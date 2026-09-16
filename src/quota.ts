import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Sprite } from "./canvas.ts";
import type { Placement, Screen } from "./desktop-scene.ts";
import { PIXEL_FONT, pixelLabel } from "./pixel-font.ts";
import { MUSIC_COLORS } from "./singer.ts";

export interface Quota { provider: "claude" | "codex"; window: "session" | "weekly"; left: number; owner: string }
export interface QuotaChange extends Quota { delta: number | null }
const MAX_AGE = 15 * 60_000;
const snapshotPath = join(homedir(), "Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json");
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const percent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/** Only quota windows are read; account identity is retained in memory solely to reset comparisons. */
export function parseQuotas(raw: unknown, now: number): Quota[] {
  const root = object(raw);
  if (!Array.isArray(root.entries)) throw new Error("Invalid quota snapshot");
  const result: Quota[] = [];
  for (const value of root.entries) {
    const entry = object(value);
    if (entry.provider !== "claude" && entry.provider !== "codex") continue;
    const updated = Date.parse(String(entry.updatedAt ?? root.generatedAt ?? ""));
    if (!Number.isFinite(updated) || now - updated > MAX_AGE || updated > now + 60_000) continue;
    for (const [key, window] of [["primary", "session"], ["secondary", "weekly"]] as const) {
      const rawWindow = object(entry[key]);
      const rows = Array.isArray(entry.usageRows) ? entry.usageRows.map(object) : [];
      const row = rows.find(r => r.id === key || r.id === window);
      const used = rawWindow.usedPercent;
      const left = percent(used) ? 100 - used : row?.percentLeft;
      if (!percent(left)) continue;
      // Reject an explicitly different period rather than mislabeling it.
      const minutes = rawWindow.windowMinutes;
      if (typeof minutes === "number" && minutes !== (window === "session" ? 300 : 10080)) continue;
      result.push({ provider: entry.provider, window, left: Math.round(left * 10) / 10,
        owner: typeof entry.quotaOwnerKey === "string" ? entry.quotaOwnerKey : "" });
    }
  }
  return result;
}

export class QuotaTracker {
  private previous = new Map<string, Quota>();
  private nextPoll = 0;
  private reading = false;
  status = "Quotas: waiting for CodexBar";

  accept(quotas: Quota[]): QuotaChange[] {
    const next = new Map<string, Quota>();
    const changes: QuotaChange[] = [];
    for (const quota of quotas) {
      const key = `${quota.provider}:${quota.window}`;
      if (next.has(key)) continue;
      next.set(key, quota);
      const old = this.previous.get(key);
      const delta = old && old.owner === quota.owner ? Math.round((quota.left - old.left) * 10) / 10 : null;
      if (delta !== 0) changes.push({ ...quota, delta });
    }
    this.previous = next;
    this.status = quotas.length ? quotas.map(q => `${q.provider} ${q.window}: ${q.left}% left`).join(" · ") : "Quotas: CodexBar data missing or stale";
    return changes;
  }

  async poll(now = Date.now()): Promise<QuotaChange[]> {
    if (this.reading || now < this.nextPoll) return [];
    this.nextPoll = now + 5000;
    this.reading = true;
    try {
      if ((await stat(snapshotPath)).size > 2_000_000) throw new Error("Oversized quota snapshot");
      return this.accept(parseQuotas(JSON.parse(await readFile(snapshotPath, "utf8")), now));
    } catch {
      this.status = "Quotas: CodexBar snapshot unavailable";
      return []; // An incomplete write is not a reset or a change to zero.
    } finally { this.reading = false; }
  }
}

const tones = { neutral: MUSIC_COLORS.text, up: 0x72dfd0, down: 0xffba73 };
export function quotaAtlas(): Record<string, Sprite> {
  const atlas: Record<string, Sprite> = {};
  for (const [tone, ink] of Object.entries(tones)) {
    for (const letter of Object.keys(PIXEL_FONT)) atlas[`quota:${tone}:${letter}`] = pixelLabel(letter, ink, MUSIC_COLORS.background);
    atlas[`quota:${tone}:pixel`] = { rows: ["#"], palette: { "#": ink } };
  }
  atlas["quota:track"] = { rows: ["#"], palette: { "#": MUSIC_COLORS.background } };
  return atlas;
}

/** One bounded batch, anchored to the pointer's monitor at notification time. */
export class QuotaAlerts {
  private changes: QuotaChange[] = [];
  private screen = "";
  private born = 0;
  show(changes: QuotaChange[], screen: string, now: number): void {
    this.changes = changes.slice(0, 4); this.screen = screen; this.born = now;
  }
  clear(): void { this.changes = []; }
  active(now: number): boolean { return this.changes.length > 0 && now - this.born < 5000; }
  render(now: number, screens: Screen[], reducedMotion: boolean): Placement[] {
    if (!this.active(now)) { this.clear(); return []; }
    const screen = screens.find(s => s.id === this.screen);
    if (!screen) { this.clear(); return []; }
    const out: Placement[] = [];
    const age = now - this.born;
    const scale = Math.max(0.1, Math.min(0.5, (screen.w - 32) / (38 * 24)));
    const unit = 4 * scale;
    const bounce = reducedMotion ? 0 : Math.round(Math.sin(Math.min(1, age / 300) * Math.PI) * 8);
    this.changes.forEach((change, row) => {
      const tone = change.delta === null ? "neutral" : change.delta > 0 ? "up" : "down";
      const title = `${change.provider.toUpperCase()} ${change.window.toUpperCase()} ${change.left}% LEFT`;
      const detail = change.delta === null ? "QUOTA READY" : `${change.delta > 0 ? "UP +" : "DOWN -"}${Math.abs(change.delta)} POINTS`;
      const x = Math.round(screen.x + (screen.w - 38 * 6 * unit) / 2);
      const y = Math.round(screen.y + 58 + row * 29 * unit - bounce);
      const text = (value: string, yy: number): void => {
        [...value].forEach((letter, i) => out.push({ sprite: `quota:${tone}:${letter}`, x: x + i * 6 * unit, y: yy, scale, flip: false }));
      };
      text(title, y); text(detail, y + 10 * unit);
      // Discrete energy cells fill from left to right; upward changes emit rising pixel sparks.
      for (let i = 0; i < 25; i++) {
        out.push({ sprite: i < Math.round(change.left / 4) ? `quota:${tone}:pixel` : "quota:track", x: x + i * 8 * unit, y: y + 21 * unit, scale: scale * 5, flip: false });
      }
      if (!reducedMotion && change.delta !== null && age < 900) {
        for (let i = 0; i < 8; i++) out.push({ sprite: `quota:${tone}:pixel`,
          x: x + (i * 27 + Math.sin(i + age / 100) * 3) * unit,
          y: y + 20 * unit + (change.delta > 0 ? -1 : 1) * age / 35,
          scale, flip: false });
      }
    });
    return out;
  }
}
