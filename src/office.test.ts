import { expect, test } from "bun:test";
import { Canvas } from "./canvas.ts";
import { computeLayout, drawBackground } from "./office.ts";

test("disco and compact pitch stay separate, in bounds, and clear of desks across terminal sizes", () => {
  for (const w of [24, 40, 56, 80, 100, 140, 200]) {
    for (const h of [12, 28, 40, 44, 60, 100]) {
      const L = computeLayout(w, h);
      for (const area of [L.disco, L.pitch]) {
        if (!area) continue;
        expect(area.x).toBeGreaterThanOrEqual(0);
        expect(area.y).toBeGreaterThanOrEqual(0);
        expect(area.x + area.w).toBeLessThanOrEqual(w);
        expect(area.y + area.h).toBeLessThanOrEqual(h);
        for (const desk of L.desks) expect(desk.x + 20).toBeLessThan(area.x);
      }
      if (L.disco && L.pitch) {
        expect(L.pitch.y - 5).toBeGreaterThanOrEqual(L.disco.y + L.disco.h);
        expect(L.pitch.h).toBeLessThanOrEqual(24);
        expect(L.pitch.w).toBeLessThanOrEqual(32);
        for (const goal of [L.goalL!, L.goalR!]) {
          expect(goal.y).toBeGreaterThanOrEqual(L.pitch.y);
          expect(goal.y + goal.h).toBeLessThanOrEqual(L.pitch.y + L.pitch.h);
        }
      }
    }
  }
  // A typical 80x24 terminal still accommodates both activities.
  expect(computeLayout(80, 44).disco).not.toBeNull();
  expect(computeLayout(80, 44).pitch).not.toBeNull();
});

test("disco lights react to playback without changing the field or status bar", () => {
  const L = computeLayout(100, 60);
  const idle = new Canvas(100, 32), playing = new Canvas(100, 32);
  const now = new Date(2026, 8, 16, 12);
  drawBackground(idle, L, now);
  drawBackground(playing, L, now, true);
  const d = L.disco!;
  expect(playing.get(d.x, d.y)).not.toBe(idle.get(d.x, d.y));
  const pitch = L.pitch!;
  for (let y = pitch.y; y < L.h + 4; y++) {
    for (let x = 0; x < L.w; x++) expect(playing.get(x, y)).toBe(idle.get(x, y));
  }
});
