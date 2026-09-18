// Read-only adapters for Codex CLI processes and their open rollout files.
import { open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SessionStatus } from "./sessions.ts";

const NON_SESSIONS = new Set([
  "app", "app-server", "mcp", "mcp-server", "login", "logout", "completion",
  "debug", "sandbox", "exec-server", "cloud", "apply", "a", "features", "help",
  "update", "upgrade", "--help", "-h", "--version", "-V",
]);
const VALUE_OPTIONS = new Set([
  "-c", "--config", "-m", "--model", "-p", "--profile", "-C", "--cd",
  "-s", "--sandbox", "-a", "--ask-for-approval", "-i", "--image",
  "--add-dir", "--enable", "--disable", "--local-provider",
  "--output-schema", "--output-last-message", "-o",
]);
const SESSION_SUBCOMMANDS = new Set(["exec", "e", "resume", "fork", "review"]);

export function isCodexCommand(argv: string[]): boolean {
  const executable = basename(argv[0] ?? "");
  let args: string[];
  if (executable === "codex") args = argv.slice(1);
  else if (/^(node|bun|deno)\d*$/.test(executable) &&
    /(?:^|\/)@openai\/codex\/bin\/codex\.js$/.test(argv[1] ?? "")) args = argv.slice(2);
  else return false;
  let subcommand = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (NON_SESSIONS.has(arg) && (!subcommand || arg.startsWith("-"))) return false;
    if (arg === "--") return true;
    if (VALUE_OPTIONS.has(arg)) { i++; continue; }
    if (arg.startsWith("-")) continue;
    if (!subcommand && SESSION_SUBCOMMANDS.has(arg)) { subcommand = true; continue; }
    // exec/review/resume/fork and an interactive positional prompt are sessions.
    return true;
  }
  return true;
}

export interface CodexFiles { cwd: string; rollouts: string[] }

export function parseCodexFiles(output: string): Map<number, CodexFiles> {
  const result = new Map<number, CodexFiles>();
  let current: CodexFiles | undefined;
  let descriptor = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      current = Number.isSafeInteger(pid) && pid > 0 ? { cwd: "?", rollouts: [] } : undefined;
      if (current) result.set(pid, current);
      descriptor = "";
    } else if (line.startsWith("f")) descriptor = line.slice(1);
    else if (line.startsWith("n") && current) {
      const path = line.slice(1);
      if (descriptor === "cwd") current.cwd = path;
      else if (path.startsWith("/") && /^rollout-.*\.jsonl$/.test(basename(path)) &&
        !current.rollouts.includes(path)) current.rollouts.push(path);
    }
  }
  return result;
}

interface RecordLine { type?: string; timestamp?: string; payload?: Record<string, unknown> }

function parseRecord(line: string): RecordLine | undefined {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLine : undefined;
  } catch { return undefined; } // A live writer may leave a partial line at either boundary.
}

/** Lazily parse JSONL lines so callers that stop early skip the rest of the chunk. */
function* records(chunk: string, reverse = false): Generator<RecordLine> {
  const lines = chunk.split("\n");
  if (reverse) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const record = parseRecord(lines[i]!);
      if (record) yield record;
    }
  } else {
    for (const line of lines) {
      const record = parseRecord(line);
      if (record) yield record;
    }
  }
}

export interface CodexMetadata {
  sessionId: string;
  cwd: string;
  version: string | null;
}

export function parseCodexMetadata(head: string): CodexMetadata | null {
  let meta: Record<string, unknown> | undefined;
  for (const record of records(head)) {
    if (record.type === "session_meta") { meta = record.payload; break; }
  }
  if (typeof meta?.id !== "string" || typeof meta.cwd !== "string") return null;
  return {
    sessionId: meta.id,
    cwd: meta.cwd,
    version: typeof meta.cli_version === "string" ? meta.cli_version : null,
  };
}

export function parseCodexActivity(tail: string): { status: SessionStatus; lastActivity: number } {
  let lastActivity = 0;
  let active = false;
  for (const row of records(tail, true)) {
    const timestamp = Date.parse(row.timestamp ?? "");
    if (Number.isFinite(timestamp)) lastActivity = Math.max(lastActivity, timestamp);
    if (row.type !== "event_msg") continue;
    const type = row.payload?.type;
    if (type === "task_complete" || type === "task_completed" || type === "turn_aborted") {
      return { status: "idle", lastActivity };
    }
    if (type === "task_started") return { status: "busy", lastActivity };
    if (type === "token_count" || type === "agent_message" || type === "agent_reasoning" || type === "item_completed") active = true;
  }
  // Long turns may have their start outside the bounded tail.
  return { status: active ? "busy" : "unknown", lastActivity };
}

export function parseCodexTitles(chunk: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const row of records(chunk) as Iterable<Record<string, unknown>>) {
    if (typeof row.id === "string" && typeof row.thread_name === "string" && row.thread_name.trim()) {
      titles.set(row.id, row.thread_name.trim());
    }
  }
  return titles;
}

/** Derive the actual Codex home, including custom homes, from an open rollout. */
export function codexIndexPath(rollout: string): string | null {
  let dir = dirname(rollout);
  while (dir !== dirname(dir)) {
    if (basename(dir) === "sessions") return join(dirname(dir), "session_index.jsonl");
    dir = dirname(dir);
  }
  return null;
}

export async function readChunk(path: string, bytes: number, tail = false): Promise<string> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const length = Math.min(size, bytes);
    const offset = tail ? size - length : 0;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, offset);
    const text = buffer.toString("utf8", 0, bytesRead);
    return offset > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally { await file.close(); }
}
