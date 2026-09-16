import { expect, test } from "bun:test";
import { parseQuotas, QuotaTracker, QuotaAlerts, quotaAtlas, type Quota } from "./quota.ts";

const now = Date.parse("2026-09-16T10:00:00Z");
const entry = { provider: "claude", updatedAt: new Date(now).toISOString(), primary: { usedPercent: 4, windowMinutes: 300 }, secondary: { usedPercent: 30, windowMinutes: 10080 } };
const q: Quota = { provider: "claude", window: "session", left: 96, owner: "one" };

test("reads remaining session and weekly quotas, and leaves missing Codex session absent", () => {
  const quotas = parseQuotas({ entries: [entry, { provider: "codex", updatedAt: entry.updatedAt, usageRows: [{ id: "weekly", percentLeft: 61 }] }] }, now);
  expect(quotas.map(v => [v.provider, v.window, v.left])).toEqual([["claude", "session", 96], ["claude", "weekly", 70], ["codex", "weekly", 61]]);
});

test("rejects stale, future, malformed and wrongly labeled windows", () => {
  expect(parseQuotas({ entries: [entry] }, now + 16 * 60_000)).toEqual([]);
  expect(parseQuotas({ entries: [entry] }, now - 120_000)).toEqual([]);
  expect(parseQuotas({ entries: [{ ...entry, primary: { usedPercent: -1 }, secondary: { usedPercent: 5, windowMinutes: 1440 } }] }, now)).toEqual([]);
  expect(parseQuotas({ entries: [{ ...entry, primary: { usedPercent: "10" }, secondary: { usedPercent: null } }] }, now)).toEqual([]);
  expect(() => parseQuotas({}, now)).toThrow();
});

test("compares remaining percentages, deduplicates polls and recognizes resets", () => {
  const tracker = new QuotaTracker();
  expect(tracker.accept([q])[0]!.delta).toBeNull();
  expect(tracker.accept([q])).toEqual([]);
  expect(tracker.accept([{ ...q, left: 95.7 }])[0]!.delta).toBe(-0.3);
  expect(tracker.accept([{ ...q, left: 100 }])[0]!.delta).toBe(4.3);
  expect(tracker.accept([{ ...q, owner: "two" }])[0]!.delta).toBeNull();
  expect(tracker.accept([])).toEqual([]);
  expect(tracker.accept([q])[0]!.delta).toBeNull();
});

test("alerts stay on selected monitor, all placements have atlas sprites, and expire", () => {
  const alerts = new QuotaAlerts();
  const screen = { id: "left", x: -1000, y: 300, w: 1000, h: 800 };
  alerts.show([{ ...q, delta: -0.3 }, { ...q, window: "weekly", delta: 10 }], "left", 0);
  const sprites = alerts.render(200, [screen], false);
  expect(sprites.length).toBeGreaterThan(50);
  const atlas = quotaAtlas();
  for (const item of sprites) {
    expect(atlas[item.sprite]).toBeDefined();
    expect(item.x).toBeGreaterThanOrEqual(screen.x);
    expect(item.x + atlas[item.sprite]!.rows[0]!.length * 4 * item.scale!).toBeLessThanOrEqual(screen.x + screen.w);
    expect(item.y).toBeGreaterThanOrEqual(screen.y);
  }
  expect(alerts.render(5000, [screen], false)).toEqual([]);
});

test("reduced motion is static, removed displays and hide clear the effect", () => {
  const alerts = new QuotaAlerts();
  const screen = { id: "small", x: 0, y: 0, w: 320, h: 480 };
  alerts.show([{ ...q, delta: 1 }], screen.id, 0);
  expect(alerts.render(200, [screen], true)).toEqual(alerts.render(1200, [screen], true));
  expect(alerts.render(1400, [], false)).toEqual([]);
  alerts.show([{ ...q, delta: null }], screen.id, 1500);
  alerts.clear();
  expect(alerts.render(1600, [screen], false)).toEqual([]);
});
