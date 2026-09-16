import type { Sprite } from "./canvas.ts";
import type { Placement, Point, Screen } from "./desktop-scene.ts";
import { pixelLabel } from "./pixel-font.ts";
import { MUSIC_COLORS } from "./singer.ts";
import { C, CODEX_PALETTE } from "./sprites.ts";

export const SPECIAL_SHOTS = ["METEOR DRIVE!", "THUNDER STRIKE!", "CYCLONE SHOT!"] as const;
const DURATION = 0.95;
const TRAIL_SECONDS = 0.32;
const LABELS = SPECIAL_SHOTS.map(text => pixelLabel(text, MUSIC_COLORS.text, MUSIC_COLORS.background));

export function footballAtlas(): Record<string, Sprite> {
  const atlas: Record<string, Sprite> = {
    "shot:fire": { rows: ["..#..", ".###.", "##*##", ".#*#.", "..#.."], palette: { "#": C.body, "*": MUSIC_COLORS.text } },
    "shot:bolt": { rows: ["....#*", "..##*.", "#***..", "..*#..", ".*#...", "*#...."], palette: { "#": MUSIC_COLORS.accent, "*": C.white } },
    "shot:wind": { rows: ["..####..", ".#....#.", "#.......", "#.......", ".#....#.", "..####.."], palette: { "#": CODEX_PALETTE["*"]! } },
    "shot:ring": { rows: ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.."], palette: { "#": MUSIC_COLORS.text } },
  };
  LABELS.forEach((label, index) => { atlas[`shot:label:${index}`] = label; });
  return atlas;
}

interface Shot { variant: number; born: number; kicker: number; origin: Point; screen: string }
interface Sample extends Point { at: number }

/** Decoration only: its random stream and trail never change football physics. */
export class FootballEffects {
  private shot: Shot | null = null;
  private trail: Sample[] = [];
  private previousVariant = -1;

  constructor(private readonly random = Math.random) {}

  get active(): boolean { return this.shot !== null; }

  clear(): void { this.shot = null; this.trail = []; }

  kick(kicker: number, origin: Point, screen: Screen, now: number): void {
    const choices = SPECIAL_SHOTS.map((_, i) => i).filter(i => i !== this.previousVariant);
    const variant = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))]!;
    this.previousVariant = variant;
    this.shot = { variant, born: now, kicker, origin: { ...origin }, screen: screen.id };
    this.trail = [];
  }

  render(ball: Point, now: number, screens: Screen[], idlePids: Set<number>, paused = false): Placement[] {
    const shot = this.shot;
    if (!shot) return [];
    const age = now - shot.born;
    if (paused || age >= DURATION || !idlePids.has(shot.kicker) || !screens.length) { this.clear(); return []; }
    const last = this.trail.at(-1);
    // Preserve the actual ball path through bounces; never draw across a skipped screen gap.
    if (last && Math.hypot(ball.x - last.x, ball.y - last.y) > 80) this.trail = [];
    this.trail = this.trail.filter(point => now - point.at < TRAIL_SECONDS);
    if (!last || now - last.at >= 1 / 35 || !this.trail.length) this.trail.push({ x: ball.x, y: ball.y, at: now });
    if (this.trail.length > 12) this.trail.shift();
    const out: Placement[] = [];
    const add = (sprite: string, point: Point, width: number, height: number, scale: number, flip = false): void => {
      out.push({ sprite, x: Math.round(point.x - width * 2 * scale), y: Math.round(point.y - height * 2 * scale), scale, flip });
    };
    const fade = Math.min(1, (DURATION - age) / 0.2);
    this.trail.forEach((point, i) => {
      const freshness = 1 - (now - point.at) / TRAIL_SECONDS;
      if (shot.variant === 0) {
        add("shot:fire", { x: point.x, y: point.y - (1 - freshness) * 14 }, 5, 5, (0.25 + freshness * 0.7) * fade, i % 2 === 0);
      } else if (shot.variant === 1) {
        add("shot:bolt", { x: point.x + Math.sin(i * 2 + age * 30) * 9, y: point.y }, 6, 6, (0.2 + freshness * 0.55) * fade, i % 2 === 0);
      } else {
        const angle = age * 18 - i * 0.7;
        add("shot:wind", { x: point.x + Math.cos(angle) * 14, y: point.y + Math.sin(angle) * 14 }, 8, 6, (0.2 + freshness * 0.5) * fade, i % 2 === 0);
      }
    });
    // A brief launch shockwave and an orbit around the powered ball.
    if (age < 0.28) add("shot:ring", shot.origin, 7, 7, 0.3 + age * 3);
    for (let i = 0; i < 3; i++) {
      const angle = age * 14 + i * Math.PI * 2 / 3;
      const point = { x: ball.x + Math.cos(angle) * 17, y: ball.y + Math.sin(angle) * 17 };
      const sprite = shot.variant === 0 ? "shot:fire" : shot.variant === 1 ? "shot:bolt" : "shot:wind";
      add(sprite, point, shot.variant === 2 ? 8 : shot.variant === 1 ? 6 : 5, shot.variant === 0 ? 5 : 6, 0.5 * fade, i % 2 === 0);
    }
    const screen = screens.find(s => s.id === shot.screen);
    if (screen) {
      const label = LABELS[shot.variant]!;
      const pop = age < 0.2 ? Math.sin(age / 0.2 * Math.PI) * 0.06 : 0;
      const scale = Math.max(0.01, Math.min((0.45 + pop) * fade, (screen.w - 16) / (label.rows[0]!.length * 4)));
      const width = label.rows[0]!.length * 4 * scale, height = label.rows.length * 4 * scale;
      out.push({
        sprite: `shot:label:${shot.variant}`, scale, flip: false,
        x: Math.round(Math.max(screen.x + 8, Math.min(shot.origin.x - width / 2, screen.x + screen.w - width - 8))),
        y: Math.round(Math.max(screen.y + 8, Math.min(shot.origin.y - 64 - age * 10, screen.y + screen.h - height - 8))),
      });
    }
    return out;
  }
}
