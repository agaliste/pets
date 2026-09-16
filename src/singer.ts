import { Canvas, cleanText, clipText, textParts } from "./canvas.ts";
import type { MusicView } from "./music.ts";
import type { Layout, Rect } from "./office.ts";
import type { Agent } from "./sim.ts";
import { CODEX_MASCOT, CODEX_PALETTE, MASCOT, MASCOT_PALETTE, MASCOT_H, MASCOT_W } from "./sprites.ts";

export const MUSIC_COLORS = { background: 0x14161c, text: 0xf3e4cf, accent: 0x7fb2ff, muted: 0x9aa0a6 };
const ADLIBS = ["yeah!", "woo!", "sing it!", "oh-oh!", "la la!", "encore!"];
const LABELS = {
  loading: "Finding lyrics…", synced: "", plain: "Lyrics · unsynced",
  missing: "No lyrics · ♪", instrumental: "Instrumental · ♪", error: "Lyrics unavailable · retrying",
};

export function wrapBubble(text: string, width: number): string[] {
  if (width < 1) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of cleanText(text).split(" ")) {
    if (line && Bun.stringWidth(`${line} ${word}`) <= width) { line += ` ${word}`; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const part of textParts(word)) {
      if (Bun.stringWidth(line + part) > width) { if (line) lines.push(line); line = ""; }
      if (Bun.stringWidth(part) <= width) line += part;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["♪"];
}

/** A bounded overlay shared by the singer and audience. Coordinates are terminal cells. */
export function drawBubble(cv: Canvas, x: number, row: number, width: number, lines: string[], label = "", anchor = x + MASCOT_W / 2): Rect {
  const w = Math.min(cv.cols, width);
  const h = lines.length + (label ? 1 : 0) + 2;
  const left = Math.max(0, Math.min(Math.round(x), cv.cols - w));
  const top = Math.max(0, Math.round(row));
  const { background, text, accent, muted } = MUSIC_COLORS;
  const rect = { x: left, y: top, w, h: h + 1 };
  if (w < 4) return rect;
  const border = "─".repeat(w - 2);
  cv.putText(left, top, `╭${border}╮`, accent, background);
  const body = label ? [label, ...lines] : lines;
  for (let i = 0; i < body.length; i++) {
    const content = clipText(body[i]!, w - 4);
    const padding = " ".repeat(w - 4 - Bun.stringWidth(content));
    cv.putText(left, top + 1 + i, `│ ${content}${padding} │`, label && i === 0 ? muted : text, background);
  }
  cv.putText(left, top + h - 1, `╰${border}╯`, accent, background);
  cv.putText(Math.max(left + 1, Math.min(left + w - 2, Math.round(anchor))), top + h, "╲", accent, background);
  return rect;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Singer {
  private id = "";
  private x = 0;
  private y = 0;
  private nextAdlib = 0;
  private lyricText = "";
  private lyricSince = 0;
  private adlib: { pid: number; text: string; until: number } | null = null;

  constructor(private readonly random = Math.random) {}

  draw(cv: Canvas, L: Layout, music: MusicView | null, agents: Iterable<Agent>, now: number, dt: number): void {
    if (!music) { this.id = ""; this.adlib = null; return; }
    if (cv.cols < 24 || L.h < 28) return;
    if (this.id !== music.track.id) {
      if (!this.id) { this.x = L.spawn.x; this.y = L.spawn.y; }
      this.id = music.track.id;
      this.nextAdlib = now + 6000;
      this.adlib = null;
      this.lyricText = "";
    }
    if (music.text !== this.lyricText) { this.lyricText = music.text; this.lyricSince = now; }
    const width = Math.min(48, cv.cols - 2);
    const allLines = wrapBubble(music.text, width - 4);
    // Paginate long lines; timing of short lines stays entirely driven by LRC.
    const page = Math.floor((now - this.lyricSince) / 4000) % Math.ceil(allLines.length / 2);
    const lines = allLines.slice(page * 2, page * 2 + 2);
    const targetX = cv.cols - MASCOT_W - 6;
    const targetY = Math.min(L.h - MASCOT_H - 2, Math.max(L.wallH + 4, (lines.length + 5) * 2));
    const dx = targetX - this.x, dy = targetY - this.y, distance = Math.hypot(dx, dy);
    const step = Math.min(distance, Math.max(0, dt) * 22);
    if (distance) { this.x += dx / distance * step; this.y += dy / distance * step; }
    const x = Math.round(Math.max(0, Math.min(this.x, cv.cols - MASCOT_W - 3)));
    const walking = distance > 1;
    const y = Math.max(0, Math.min(L.h - MASCOT_H - 1, Math.round(this.y) - (walking ? 0 : Math.floor(now / 300) % 2)));
    const codex = [...music.track.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 2 === 0;
    const frame = walking ? (Math.floor(now / 150) % 2 ? "walkA" : "walkB") : (Math.floor(now / 350) % 2 ? "wave" : "stand");
    cv.blit({ rows: (codex ? CODEX_MASCOT : MASCOT)[frame], palette: codex ? CODEX_PALETTE : MASCOT_PALETTE }, x, y);
    // Silver microphone and stand, sized to the existing pixel sprites.
    cv.fillRect(x + MASCOT_W, y + 4, 3, 2, MUSIC_COLORS.text);
    cv.fillRect(x + MASCOT_W + 1, y + 6, 1, MASCOT_H - 6, MUSIC_COLORS.muted);
    cv.fillRect(x + MASCOT_W - 1, y + MASCOT_H, 5, 1, MUSIC_COLORS.muted);
    if (y < (lines.length + 5) * 2) return;
    const top = Math.max(0, Math.floor(y / 2) - lines.length - 5);
    const song = `${music.track.artist} · ${music.track.title}`;
    const label = LABELS[music.state] ? `${LABELS[music.state]} · ${song}` : song;
    const bubble = drawBubble(cv, x - width + MASCOT_W + 2, top, width, lines, label, x + MASCOT_W / 2);

    const audience = [...agents].filter((a) => !["gone", "leave", "wave", "nap"].includes(a.act.kind));
    if (now >= this.nextAdlib) {
      this.nextAdlib = now + 8000 + this.random() * 10_000;
      const agent = audience[Math.floor(this.random() * audience.length)];
      if (agent) this.adlib = { pid: agent.pid, text: ADLIBS[Math.floor(this.random() * ADLIBS.length)]!, until: now + 1800 };
    }
    if (this.adlib && now < this.adlib.until) {
      const agent = audience.find((a) => a.pid === this.adlib!.pid);
      if (!agent) return;
      const w = this.adlib.text.length + 4;
      const rect = { x: Math.max(0, Math.min(Math.round(agent.x), cv.cols - w)), y: Math.floor((agent.y - agent.hat.rows.length) / 2) - 4, w, h: 4 };
      if (rect.y >= 0 && rect.y + rect.h < L.h / 2 && !overlaps(rect, bubble)) {
        drawBubble(cv, rect.x, rect.y, w, [this.adlib.text]);
      }
    }
  }
}
