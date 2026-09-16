// Simulation: one mascot per Claude or Codex session, with a small behaviour state machine
// (enter, work, wait, coffee, football, nap, plant, wander, leave) and a football.

import { Canvas, mix } from "./canvas.ts";
import type { Desk, DeskState, Drawable, Layout, Pt } from "./office.ts";
import type { AgentSession } from "./sessions.ts";
import { ACCESSORIES, BALL, CODEX_MASCOT, CODEX_PALETTE, CUP, HATS, MASCOT, MASCOT_H, MASCOT_PALETTE, MASCOT_W, type Accessory, type Hat, type MascotFrame } from "./sprites.ts";

type Activity =
  | { kind: "walk"; to: Pt; then: Activity }
  | { kind: "work" }
  | { kind: "wait"; until: number }
  | { kind: "coffee"; until: number; slot: number }
  | { kind: "football"; until: number }
  | { kind: "nap"; until: number }
  | { kind: "plant"; until: number }
  | { kind: "pause"; until: number; then: Activity }
  | { kind: "celebrate"; until: number; then: Activity }
  | { kind: "wave"; until: number }
  | { kind: "leave" }
  | { kind: "gone" };

export interface Agent {
  pid: number;
  session: AgentSession;
  hat: Hat;
  accessory: Accessory;
  x: number;
  y: number;
  facing: 1 | -1;
  desk: Desk | null;
  act: Activity;
  footSide: 1 | -1;
  kickUntil: number;
  arrivedAt: number;
  jumpPhase: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const WALK_SPEED = 16; // px per second
const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const LEISURE = new Set<Activity["kind"]>(["coffee", "football", "nap", "plant", "pause", "wait"]);

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Sim {
  readonly agents = new Map<number, Agent>();
  private L: Layout;
  private ball: Ball | null = null;
  private goalFlash: { text: string; until: number } | null = null;
  score = { l: 0, r: 0 };

  constructor(layout: Layout) {
    this.L = layout;
    this.resetBall();
  }

  setLayout(L: Layout): void {
    this.L = L;
    for (const a of this.agents.values()) {
      const idx = a.desk?.id ?? -1;
      a.desk = idx >= 0 && idx < L.desks.length ? L.desks[idx]! : null;
      if (a.act.kind === "work" || a.act.kind === "wait") {
        if (a.desk) {
          a.x = a.desk.seat.x;
          a.y = a.desk.seat.y;
        } else {
          a.act = { kind: "pause", until: 0, then: { kind: "work" } };
        }
      } else {
        a.x = Math.min(Math.max(a.x, L.floor.x), L.floor.x + L.floor.w - MASCOT_W);
        a.y = Math.min(Math.max(a.y, L.floor.y - 4), L.h - MASCOT_H);
        if (a.act.kind === "football" && !L.pitch) a.act = { kind: "wait", until: 0 };
      }
    }
    this.resetBall();
  }

  private resetBall(): void {
    const p = this.L.pitch;
    this.ball = p ? { x: p.x + (p.w >> 1) - 2, y: p.y + (p.h >> 1) - 2, vx: 0, vy: 0 } : null;
  }

  // ---------------------------------------------------------------- updates

  update(sessions: AgentSession[], now: number, dt: number): void {
    const live = new Set<number>();
    for (const s of sessions) {
      live.add(s.pid);
      const a = this.agents.get(s.pid);
      if (a) a.session = s;
      else this.spawn(s, now);
    }
    for (const a of this.agents.values()) {
      if (!live.has(a.pid) && a.act.kind !== "wave" && a.act.kind !== "leave" && a.act.kind !== "gone") {
        this.releaseDesk(a);
        a.act = { kind: "wave", until: now + 1600 };
      }
    }
    for (const a of this.agents.values()) this.step(a, now, dt);
    for (const [pid, a] of this.agents) if (a.act.kind === "gone") this.agents.delete(pid);
    this.stepBall(now, dt);
  }

  private spawn(s: AgentSession, now: number): void {
    const used = new Set([...this.agents.values()].map((a) => a.hat.name));
    let idx = hashStr(s.sessionId ?? String(s.pid)) % HATS.length;
    for (let i = 0; i < HATS.length && used.has(HATS[idx]!.name); i++) idx = (idx + 1) % HATS.length;
    const usedAccessories = new Set([...this.agents.values()].map((a) => a.accessory.name));
    let accessoryIdx = hashStr(`accessory:${s.provider}:${s.sessionId ?? s.pid}`) % ACCESSORIES.length;
    for (let i = 0; i < ACCESSORIES.length && usedAccessories.has(ACCESSORIES[accessoryIdx]!.name); i++) {
      accessoryIdx = (accessoryIdx + 1) % ACCESSORIES.length;
    }
    const a: Agent = {
      pid: s.pid,
      session: s,
      hat: HATS[idx]!,
      accessory: ACCESSORIES[accessoryIdx]!,
      x: this.L.spawn.x,
      y: this.L.spawn.y,
      facing: 1,
      desk: null,
      act: { kind: "pause", until: now + 400, then: { kind: "work" } },
      footSide: 1,
      kickUntil: 0,
      arrivedAt: now,
      jumpPhase: 0,
    };
    this.assignDesk(a);
    this.agents.set(s.pid, a);
  }

  private assignDesk(a: Agent): void {
    if (a.desk) return;
    const taken = new Set([...this.agents.values()].map((o) => o.desk?.id ?? -1));
    a.desk = this.L.desks.find((d) => !taken.has(d.id)) ?? null;
  }

  private releaseDesk(a: Agent): void {
    a.desk = null;
  }

  /** Where an agent without a desk stands to work: along the wall, spaced out. */
  private standingSpot(a: Agent): Pt {
    const homeless = [...this.agents.values()].filter((o) => !o.desk && o.act.kind !== "leave").map((o) => o.pid).sort();
    const k = Math.max(0, homeless.indexOf(a.pid));
    const x = this.L.floor.x + 14 + (k * 15) % Math.max(15, this.L.floor.w - 30);
    return { x, y: this.L.h - MASCOT_H - 2 };
  }

  private busy(a: Agent): boolean {
    return a.session.status === "busy";
  }

  private step(a: Agent, now: number, dt: number): void {
    const act = a.act;
    switch (act.kind) {
      case "gone":
        return;
      case "pause":
        if (now >= act.until) this.begin(a, act.then, now);
        return;
      case "walk": {
        if (this.busy(a) && LEISURE.has(act.then.kind)) { this.goWork(a); return; }
        if (this.moveToward(a, act.to, dt)) this.begin(a, act.then, now);
        return;
      }
      case "wave":
        if (now >= act.until) a.act = { kind: "leave" };
        return;
      case "leave":
        if (this.moveToward(a, this.L.spawn, dt)) a.act = { kind: "gone" };
        return;
      case "work":
        if (!this.busy(a)) a.act = { kind: "wait", until: now + rand(2500, 6000) };
        return;
      case "wait":
        if (this.busy(a)) { a.act = { kind: "work" }; return; }
        if (now >= act.until) this.begin(a, this.pickLeisure(a, now), now);
        return;
      case "celebrate":
        a.jumpPhase += dt * 8;
        if (now >= act.until) { a.jumpPhase = 0; this.begin(a, act.then, now); }
        return;
      case "coffee":
      case "nap":
      case "plant":
        if (this.busy(a)) { this.goWork(a); return; }
        if (now >= act.until) this.begin(a, this.pickLeisure(a, now), now);
        return;
      case "football":
        if (this.busy(a)) { this.goWork(a); return; }
        if (now >= act.until || !this.ball) { this.begin(a, this.pickLeisure(a, now), now); return; }
        this.playFootball(a, now, dt);
        return;
    }
  }

  private goWork(a: Agent): void {
    this.assignDesk(a);
    const to = a.desk ? a.desk.seat : this.standingSpot(a);
    a.act = { kind: "walk", to, then: { kind: "work" } };
  }

  /** Enter an activity: resolves where it happens and walks there first if needed. */
  private begin(a: Agent, next: Activity, now: number): void {
    const at = (p: Pt): boolean => Math.abs(a.x - p.x) < 0.6 && Math.abs(a.y - p.y) < 0.6;
    switch (next.kind) {
      case "work":
      case "wait": {
        this.assignDesk(a);
        const to = a.desk ? a.desk.seat : this.standingSpot(a);
        if (!at(to)) { a.act = { kind: "walk", to, then: next }; return; }
        if (next.kind === "work" && !this.busy(a)) next = { kind: "wait", until: now + rand(8000, 20000) };
        else if (next.kind === "wait" && next.until <= now) next = { kind: "wait", until: now + rand(6000, 15000) };
        a.act = next;
        return;
      }
      case "coffee": {
        const c = this.L.coffee;
        if (!c) { a.act = { kind: "wait", until: now }; return; }
        const to = { x: Math.max(this.L.floor.x, c.stand.x - next.slot * 13), y: c.stand.y };
        if (!at(to)) { a.act = { kind: "walk", to, then: next }; return; }
        a.facing = 1;
        a.act = next;
        return;
      }
      case "nap": {
        const c = this.L.couch;
        if (!c) { a.act = { kind: "wait", until: now }; return; }
        if (!at(c.seat)) { a.act = { kind: "walk", to: c.seat, then: next }; return; }
        a.act = next;
        return;
      }
      case "plant": {
        const p = this.L.plant;
        if (!p) { a.act = { kind: "wait", until: now }; return; }
        const to = { x: p.x + 7, y: this.L.wallH - 4 };
        if (!at(to)) { a.act = { kind: "walk", to, then: next }; return; }
        a.facing = -1;
        a.act = next;
        return;
      }
      case "football": {
        const p = this.L.pitch;
        if (!p) { a.act = { kind: "wait", until: now }; return; }
        const players = [...this.agents.values()].filter((o) => o !== a && o.act.kind === "football");
        a.footSide = players.length === 0 ? (Math.random() < 0.5 ? 1 : -1) : (players.length % 2 === 0 ? 1 : -1);
        a.act = next;
        return;
      }
      default:
        a.act = next;
    }
  }

  private pickLeisure(a: Agent, now: number): Activity {
    const L = this.L;
    const others = [...this.agents.values()].filter((o) => o !== a);
    const opts: Array<{ w: number; act: Activity }> = [];
    if (L.pitch) opts.push({ w: 40, act: { kind: "football", until: now + rand(20000, 45000) } });
    if (L.coffee) {
      const slot = others.filter((o) => o.act.kind === "coffee" || (o.act.kind === "walk" && o.act.then.kind === "coffee")).length;
      if (slot < 3) opts.push({ w: 20, act: { kind: "coffee", until: now + rand(6000, 12000), slot } });
    }
    if (L.couch && !others.some((o) => o.act.kind === "nap" || (o.act.kind === "walk" && o.act.then.kind === "nap"))) {
      opts.push({ w: 12, act: { kind: "nap", until: now + rand(12000, 30000) } });
    }
    if (L.plant && !others.some((o) => o.act.kind === "plant")) {
      opts.push({ w: 10, act: { kind: "plant", until: now + rand(5000, 9000) } });
    }
    const wanderTo: Pt = {
      x: rand(L.floor.x, L.floor.x + L.floor.w - MASCOT_W),
      y: rand(L.floor.y, L.floor.y + L.floor.h - MASCOT_H),
    };
    opts.push({ w: 15, act: { kind: "walk", to: wanderTo, then: { kind: "pause", until: now + rand(2000, 5000), then: { kind: "wait", until: now } } } });
    opts.push({ w: 12, act: { kind: "wait", until: now + rand(10000, 25000) } });
    const total = opts.reduce((s, o) => s + o.w, 0);
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) return o.act;
    }
    return opts[opts.length - 1]!.act;
  }

  private moveToward(a: Agent, to: Pt, dt: number): boolean {
    const dx = to.x - a.x, dy = to.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    const stepLen = WALK_SPEED * dt;
    if (dist <= stepLen + 0.01) { a.x = to.x; a.y = to.y; return true; }
    a.x += (dx / dist) * stepLen;
    a.y += (dy / dist) * stepLen;
    return false;
  }

  // -------------------------------------------------------------- football

  private approachPoint(a: Agent, b: Ball): Pt {
    const p = this.L.pitch!;
    const x = a.footSide === 1 ? b.x - MASCOT_W : b.x + 4;
    const y = b.y - 5;
    return {
      x: Math.min(Math.max(x, p.x - 2), p.x + p.w - MASCOT_W + 2),
      y: Math.min(Math.max(y, p.y - 5), p.y + p.h - MASCOT_H + 1),
    };
  }

  private playFootball(a: Agent, now: number, dt: number): void {
    const b = this.ball!;
    if (now < a.kickUntil) return;
    const to = this.approachPoint(a, b);
    const close = Math.abs(a.x - to.x) < 2.5 && Math.abs(a.y - to.y) < 2.5;
    const speed = Math.hypot(b.vx, b.vy);
    if (!close) {
      this.moveToward(a, to, dt);
      return;
    }
    a.facing = a.footSide;
    if (speed > 5) return; // wait for the ball to settle
    const goal = a.footSide === 1 ? this.L.goalR! : this.L.goalL!;
    const vx = a.footSide * rand(28, 44);
    const goalCenterY = goal.y + goal.h / 2 - 2 + rand(-7, 7);
    const t = Math.max(0.2, Math.abs(goal.x - b.x) / Math.abs(vx));
    b.vx = vx;
    b.vy = Math.min(18, Math.max(-18, (goalCenterY - b.y) / t));
    a.kickUntil = now + 380;
    const solo = ![...this.agents.values()].some((o) => o !== a && o.act.kind === "football");
    if (solo) a.footSide = a.footSide === 1 ? -1 : 1;
  }

  private stepBall(now: number, dt: number): void {
    const b = this.ball, p = this.L.pitch;
    if (!b || !p) return;
    if (this.goalFlash && now >= this.goalFlash.until) this.goalFlash = null;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 1.5) { b.vx = 0; b.vy = 0; return; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const damp = Math.exp(-dt * 1.1);
    b.vx *= damp;
    b.vy *= damp;
    const minX = p.x + 1, maxX = p.x + p.w - 5, minY = p.y + 1, maxY = p.y + p.h - 5;
    const cy = b.y + 2;
    const gl = this.L.goalL!, gr = this.L.goalR!;
    if (b.x <= minX && cy >= gl.y && cy < gl.y + gl.h) { this.goal("r", now); return; }
    if (b.x >= maxX && cy >= gr.y && cy < gr.y + gr.h) { this.goal("l", now); return; }
    if (b.x < minX) { b.x = minX; b.vx = -b.vx * 0.7; }
    if (b.x > maxX) { b.x = maxX; b.vx = -b.vx * 0.7; }
    if (b.y < minY) { b.y = minY; b.vy = -b.vy * 0.7; }
    if (b.y > maxY) { b.y = maxY; b.vy = -b.vy * 0.7; }
  }

  private goal(side: "l" | "r", now: number): void {
    if (side === "l") this.score.l++; else this.score.r++;
    this.goalFlash = { text: "GOAL!", until: now + 2500 };
    this.resetBall();
    for (const a of this.agents.values()) {
      if (a.act.kind === "football") a.act = { kind: "celebrate", until: now + 2000, then: a.act };
    }
  }

  // -------------------------------------------------------------- rendering

  deskStates(): Map<number, DeskState> {
    const m = new Map<number, DeskState>();
    for (const a of this.agents.values()) {
      if (!a.desk) continue;
      m.set(a.desk.id, a.act.kind === "work" ? "working" : "idle");
    }
    return m;
  }

  deskLabels(): Map<number, string> {
    const m = new Map<number, string>();
    for (const a of this.agents.values()) if (a.desk) m.set(a.desk.id, a.session.name);
    return m;
  }

  drawables(now: number, selectedPid: number | null): Drawable[] {
    const out: Drawable[] = [];
    for (const a of this.agents.values()) out.push(this.agentDrawable(a, now, a.pid === selectedPid));
    const b = this.ball;
    if (b) {
      out.push({ depth: b.y + 4, draw: (cv) => cv.blit(BALL, Math.round(b.x), Math.round(b.y)) });
    }
    const flash = this.goalFlash, p = this.L.pitch;
    if (flash && p) {
      out.push({
        depth: 1e9,
        draw: (cv) => {
          const col = p.x + (p.w >> 1) - 2;
          const row = (p.y + (p.h >> 1) - 6) >> 1;
          cv.putText(col, row, flash.text, (now >> 7) % 2 === 0 ? 0xfff176 : 0xffffff, 0x1b5e20);
        },
      });
    }
    return out;
  }

  private frameFor(a: Agent, now: number): { frame: MascotFrame; dy: number; flip: boolean } {
    const act = a.act;
    const t = now / 1000;
    const flip = a.facing === -1;
    switch (act.kind) {
      case "walk":
      case "leave":
        return { frame: Math.floor(t * 6) % 2 === 0 ? "walkA" : "walkB", dy: 0, flip };
      case "work": {
        const fast = now - a.session.lastActivity < 4000;
        const period = fast ? 0.14 : 0.3;
        return { frame: Math.floor(t / period) % 2 === 0 ? "typeA" : "typeB", dy: 0, flip: false };
      }
      case "wait": {
        const blink = Math.floor(t * 4) % 16 === 0;
        return { frame: a.desk ? (blink ? "sleep" : "sit") : (blink ? "sleep" : "stand"), dy: 0, flip: false };
      }
      case "coffee":
        return { frame: Math.floor(t / 1.1) % 2 === 0 ? "stand" : "typeA", dy: 0, flip: false };
      case "nap":
        return { frame: "sleep", dy: Math.floor(t) % 2, flip: false };
      case "plant":
        return { frame: "stand", dy: 0, flip: true };
      case "celebrate":
        return { frame: "stand", dy: -Math.round(Math.abs(Math.sin(a.jumpPhase)) * 3), flip: false };
      case "wave":
        return { frame: Math.floor(t * 3) % 2 === 0 ? "wave" : "stand", dy: 0, flip: false };
      case "football": {
        if (now < a.kickUntil) return { frame: "kick", dy: 0, flip: a.footSide === -1 };
        const b = this.ball!;
        const to = this.approachPoint(a, b);
        const moving = Math.abs(a.x - to.x) >= 2.5 || Math.abs(a.y - to.y) >= 2.5;
        return { frame: moving ? (Math.floor(t * 6) % 2 === 0 ? "walkA" : "walkB") : "stand", dy: 0, flip };
      }
      case "pause":
      case "gone":
        return { frame: "stand", dy: 0, flip };
    }
  }

  private agentDrawable(a: Agent, now: number, selected: boolean): Drawable {
    const seated = (a.act.kind === "work" || a.act.kind === "wait") && a.desk !== null;
    const x = Math.round(a.x), y = Math.round(a.y);
    const depth = seated && a.desk ? a.desk.y + 5 : y + MASCOT_H;
    return {
      depth,
      draw: (cv: Canvas) => {
        const { frame, dy, flip } = this.frameFor(a, now);
        const yy = y + dy;
        const codex = a.session.provider === "codex";
        cv.blit({ rows: (codex ? CODEX_MASCOT : MASCOT)[frame], palette: codex ? CODEX_PALETTE : MASCOT_PALETTE }, x, yy, flip);
        const hatTop = yy - (a.hat.rows.length - 1);
        cv.blit({ rows: a.hat.rows, palette: a.hat.palette }, x, hatTop, flip);
        cv.blit(a.accessory, x, yy + a.accessory.y[a.session.provider], flip);
        this.drawExtras(cv, a, x, yy, now);
        if (selected) {
          const row = (hatTop - 3) >> 1;
          cv.putText(x + MASCOT_W / 2 - 1, row, "▼", 0xfff176);
        }
        if (!a.desk && a.act.kind !== "leave" && a.act.kind !== "wave") {
          const name = a.session.name.slice(0, 14);
          const col = x + Math.floor((MASCOT_W - name.length) / 2);
          cv.putText(col, (yy + MASCOT_H + 1) >> 1, name, 0xd8d8d8);
        }
      },
    };
  }

  private drawExtras(cv: Canvas, a: Agent, x: number, y: number, now: number): void {
    const act = a.act;
    const t = now / 1000;
    if (act.kind === "coffee") {
      cv.blit(CUP, x + MASCOT_W, y + 2, false);
      if (Math.floor(t * 2) % 2 === 0) cv.set(x + MASCOT_W + 1, y, 0x9aa0a6);
    } else if (act.kind === "nap") {
      const phase = Math.floor(t * 2) % 3;
      cv.putText(x + MASCOT_W, (y - 2 - phase * 2) >> 1, phase === 2 ? "Z" : "z", 0xbfc7ff);
    } else if (act.kind === "plant" && this.L.plant) {
      const drop = Math.floor(t * 6) % 4;
      cv.set(x - 2, y + 3 + drop, 0x6fc3ff);
      cv.set(x - 3, y + 1 + ((drop + 2) % 4), 0x6fc3ff);
    } else if (act.kind === "work" && now - a.session.lastActivity < 1500) {
      const c = mix(0xf3e4cf, 0x7fb2ff, (Math.sin(t * 20) + 1) / 2);
      cv.set(x + 5 + (Math.floor(t * 12) % 3), y + 5, c);
    }
  }
}
