// Read-only OpenCode discovery. A shared database is not evidence of a live session.
import { Database } from "bun:sqlite";
import { basename } from "node:path";
import type { SessionStatus } from "./sessions.ts";

const HELPERS = new Set([
  "agent", "auth", "completion", "db", "debug", "export", "github", "import", "mcp",
  "models", "session", "stats", "upgrade", "uninstall", "serve", "web", "acp", "help",
  "plugin", "plug",
]);
const VALUES = new Set([
  "--log-level", "--model", "-m", "--agent", "--session", "-s", "--prompt", "--port",
  "--hostname", "--title", "--file", "-f", "--format", "--command", "--attach", "--dir",
  "--password", "-p", "--username", "-u", "--variant",
]);

export interface OpenCodeCommand { sessionId: string | null; wrapper: boolean; remote: boolean }

export function parseOpenCodeCommand(argv: string[]): OpenCodeCommand | null {
  const executable = basename(argv[0] ?? "");
  const wrapper = /^(node|bun)\d*$/.test(executable) &&
    /(?:^|\/)opencode-ai\/bin\/opencode(?:\.js)?$/.test(argv[1] ?? "");
  if (executable !== "opencode" && !wrapper) return null;
  const args = argv.slice(wrapper ? 2 : 1);
  let positional = false, sessionId: string | null = null, remote = false, fork = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (["--help", "-h", "--version", "-v"].includes(arg)) return null;
    if (arg === "--fork") fork = true;
    const [key, inline] = arg.split(/=(.*)/s);
    if (VALUES.has(key!)) {
      const value = inline ?? args[++i];
      if (key === "--session" || key === "-s") sessionId = value ?? null;
      if (key === "--attach") remote = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (!positional && HELPERS.has(arg)) return null;
    if (!positional && arg === "attach") remote = true;
    positional = true; // run prompts and project paths may contain helper names
  }
  // A fork creates a new ID; an attached session belongs to a different backend.
  return { wrapper, remote, sessionId: !fork && !remote && /^ses_[\w-]+$/.test(sessionId ?? "") ? sessionId : null };
}

export interface OpenCodeFiles { cwd: string; databases: string[] }

export function parseOpenCodeFiles(output: string): Map<number, OpenCodeFiles> {
  const files = new Map<number, OpenCodeFiles>();
  let current: OpenCodeFiles | undefined, descriptor = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      current = Number.isSafeInteger(pid) && pid > 0 ? { cwd: "?", databases: [] } : undefined;
      if (current) files.set(pid, current);
      descriptor = "";
    } else if (line.startsWith("f")) descriptor = line.slice(1);
    else if (line.startsWith("n") && current) {
      const path = line.slice(1);
      if (descriptor === "cwd") current.cwd = path;
      else if (path.startsWith("/") && /\.(?:db|sqlite|sqlite3)$/.test(path) && !current.databases.includes(path)) {
        current.databases.push(path);
      }
    }
  }
  return files;
}

interface SessionRow { id: string; directory: string; title: string; version: string }
interface ActivityRow { role: string | null; completed: number | null; finish: string | null; error: string | null; updated: number }
export interface OpenCodeMetadata {
  sessionId: string; cwd: string; title: string | null; version: string | null;
  status: SessionStatus; lastActivity: number;
}

/** Only an explicit CLI session ID may select history; never pick the newest cwd match. */
export function readOpenCodeSession(path: string, sessionId: string, startedAt: number): OpenCodeMetadata | null {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true, create: false });
    const row = db.query<SessionRow, [string]>(
      "SELECT id, directory, title, version FROM session WHERE id = ? AND parent_id IS NULL",
    ).get(sessionId);
    if (!row || typeof row.directory !== "string") return null;
    const activity = db.query<ActivityRow, [string]>(`
      SELECT json_extract(data, '$.role') AS role, json_extract(data, '$.time.completed') AS completed,
        json_extract(data, '$.finish') AS finish, json_extract(data, '$.error.name') AS error,
        time_updated AS updated FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1
    `).get(sessionId);
    let status: SessionStatus = "unknown";
    const lastActivity = activity?.updated ?? 0;
    // Old messages can belong to an interrupted previous process. They cannot set live status.
    if (activity && lastActivity >= startedAt - 2000) {
      if (activity.error || (activity.role === "assistant" && activity.completed &&
        ["stop", "length", "content-filter"].includes(activity.finish ?? ""))) status = "idle";
      else if (activity.role === "user" || (activity.role === "assistant" &&
        (!activity.completed || activity.finish === "tool-calls"))) status = "busy";
    }
    return { sessionId: row.id, cwd: row.directory, title: row.title || null, version: row.version || null, status, lastActivity };
  } catch {
    return null; // Older schemas, locked files, and missing metadata leave the process visible.
  } finally {
    db?.close();
  }
}
