// Low-level terminal control: raw mode, alternate screen, size and key events.

export type Key =
  | { kind: "char"; ch: string }
  | { kind: "up" | "down" | "left" | "right" | "tab" | "enter" | "escape" | "ctrl-c" };

export interface TermSize {
  cols: number;
  rows: number;
}

const ESC = "\x1b";

export const ansi = {
  altScreenOn: `${ESC}[?1049h`,
  altScreenOff: `${ESC}[?1049l`,
  cursorHide: `${ESC}[?25l`,
  cursorShow: `${ESC}[?25h`,
  clear: `${ESC}[2J`,
  home: `${ESC}[H`,
  reset: `${ESC}[0m`,
  syncStart: `${ESC}[?2026h`,
  syncEnd: `${ESC}[?2026l`,
  moveTo: (row: number, col: number): string => `${ESC}[${row + 1};${col + 1}H`,
};

export function termSize(): TermSize {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  return { cols: Math.max(20, cols), rows: Math.max(8, rows) };
}

export class Terminal {
  private keyHandlers: Array<(k: Key) => void> = [];
  private resizeHandlers: Array<(s: TermSize) => void> = [];
  private open = false;

  start(): void {
    if (this.open) return;
    this.open = true;
    process.stdout.write(ansi.altScreenOn + ansi.cursorHide + ansi.clear + ansi.home);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.handleResize);
    process.on("SIGWINCH", this.handleResize);
  }

  stop(): void {
    if (!this.open) return;
    this.open = false;
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.handleResize);
    process.off("SIGWINCH", this.handleResize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.write(ansi.reset + ansi.cursorShow + ansi.altScreenOff);
  }

  onKey(fn: (k: Key) => void): void {
    this.keyHandlers.push(fn);
  }

  onResize(fn: (s: TermSize) => void): void {
    this.resizeHandlers.push(fn);
  }

  private handleResize = (): void => {
    const s = termSize();
    for (const h of this.resizeHandlers) h(s);
  };

  write(s: string): void {
    process.stdout.write(s);
  }

  private onData = (chunk: string | Buffer): void => {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const k of parseKeys(s)) {
      for (const h of this.keyHandlers) h(k);
    }
  };
}

export function parseKeys(s: string): Key[] {
  const out: Key[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ESC) {
      const seq = s.slice(i, i + 3);
      if (seq === `${ESC}[A`) { out.push({ kind: "up" }); i += 3; continue; }
      if (seq === `${ESC}[B`) { out.push({ kind: "down" }); i += 3; continue; }
      if (seq === `${ESC}[C`) { out.push({ kind: "right" }); i += 3; continue; }
      if (seq === `${ESC}[D`) { out.push({ kind: "left" }); i += 3; continue; }
      if (s.length === i + 1) { out.push({ kind: "escape" }); i += 1; continue; }
      // Unknown escape sequence: skip it entirely.
      let j = i + 1;
      while (j < s.length && !/[A-Za-z~]/.test(s[j]!)) j++;
      i = j + 1;
      continue;
    }
    if (c === "\x03") { out.push({ kind: "ctrl-c" }); i++; continue; }
    if (c === "\t") { out.push({ kind: "tab" }); i++; continue; }
    if (c === "\r" || c === "\n") { out.push({ kind: "enter" }); i++; continue; }
    out.push({ kind: "char", ch: c });
    i++;
  }
  return out;
}
