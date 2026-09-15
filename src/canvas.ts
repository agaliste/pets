// Pixel canvas rendered with half-block characters (1 cell = 1px wide, 2px tall),
// plus a text overlay layer for labels. Output is diffed per terminal row.

import { ansi } from "./term.ts";

export type RGB = number; // 0xRRGGBB

export interface TextCell {
  ch: string;
  fg: RGB;
  bg?: RGB;
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
    for (let i = 0; i < s.length; i++) {
      const c = col + i;
      if (c < 0 || c >= this.cols) continue;
      const cell: TextCell = bg === undefined ? { ch: s[i]!, fg } : { ch: s[i]!, fg, bg };
      this.text[row * this.cols + c] = cell;
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
