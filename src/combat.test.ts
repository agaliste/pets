import { describe, expect, test } from "bun:test";
import { combatAtlas, COMBO_TIERS, COMBO_WINDOW_MS, TypingCombat } from "./combat.ts";
import type { Point, Screen } from "./desktop-scene.ts";

const screen: Screen = { id: "main", x: 0, y: 0, w: 1440, h: 900 };
const anchor: Point = { x: 700, y: 500 };
const chain = (fight: TypingCombat, count: number, start = 1000, point = anchor): number => {
  for (let i = 0; i < count; i++) fight.hit(start + i * 100, point);
  return start + (count - 1) * 100;
};

describe("typing combos", () => {
  test("starts a fight on a pulse and chains ordinary typing without reading text", () => {
    const fight = new TypingCombat();
    expect(fight.state(0)).toBeNull();
    expect(fight.hit(100, anchor)).toBe(true);
    expect(fight.state(100)?.move).toBe("jab");
    fight.hit(250, anchor); fight.hit(400, anchor);
    expect(fight.state(400)?.hits).toBe(3);
    expect(fight.state(400)?.move).toBe("kick");
    expect(fight.render(430, [screen]).some(p => p.sprite === "fight:kick")).toBe(true);
  });
  test.each(COMBO_TIERS.filter(t => t.label))("$hits hits shows $label", tier => {
    const fight = new TypingCombat(), now = chain(fight, tier.hits);
    expect(fight.state(now)?.label).toBe(tier.label);
    if (tier.hits >= 12) expect(fight.state(now)?.move).toBe(tier.move);
    const sprites = fight.render(now, [screen]);
    const letters = sprites.filter(p => p.sprite.startsWith("fight:letter:")).map(p => p.sprite.split(":").at(-1)).join("");
    expect(letters).toContain(tier.label);
  });
  test("inactivity resets the next streak and removes the fight after a short linger", () => {
    const fight = new TypingCombat(), now = chain(fight, 25);
    expect(fight.state(now + COMBO_WINDOW_MS)?.remaining).toBe(0);
    expect(fight.render(now + COMBO_WINDOW_MS + 501, [screen])).toEqual([]);
    fight.hit(now + COMBO_WINDOW_MS + 600, anchor);
    expect(fight.state(now + COMBO_WINDOW_MS + 600)?.hits).toBe(1);
    expect(fight.state(now + COMBO_WINDOW_MS + 600)?.label).toBe("");
  });
  test("allows a steady slow rhythm within the grace period", () => {
    const fight = new TypingCombat();
    for (let i = 0; i < 5; i++) fight.hit(i * 1300, anchor);
    expect(fight.state(5200)?.hits).toBe(5);
  });
  test("rejects duplicate, out-of-order, invalid and implausibly fast pulses", () => {
    const fight = new TypingCombat();
    expect(fight.hit(100, anchor)).toBe(true);
    for (const at of [100, 99, 110, NaN, Infinity]) expect(fight.hit(at, anchor)).toBe(false);
    expect(fight.hit(150, { x: Infinity, y: 0 })).toBe(false);
    expect(fight.state(150)?.hits).toBe(1);
  });
  test("reset removes stale effects after focus, pause, hide or permissions change", () => {
    const fight = new TypingCombat(), now = chain(fight, 50);
    fight.reset();
    expect(fight.render(now + 30, [screen])).toEqual([]);
    expect(fight.state(now + 30)).toBeNull();
    fight.hit(now + 100, anchor);
    expect(fight.state(now + 100)?.hits).toBe(1);
  });
  test("reduced motion keeps the counter with no lunges, hit flashes or label bounce", () => {
    const fight = new TypingCombat(), now = chain(fight, 50);
    const a = fight.render(now, [screen], true), b = fight.render(now + 70, [screen], true);
    expect(a.filter(p => p.sprite !== "fight:meter")).toEqual(b.filter(p => p.sprite !== "fight:meter"));
    expect(a.some(p => ["fight:spark", "fight:flame", "fight:streak", "fight:hurt"].includes(p.sprite))).toBe(false);
    expect(a.some(p => p.sprite === "fight:guard")).toBe(true);
  });
  test("every generated sprite exists and stays inside the selected display", () => {
    const atlas = combatAtlas();
    const screens = [screen, { id: "left", x: -1200, y: -300, w: 1200, h: 800 }];
    for (const display of screens) {
      for (const point of [
        { x: display.x, y: display.y }, { x: display.x + display.w, y: display.y },
        { x: display.x + 100, y: display.y + display.h }, { x: display.x + display.w / 2, y: display.y + 300 },
      ]) {
        for (const count of [1, 5, 12, 25, 50, 100, 999]) {
          const fight = new TypingCombat(), now = chain(fight, count, 1000, point);
          for (const age of [0, 100, 300, 1500]) {
            for (const p of fight.render(now + age, [display])) {
              const sprite = atlas[p.sprite]!;
              expect(sprite).toBeDefined();
              expect(p.x).toBeGreaterThanOrEqual(display.x);
              expect(p.y).toBeGreaterThanOrEqual(display.y);
              expect(p.x + sprite.rows[0]!.length * 4 * (p.scale ?? 1)).toBeLessThanOrEqual(display.x + display.w);
              expect(p.y + sprite.rows.length * 4 * (p.scale ?? 1)).toBeLessThanOrEqual(display.y + display.h);
            }
          }
        }
      }
    }
  });
  test("fits around the caret without covering the typing line", () => {
    const fight = new TypingCombat(), now = chain(fight, 12);
    const sprites = fight.render(now + 90, [screen]);
    expect(sprites.every(p => p.y < anchor.y - 20)).toBe(true);
    fight.hit(now + 100, { x: 700, y: 10 });
    expect(fight.render(now + 150, [screen]).every(p => p.y >= 40)).toBe(true);
  });
  test("caps state and render size under extended typing", () => {
    const fight = new TypingCombat(), now = chain(fight, 5000);
    expect(fight.state(now)?.hits).toBe(999);
    expect(fight.render(now, [screen]).length).toBeLessThan(100);
  });
  test("missing or tiny displays produce no offscreen overlay", () => {
    const fight = new TypingCombat(), now = chain(fight, 5);
    expect(fight.render(now, [])).toEqual([]);
    expect(fight.render(now, [{ ...screen, w: 100, h: 100 }])).toEqual([]);
  });
});
