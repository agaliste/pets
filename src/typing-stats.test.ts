import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACHIEVEMENTS, longestDayStreak } from "./achievements.ts";
import { TypingStats, localDay, type TypingPulse } from "./typing-stats.ts";
import { TypingCombat, COMBO_WINDOW_MS } from "./combat.ts";

const opened: TypingStats[] = [];
const directories: string[] = [];
const base = new Date(2026, 8, 17, 12, 0, 0).getTime();
function create(path = ":memory:"): TypingStats {
  const stats = new TypingStats(path); opened.push(stats); return stats;
}
function tempPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "pets-stats-test-"));
  directories.push(directory); return join(directory, "history.sqlite");
}
function pulses(count: number, at = base, monotonic = 1000, interval = 100): TypingPulse[] {
  return Array.from({ length: count }, (_, i) => ({ at: at + i * interval, monotonic: monotonic + i * interval, comboHit: true }));
}
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("anonymous typing history", () => {
  test("fresh history has 50 distinct locked achievements, zero-filled charts and no fabricated activity", () => {
    const data = create().snapshot(base);
    expect(data.metrics).toEqual({ keys: 0, combos: 0, bestCombo: 0, activeMinutes: 0, peakMinute: 0, activeDays: 0, bestDay: 0, dayStreak: 0 });
    expect(data.recordedSince).toBeNull();
    expect(data.days).toHaveLength(30);
    expect(data.hours).toHaveLength(24);
    expect(data.achievements).toHaveLength(50);
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(50);
    expect(data.achievements.every(a => a.unlockedAt === null && a.progress === 0)).toBe(true);
  });

  test("records each pulse, including keys faster than the visual combat filter", () => {
    const stats = create(), combat = new TypingCombat();
    const times = [0, 10, 100, 200, 300, 400];
    stats.record(times.map(t => ({ at: base + t, monotonic: t, comboHit: combat.hit(t, { x: 1, y: 1 }) })));
    const data = stats.snapshot(base);
    expect(data.metrics.keys).toBe(6);
    expect(data.metrics.combos).toBe(1);
    expect(data.metrics.bestCombo).toBe(5);
    expect(data.metrics.peakMinute).toBe(6);
    expect(data.hours[12]!.keys).toBe(6);
  });

  test("ignores short streaks for combo totals and splits on gaps or resets", () => {
    const stats = create();
    stats.record(pulses(4));
    expect(stats.snapshot(base).metrics.combos).toBe(0);
    stats.record(pulses(5, base + 5000, 6000));
    stats.resetCombo();
    stats.record(pulses(6, base + 5500, 6500));
    const data = stats.snapshot(base);
    expect(data.metrics.keys).toBe(15);
    expect(data.metrics.combos).toBe(2);
    expect(data.recentCombos.map(c => c.hits)).toEqual([6, 5]);
  });

  test("honors the exact combat gap boundary and tracks past the 999-hit visual cap", () => {
    const stats = create(), combat = new TypingCombat();
    const events = pulses(1500);
    stats.record(events.map(p => ({ ...p, comboHit: combat.hit(p.monotonic, { x: 1, y: 1 }) })));
    expect(combat.state(events.at(-1)!.monotonic)?.hits).toBe(999);
    const last = events.at(-1)!;
    stats.record(pulses(1, last.at + COMBO_WINDOW_MS, last.monotonic + COMBO_WINDOW_MS));
    expect(stats.snapshot(base).metrics.bestCombo).toBe(1501);
    stats.record(pulses(5, last.at + 2 * COMBO_WINDOW_MS + 1, last.monotonic + 2 * COMBO_WINDOW_MS + 1));
    expect(stats.snapshot(base).metrics.combos).toBe(2);
    expect(stats.snapshot(base).achievements.find(a => a.id === "bestCombo:1000")!.unlockedAt).not.toBeNull();
  });

  test("uses monotonic time for combo gaps even when the wall clock changes", () => {
    const stats = create();
    stats.record(pulses(4));
    stats.record(pulses(1, base - 60_000, 1400));
    expect(stats.snapshot(base).metrics.bestCombo).toBe(5);
  });

  test("attributes each event to its local date/hour and combos to the start day", () => {
    const stats = create();
    const midnight = new Date(2026, 8, 18, 0, 0, 0).getTime();
    stats.record(pulses(6, midnight - 300, 1000));
    const data = stats.snapshot(midnight + 1000);
    expect(data.today.keys).toBe(3);
    expect(data.today.combos).toBe(0);
    expect(data.days.at(-2)!.keys).toBe(3);
    expect(data.days.at(-2)!.combos).toBe(1);
    expect(data.days.at(-2)!.bestCombo).toBe(6);
    expect(data.hours[23]!.keys).toBe(3);
    expect(data.hours[0]!.keys).toBe(3);
    expect(data.metrics.activeMinutes).toBe(2);
    expect(data.metrics.activeDays).toBe(2);
    expect(data.metrics.dayStreak).toBe(2);
  });

  test("calendar day streaks tolerate DST and duplicates but break on missing days", () => {
    expect(longestDayStreak(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-30"])).toBe(3);
    expect(longestDayStreak(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-28"])).toBe(3);
    expect(longestDayStreak([])).toBe(0);
    const stats = create();
    stats.record(pulses(1, base));
    stats.record(pulses(1, base + 2 * 86_400_000, 2000));
    expect(stats.snapshot(base + 2 * 86_400_000).days.at(-2)!.keys).toBe(0);
    expect(stats.snapshot(base).metrics.dayStreak).toBe(1);
  });

  test("persists sub-millisecond anonymous times, private file modes and unlock dates across restart", () => {
    const path = tempPath(), stats = create(path);
    const unlocked = stats.record(pulses(5, base + 0.5));
    const first = stats.snapshot(base);
    stats.close();
    const reopened = create(path);
    expect(reopened.snapshot(base)).toEqual(first);
    expect(reopened.record(pulses(5, base + 1000, 2000))).toEqual([]);
    expect(reopened.snapshot(base).metrics.combos).toBe(2);
    expect(unlocked.find(a => a.id === "combos:1")?.unlockedAt).toBe(base + 400.5);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    const db = new Database(path, { readonly: true });
    try {
      const columns = db.query<{ name: string }, []>("PRAGMA table_info(key_events)").all().map(c => c.name);
      expect(columns).toEqual(["id", "at_ms", "utc_offset_minutes"]);
      expect(db.query<{ at_ms: number; utc_offset_minutes: number }, []>("SELECT at_ms, utc_offset_minutes FROM key_events ORDER BY id LIMIT 1").get())
        .toEqual({ at_ms: base + 0.5, utc_offset_minutes: -new Date(base).getTimezoneOffset() || 0 });
    } finally { db.close(); }
  });

  test("10,000 qualifying streaks unlocks the named milestone exactly once", () => {
    const stats = create();
    const events = Array.from({ length: 10_000 }, (_, i) => pulses(5, base + i * 2000, 1000 + i * 2000)).flat();
    const unlocked = stats.record(events);
    expect(stats.snapshot(base).metrics.combos).toBe(10_000);
    expect(unlocked.filter(a => a.id === "combos:10000")).toHaveLength(1);
    expect(stats.record(pulses(5, base + 20_000_000, 20_001_000)).some(a => a.id === "combos:10000")).toBe(false);
  });

  test("recomputes day achievements incrementally", () => {
    const stats = create();
    stats.record(pulses(100));
    expect(stats.snapshot(base).metrics.bestDay).toBe(100);
    expect(stats.record(pulses(1, base + 10_000, 11_000))).toEqual([]);
    expect(stats.record(pulses(1, base + 86_400_000, 100_000))).toEqual([]);
    expect(stats.snapshot(base + 86_400_000).metrics.activeDays).toBe(2);
    expect(stats.record(pulses(1, base + 2 * 86_400_000, 200_000)).some(a => a.id === "dayStreak:3")).toBe(true);
  });

  test("rejects a malformed batch atomically and retains the pre-batch combo", () => {
    const stats = create();
    stats.record(pulses(4));
    expect(() => stats.record([...pulses(1, base + 400, 1400), { at: NaN, monotonic: 1500, comboHit: true }])).toThrow();
    expect(stats.snapshot(base).metrics.keys).toBe(4);
    stats.record(pulses(1, base + 400, 1400));
    expect(stats.snapshot(base).metrics.bestCombo).toBe(5);
  });

  test("a write failure rolls back events, summaries and active combo state", () => {
    const path = tempPath(), stats = create(path);
    stats.record(pulses(4));
    const db = new Database(path);
    try {
      db.exec("CREATE TRIGGER fail_combo BEFORE INSERT ON combos BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
      expect(() => stats.record(pulses(2, base + 400, 1400))).toThrow("simulated disk failure");
      expect(stats.snapshot(base).metrics.keys).toBe(4);
      db.exec("DROP TRIGGER fail_combo");
      stats.record(pulses(1, base + 400, 1400));
      expect(stats.snapshot(base).metrics.bestCombo).toBe(5);
    } finally { db.close(); }
  });

  test("reset clears all data and unlocks, including the in-memory streak", () => {
    const path = tempPath(), stats = create(path);
    stats.record(pulses(100));
    stats.clear();
    const empty = stats.snapshot(base);
    expect(empty.metrics.keys).toBe(0);
    expect(empty.recentCombos).toEqual([]);
    expect(empty.recordedSince).toBeNull();
    expect(empty.achievements.every(a => a.unlockedAt === null)).toBe(true);
    stats.record(pulses(1, base + 10_000, 11_000));
    expect(stats.snapshot(base).metrics.combos).toBe(0);
    stats.close();
    expect(create(path).snapshot(base).metrics.keys).toBe(1);
  });

  test("refuses an unknown schema without overwriting history", () => {
    const path = tempPath();
    const db = new Database(path);
    db.exec("PRAGMA user_version = 99; CREATE TABLE future_history(value TEXT); INSERT INTO future_history VALUES('keep')");
    db.close();
    expect(() => create(path)).toThrow("newer pets version");
    const reader = new Database(path, { readonly: true });
    try { expect(reader.query("SELECT value FROM future_history").get()).toEqual({ value: "keep" }); }
    finally { reader.close(); }
  });

  test("local date formatting stays date-only", () => {
    expect(localDay(new Date(2026, 0, 2, 23, 59).getTime())).toBe("2026-01-02");
  });

  test("uses macOS capture offsets even when the Bun process has a different timezone", () => {
    const stats = create();
    const at = Date.parse("2026-09-17T23:15:00Z");
    stats.record(pulses(5, at).map(p => ({ ...p, utcOffsetMinutes: 120 })));
    const data = stats.snapshot(at, 120);
    expect(data.today.day).toBe("2026-09-18");
    expect(data.today.keys).toBe(5);
    expect(data.hours[1]!.keys).toBe(5);
    expect(data.days.at(-1)!.keys).toBe(5);
  });
});
