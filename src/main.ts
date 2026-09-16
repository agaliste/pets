// Agent Office: a terminal office where every running Claude Code or Codex CLI session
// on this machine shows up as a mascot wearing its own hat.

import { Canvas, FrameWriter } from "./canvas.ts";
import { computeLayout, drawBackground, roomDrawables, type Drawable, type Layout } from "./office.ts";
import { SessionTracker, type AgentSession } from "./sessions.ts";
import { Sim } from "./sim.ts";
import { Terminal, termSize } from "./term.ts";
import { homedir } from "node:os";
import { MusicTracker } from "./music.ts";
import { Singer } from "./singer.ts";

const FPS = 12;
const STATUS_ROWS = 2;

const BAR_BG = 0x14161c;
const BAR_FG = 0xc9ccd3;
const DIM = 0x7c818c;
const ORANGE = 0xd97757;
const GREEN = 0x3adb76;
const RED = 0xff6b6b;

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function fit(s: string, width: number): string {
  if (width <= 0) return "";
  return s.length > width ? s.slice(0, Math.max(0, width - 1)) + "…" : s;
}

class App {
  private term = new Terminal();
  private tracker = new SessionTracker();
  private music = new MusicTracker();
  private singer = new Singer();
  private layout: Layout;
  private canvas: Canvas;
  private writer = new FrameWriter();
  private sim: Sim;
  private selectedPid: number | null = null;
  private lastTick = performance.now();
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const { cols, rows } = termSize();
    this.canvas = new Canvas(cols, rows);
    this.layout = computeLayout(cols, Math.max(2, rows - STATUS_ROWS) * 2);
    this.sim = new Sim(this.layout);
  }

  async start(): Promise<void> {
    await this.tracker.poll(Date.now());
    this.term.onKey((k) => {
      if (k.kind === "ctrl-c" || k.kind === "escape" || (k.kind === "char" && (k.ch === "q" || k.ch === "Q"))) {
        this.quit();
      } else if (k.kind === "tab" || k.kind === "right" || k.kind === "down" || (k.kind === "char" && (k.ch === "j" || k.ch === "l"))) {
        this.cycleSelection(1);
      } else if (k.kind === "left" || k.kind === "up" || (k.kind === "char" && (k.ch === "k" || k.ch === "h"))) {
        this.cycleSelection(-1);
      } else if (k.kind === "char" && k.ch === "r") {
        this.writer.invalidate();
      }
    });
    this.term.onResize(({ cols, rows }) => this.resize(cols, rows));
    this.term.start();
    this.timer = setInterval(() => this.frame(), Math.round(1000 / FPS));
    const bye = (): void => this.quit();
    process.on("SIGINT", bye);
    process.on("SIGTERM", bye);
    process.on("SIGHUP", bye);
    process.on("uncaughtException", (e) => {
      this.term.stop();
      console.error(e);
      process.exit(1);
    });
  }

  private quit(): void {
    this.music.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.term.stop();
    setTimeout(() => process.exit(0), 20);
  }

  private resize(cols: number, rows: number): void {
    this.canvas = new Canvas(cols, rows);
    this.layout = computeLayout(cols, Math.max(2, rows - STATUS_ROWS) * 2);
    this.sim.setLayout(this.layout);
    this.writer.invalidate();
    this.term.write("\x1b[2J");
  }

  private sessions(): AgentSession[] {
    return this.tracker.list();
  }

  private cycleSelection(dir: 1 | -1): void {
    const pids = [...this.sim.agents.keys()].sort((a, b) => a - b);
    if (pids.length === 0) { this.selectedPid = null; return; }
    const i = this.selectedPid === null ? -1 : pids.indexOf(this.selectedPid);
    const next = i < 0 ? (dir === 1 ? 0 : pids.length - 1) : (i + dir + pids.length) % pids.length;
    this.selectedPid = pids[next]!;
  }

  private frame(): void {
    const nowPerf = performance.now();
    const dt = Math.min(0.25, (nowPerf - this.lastTick) / 1000);
    this.lastTick = nowPerf;
    const now = Date.now();
    this.tick++;

    void this.tracker.poll(now);
    void this.music.poll();
    const sessions = this.sessions();
    this.sim.update(sessions, now, dt);
    if (this.selectedPid !== null && !this.sim.agents.has(this.selectedPid)) this.selectedPid = null;

    const cv = this.canvas, L = this.layout;
    const music = this.music.view();
    cv.clear(BAR_BG);
    drawBackground(cv, L, new Date(now), music !== null);
    const drawables: Drawable[] = [
      ...roomDrawables(L, this.sim.deskStates(), this.tick, this.sim.deskLabels()),
      ...this.sim.drawables(now, this.selectedPid),
    ];
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw(cv);
    this.singer.draw(cv, L, music, this.sim.agents.values(), nowPerf, dt);
    this.drawStatus(cv, sessions, now);

    this.term.write(this.writer.frame(cv.renderRows()));
  }

  private drawStatus(cv: Canvas, sessions: AgentSession[], now: number): void {
    const row0 = cv.rows - 2, row1 = cv.rows - 1;
    cv.fillRect(0, row0 * 2, cv.w, 4, BAR_BG);
    for (let c = 0; c < cv.cols; c++) {
      cv.putText(c, row0, " ", BAR_FG, BAR_BG);
      cv.putText(c, row1, " ", BAR_FG, BAR_BG);
    }

    const busy = sessions.filter((s) => s.status === "busy").length;
    const idle = sessions.filter((s) => s.status === "idle").length;
    const unknown = sessions.length - busy - idle;
    let col = 1;
    cv.putText(col, row0, "Agent Office", ORANGE, BAR_BG); col += 13;
    cv.putText(col, row0, "│", DIM, BAR_BG); col += 2;
    cv.putText(col, row0, `● ${busy} working`, GREEN, BAR_BG); col += `● ${busy} working`.length + 2;
    cv.putText(col, row0, `○ ${idle} idle`, DIM, BAR_BG); col += `○ ${idle} idle`.length + 2;
    if (unknown) {
      cv.putText(col, row0, `? ${unknown} unknown`, DIM, BAR_BG); col += `? ${unknown} unknown`.length + 2;
    }
    if (this.layout.pitch) {
      cv.putText(col, row0, "│", DIM, BAR_BG); col += 2;
      const sc = `football ${this.sim.score.l}–${this.sim.score.r}`;
      cv.putText(col, row0, sc, BAR_FG, BAR_BG); col += sc.length + 2;
    }
    const clock = new Date(now).toTimeString().slice(0, 5);
    cv.putText(cv.cols - clock.length - 1, row0, clock, DIM, BAR_BG);

    const keys = "tab/←→ select · q quit";
    const err = this.tracker.lastError ?? this.music.lastError;
    if (err) {
      cv.putText(1, row1, fit(err, cv.cols - keys.length - 3), RED, BAR_BG);
    } else if (sessions.length === 0) {
      cv.putText(1, row1, fit("Start `claude` or `codex` anywhere and a mascot walks in.", cv.cols - keys.length - 3), DIM, BAR_BG);
    } else {
      const a = this.selectedPid !== null ? this.sim.agents.get(this.selectedPid) : undefined;
      if (a) {
        const s = a.session;
        const parts = [
          s.provider === "codex" ? "Codex" : "Claude",
          s.name,
          s.title ?? "",
          shortPath(s.cwd),
          s.status,
          `up ${fmtUptime(now - s.startedAt)}`,
          `${a.hat.name} hat`,
          a.accessory.name,
          `pid ${s.pid}`,
        ].filter((p) => p.length > 0);
        cv.putText(1, row1, "▼ ", ORANGE, BAR_BG);
        cv.putText(3, row1, fit(parts.join("  ·  "), cv.cols - keys.length - 5), BAR_FG, BAR_BG);
      } else {
        const names = sessions.map((s) => `${s.status === "busy" ? "●" : s.status === "idle" ? "○" : "?"} ${s.provider === "codex" ? "Codex" : "Claude"}: ${s.name}`).join("  ");
        cv.putText(1, row1, fit(names, cv.cols - keys.length - 3), BAR_FG, BAR_BG);
      }
    }
    cv.putText(cv.cols - keys.length - 1, row1, keys, DIM, BAR_BG);
  }
}

if (!process.stdout.isTTY) {
  console.error("claude-office needs an interactive terminal.");
  process.exit(1);
}
await new App().start();
