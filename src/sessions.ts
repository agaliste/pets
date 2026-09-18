// Detects running Claude Code, Codex CLI, and OpenCode sessions on this machine.
// Codex uses live processes plus their open rollout files (never a cwd guess).
//
// Sources, in order of trust:
//  1. `ps` — the authoritative list of live `claude` processes.
//  2. ~/.claude/sessions/<pid>.json — registry written by Claude Code with
//     name, cwd, sessionId and a live busy/idle status.
//  3. `lsof` — cwd fallback for claude processes without a registry entry.
//  4. ~/.claude/projects/<cwd>/<sessionId>.jsonl — transcript, read only from
//     its tail to pick up the AI-generated session title and last activity.

import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { codexIndexPath, isCodexCommand, parseCodexActivity, parseCodexFiles, parseCodexMetadata, parseCodexTitles, readChunk } from "./codex.ts";
import { parseOpenCodeCommand, parseOpenCodeFiles, readOpenCodeSession, type OpenCodeCommand } from "./opencode.ts";

export type SessionStatus = "busy" | "idle" | "unknown";
export const PROVIDER_NAMES = { claude: "Claude", codex: "Codex", opencode: "OpenCode" } as const;

export interface AgentSession {
  provider: keyof typeof PROVIDER_NAMES;
  pid: number;
  sessionId: string | null;
  cwd: string;
  name: string;
  status: SessionStatus;
  startedAt: number; // epoch ms
  version: string | null;
  title: string | null;
  source: "registry" | "ps" | "rollout" | "database";
  lastActivity: number; // epoch ms
}

export type ClaudeSession = AgentSession;

const PS_INTERVAL = 2500;
const REGISTRY_INTERVAL = 1000;
const TITLE_INTERVAL_FOUND = 60_000;
const TITLE_INTERVAL_MISSING = 8_000;
const TAIL_BYTES = 256 * 1024;
const HEAD_BYTES = 128 * 1024;

const NON_SESSION_SUBCOMMANDS = new Set([
  "mcp", "doctor", "update", "install", "config", "plugin", "plugins", "auth", "login", "logout",
  "setup-token", "migrate-installer", "agents", "--version", "-v", "--help", "-h", "upgrade",
]);

async function run(cmd: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } catch {
    return "";
  }
}

export function isClaudeCommand(argv: string[]): boolean {
  const b0 = basename(argv[0] ?? "");
  let claudeArgs: string[] | null = null;
  if (b0 === "claude") claudeArgs = argv.slice(1);
  else if (/^(node|bun|deno)\d*$/.test(b0)) {
    const a1 = argv[1] ?? "";
    if (basename(a1) === "claude" || (a1.includes("claude-code") && a1.endsWith("cli.js"))) {
      claudeArgs = argv.slice(2);
    }
  }
  if (!claudeArgs) return false;
  const first = claudeArgs[0];
  if (first !== undefined && NON_SESSION_SUBCOMMANDS.has(first)) return false;
  return true;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

interface RegistryEntry {
  pid: number;
  sessionId?: string;
  cwd?: string;
  name?: string;
  status?: string;
  startedAt?: number;
  version?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

interface TitleCache {
  checkedAt: number;
  title: string | null;
  mtime: number;
}

export class SessionTracker {
  constructor(
    private readonly runCommand: (cmd: string[]) => Promise<string> = run,
    private readonly claudeDir = join(homedir(), ".claude"),
  ) {}
  private sessions = new Map<number, ClaudeSession>();
  private livePids = new Set<number>();
  private codexPids = new Map<number, number>(); // pid -> process start time
  private openCodePids = new Map<number, OpenCodeCommand & { startedAt: number }>();
  private codexRollouts = new Map<number, { path: string; mtime: number; size: number }>();
  private codexTitles = new Map<string, { at: number; titles: Map<string, string> }>();
  private lastPs = 0;
  private lastRegistry = 0;
  private cwdCache = new Map<number, string>();
  private titles = new Map<number, TitleCache>();
  private transcriptScan = new Map<string, { at: number; mtime: number }>();
  private registryCache = new Map<string, { mtime: number; size: number; entry: RegistryEntry | null }>();
  private polling = false;
  lastError: string | null = null;

  list(): ClaudeSession[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  /** Cheap to call every frame; does real work only when an interval elapsed. */
  async poll(now: number): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      if (now - this.lastPs >= PS_INTERVAL) {
        this.lastPs = now;
        await this.scanProcesses();
      }
      if (now - this.lastRegistry >= REGISTRY_INTERVAL) {
        this.lastRegistry = now;
        await this.readRegistry(now);
        await this.readCodexSessions(now);
        await this.readOpenCodeSessions();
        await this.refreshTitles(now);
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.polling = false;
    }
  }

  private async scanProcesses(): Promise<void> {
    const out = await this.runCommand(["ps", "-axo", "pid=,ppid=,etime=,command="]);
    if (!out.trim()) throw new Error("Unable to read the process list");
    const pids = new Set<number>();
    const codex = new Map<number, { parent: number; startedAt: number; wrapper: boolean }>();
    const opencode = new Map<number, OpenCodeCommand & { parent: number; startedAt: number }>();
    for (const raw of out.split("\n")) {
      const match = raw.match(/^\s*(\d+)\s+(\d+)\s+([\d:-]+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      const argv = match[4]!.trim().split(/\s+/);
      const openCodeCommand = parseOpenCodeCommand(argv);
      const [days, clock] = match[3]!.includes("-") ? match[3]!.split("-") : ["0", match[3]!];
      const seconds = clock!.split(":").reduce((total, part) => total * 60 + Number(part), 0) + Number(days) * 86400;
      const startedAt = Date.now() - seconds * 1000;
      if (isClaudeCommand(argv)) pids.add(pid);
      else if (isCodexCommand(argv)) {
        codex.set(pid, { parent: Number(match[2]), startedAt, wrapper: basename(argv[0]!) !== "codex" });
      } else if (openCodeCommand) opencode.set(pid, { ...openCodeCommand, parent: Number(match[2]), startedAt });
    }
    // npm's node wrapper stays alive while its native Codex child runs.
    const wrappers = new Set([...codex.values()].map((p) => p.parent));
    this.codexPids = new Map([...codex].filter(([pid, p]) => !p.wrapper || !wrappers.has(pid)).map(([pid, p]) => [pid, p.startedAt]));
    const openCodeParents = new Set([...opencode.values()].map(p => p.parent));
    this.openCodePids = new Map([...opencode].filter(([pid, p]) => !p.wrapper || !openCodeParents.has(pid)));
    this.livePids = pids;
    for (const pid of [...this.sessions.keys()]) {
      if (!pids.has(pid) && !this.codexPids.has(pid) && !this.openCodePids.has(pid)) {
        this.sessions.delete(pid);
        this.cwdCache.delete(pid);
        this.titles.delete(pid);
        this.codexRollouts.delete(pid);
      }
    }
  }

  private async readRegistry(now: number): Promise<void> {
    const dir = join(this.claudeDir, "sessions");
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      files = [];
    }
    const names = files.filter((f) => f.endsWith(".json")); // never touch the .key files
    const entries = await Promise.all(names.map((f) => this.readRegistryFile(dir, f)));
    const present = new Set(names);
    for (const f of this.registryCache.keys()) if (!present.has(f)) this.registryCache.delete(f);
    const seen = new Set<number>();
    for (const entry of entries) {
      if (!entry || typeof entry.pid !== "number") continue;
      if (!this.livePids.has(entry.pid) || !isAlive(entry.pid)) continue;
      seen.add(entry.pid);
      const cwd = entry.cwd ?? this.cwdCache.get(entry.pid) ?? "?";
      const status: SessionStatus = entry.status === "busy" ? "busy" : entry.status === "idle" ? "idle" : "unknown";
      const prev = this.sessions.get(entry.pid);
      this.sessions.set(entry.pid, {
        provider: "claude",
        pid: entry.pid,
        sessionId: entry.sessionId ?? prev?.sessionId ?? null,
        cwd,
        name: entry.name ?? prev?.name ?? basename(cwd),
        status,
        startedAt: entry.startedAt ?? prev?.startedAt ?? now,
        version: entry.version ?? prev?.version ?? null,
        title: prev?.title ?? null,
        source: "registry",
        lastActivity: Math.max(entry.statusUpdatedAt ?? 0, entry.updatedAt ?? 0, prev?.lastActivity ?? 0),
      });
    }

    // Processes without a registry file: fall back to lsof for the cwd.
    const orphans = [...this.livePids].filter((pid) => !seen.has(pid));
    const needCwd = orphans.filter((pid) => !this.cwdCache.has(pid));
    if (needCwd.length > 0) {
      const out = await this.runCommand(["lsof", "-a", "-p", needCwd.join(","), "-d", "cwd", "-Fpn"]);
      let cur = -1;
      for (const line of out.split("\n")) {
        if (line.startsWith("p")) cur = Number(line.slice(1));
        else if (line.startsWith("n") && cur > 0) this.cwdCache.set(cur, line.slice(1));
      }
      for (const pid of needCwd) if (!this.cwdCache.has(pid)) this.cwdCache.set(pid, "?");
    }
    for (const pid of orphans) {
      const cwd = this.cwdCache.get(pid) ?? "?";
      const prev = this.sessions.get(pid);
      const activity = await this.newestTranscriptMtime(cwd);
      const status: SessionStatus = activity > 0 ? (now - activity < 20_000 ? "busy" : "idle") : "unknown";
      this.sessions.set(pid, {
        provider: "claude",
        pid,
        sessionId: null,
        cwd,
        name: prev?.name ?? (basename(cwd) || "claude"),
        status,
        startedAt: prev?.startedAt ?? now,
        version: null,
        title: null,
        source: "ps",
        lastActivity: activity,
      });
    }
  }

  /** Re-parses a registry file only when its mtime or size changed since the last poll. */
  private async readRegistryFile(dir: string, f: string): Promise<RegistryEntry | null> {
    const path = join(dir, f);
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(path);
    } catch {
      this.registryCache.delete(f);
      return null;
    }
    const cached = this.registryCache.get(f);
    if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached.entry;
    let entry: RegistryEntry | null = null;
    try {
      entry = JSON.parse(await readFile(path, "utf8")) as RegistryEntry;
    } catch {
      entry = null;
    }
    this.registryCache.set(f, { mtime: st.mtimeMs, size: st.size, entry });
    return entry;
  }

  private async readCodexSessions(now: number): Promise<void> {
    if (this.codexPids.size === 0) return;
    const files = parseCodexFiles(await this.runCommand(["lsof", "-a", "-p", [...this.codexPids.keys()].join(","), "-Fpfn"]));
    for (const [pid, startedAt] of this.codexPids) {
      const opened = files.get(pid);
      const prev = this.sessions.get(pid);
      // Never choose arbitrarily between multiple transcripts (e.g. subagents).
      const path = opened?.rollouts.length === 1 ? opened.rollouts[0] : undefined;
      const cwd = opened?.cwd ?? prev?.cwd ?? "?";
      let session: AgentSession = {
        provider: "codex", pid, sessionId: null, cwd,
        name: basename(cwd) || "codex", status: "unknown",
        startedAt: prev?.startedAt ?? startedAt, version: null, title: null,
        source: "ps", lastActivity: 0,
      };
      if (path) {
        try {
          const st = await stat(path);
          const cached = this.codexRollouts.get(pid);
          if (prev && cached?.path === path && cached.mtime === st.mtimeMs && cached.size === st.size) {
            session = { ...prev };
          } else {
            const meta = parseCodexMetadata(await readChunk(path, HEAD_BYTES));
            const activity = parseCodexActivity(await readChunk(path, TAIL_BYTES, true));
            if (meta) {
              session = { ...session, ...meta, ...activity, name: basename(meta.cwd) || "codex", source: "rollout" };
              // A resumed process may still hold an interrupted turn from an old run.
              if (session.status === "busy" && session.lastActivity < startedAt - 2000) session.status = "unknown";
              this.codexRollouts.set(pid, { path, mtime: st.mtimeMs, size: st.size });
            }
          }
          const index = codexIndexPath(path);
          if (index && session.sessionId) {
            let titles = this.codexTitles.get(index);
            if (!titles || now - titles.at >= TITLE_INTERVAL_MISSING) {
              const chunk = await readChunk(index, TAIL_BYTES, true).catch(() => "");
              titles = { at: now, titles: parseCodexTitles(chunk) };
              this.codexTitles.set(index, titles);
            }
            session.title = titles.titles.get(session.sessionId) ?? null;
          }
        } catch {
          // Missing/inaccessible metadata does not hide an authoritative live PID.
          this.codexRollouts.delete(pid);
        }
      } else this.codexRollouts.delete(pid);
      this.sessions.set(pid, session);
    }
  }

  private async readOpenCodeSessions(): Promise<void> {
    if (!this.openCodePids.size) return;
    const files = parseOpenCodeFiles(await this.runCommand(["lsof", "-a", "-p", [...this.openCodePids.keys()].join(","), "-Fpfn"]));
    for (const [pid, command] of this.openCodePids) {
      const opened = files.get(pid);
      const prev = this.sessions.get(pid);
      const cwd = opened?.cwd ?? prev?.cwd ?? "?";
      const startedAt = prev?.startedAt ?? command.startedAt;
      let session: AgentSession = {
        provider: "opencode", pid, sessionId: command.sessionId, cwd,
        name: basename(cwd) || "opencode", status: "unknown", startedAt,
        version: null, title: null, source: "ps", lastActivity: 0,
      };
      // Multiple opened databases are ambiguous. Never substitute the global history file.
      if (command.sessionId && opened?.databases.length === 1) {
        const meta = readOpenCodeSession(opened.databases[0]!, command.sessionId, startedAt);
        if (meta) session = { ...session, ...meta, name: basename(meta.cwd) || "opencode", source: "database" };
      }
      this.sessions.set(pid, session);
    }
  }

  private async newestTranscriptMtime(cwd: string): Promise<number> {
    if (cwd === "?") return 0;
    const cached = this.transcriptScan.get(cwd);
    const now = Date.now();
    if (cached && now - cached.at < 5000) return cached.mtime;
    const mtime = await this.scanTranscripts(join(this.claudeDir, "projects", encodeProjectDir(cwd)));
    this.transcriptScan.set(cwd, { at: now, mtime });
    return mtime;
  }

  private async scanTranscripts(dir: string): Promise<number> {
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
      const mtimes = await Promise.all(files.map((f) => stat(join(dir, f)).then((st) => st.mtimeMs, () => 0)));
      return mtimes.reduce((newest, m) => (m > newest ? m : newest), 0);
    } catch {
      return 0;
    }
  }

  private transcriptPath(s: ClaudeSession): string | null {
    if (s.provider !== "claude") return null;
    if (!s.sessionId || s.cwd === "?") return null;
    return join(this.claudeDir, "projects", encodeProjectDir(s.cwd), `${s.sessionId}.jsonl`);
  }

  private async refreshTitles(now: number): Promise<void> {
    for (const s of this.sessions.values()) {
      const path = this.transcriptPath(s);
      if (!path) continue;
      const cache = this.titles.get(s.pid);
      const interval = cache?.title ? TITLE_INTERVAL_FOUND : TITLE_INTERVAL_MISSING;
      let mtime = cache?.mtime ?? 0;
      try {
        mtime = (await stat(path)).mtimeMs;
      } catch {
        continue;
      }
      if (mtime > s.lastActivity) s.lastActivity = mtime;
      if (cache && now - cache.checkedAt < interval) {
        s.title = cache.title;
        continue;
      }
      const title = await readAiTitle(path);
      this.titles.set(s.pid, { checkedAt: now, title, mtime });
      s.title = title;
    }
  }
}

function findTitle(chunk: string): string | null {
  const lines = chunk.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"type":"ai-title"')) continue;
    try {
      const obj = JSON.parse(line) as { aiTitle?: unknown };
      if (typeof obj.aiTitle === "string" && obj.aiTitle.trim()) return obj.aiTitle.trim();
    } catch {
      // partial line at the chunk boundary; keep looking
    }
  }
  return null;
}

async function readAiTitle(path: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(path, "r");
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, TAIL_BYTES);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const fromTail = findTitle(tail.toString("utf8"));
    if (fromTail || size <= TAIL_BYTES) return fromTail;
    const headLen = Math.min(size, HEAD_BYTES);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);
    return findTitle(head.toString("utf8"));
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}
