import { PIXEL_FONT as FONT } from "./pixel-font.ts";
import type { Sprite } from "./canvas.ts";
import { nearestScreen, type Placement, type Point, type Screen } from "./desktop-scene.ts";
import { C, CODEX_PALETTE, MASCOT_PALETTE } from "./sprites.ts";
import { MUSIC_COLORS } from "./singer.ts";

export const COMBO_WINDOW_MS = 1400;
export const COMBO_TIERS = [
  { hits: 1, label: "", move: "jab" },
  { hits: 5, label: "COMBO!", move: "kick" },
  { hits: 12, label: "ON FIRE!", move: "uppercut" },
  { hits: 25, label: "RAMPAGE!", move: "spin" },
  { hits: 50, label: "OOOOMMMGGGG!", move: "blast" },
  { hits: 100, label: "GODLIKE!", move: "blast" },
] as const;
export type CombatMove = typeof COMBO_TIERS[number]["move"];


export function combatAtlas(): Record<string, Sprite> {
  const atlas: Record<string, Sprite> = {};
  const poses: Record<string, string[]> = {
    guard: ["..#......#......", ".##########.....", ".##o####o##.....", "############.##.", "###############.", ".##########.....", "...##..##.......", "..###..###......"],
    jab: ["..#......#......", ".##########.....", ".##o####o##.....", "################", "############..##", ".##########.....", "...##..##.......", "..###...###....."],
    kick: ["..#......#......", ".##########.....", ".##o####o##.....", "############....", "############....", ".##########.....", "...##..#########", "..###..........."],
    uppercut: ["..#......#..##..", ".#############..", ".##o####o#####..", "############....", "############....", ".##########.....", "...##..##.......", "....##..##......"],
    spin: ["....#......#....", "...##########...", "...##o####o##...", ".##############.", "################", "...##########...", ".#####..#####...", "###........###.."],
    blast: ["..#......#......", ".##########.....", ".##o####o##.....", "###############.", "################", ".##########.....", "..###..###......", ".###....###....."],
  };
  for (const [name, rows] of Object.entries(poses)) atlas[`fight:${name}`] = { rows, palette: MASCOT_PALETTE };
  atlas["fight:enemy"] = { rows: ["...######...", "..########..", "..#oooooo#..", "..#o*oo*o#..", ".##########.", "..##====##..", "...##..##...", "...==..==..."], palette: CODEX_PALETTE };
  atlas["fight:hurt"] = { rows: ["..######....", ".########...", ".#oooooo#...", ".#o=oo=o#...", "##########..", ".##====##...", "..##..##....", ".==....==..."], palette: CODEX_PALETTE };
  const fire = { "#": C.body, "+": C.white, "*": MUSIC_COLORS.accent };
  atlas["fight:spark"] = { rows: ["...+...", "#..+..#", ".#.+.#.", "+++*+++", ".#.+.#.", "#..+..#", "...+..."], palette: fire };
  atlas["fight:flame"] = { rows: [".......#...", "..#...###..", "..##.##+#..", ".####++++#.", "####+++++##", ".####+++##.", "..#######..", "....###...."], palette: fire };
  atlas["fight:streak"] = { rows: ["....++++", "++####++", "....++++"], palette: fire };
  atlas["fight:meter"] = { rows: ["#"], palette: { "#": MUSIC_COLORS.accent } };
  for (const [letter, bitmap] of Object.entries(FONT)) {
    const rows = bitmap.split("/").map(row => row.replaceAll("0", ".").replaceAll("1", "#"));
    atlas[`fight:letter:${letter}`] = { rows, palette: { "#": MUSIC_COLORS.text } };
    atlas[`fight:shadow:${letter}`] = { rows, palette: { "#": MUSIC_COLORS.background } };
  }
  return atlas;
}

export interface CombatState {
  hits: number;
  tier: number;
  move: CombatMove;
  label: string;
  age: number;
  remaining: number;
}

/** Accepts only event times and a point. Typed characters never enter this module. */
export class TypingCombat {
  private hits = 0;
  private lastHit = -Infinity;
  private lastAccepted = -Infinity;
  private anchor: Point | null = null;
  private tierAt = -Infinity;

  reset(): void { this.hits = 0; this.lastHit = -Infinity; this.lastAccepted = -Infinity; this.anchor = null; this.tierAt = -Infinity; }

  hit(now: number, anchor: Point): boolean {
    if (![now, anchor.x, anchor.y].every(Number.isFinite) || now - this.lastAccepted < 18) return false;
    if (now - this.lastHit > COMBO_WINDOW_MS) this.hits = 0;
    const previousTier = this.tier();
    this.hits = Math.min(999, this.hits + 1);
    this.lastHit = now; this.lastAccepted = now; this.anchor = { ...anchor };
    if (previousTier !== this.tier()) this.tierAt = now;
    return true;
  }

  private tier(): number { return COMBO_TIERS.findLastIndex(tier => tier.hits <= this.hits); }

  state(now: number): CombatState | null {
    const age = now - this.lastHit;
    if (!this.anchor || age < 0 || age > COMBO_WINDOW_MS + 500) return null;
    const tier = Math.max(0, this.tier());
    const tierMove = COMBO_TIERS[tier]!.move;
    const finisher = this.hits % 5 === 0 || this.hits === COMBO_TIERS[tier]!.hits;
    const move: CombatMove = tier >= 2 && finisher ? tierMove : this.hits % 3 === 0 ? "kick" : "jab";
    return { hits: this.hits, tier, move, label: COMBO_TIERS[tier]!.label, age, remaining: Math.max(0, 1 - age / COMBO_WINDOW_MS) };
  }

  render(now: number, screens: Screen[], reducedMotion = false): Placement[] {
    const state = this.state(now);
    if (!state || !this.anchor) return [];
    const screen = nearestScreen(screens, this.anchor);
    if (!screen || screen.w < 220 || screen.h < 160) return [];
    // Keep the entire fight above the insertion point; below it when near the top edge.
    const width = 208, height = 130;
    const x = Math.max(screen.x + 8, Math.min(this.anchor.x - width / 2, screen.x + screen.w - width - 8));
    const preferredY = this.anchor.y - height - 20;
    const y = Math.max(screen.y + 8, Math.min(preferredY < screen.y + 8 ? this.anchor.y + 30 : preferredY, screen.y + screen.h - height - 8));
    const out: Placement[] = [];
    const add = (sprite: string, dx: number, dy: number, scale = 1, flip = false): void => {
      out.push({ sprite, x: Math.round(x + dx), y: Math.round(y + dy), scale, flip });
    };
    const text = (value: string, dy: number, scale = 0.5): void => {
      const start = (width - value.length * 24 * scale) / 2;
      [...value].forEach((ch, i) => {
        add(`fight:shadow:${ch}`, start + i * 24 * scale + 2, dy + 2, scale);
        add(`fight:letter:${ch}`, start + i * 24 * scale, dy, scale);
      });
    };
    const active = state.age < 220;
    const strike = reducedMotion ? 0 : Math.sin(Math.min(1, state.age / 220) * Math.PI);
    const uppercut = state.move === "uppercut" || state.move === "spin";
    add(`fight:${active && !reducedMotion ? state.move : "guard"}`, 36 + strike * 12, 68 - (uppercut ? strike * 18 : 0));
    add(`fight:${active && !reducedMotion ? "hurt" : "enemy"}`, 116 + strike * (state.tier >= 3 ? 20 : 9), 68 - (uppercut ? strike * 24 : 0), 1, true);
    if (active && !reducedMotion) {
      add(state.move === "blast" ? "fight:flame" : "fight:spark", 97 + strike * 16, 60 - (uppercut ? strike * 14 : 0), state.tier >= 3 ? 1 : 0.75);
      if (state.tier >= 3) add("fight:streak", 10, 80, 0.75);
      if (state.tier >= 4) add("fight:streak", 14, 65, 0.75);
    }
    text(`${state.hits} HIT${state.hits === 1 ? "" : "S"}`, 104, 0.375);
    if (state.label) {
      const pop = !reducedMotion && now - this.tierAt < 350 ? Math.sin((now - this.tierAt) / 350 * Math.PI) * 0.08 : 0;
      text(state.label, 16, 0.5 + pop);
    }
    // A dotted timer communicates the combo window without a permanent HUD.
    for (let i = 0; i < Math.ceil(state.remaining * 20); i++) add("fight:meter", 44 + i * 6, 126, 0.5);
    return out;
  }
}
