import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexIndexPath, isCodexCommand, parseCodexActivity, parseCodexFiles, parseCodexMetadata, parseCodexTitles, readChunk } from "./codex.ts";
import { isClaudeCommand, isValidClaudeSessionId, isWithinDir, SessionTracker } from "./sessions.ts";
import { CODEX_MASCOT, CODEX_PALETTE, OPENCODE_MASCOT, OPENCODE_PALETTE, MASCOT, MASCOT_H, MASCOT_W } from "./sprites.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const event = (type: string, timestamp = new Date().toISOString()) => JSON.stringify({ type: "event_msg", timestamp, payload: { type } }) + "\n";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pets-sessions-"));
  roots.push(root);
  const dir = join(root, "custom codex home", "sessions", "2026", "09", "15");
  await mkdir(dir, { recursive: true });
  const rollout = join(dir, "rollout-test-session.jsonl");
  await writeFile(rollout, JSON.stringify({ type: "session_meta", payload: { id: "session-1", cwd: "/work/project with spaces", cli_version: "test", source: "cli" } }) + "\n" + event("task_started"));
  const index = codexIndexPath(rollout)!;
  await writeFile(index, JSON.stringify({ id: "session-1", thread_name: "A Codex task" }) + "\n");
  return { root, rollout, index };
}

describe("Codex command detection", () => {
  test.each([
    ["codex"], ["/opt/homebrew/bin/codex", "--yolo"],
    ["codex", "--config", "model=example", "resume", "id"],
    ["codex", "--profile", "work", "exec", "task"],
    ["codex", "fork", "--last"], ["codex", "review", "--uncommitted"],
    ["node", "/opt/node_modules/@openai/codex/bin/codex.js", "--yolo"],
    ["codex", "--", "login"],
    ["codex", "exec", "login"],
  ].map((argv) => ({ argv })))("recognizes session argv %j", ({ argv }) => expect(isCodexCommand(argv)).toBe(true));

  test.each([
    ["CodexBar"], ["codex-code-mode-host"], ["sh", "-c", "codex"],
    ["node", "/tmp/codex.js"], ["codex", "--version"], ["codex", "login"],
    ["codex", "--config", "a=b", "app-server"],
    ["codex", "--profile=work", "mcp-server"], ["codex", "app"],
    ["codex", "completion", "zsh"], ["codex", "--profile", "work", "--help"],
    ["codex", "exec", "--help"], ["codex", "resume", "--help"],
  ].map((argv) => ({ argv })))("excludes non-session argv %j", ({ argv }) => expect(isCodexCommand(argv)).toBe(false));

  test("preserves Claude classification", () => {
    expect(isClaudeCommand(["claude", "--resume", "id"])).toBe(true);
    expect(isClaudeCommand(["node", "/npm/claude-code/cli.js"])).toBe(true);
    expect(isClaudeCommand(["claude", "mcp"])).toBe(false);
    expect(isClaudeCommand(["codex"])).toBe(false);
  });
});

test("parses exact per-PID open files, with spaces and duplicate descriptors", () => {
  const output = "p123\nfcwd\nn/work/shared project\nf10\nn/custom home/sessions/rollout-one.jsonl\nf11\nn/custom home/sessions/rollout-one.jsonl\nf12\nn/tmp/not-a-rollout.jsonl\np456\nfcwd\nn/work/shared project\nf20\nn/custom home/sessions/rollout-two.jsonl\n";
  const files = parseCodexFiles(output);
  expect(files.get(123)).toEqual({ cwd: "/work/shared project", rollouts: ["/custom home/sessions/rollout-one.jsonl"] });
  expect(files.get(456)?.rollouts).toEqual(["/custom home/sessions/rollout-two.jsonl"]);
});

test("Codex status follows the latest turn boundary, including interruption", () => {
  expect(parseCodexActivity(event("task_started") + event("task_complete")).status).toBe("idle");
  expect(parseCodexActivity(event("task_complete") + event("task_started")).status).toBe("busy");
  expect(parseCodexActivity(event("task_started") + event("turn_aborted")).status).toBe("idle");
  expect(parseCodexActivity(event("task_started", "2020-01-01T00:00:00Z")).status).toBe("busy");
  expect(parseCodexActivity('broken prefix\n' + event("token_count") + '{"partial":').status).toBe("busy");
  expect(parseCodexActivity('null\n{}\n{"payload":null}\n').status).toBe("unknown");
  expect(parseCodexMetadata('not json\n')).toBeNull();
});

test("titles tolerate partial records and follow the latest rename", () => {
  const titles = parseCodexTitles('partial\n{"id":"s","thread_name":"Old"}\n{"id":"s","thread_name":"New"}\n{"id":');
  expect(titles.get("s")).toBe("New");
});

test("bounded reads and custom Codex homes", async () => {
  const { rollout, index } = await fixture();
  expect(codexIndexPath(rollout)).toBe(index);
  expect(codexIndexPath("/tmp/rollout-x.jsonl")).toBeNull();
  expect(parseCodexMetadata(await readChunk(rollout, 128 * 1024))?.sessionId).toBe("session-1");
  expect((await readChunk(rollout, 80, true)).length).toBeLessThanOrEqual(80);
});

test("tracker combines providers, removes only launcher duplicates, and tracks completion/exit", async () => {
  const { root, rollout } = await fixture();
  const claudePid = process.ppid;
  const registry = join(root, "claude", "sessions");
  await mkdir(registry, { recursive: true });
  await writeFile(join(registry, "claude.json"), JSON.stringify({ pid: claudePid, cwd: "/work/claude", status: "busy", name: "Claude task" }));
  let ps = `101 1 00:10 node /npm/@openai/codex/bin/codex.js\n102 101 00:10 /npm/vendor/codex\n103 102 00:01 codex exec task\n104 1 00:10 codex --profile work app-server\n${claudePid} 1 00:10 claude\n`;
  const commands: string[][] = [];
  const tracker = new SessionTracker(async (cmd) => {
    commands.push(cmd);
    return cmd[0] === "ps" ? ps : `p102\nfcwd\nn/work/project with spaces\nf10\nn${rollout}\np103\nfcwd\nn/work/child\n`;
  }, join(root, "claude"));
  const now = Date.now();
  await tracker.poll(now);
  expect(tracker.lastError).toBeNull();
  expect(tracker.list().map((s) => s.pid).sort((a, b) => a - b)).toEqual([102, 103, claudePid].sort((a, b) => a - b));
  expect(tracker.list().find((s) => s.pid === 102)).toMatchObject({ provider: "codex", sessionId: "session-1", title: "A Codex task", cwd: "/work/project with spaces", status: "busy", source: "rollout" });
  expect(tracker.list().find((s) => s.pid === 103)?.status).toBe("unknown");
  expect(tracker.list().find((s) => s.pid === claudePid)).toMatchObject({ provider: "claude", status: "busy", name: "Claude task" });
  expect(commands.filter((c) => c[0] === "lsof")[0]?.join(" ")).toContain("102,103");
  await appendFile(rollout, event("task_complete"));
  await tracker.poll(now + 1100);
  expect(tracker.list().find((s) => s.pid === 102)?.status).toBe("idle");
  await tracker.poll(now + 2200); // Exercise unchanged-file cache.
  expect(tracker.list().find((s) => s.pid === 102)?.status).toBe("idle");
  ps = "999 1 00:01 zsh\n";
  await tracker.poll(now + 3300);
  expect(tracker.list()).toEqual([]);
});

test("oversized registry files are skipped, even after a cached file grows past the limit", async () => {
  const { root } = await fixture();
  const claudePid = process.ppid;
  const registry = join(root, "claude", "sessions");
  await mkdir(registry, { recursive: true });
  const entry = { pid: claudePid, cwd: "/work/claude", status: "busy", name: "Claude task" };
  const oversized = JSON.stringify({ ...entry, name: "Huge", padding: "x".repeat(64 * 1024) });
  await writeFile(join(registry, "claude.json"), JSON.stringify(entry));
  await writeFile(join(registry, "huge.json"), oversized);
  const tracker = new SessionTracker(async (cmd) => cmd[0] === "ps" ? `${claudePid} 1 00:10 claude\n` : "", join(root, "claude"));
  const now = Date.now();
  await tracker.poll(now);
  expect(tracker.list()).toHaveLength(1);
  expect(tracker.list()[0]).toMatchObject({ pid: claudePid, source: "registry", name: "Claude task", status: "busy" });
  await writeFile(join(registry, "claude.json"), oversized);
  await tracker.poll(now + 1100);
  expect(tracker.list()[0]).toMatchObject({ pid: claudePid, source: "ps" });
  await writeFile(join(registry, "claude.json"), JSON.stringify({ ...entry, status: "idle" }));
  await tracker.poll(now + 2200);
  expect(tracker.list()[0]).toMatchObject({ pid: claudePid, source: "registry", status: "idle" });
});

test("ambiguous rollouts and missing files keep a live mascot with unknown status", async () => {
  const { root, rollout } = await fixture();
  let files = `p201\nfcwd\nn/work\nf1\nn${rollout}\nf2\nn/tmp/rollout-other.jsonl\n`;
  const tracker = new SessionTracker(async (cmd) => cmd[0] === "ps" ? "201 1 00:05 codex\n" : files, join(root, "claude"));
  const now = Date.now();
  await tracker.poll(now);
  expect(tracker.list()[0]).toMatchObject({ pid: 201, status: "unknown", sessionId: null });
  files = "p201\nfcwd\nn/work\nf1\nn/tmp/rollout-missing.jsonl\n";
  await tracker.poll(now + 1100);
  expect(tracker.list()[0]).toMatchObject({ pid: 201, status: "unknown", source: "ps" });
});

test("a failed process scan preserves sessions and reports an error", async () => {
  const { root } = await fixture();
  let ps = "201 1 00:05 codex\n";
  const tracker = new SessionTracker(async (cmd) => cmd[0] === "ps" ? ps : "", join(root, "claude"));
  const now = Date.now();
  await tracker.poll(now);
  ps = "";
  await tracker.poll(now + 3000);
  expect(tracker.list()).toHaveLength(1);
  expect(tracker.lastError).toContain("process list");
});

test("every Codex animation fits existing hats, desks, and collision dimensions", () => {
  expect(Object.keys(CODEX_MASCOT).sort()).toEqual(Object.keys(MASCOT).sort());
  for (const frame of Object.values(CODEX_MASCOT)) {
    expect(frame).toHaveLength(MASCOT_H);
    for (const row of frame) {
      expect(row).toHaveLength(MASCOT_W);
      for (const pixel of row) if (pixel !== ".") expect(CODEX_PALETTE[pixel]).toBeDefined();
    }
  }
});


test("OpenCode animation frames fit existing hats and have complete palettes", () => {
  expect(Object.keys(OPENCODE_MASCOT)).toEqual(Object.keys(MASCOT));
  for (const rows of Object.values(OPENCODE_MASCOT)) {
    expect(rows).toHaveLength(MASCOT_H);
    for (const row of rows) {
      expect(row).toHaveLength(MASCOT_W);
      for (const pixel of row) if (pixel !== ".") expect(OPENCODE_PALETTE[pixel]).toBeDefined();
    }
  }
});

describe("claude transcript path", () => {
  test("rejects session ids that could escape the projects directory", () => {
    expect(isValidClaudeSessionId("3f1c2a4e-9b8d-4c7a-a1e2-0f9e8d7c6b5a")).toBe(true);
    expect(isValidClaudeSessionId("session_1.v2")).toBe(true);
    for (const bad of ["", ".", "..", "../etc/foo", "a/../../b", "a\\b", "a..b/c", "a\0b", ".hidden", "x.", undefined, 42]) {
      expect(isValidClaudeSessionId(bad)).toBe(false);
    }
  });

  test("isWithinDir only accepts paths strictly inside the directory", () => {
    expect(isWithinDir("/home/u/.claude/projects/-work/abc.jsonl", "/home/u/.claude/projects")).toBe(true);
    expect(isWithinDir("/home/u/.claude/projects/-work/../../x.jsonl", "/home/u/.claude/projects")).toBe(false);
    expect(isWithinDir("/home/u/.claude/projects", "/home/u/.claude/projects")).toBe(false);
    expect(isWithinDir("/home/u/.claude/projects-evil/x.jsonl", "/home/u/.claude/projects")).toBe(false);
  });

  test("traversal in a registry sessionId never reaches files outside projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "pets-claude-"));
    roots.push(root);
    const claudeDir = join(root, ".claude");
    await mkdir(join(claudeDir, "sessions"), { recursive: true });
    await writeFile(join(root, "secret.jsonl"), JSON.stringify({ type: "ai-title", aiTitle: "LEAKED" }) + "\n");
    const pid = process.ppid;
    await writeFile(join(claudeDir, "sessions", `${pid}.json`), JSON.stringify({
      pid, cwd: "/work", sessionId: "../../../secret", status: "idle", startedAt: Date.now(), updatedAt: Date.now(),
    }));
    const tracker = new SessionTracker(async (cmd) => (cmd[0] === "ps" ? `${pid} 1 00:05 claude\n` : ""), claudeDir);
    await tracker.poll(Date.now());
    const session = tracker.list().find((s) => s.pid === pid);
    expect(session?.sessionId).toBeNull();
    expect(session?.title).toBeNull();
  });
});
