import type { Sprite } from "./canvas.ts";
import type { Placement, Point, Screen } from "./desktop-scene.ts";
import { pixelLabel } from "./pixel-font.ts";
import { MUSIC_COLORS } from "./singer.ts";
import { C, CODEX_PALETTE } from "./sprites.ts";

export const SPECIAL_SHOTS = [
  "METEOR DRIVE!", "THUNDER STRIKE!", "CYCLONE SHOT!", "DRAGON ROAR!",
  "FROST FANG!", "SHADOW ECLIPSE!", "SOLAR BURST!", "GALAXY BREAK!", "BICYCLE COMET!",
] as const;
export const BACKFLIP_FRAMES = 12;
const BACKFLIP_SECONDS = 0.6;
const BACKFLIP_VARIANT = SPECIAL_SHOTS.indexOf("BICYCLE COMET!");
const DURATION = 0.95;
const TRAIL_SECONDS = 0.32;
const LABELS = SPECIAL_SHOTS.map(text => pixelLabel(text, MUSIC_COLORS.text, MUSIC_COLORS.background));

const SHOT_SPRITES: Record<string, Sprite> = {
  "shot:fire": { rows: ["..#..", ".###.", "##*##", ".#*#.", "..#.."], palette: { "#": C.body, "*": MUSIC_COLORS.text } },
  "shot:bolt": { rows: ["....#*", "..##*.", "#***..", "..*#..", ".*#...", "*#...."], palette: { "#": MUSIC_COLORS.accent, "*": C.white } },
  "shot:wind": { rows: ["..####..", ".#....#.", "#.......", "#.......", ".#....#.", "..####.."], palette: { "#": CODEX_PALETTE["*"]! } },
  "shot:ring": { rows: ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.."], palette: { "#": MUSIC_COLORS.text } },
  "shot:dragon": { rows: [".#....#...", ".##..##...", "..#####...", ".###o###..", "###***####", ".###**....", "..#######.", "...#..#..."], palette: { "#": C.body, "*": MUSIC_COLORS.text, "o": C.eye } },
  "shot:scale": { rows: ["..#..", ".###.", "##*##", ".#*#.", "..*.."], palette: { "#": C.bodyDark, "*": C.body } },
  "shot:ice": { rows: ["...*...", "..*#*..", ".*###*.", "*##*##*", ".*###*.", "..*#*..", "...*..."], palette: { "#": MUSIC_COLORS.accent, "*": C.white } },
  "shot:shadow": { rows: ["..####..", ".##**...", "##**....", "##*.....", "##**....", ".##**...", "..####.."], palette: { "#": MUSIC_COLORS.background, "*": MUSIC_COLORS.accent } },
  "shot:sun": { rows: ["...#...", ".#.*.#.", "..***..", "#**o**#", "..***..", ".#.*.#.", "...#..."], palette: { "#": C.body, "*": MUSIC_COLORS.text, "o": C.white } },
  "shot:star": { rows: ["...*...", "...#...", "..###..", "*#####*", "..###..", "...#...", "...*..."], palette: { "#": CODEX_PALETTE["*"]!, "*": C.white } },
  "shot:comet": { rows: ["*.......", ".*......", "..#*....", "...##*..", "...#**#.", "....#**#", ".....##."], palette: { "#": MUSIC_COLORS.accent, "*": MUSIC_COLORS.text } },
  "shot:impact": { rows: ["#....#....#", ".#...#...#.", "..#..*..#..", "...#.*.#...", "....***....", "##*******##", "....***....", "...#.*.#...", "..#..*..#..", ".#...#...#.", "#....#....#"], palette: { "#": MUSIC_COLORS.text, "*": C.white } },
};
const TRAIL_SPRITES = ["shot:fire", "shot:bolt", "shot:wind", "shot:scale", "shot:ice", "shot:shadow", "shot:sun", "shot:star", "shot:comet"] as const;

export function footballAtlas(): Record<string, Sprite> {
  const atlas = { ...SHOT_SPRITES };
  LABELS.forEach((label, index) => { atlas[`shot:label:${index}`] = label; });
  return atlas;
}

interface Shot { variant: number; born: number; kicker: number; origin: Point; screen: string; flip: boolean }
interface Sample extends Point { at: number }

/** Decoration only: its random stream and trail never change football physics. */
export class FootballEffects {
  private shot: Shot | null = null;
  private trail: Sample[] = [];
  private previousVariant = -1;

  constructor(private readonly random = Math.random) {}

  get active(): boolean { return this.shot !== null; }

  clear(): void { this.shot = null; this.trail = []; }

  kick(kicker: number, origin: Point, screen: Screen, now: number, flip = false): void {
    const choices = SPECIAL_SHOTS.map((_, i) => i).filter(i => i !== this.previousVariant);
    const variant = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))]!;
    this.previousVariant = variant;
    this.shot = { variant, born: now, kicker, origin: { ...origin }, screen: screen.id, flip };
    this.trail = [];
  }

  backflip(kicker: number, now: number): { step: number; lift: number; flip: boolean } | null {
    const shot = this.shot;
    if (!shot || shot.variant !== BACKFLIP_VARIANT || shot.kicker !== kicker) return null;
    const progress = (now - shot.born) / BACKFLIP_SECONDS;
    if (progress < 0 || progress >= 1) return null;
    return { step: Math.floor(progress * BACKFLIP_FRAMES), lift: Math.sin(progress * Math.PI) * 38, flip: shot.flip };
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
    const add = (sprite: string, point: Point, scale: number, flip = false): void => {
      const asset = SHOT_SPRITES[sprite]!;
      const width = asset.rows[0]!.length, height = asset.rows.length;
      out.push({ sprite, x: Math.round(point.x - width * 2 * scale), y: Math.round(point.y - height * 2 * scale), scale, flip });
    };
    const fade = Math.min(1, (DURATION - age) / 0.2);
    const sprite = TRAIL_SPRITES[shot.variant]!;
    const first = this.trail[0]!;
    const heading = Math.atan2(ball.y - first.y, ball.x - first.x);
    const normal = { x: -Math.sin(heading), y: Math.cos(heading) };
    this.trail.forEach((point, i) => {
      const freshness = 1 - (now - point.at) / TRAIL_SECONDS;
      if (shot.variant === 0) {
        add(sprite, { x: point.x, y: point.y - (1 - freshness) * 14 }, (0.25 + freshness * 0.7) * fade, i % 2 === 0);
      } else if (shot.variant === 1) {
        add(sprite, { x: point.x + Math.sin(i * 2 + age * 30) * 9, y: point.y }, (0.2 + freshness * 0.55) * fade, i % 2 === 0);
      } else if (shot.variant === 2) {
        const angle = age * 18 - i * 0.7;
        add(sprite, { x: point.x + Math.cos(angle) * 14, y: point.y + Math.sin(angle) * 14 }, (0.2 + freshness * 0.5) * fade, i % 2 === 0);
      } else if (shot.variant === 3) {
        // A serpentine body follows the sampled path behind a dragon head.
        const sway = Math.sin(age * 20 - i * 0.8) * 12;
        add(sprite, { x: point.x + normal.x * sway, y: point.y + normal.y * sway }, (0.25 + freshness * 0.75) * fade);
      } else if (shot.variant === 4) {
        const spread = (i % 2 ? 1 : -1) * (1 - freshness) * 26;
        add(sprite, { x: point.x + normal.x * spread, y: point.y + normal.y * spread }, (0.15 + freshness * 0.55) * fade);
      } else if (shot.variant === 5) {
        // Older crescents grow into a smoky wake as the ball escapes.
        add(sprite, point, (0.35 + (1 - freshness) * 0.5) * fade, i % 2 === 0);
      } else if (shot.variant === 6) {
        add(sprite, point, (0.2 + freshness * 0.65) * fade, i % 2 === 0);
      } else if (shot.variant === BACKFLIP_VARIANT) {
        const curve = Math.sin(freshness * Math.PI) * 22;
        add(sprite, { x: point.x + normal.x * curve, y: point.y + normal.y * curve }, (0.2 + freshness * 0.65) * fade, shot.flip);
      } else {
        const spiral = age * 16 - i * 1.1;
        add(sprite, { x: point.x + Math.cos(spiral) * 20, y: point.y + Math.sin(spiral) * 10 }, (0.15 + freshness * 0.5) * fade);
      }
    });
    // A local impact frame, shockwave, and six outward elemental fragments.
    if (age < 0.16) add("shot:impact", shot.origin, 0.35 + age * 3);
    if (age < 0.28) add("shot:ring", shot.origin, 0.3 + age * 3);
    if (age < 0.24) {
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 + Math.PI / 6;
        const radius = 10 + age * 135;
        add(sprite, { x: shot.origin.x + Math.cos(angle) * radius, y: shot.origin.y + Math.sin(angle) * radius }, 0.45 * (1 - age / 0.24), i % 2 === 0);
      }
    }
    // Each power has its own silhouette around the ball, drawn behind it.
    for (let i = 0; i < 3; i++) {
      const angle = age * (shot.variant === 5 ? -10 : 14) + i * Math.PI * 2 / 3;
      const radius = shot.variant === 6 ? 18 + Math.sin(age * 12) * 5 : shot.variant === 7 ? 26 : 17;
      const point = { x: ball.x + Math.cos(angle) * radius, y: ball.y + Math.sin(angle) * radius * (shot.variant === 7 ? 0.45 : 1) };
      add(sprite, point, (shot.variant === 5 ? 0.7 : 0.5) * fade, i % 2 === 0);
    }
    if (shot.variant === 3) add("shot:dragon", { x: ball.x + Math.cos(heading) * 17, y: ball.y + Math.sin(heading) * 17 }, 0.85 * fade, Math.cos(heading) < 0);
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
