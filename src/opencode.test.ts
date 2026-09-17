import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenCodeCommand, parseOpenCodeFiles, readOpenCodeSession } from "./opencode.ts";
import { SessionTracker } from "./sessions.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pets-opencode-"));
  roots.push(root);
  const path = join(root, "custom history.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, version TEXT, parent_id TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    INSERT INTO session VALUES ('ses_one', '/project with spaces', 'OpenCode task', '1.18.30', NULL);
    INSERT INTO session VALUES ('ses_child', '/project with spaces', 'Child task', '1.18.30', 'ses_one');`);
  const update = (data: object, at = Date.now()) => db.query("INSERT OR REPLACE INTO message VALUES ('msg_one', 'ses_one', ?, ?, ?)").run(at, at, JSON.stringify(data));
  return { root, path, db, update };
}

test.each([
  ["opencode"], ["/opt/homebrew/bin/opencode", "/project with spaces"],
  ["node", "/npm/opencode-ai/bin/opencode", "run", "task"],
  ["opencode", "--model", "vendor/model", "run", "auth"],
  ["opencode", "attach", "http://localhost:4096"], ["opencode", "--", "auth"],
].map(argv => ({ argv })))("detects live OpenCode CLI command $argv", ({ argv }) => {
  expect(parseOpenCodeCommand(argv)).not.toBeNull();
});

test.each([
  ["opencode", "auth", "login"], ["opencode", "--log-level", "INFO", "session", "list"],
  ["opencode", "--model=vendor/model", "mcp"], ["opencode", "db", "path"],
  ["opencode", "serve"], ["opencode", "web"], ["opencode", "acp"],
  ["opencode", "--version"], ["opencode", "run", "--help"], ["opencode", "models"],
  ["sh", "-c", "opencode"], ["node", "/tmp/opencode"], ["opencode-desktop"],
].map(argv => ({ argv })))("excludes helper command $argv", ({ argv }) => {
  expect(parseOpenCodeCommand(argv)).toBeNull();
});

test("explicit session IDs do not leak through forks or attached backends", () => {
  expect(parseOpenCodeCommand(["opencode", "-s", "ses_one"])?.sessionId).toBe("ses_one");
  expect(parseOpenCodeCommand(["opencode", "--session=ses_one"])?.sessionId).toBe("ses_one");
  for (const args of [["--fork"], ["attach", "http://localhost:4096"], ["run", "--attach=http://localhost:4096"]]) {
    expect(parseOpenCodeCommand(["opencode", ...args, "-s", "ses_one"])?.sessionId).toBeNull();
  }
});

test("open files preserve PID boundaries, spaces, and custom database paths", () => {
  expect(parseOpenCodeFiles("p7\nfcwd\nn/project with spaces\nf3\nn/data/custom history.sqlite\nf4\nn/data/custom history.sqlite\nf5\nn/data/custom history.sqlite-wal\np8\nfcwd\nn/other\n").get(7))
    .toEqual({ cwd: "/project with spaces", databases: ["/data/custom history.sqlite"] });
});

test("read-only metadata tracks new messages, tool continuations, completion, and interruptions", async () => {
  const { db, path, update } = await fixture();
  try {
    const start = Date.now() - 10_000;
    update({ role: "user" });
    expect(readOpenCodeSession(path, "ses_one", start)).toMatchObject({ status: "busy", title: "OpenCode task" });
    update({ role: "assistant", time: { completed: Date.now() }, finish: "tool-calls" });
    expect(readOpenCodeSession(path, "ses_one", start)?.status).toBe("busy");
    update({ role: "assistant", time: { completed: Date.now() }, finish: "stop" });
    expect(readOpenCodeSession(path, "ses_one", start)?.status).toBe("idle");
    update({ role: "assistant", time: { completed: Date.now() }, finish: "new-format" });
    expect(readOpenCodeSession(path, "ses_one", start)?.status).toBe("unknown");
    update({ role: "assistant", error: { name: "MessageAbortedError" } });
    expect(readOpenCodeSession(path, "ses_one", start)?.status).toBe("idle");
    update({ role: "user" }, start - 60_000);
    expect(readOpenCodeSession(path, "ses_one", start)?.status).toBe("unknown");
    expect(readOpenCodeSession(path, "ses_child", start)).toBeNull();
    expect(readOpenCodeSession(path, "ses_missing", start)).toBeNull();
    update({ role: "user" }); // reader released its connection; the writer remains usable
  } finally { db.close(); }
});

test("missing, malformed, and unsupported databases fail without creating files", async () => {
  const { db, root } = await fixture();
  db.close();
  const path = join(root, "missing.db");
  expect(readOpenCodeSession(path, "ses_one", 0)).toBeNull();
  expect(await Bun.file(path).exists()).toBe(false);
  await writeFile(path, "not sqlite");
  expect(readOpenCodeSession(path, "ses_one", 0)).toBeNull();
});

test("tracker deduplicates launchers, keeps same-directory sessions separate, and removes exits", async () => {
  const { db, root, path, update } = await fixture();
  try {
    update({ role: "user" });
    let ps = "101 1 00:10 node /npm/opencode-ai/bin/opencode -s ses_one\n102 101 00:10 /native/bin/opencode -s ses_one\n103 102 00:05 opencode\n104 1 00:10 opencode serve\n105 1 00:10 codex\n";
    let files = `p102\nfcwd\nn/project with spaces\nf3\nn${path}\np103\nfcwd\nn/project with spaces\nf3\nn${path}\n`;
    const tracker = new SessionTracker(async cmd => cmd[0] === "ps" ? ps : files, join(root, "claude"));
    const now = Date.now();
    await tracker.poll(now);
    expect(tracker.list().map(s => s.pid).sort()).toEqual([102, 103, 105]);
    expect(tracker.list().find(s => s.pid === 102)).toMatchObject({ provider: "opencode", source: "database", status: "busy", sessionId: "ses_one" });
    expect(tracker.list().find(s => s.pid === 103)).toMatchObject({ provider: "opencode", status: "unknown", sessionId: null });
    files = files.replace("p103\n", `f4\nn${join(root, "second.db")}\np103\n`);
    await tracker.poll(now + 1001);
    expect(tracker.list().find(s => s.pid === 102)?.status).toBe("unknown");
    ps = "999 1 00:01 unrelated\n";
    await tracker.poll(now + 3000);
    expect(tracker.list()).toEqual([]); // the saved database never creates a pet
  } finally { db.close(); }
});
