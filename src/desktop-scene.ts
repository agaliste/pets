import type { Sprite } from "./canvas.ts";
import { cleanText, clipText } from "./canvas.ts";
import type { MusicView } from "./music.ts";
import type { AgentSession } from "./sessions.ts";
import { MUSIC_COLORS, wrapBubble } from "./singer.ts";
import { pixelLabel } from "./pixel-font.ts";
import { FootballEffects, footballAtlas } from "./football-effects.ts";
import { ACCESSORIES, BALL, C, CODEX_MASCOT, CODEX_PALETTE, HATS, MASCOT, MASCOT_PALETTE, type MascotFrame } from "./sprites.ts";

export interface Point { x: number; y: number }
export interface Screen extends Point { id: string; w: number; h: number }
export interface Placement extends Point { sprite: string; flip: boolean; scale?: number }
export interface Bubble extends Point { screen: string; title: string; lines: string[] }
export interface DesktopFrame {
  type: "frame";
  sprites: Placement[];
  bubbles: Bubble[];
  sessions: string[];
  status: string;
}

export const PIXEL = 4;
const MARGIN = 48;
const ARRIVAL_SECONDS = 1;
const LIGHTNING_SECONDS = 0.55;
const LIGHTNING_SCALE = 2.5;
const WORK_CALLOUT_SECONDS = 1.15;
const WORK_CALLOUT = pixelLabel("WORK!", MUSIC_COLORS.text, MUSIC_COLORS.background);
const speed = (p: Point, q: Point, amount: number): Point => {
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  return d ? { x: (q.x - p.x) / d * amount, y: (q.y - p.y) / d * amount } : { x: 0, y: 0 };
};
const distance = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
export const contains = (s: Screen, p: Point): boolean => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;

export function nearestScreen(screens: Screen[], p: Point): Screen | undefined {
  return screens.reduce<Screen | undefined>((best, s) => {
    const d = (r: Screen): number => distance(p, { x: clamp(p.x, r.x, r.x + r.w), y: clamp(p.y, r.y, r.y + r.h) });
    return !best || d(s) < d(best) ? s : best;
  }, undefined);
}

export function onScreen(p: Point, screens: Screen[], margin = 0): Point {
  const s = nearestScreen(screens, p);
  if (!s) return p;
  const mx = Math.min(margin, s.w / 2), my = Math.min(margin, s.h / 2);
  return { x: clamp(p.x, s.x + mx, s.x + s.w - mx), y: clamp(p.y, s.y + my, s.y + s.h - my) };
}

/** Ray/rectangle entry distance; works with negative origins and stacked displays. */
function rayEntry(p: Point, v: Point, s: Screen): number | null {
  let lo = 0, hi = Infinity;
  for (const [position, direction, min, max] of [[p.x, v.x, s.x, s.x + s.w], [p.y, v.y, s.y, s.y + s.h]]) {
    if (Math.abs(direction!) < 1e-9) {
      if (position! < min! || position! > max!) return null;
    } else {
      const a = (min! - position!) / direction!, b = (max! - position!) / direction!;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
  }
  return hi >= lo && hi > 0 ? lo : null;
}

/** Cross adjacent displays continuously; skip empty gaps between display rectangles. */
export function travel(p: Point, velocity: Point, dt: number, screens: Screen[]): { point: Point; velocity: Point } {
  if (!screens.length) return { point: p, velocity };
  const next = { x: p.x + velocity.x * dt, y: p.y + velocity.y * dt };
  if (screens.some(s => contains(s, next))) return { point: next, velocity };
  let entry = Infinity;
  for (const s of screens) {
    if (contains(s, p)) continue;
    const t = rayEntry(p, velocity, s);
    if (t !== null && t < entry) entry = t;
  }
  if (Number.isFinite(entry)) {
    return { point: onScreen({ x: p.x + velocity.x * (entry + 0.001), y: p.y + velocity.y * (entry + 0.001) }, screens), velocity };
  }
  const s = nearestScreen(screens, p)!;
  return {
    point: onScreen(next, [s], 1),
    velocity: {
      x: next.x < s.x || next.x > s.x + s.w ? -velocity.x : velocity.x,
      y: next.y < s.y || next.y > s.y + s.h ? -velocity.y : velocity.y,
    },
  };
}

export function desktopAtlas(): Record<string, Sprite> {
  const atlas: Record<string, Sprite> = { ball: BALL, ...footballAtlas() };
  for (const frame of Object.keys(MASCOT) as MascotFrame[]) {
    atlas[`claude:${frame}`] = { rows: MASCOT[frame], palette: MASCOT_PALETTE };
    atlas[`codex:${frame}`] = { rows: CODEX_MASCOT[frame], palette: CODEX_PALETTE };
  }
  HATS.forEach((hat, i) => { atlas[`hat:${i}`] = hat; });
  ACCESSORIES.forEach((accessory, i) => { atlas[`accessory:${i}`] = accessory; });
  atlas.microphone = { rows: [".##.", "####", ".##.", ".==.", ".==.", ".==."], palette: { "#": MUSIC_COLORS.text, "=": MUSIC_COLORS.muted } };
  atlas.note = { rows: ["..##", "..#.", "..#.", "###.", "##.."], palette: { "#": MUSIC_COLORS.accent } };
  atlas.laptop = { rows: ["======", "=****=", "=****=", "======", ".====."], palette: { "=": CODEX_PALETTE["="]!, "*": MUSIC_COLORS.accent } };
  const fire = { "#": C.body, "*": MUSIC_COLORS.text, "+": C.bodyDark };
  atlas["explosion:burst"] = {
    rows: ["....#....", ".#..#..#.", "..##*##..", "..#***#..", "##*****##", "..#***#..", "..##*##..", ".#..#..#.", "....#...."], palette: fire,
  };
  atlas["explosion:ring"] = {
    rows: ["...###...", "..#+++#..", ".#+...+#.", "#+.....+#", "#+.....+#", "#+.....+#", ".#+...+#.", "..#+++#..", "...###..."], palette: fire,
  };
  atlas["explosion:smoke"] = {
    rows: ["..##...", ".####..", "######.", ".######", "..####.", "...##.."], palette: { "#": MUSIC_COLORS.muted },
  };
  atlas["explosion:claude"] = { rows: ["##", "#."], palette: { "#": C.body } };
  atlas["explosion:codex"] = { rows: ["##", "#."], palette: { "#": CODEX_PALETTE["#"]! } };
  const vortex = [
    "....#####....", "..##*****##..", ".#**ooooo**#.", ".#*oo###oo*#.",
    "#*oo#***#oo*#", "#*o#*ooo*#o*#", "#*o#*o+o*#o*#", "#*o#*oo**#o*#",
    "#*oo####*oo*#", ".#*ooooooo*#.", ".#**ooooo**#.", "..##*****##..", "....#####....",
  ];
  const portalPalette = { "#": MUSIC_COLORS.accent, "*": CODEX_PALETTE["*"]!, "+": MUSIC_COLORS.text, "o": MUSIC_COLORS.background };
  atlas["portal:vortexA"] = { rows: vortex, palette: portalPalette };
  atlas["portal:vortexB"] = { rows: vortex[0]!.split("").map((_, x) => vortex.map(row => row[x]).reverse().join("")), palette: portalPalette };
  atlas["portal:spark"] = { rows: [".#.", "###", ".#."], palette: { "#": CODEX_PALETTE["*"]! } };
  const electric = { "#": MUSIC_COLORS.accent, "*": MUSIC_COLORS.text };
  atlas["lightning:bolt"] = {
    rows: [
      "...#*#...", "....#*#..", "....#*#..", "....#*#..", "...#*#...", "...#*#...",
      "..#*#....", "..#****#.", "...###*#.", ".....#*#.", "....#*#..", "....#*#..",
      "...#*#...", "...#*#...", "..#*#....", "..#***#..", "....#*#..", "....#*#..",
      "...#*#...", "...#*#...", "....*....", "....*....",
    ], palette: electric,
  };
  atlas["lightning:spark"] = { rows: ["..*..", ".#*#.", "*****", ".#*#.", "..*.."], palette: electric };
  atlas["work:callout"] = WORK_CALLOUT;
  return atlas;
}

interface Pet extends Point {
  session: AgentSession;
  target: Point;
  hat: number;
  accessory: number;
  flip: boolean;
  kickUntil: number;
  phase: number;
  arrivedAt: number;
  lastStatus: AgentSession["status"];
  lightningAt: number;
}
const hash = (s: string): number => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

export class DesktopScene {
  readonly pets = new Map<number, Pet>();
  screens: Screen[] = [];
  ball: Point & { velocity: Point } = { x: 0, y: 0, velocity: { x: 160, y: 80 } };
  private singer: (Point & { target: Point; flip: boolean }) | null = null;
  private elapsed = 0;
  private readingTime = 0;
  private nextKick = 0;
  private lyric = "";
  private lyricSince = 0;
  private explosions: Array<Point & { born: number; provider: AgentSession["provider"]; phase: number }> = [];
  private readonly shots: FootballEffects;

  get hasEffects(): boolean {
    return this.explosions.length > 0 || this.shots.active || [...this.pets.values()].some(p =>
      this.elapsed - p.arrivedAt < ARRIVAL_SECONDS || this.elapsed - p.lightningAt < WORK_CALLOUT_SECONDS);
  }

  constructor(private readonly random = Math.random, shotRandom = Math.random) {
    this.shots = new FootballEffects(shotRandom);
  }

  setScreens(screens: Screen[]): void {
    // Display reconfiguration is not an agent exit; don't replay an offscreen burst.
    this.explosions = [];
    this.shots.clear();
    for (const pet of this.pets.values()) { pet.arrivedAt = -Infinity; pet.lightningAt = -Infinity; }
    this.screens = screens.filter(s => [s.x, s.y, s.w, s.h].every(Number.isFinite) && s.w > 0 && s.h > 0);
    if (!this.screens.length) return;
    this.ball = { ...onScreen(this.ball, this.screens, MARGIN), velocity: this.ball.velocity };
    for (const pet of this.pets.values()) {
      Object.assign(pet, onScreen(pet, this.screens, MARGIN));
      pet.target = onScreen(pet.target, this.screens, MARGIN);
    }
    if (this.singer) {
      Object.assign(this.singer, onScreen(this.singer, this.screens, MARGIN));
      this.singer.target = onScreen(this.singer.target, this.screens, MARGIN);
    }
  }

  private destination(from?: Point): Point {
    const current = from && nearestScreen(this.screens, from);
    const options = this.screens.filter(s => s !== current);
    const pool = options.length ? options : this.screens;
    const screen = pool[Math.floor(this.random() * pool.length)]!;
    return onScreen({ x: screen.x + this.random() * screen.w, y: screen.y + this.random() * screen.h }, [screen], MARGIN + 40);
  }

  private move(pet: Point & { flip: boolean }, target: Point, rate: number, dt: number): void {
    const v = speed(pet, target, Math.min(rate, distance(pet, target) / Math.max(dt, 0.001)));
    const result = travel(pet, v, dt, this.screens);
    Object.assign(pet, result.point);
    if (Math.abs(v.x) > 1) pet.flip = v.x < 0;
  }

  update(sessions: AgentSession[], music: MusicView | null, dt: number, paused = false): DesktopFrame {
    const frame: DesktopFrame = { type: "frame", sprites: [], bubbles: [], sessions: [], status: "" };
    if (!this.screens.length) return frame;
    this.readingTime += clamp(dt, 0, 1);
    dt = paused ? 0 : clamp(dt, 0, 0.05);
    this.elapsed += dt;
    const now = this.elapsed;
    const live = new Set(sessions.map(s => s.pid));
    this.explosions = paused ? [] : this.explosions.filter(effect => now - effect.born < 0.85);
    for (const [pid, pet] of this.pets) {
      if (live.has(pid)) continue;
      if (!paused) this.explosions.push({
        x: pet.x, y: pet.y + Math.sin((now - dt) * 2 + pet.phase) * 5,
        born: now, provider: pet.session.provider, phase: pet.phase,
      });
      this.pets.delete(pid);
    }
    for (const session of sessions) {
      let pet = this.pets.get(session.pid);
      if (!pet) {
        const seed = hash(`${session.provider}:${session.sessionId ?? session.pid}`);
        const free = (count: number, taken: Set<number>): number => {
          let i = seed % count;
          for (let n = 0; n < count && taken.has(i); n++) i = (i + 1) % count;
          return i;
        };
        pet = {
          ...this.destination(), target: this.destination(), session,
          hat: free(HATS.length, new Set([...this.pets.values()].map(p => p.hat))),
          accessory: free(ACCESSORIES.length, new Set([...this.pets.values()].map(p => p.accessory))),
          flip: false, kickUntil: 0, phase: seed % 30,
          arrivedAt: paused ? -Infinity : now,
          lastStatus: session.status, lightningAt: -Infinity,
        };
        this.pets.set(session.pid, pet);
      }
      // Snapshot status independently: a tracker may mutate the same session object.
      if (!paused && pet.lastStatus === "idle" && session.status === "busy") pet.lightningAt = now;
      if (paused || session.status !== "busy") pet.lightningAt = -Infinity;
      pet.lastStatus = session.status;
      pet.session = session;
      if (paused) pet.arrivedAt = -Infinity;
    }
    const players = [...this.pets.values()].filter(p => p.session.status === "idle" && now - p.arrivedAt >= ARRIVAL_SECONDS);
    if (players.length && dt) {
      const result = travel(this.ball, this.ball.velocity, dt, this.screens);
      Object.assign(this.ball, result.point, { velocity: result.velocity });
      const damping = Math.exp(-0.26 * dt);
      this.ball.velocity.x *= damping; this.ball.velocity.y *= damping;
    }
    const chaser = players.reduce<Pet | null>((best, p) => !best || distance(p, this.ball) < distance(best, this.ball) ? p : best, null);
    const place = (sprite: string, x: number, y: number, flip = false): void => {
      frame.sprites.push({ sprite, x: Math.round(x), y: Math.round(y), flip });
    };
    for (const pet of this.pets.values()) {
      const busy = pet.session.status === "busy";
      const arrivalAge = now - pet.arrivedAt;
      const arriving = arrivalAge < ARRIVAL_SECONDS;
      if (distance(pet, pet.target) < 12) pet.target = this.destination(pet);
      if (dt && !arriving) this.move(pet, pet === chaser ? this.ball : pet.target, pet === chaser ? 145 : busy ? 20 : 46, dt);
      if (dt && pet === chaser && now >= this.nextKick && distance(pet, this.ball) < 38) {
        const receivers = players.filter(p => p !== pet);
        const otherScreens = receivers.filter(p => nearestScreen(this.screens, p) !== nearestScreen(this.screens, pet));
        const pool = otherScreens.length ? otherScreens : receivers;
        const receiver = pool[Math.floor(this.random() * pool.length)];
        const target = receiver ?? this.destination(pet);
        this.ball.velocity = speed(pet, target, 340);
        pet.flip = this.ball.velocity.x < 0;
        this.ball.x = pet.x + (pet.flip ? -30 : 30); this.ball.y = pet.y + 8;
        Object.assign(this.ball, onScreen(this.ball, this.screens, 8));
        pet.kickUntil = now + 0.35; this.nextKick = now + 0.7;
        this.shots.kick(pet.session.pid, pet, nearestScreen(this.screens, pet)!, now);
      }
      const animated = Math.floor(now * (busy ? 5 : 4)) % 2 === 0;
      const lightningAge = now - pet.lightningAt;
      const pose: MascotFrame = paused ? "stand" : arriving || lightningAge < 0.18 ? "wave" : pet.kickUntil > now ? "kick" : busy ? animated ? "typeA" : "typeB" : animated ? "walkA" : "walkB";
      if (arriving) {
        const opening = clamp(arrivalAge / 0.2, 0.08, 1);
        const closing = clamp((ARRIVAL_SECONDS - arrivalAge) / 0.3, 0, 1);
        const scale = opening * closing * 1.35;
        frame.sprites.push({ sprite: `portal:vortex${Math.floor(arrivalAge * 12) % 2 ? "B" : "A"}`, x: Math.round(pet.x - 26 * scale), y: Math.round(pet.y - 26 * scale), scale, flip: false });
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5 + arrivalAge * 8 + pet.phase;
          const radius = 32 * opening * closing;
          frame.sprites.push({ sprite: "portal:spark", x: Math.round(pet.x + Math.cos(angle) * radius - 3), y: Math.round(pet.y + Math.sin(angle) * radius - 3), scale: 0.5 * closing, flip: false });
        }
      }
      const reveal = arriving ? clamp((arrivalAge - 0.15) / 0.45, 0, 1) : 1;
      const x = pet.x - 24 * reveal;
      const y = pet.y - 16 * reveal + (paused || arriving ? 0 : Math.sin(now * 2 + pet.phase) * 5);
      const bodyPart = (sprite: string, px: number, py: number): void => {
        if (reveal > 0) frame.sprites.push({ sprite, x: Math.round(px), y: Math.round(py), scale: reveal, flip: pet.flip });
      };
      bodyPart(`${pet.session.provider}:${pose}`, x, y);
      bodyPart(`hat:${pet.hat}`, x, y - (HATS[pet.hat]!.rows.length - 1) * PIXEL * reveal);
      bodyPart(`accessory:${pet.accessory}`, x, y + ACCESSORIES[pet.accessory]!.y[pet.session.provider] * PIXEL * reveal);
      if (busy && reveal > 0) frame.sprites.push({ sprite: "laptop", x: Math.round(x + (pet.flip ? -18 : 42) * reveal), y: Math.round(y + 18 * reveal), scale: reveal, flip: false });
      if (lightningAge < LIGHTNING_SECONDS) {
        const targetY = y + 8 * reveal;
        const screen = nearestScreen(this.screens, pet)!;
        if (lightningAge < 0.22) {
          // Tile square-pixel zigzags from this monitor's top to the moving head.
          // Matching endpoints join the segments without stretching the sprite vertically.
          const height = clamp(Math.round(targetY) - screen.y, 0, screen.h);
          const maxScale = Math.min(LIGHTNING_SCALE, screen.w / 36);
          const segments = Math.ceil(height / (88 * maxScale));
          const scale = segments ? height / (segments * 88) : 0;
          const left = clamp(pet.x - 18 * scale, screen.x, screen.x + screen.w - 36 * scale);
          for (let i = 0; i < segments; i++) frame.sprites.push({
            sprite: "lightning:bolt", x: left, y: screen.y + i * 88 * scale,
            scale, flip: i % 2 === 1,
          });
        }
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5 + pet.phase;
          const radius = 14 + lightningAge * 68;
          const scale = (1 - lightningAge / LIGHTNING_SECONDS);
          frame.sprites.push({
            sprite: "lightning:spark", scale, flip: false,
            x: Math.round(pet.x + Math.cos(angle) * radius - 10 * scale),
            y: Math.round(targetY + Math.sin(angle) * radius - 10 * scale),
          });
        }
      }
      if (lightningAge < WORK_CALLOUT_SECONDS) {
        const screen = nearestScreen(this.screens, pet)!;
        const bounce = lightningAge < 0.25 ? Math.sin(lightningAge / 0.25 * Math.PI) : 0;
        const close = clamp((WORK_CALLOUT_SECONDS - lightningAge) / 0.18, 0, 1);
        const labelWidth = WORK_CALLOUT.rows[0]!.length * PIXEL;
        const scale = Math.min((0.5 + bounce * 0.06) * close, Math.max(0.01, (screen.w - 16) / labelWidth));
        const width = labelWidth * scale, height = WORK_CALLOUT.rows.length * PIXEL * scale;
        const right = pet.x + 38;
        const left = right + width <= screen.x + screen.w - 8 ? right : pet.x - 38 - width;
        frame.sprites.push({
          sprite: "work:callout", scale, flip: false,
          x: Math.round(clamp(left, screen.x + 8, screen.x + screen.w - width - 8)),
          y: Math.round(clamp(pet.y - 42 - bounce * 9 - lightningAge * 6, screen.y + 8, screen.y + screen.h - height - 8)),
        });
      }
      frame.sessions.push(`${pet.session.provider === "codex" ? "Codex" : "Claude"} · ${clipText(cleanText(pet.session.name), 50)} · ${pet.session.status} · ${HATS[pet.hat]!.name} · ${pet.session.pid}`);
    }
    frame.sprites.push(...this.shots.render(this.ball, now, this.screens, new Set(players.map(p => p.session.pid)), paused));
    // Keep the ball readable in front of its special-shot trail and aura.
    if (players.length) place("ball", this.ball.x - 8, this.ball.y - 8);
    if (music) {
      this.singer ??= { ...this.destination(), target: this.destination(), flip: false };
      if (distance(this.singer, this.singer.target) < 12) this.singer.target = this.destination(this.singer);
      if (dt) this.move(this.singer, this.singer.target, 54, dt);
      const x = this.singer.x - 24, y = this.singer.y - 16 + (paused ? 0 : Math.sin(now * 3) * 5);
      const provider = hash(music.track.id) % 2 ? "claude" : "codex";
      place(`${provider}:${paused || Math.floor(now * 3) % 2 ? "stand" : "wave"}`, x, y, this.singer.flip);
      place("microphone", x + (this.singer.flip ? -12 : 46), y + 8);
      place("note", x + 60, y - 22 - (paused ? 0 : now * 12 % 20));
      const lyricKey = `${music.track.id}\0${music.text}`;
      if (lyricKey !== this.lyric) { this.lyric = lyricKey; this.lyricSince = this.readingTime; }
      const lines = wrapBubble(music.text, 36);
      const page = Math.floor((this.readingTime - this.lyricSince) / 4) % Math.ceil(lines.length / 2);
      const labels: Record<MusicView["state"], string> = { synced: "", plain: "Lyrics · unsynced · ", loading: "Finding lyrics · ", missing: "No lyrics · ", instrumental: "Instrumental · ", error: "Lyrics unavailable · " };
      frame.bubbles.push({
        x: this.singer.x, y: y - 24, screen: nearestScreen(this.screens, this.singer)!.id,
        title: clipText(cleanText(`${labels[music.state]}${music.track.artist} · ${music.track.title}`), 100),
        lines: lines.slice(page * 2, page * 2 + 2),
      });
    } else this.singer = null;
    for (const effect of this.explosions) {
      const age = now - effect.born;
      if (age < 0.38) {
        const scale = 0.6 + age * 3;
        frame.sprites.push({ sprite: age < 0.14 ? "explosion:burst" : "explosion:ring", x: Math.round(effect.x - 18 * scale), y: Math.round(effect.y - 18 * scale), scale, flip: false });
      }
      // Eight provider-colored pixel fragments fly out, arc downward, then shrink.
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + effect.phase * 0.1;
        const radius = 8 + age * (38 + i % 3 * 10);
        const scale = Math.max(0.15, 1 - age / 0.85);
        frame.sprites.push({
          sprite: `explosion:${effect.provider}`, scale, flip: i % 2 === 0,
          x: Math.round(effect.x + Math.cos(angle) * radius - 4 * scale),
          y: Math.round(effect.y + Math.sin(angle) * radius + age * age * 35 - 4 * scale),
        });
      }
      if (age >= 0.28 && age < 0.75) {
        const scale = (0.85 - age) * 1.4;
        for (const side of [-1, 1]) frame.sprites.push({
          sprite: "explosion:smoke", scale, flip: side === -1,
          x: Math.round(effect.x + side * age * 24 - 14 * scale),
          y: Math.round(effect.y - age * 28 - 12 * scale),
        });
      }
    }
    frame.status = sessions.length ? `${sessions.length} agents · ${players.length} playing` : "Start Claude or Codex to bring in an agent";
    return frame;
  }
}
