import { expect, test } from "bun:test";
import { FootballEffects, footballAtlas } from "./football-effects.ts";
import { DesktopScene, type Screen } from "./desktop-scene.ts";
import type { AgentSession } from "./sessions.ts";

const screen: Screen = { id: "main", x: 0, y: 0, w: 1200, h: 900 };
const idle = new Set([1]);
const origin = { x: 500, y: 400 };

test.each([
  { random: 0, variant: 0, sprite: "shot:fire" },
  { random: 0.5, variant: 1, sprite: "shot:bolt" },
  { random: 0.99, variant: 2, sprite: "shot:wind" },
])("special-shot variant $variant has its own callout and effects", ({ random, variant, sprite }) => {
  const shots = new FootballEffects(() => random);
  shots.kick(1, origin, screen, 0);
  const frame = shots.render(origin, 0, [screen], idle);
  expect(frame.some(p => p.sprite === `shot:label:${variant}`)).toBe(true);
  expect(frame.some(p => p.sprite === sprite)).toBe(true);
  expect(frame.some(p => p.sprite === "shot:ring")).toBe(true);
  const atlas = footballAtlas();
  for (const p of frame) expect(atlas[p.sprite]).toBeDefined();
});

test("consecutive kicks avoid repeating the previous special shot", () => {
  const shots = new FootballEffects(() => 0);
  let previous = "";
  for (let i = 0; i < 20; i++) {
    shots.kick(1, origin, screen, i);
    const label = shots.render(origin, i, [screen], idle).find(p => p.sprite.startsWith("shot:label:"))!.sprite;
    expect(label).not.toBe(previous);
    previous = label;
  }
});

test("trails are bounded, follow a bouncing ball, and expire", () => {
  const shots = new FootballEffects(() => 0);
  shots.kick(1, origin, screen, 0);
  for (let i = 0; i < 28; i++) {
    const ball = { x: i < 14 ? 500 + i * 10 : 640 - (i - 14) * 10, y: 400 };
    const frame = shots.render(ball, i / 30, [screen], idle);
    expect(frame.length).toBeLessThanOrEqual(17);
  }
  expect(shots.render(origin, 1, [screen], idle)).toEqual([]);
  expect(shots.active).toBe(false);
});

test("a screen-gap jump drops the old trail instead of connecting across empty space", () => {
  const shots = new FootballEffects(() => 0);
  shots.kick(1, origin, screen, 0);
  shots.render(origin, 0.4, [screen], idle);
  const frame = shots.render({ x: 950, y: 400 }, 0.45, [screen], idle);
  expect(frame.filter(p => p.sprite === "shot:fire").every(p => p.x > 900)).toBe(true);
});

test("pause/reduced motion, session departure, and clear discard effects without replay", () => {
  for (const kind of ["pause", "departure", "display"]) {
    const shots = new FootballEffects();
    shots.kick(1, origin, screen, 0);
    if (kind === "display") shots.clear();
    expect(shots.render(origin, 0.1, [screen], kind === "departure" ? new Set() : idle, kind === "pause")).toEqual([]);
    expect(shots.render(origin, 0.2, [screen], idle)).toEqual([]);
    expect(shots.active).toBe(false);
  }
});

test("shot callouts fit near the edges of offset monitors", () => {
  const display = { ...screen, x: -1200, y: -900 };
  const atlas = footballAtlas();
  for (const point of [{ x: -1200, y: -900 }, { x: -1, y: -1 }]) {
    const shots = new FootballEffects(() => 0.5);
    shots.kick(1, point, display, 0);
    const label = shots.render(point, 0.1, [display], idle).find(p => p.sprite.startsWith("shot:label:"))!;
    expect(label.x).toBeGreaterThanOrEqual(display.x);
    expect(label.y).toBeGreaterThanOrEqual(display.y);
    expect(label.x + atlas[label.sprite]!.rows[0]!.length * 4 * label.scale!).toBeLessThanOrEqual(display.x + display.w);
    expect(label.y + 36 * label.scale!).toBeLessThanOrEqual(display.y + display.h);
  }
});

test("changing only special-shot randomness does not change ball or player movement", () => {
  const random = () => {
    let seed = 123;
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  };
  const a = new DesktopScene(random(), () => 0), b = new DesktopScene(random(), () => 0.99);
  const sessions: AgentSession[] = [1, 2].map(pid => ({
    pid, provider: "claude", sessionId: `${pid}`, name: "fixture", cwd: "/fixture", status: "idle",
    startedAt: 0, lastActivity: 0, version: null, title: null, source: "ps",
  }));
  let sawShot = false;
  for (const sim of [a, b]) sim.setScreens([screen]);
  for (let i = 0; i < 1000; i++) {
    const frame = a.update(sessions, null, 1 / 30);
    b.update(sessions, null, 1 / 30);
    sawShot ||= frame.sprites.some(p => p.sprite.startsWith("shot:label:"));
    expect(a.ball).toEqual(b.ball);
    expect([...a.pets.values()].map(p => [p.x, p.y])).toEqual([...b.pets.values()].map(p => [p.x, p.y]));
    const ballIndex = frame.sprites.findIndex(p => p.sprite === "ball");
    expect(frame.sprites.findLastIndex(p => p.sprite.startsWith("shot:"))).toBeLessThanOrEqual(ballIndex);
  }
  expect(sawShot).toBe(true);
});
