// Pixel canvas rendered with half-block characters (1 cell = 1px wide, 2px tall),
// plus a text overlay layer for labels. Output is diffed per terminal row.

import { ansi } from "./term.ts";

export type RGB = number; // 0xRRGGBB

export interface TextCell {
  ch: string;
  fg: RGB;
  bg?: RGB;
  width?: number; // 0 marks the continuation of a wide grapheme
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const CONTROL = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;
// Printable ASCII: every char is its own grapheme and exactly one cell wide.
const ASCII = /^[\x20-\x7e]*$/;

/** External text must never emit terminal control sequences. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

export function textParts(s: string): string[] {
  const clean = cleanText(s);
  if (ASCII.test(clean)) return clean.split("");
  return Array.from(graphemes.segment(clean), (part) => part.segment);
}

export function clipText(s: string, width: number): string {
  const clean = cleanText(s);
  if (ASCII.test(clean)) return clean.length <= width ? clean : clean.slice(0, Math.max(0, width));
  let out = "", used = 0;
  for (const { segment: part } of graphemes.segment(clean)) {
    const w = Bun.stringWidth(part);
    if (used + w > width) break;
    out += part;
    used += w;
  }
  return out;
}

export type Palette = Record<string, RGB>;

export interface Sprite {
  rows: string[]; // '.' is transparent, other chars index the palette
  palette: Palette;
}

const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") ||
  /kitty|ghostty|wezterm|alacritty|iterm|orca/i.test(
    `${process.env.TERM ?? ""} ${process.env.TERM_PROGRAM ?? ""}`,
  );

export function rgb(r: number, g: number, b: number): RGB {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  return rgb(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  );
}

function to256(c: RGB): number {
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 238) return 231;
    return 232 + Math.round(((r - 8) / 230) * 23);
  }
  const q = (v: number): number => Math.round(v / 255 * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function fgCode(c: RGB): string {
  return TRUECOLOR
    ? `\x1b[38;2;${c >> 16 & 255};${c >> 8 & 255};${c & 255}m`
    : `\x1b[38;5;${to256(c)}m`;
}

function bgCode(c: RGB): string {
  return TRUECOLOR
    ? `\x1b[48;2;${c >> 16 & 255};${c >> 8 & 255};${c & 255}m`
    : `\x1b[48;5;${to256(c)}m`;
}

export class Canvas {
  readonly cols: number;
  readonly rows: number;
  readonly w: number; // pixels
  readonly h: number; // pixels
  private px: Uint32Array;
  private text: Array<TextCell | undefined>;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.w = cols;
    this.h = rows * 2;
    this.px = new Uint32Array(this.w * this.h);
    this.text = new Array<TextCell | undefined>(cols * rows);
  }

  clear(color: RGB): void {
    this.px.fill(color);
    this.text.fill(undefined);
  }

  set(x: number, y: number, color: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = color;
  }

  get(x: number, y: number): RGB {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x]!;
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB): void {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const base = yy * this.w;
      for (let xx = x0; xx < x1; xx++) this.px[base + xx] = color;
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  /** Draw a sprite with its top-left corner at (x, y). '.' cells are transparent. */
  blit(sprite: Sprite, x: number, y: number, flipX = false): void {
    const rows = sprite.rows;
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r]!;
      const yy = y + r;
      if (yy < 0 || yy >= this.h) continue;
      const len = line.length;
      for (let c = 0; c < len; c++) {
        const ch = line[c]!;
        if (ch === ".") continue;
        const color = sprite.palette[ch];
        if (color === undefined) continue;
        const xx = x + (flipX ? len - 1 - c : c);
        if (xx < 0 || xx >= this.w) continue;
        this.px[yy * this.w + xx] = color;
      }
    }
  }

  /** Place text on a terminal row (not a pixel row). */
  putText(col: number, row: number, s: string, fg: RGB, bg?: RGB): void {
    if (row < 0 || row >= this.rows) return;
    let c = Math.round(col);
    // Preserve intentional padding; strip only control characters here.
    const clean = s.replace(CONTROL, " ");
    if (ASCII.test(clean)) {
      for (let i = 0; i < clean.length; i++, c++) this.putCell(row, c, clean[i]!, 1, fg, bg);
      return;
    }
    for (const { segment: ch } of graphemes.segment(clean)) {
      const width = Bun.stringWidth(ch);
      if (!width) continue;
      this.putCell(row, c, ch, width, fg, bg);
      c += width;
    }
  }

  /** Fill `width` cells of a terminal row with spaces, as if by putText(" ".repeat(width)). */
  fillText(col: number, row: number, width: number, fg: RGB, bg?: RGB): void {
    if (row < 0 || row >= this.rows) return;
    const c0 = Math.max(0, Math.round(col)), c1 = Math.min(this.cols, Math.round(col) + width);
    const base = row * this.cols;
    if (c0 > 0) {
      const left = this.text[base + c0];
      if (left?.width === 0) this.text[base + c0 - 1] = { ch: " ", fg, bg };
    }
    if (c1 < this.cols) {
      const right = this.text[base + c1 - 1];
      if ((right?.width ?? 1) > 1) this.text[base + c1] = { ch: " ", fg, bg };
    }
    for (let x = c0; x < c1; x++) this.text[base + x] = { ch: " ", fg, bg, width: 1 };
  }

  private putCell(row: number, c: number, ch: string, width: number, fg: RGB, bg: RGB | undefined): void {
    if (c < 0 || c + width > this.cols) return;
    const base = row * this.cols;
    for (let x = c; x < c + width; x++) {
      const old = this.text[base + x];
      if (old?.width === 0 && x > 0) this.text[base + x - 1] = { ch: " ", fg, bg };
      if ((old?.width ?? 1) > 1) this.text[base + x + 1] = { ch: " ", fg, bg };
    }
    for (let x = c; x < c + width; x++) {
      this.text[base + x] = { ch: x === c ? ch : "", fg, bg, width: x === c ? width : 0 };
    }
  }

  /** Build one string per terminal row. */
  renderRows(): string[] {
    const out: string[] = new Array<string>(this.rows);
    for (let r = 0; r < this.rows; r++) {
      let s = "";
      let curFg = -1, curBg = -1;
      const topBase = (r * 2) * this.w;
      const botBase = (r * 2 + 1) * this.w;
      const tBase = r * this.cols;
      for (let c = 0; c < this.cols; c++) {
        const t = this.text[tBase + c];
        if (t?.width === 0) continue;
        const top = this.px[topBase + c]!;
        const bot = this.px[botBase + c]!;
        let ch: string, fg: number, bg: number;
        if (t !== undefined) {
          ch = t.ch;
          fg = t.fg;
          bg = t.bg ?? mix(top, bot, 0.5);
        } else if (top === bot) {
          ch = " ";
          fg = curFg;
          bg = top;
        } else {
          ch = "▀"; // upper half block
          fg = top;
          bg = bot;
        }
        if (bg !== curBg) { s += bgCode(bg); curBg = bg; }
        if (fg !== curFg && fg !== -1) { s += fgCode(fg); curFg = fg; }
        s += ch;
      }
      out[r] = s + ansi.reset;
    }
    return out;
  }
}

/** Writes only the rows that changed since the previous frame. */
export class FrameWriter {
  private prev: string[] = [];

  invalidate(): void {
    this.prev = [];
  }

  frame(rows: string[]): string {
    let out = ansi.syncStart;
    for (let r = 0; r < rows.length; r++) {
      if (this.prev[r] !== rows[r]) {
        out += ansi.moveTo(r, 0) + rows[r]!;
      }
    }
    this.prev = rows;
    return out + ansi.syncEnd;
  }
}
