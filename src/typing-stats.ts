import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ACHIEVEMENTS, longestDayStreak, type AchievementProgress, type TypingMetrics } from "./achievements.ts";
import { COMBO_WINDOW_MS } from "./combat.ts";

export const TYPING_DB_PATH = join(homedir(), "Library/Application Support/pets/typing.sqlite");
export const COMBO_MIN_HITS = 5;
export interface TypingPulse { at: number; monotonic: number; comboHit: boolean; utcOffsetMinutes?: number }
interface ActiveCombo { id: string; start: number; end: number; last: number; hits: number; day: string }
interface Day { day: string; keys: number; activeMinutes: number; combos: number; bestCombo: number }
export interface StatsSnapshot {
  metrics: TypingMetrics;
  today: Day;
  days: Day[];
  hours: { hour: number; keys: number }[];
  recentCombos: { start: number; end: number; hits: number }[];
  achievements: AchievementProgress[];
  recordedSince: number | null;
  generatedAt: number;
}

export function localDay(at: number, offset = -new Date(at).getTimezoneOffset()): string {
  return new Date(at + offset * 60_000).toISOString().slice(0, 10);
}
const emptyDay = (day: string): Day => ({ day, keys: 0, activeMinutes: 0, combos: 0, bestCombo: 0 });

/** Local timing only. Text, key codes, apps and caret geometry have no place in this schema. */
export class TypingStats {
  private db: Database;
  private active: ActiveCombo | null = null;
  private closed = false;

  constructor(path = TYPING_DB_PATH) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
    }
    this.db = new Database(path, { create: true, strict: true });
    try {
      if (path !== ":memory:") chmodSync(path, 0o600);
      this.db.exec("PRAGMA busy_timeout = 50; PRAGMA foreign_keys = ON;");
      const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
      if (version > 1) throw new Error("Typing history was created by a newer pets version");
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;");
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS key_events (id INTEGER PRIMARY KEY, at_ms REAL NOT NULL, utc_offset_minutes INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS key_events_time ON key_events(at_ms);
          CREATE TABLE IF NOT EXISTS combos (id TEXT PRIMARY KEY, start REAL NOT NULL, end REAL NOT NULL, hits INTEGER NOT NULL CHECK(hits >= 5));
          CREATE INDEX IF NOT EXISTS combos_time ON combos(start DESC);
          CREATE TABLE IF NOT EXISTS minutes (minute INTEGER PRIMARY KEY, keys INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, keys INTEGER NOT NULL DEFAULT 0,
            activeMinutes INTEGER NOT NULL DEFAULT 0, combos INTEGER NOT NULL DEFAULT 0, bestCombo INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS hours (hour INTEGER PRIMARY KEY, keys INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY CHECK(id = 1), keys INTEGER NOT NULL DEFAULT 0,
            combos INTEGER NOT NULL DEFAULT 0, bestCombo INTEGER NOT NULL DEFAULT 0,
            activeMinutes INTEGER NOT NULL DEFAULT 0, peakMinute INTEGER NOT NULL DEFAULT 0);
          INSERT OR IGNORE INTO totals(id) VALUES(1);
          CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, unlocked_at REAL NOT NULL);
          PRAGMA user_version = 1;
        `);
      })();
    } catch (error) { this.db.close(); throw error; }
  }

  resetCombo(): void { this.active = null; }

  record(pulses: readonly TypingPulse[]): AchievementProgress[] {
    if (!pulses.length) return [];
    // Validate the entire batch before a transaction; never partially record a malformed message.
    if (pulses.some(p => !Number.isFinite(p.at) || p.at < 0 || !Number.isFinite(new Date(p.at).getTime()) ||
        !Number.isFinite(p.monotonic) || typeof p.comboHit !== "boolean" ||
        (p.utcOffsetMinutes !== undefined && (!Number.isInteger(p.utcOffsetMinutes) || Math.abs(p.utcOffsetMinutes) > 14 * 60)))) throw new Error("Invalid typing pulse");
    let active = this.active ? { ...this.active } : null;
    const newlyUnlocked = this.db.transaction(() => {
      for (const pulse of pulses) {
        const offset = pulse.utcOffsetMinutes ?? -new Date(pulse.at).getTimezoneOffset();
        const date = new Date(pulse.at + offset * 60_000), day = localDay(pulse.at, offset), minute = Math.floor(pulse.at / 60_000);
        this.db.query("INSERT INTO key_events(at_ms, utc_offset_minutes) VALUES (?, ?)").run(pulse.at, offset);
        const count = this.db.query<{ keys: number }, [number]>(`INSERT INTO minutes(minute, keys) VALUES (?, 1)
          ON CONFLICT(minute) DO UPDATE SET keys = keys + 1 RETURNING keys`).get(minute)!.keys;
        const fresh = count === 1 ? 1 : 0;
        this.db.query(`INSERT INTO days(day, keys, activeMinutes) VALUES (?, 1, ?)
          ON CONFLICT(day) DO UPDATE SET keys = keys + 1, activeMinutes = activeMinutes + excluded.activeMinutes`).run(day, fresh);
        this.db.query(`INSERT INTO hours(hour, keys) VALUES (?, 1) ON CONFLICT(hour) DO UPDATE SET keys = keys + 1`).run(date.getUTCHours());
        this.db.query("UPDATE totals SET keys = keys + 1, activeMinutes = activeMinutes + ?, peakMinute = max(peakMinute, ?) WHERE id = 1").run(fresh, count);
        if (!pulse.comboHit) continue;
        if (!active || pulse.monotonic - active.last > COMBO_WINDOW_MS || pulse.monotonic < active.last) {
          active = { id: crypto.randomUUID(), start: pulse.at, end: pulse.at, last: pulse.monotonic, hits: 0, day };
        }
        active.hits++;
        active.last = pulse.monotonic;
        active.end = pulse.at;
        if (active.hits < COMBO_MIN_HITS) continue;
        this.db.query(`INSERT INTO combos(id, start, end, hits) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET end = excluded.end, hits = excluded.hits`).run(active.id, active.start, active.end, active.hits);
        const first = active.hits === COMBO_MIN_HITS ? 1 : 0;
        this.db.query("UPDATE totals SET combos = combos + ?, bestCombo = max(bestCombo, ?) WHERE id = 1").run(first, active.hits);
        this.db.query("UPDATE days SET combos = combos + ?, bestCombo = max(bestCombo, ?) WHERE day = ?").run(first, active.hits, active.day);
      }
      return this.unlock(pulses.at(-1)!.at);
    })();
    // An unsuccessful transaction leaves both persisted and in-memory combo state unchanged.
    this.active = active;
    return newlyUnlocked;
  }

  private metrics(): TypingMetrics {
    const totals = this.db.query<Omit<TypingMetrics, "activeDays" | "bestDay" | "dayStreak">, []>(
      "SELECT keys, combos, bestCombo, activeMinutes, peakMinute FROM totals WHERE id = 1").get()!;
    const days = this.db.query<{ day: string; keys: number }, []>("SELECT day, keys FROM days WHERE keys > 0 ORDER BY day").all();
    return { ...totals, activeDays: days.length, bestDay: Math.max(0, ...days.map(d => d.keys)), dayStreak: longestDayStreak(days.map(d => d.day)) };
  }

  private unlock(at: number): AchievementProgress[] {
    const metrics = this.metrics();
    const result: AchievementProgress[] = [];
    for (const achievement of ACHIEVEMENTS) {
      if (metrics[achievement.metric] < achievement.target) continue;
      const inserted = this.db.query("INSERT OR IGNORE INTO achievements(id, unlocked_at) VALUES (?, ?)").run(achievement.id, at);
      if (inserted.changes) result.push({ ...achievement, progress: metrics[achievement.metric], unlockedAt: at });
    }
    return result;
  }

  snapshot(now = Date.now(), offset = -new Date(now).getTimezoneOffset()): StatsSnapshot {
    return this.db.transaction(() => {
      const metrics = this.metrics();
      const since = this.db.query<{ at: number | null }, []>("SELECT min(at_ms) AS at FROM key_events").get()!.at;
      const allDays = this.db.query<Day, []>("SELECT * FROM days ORDER BY day").all();
      const byDay = new Map(allDays.map(d => [d.day, d]));
      const days: Day[] = [];
      for (let i = 29; i >= 0; i--) {
        const day = localDay(now - i * 86_400_000, offset);
        days.push(byDay.get(day) ?? emptyDay(day));
      }
      const hours = this.db.query<{ hour: number; keys: number }, []>("SELECT hour, keys FROM hours ORDER BY hour").all();
      const byHour = new Map(hours.map(h => [h.hour, h.keys]));
      const unlocks = new Map(this.db.query<{ id: string; unlocked_at: number }, []>("SELECT * FROM achievements").all().map(a => [a.id, a.unlocked_at]));
      return {
        metrics, today: byDay.get(localDay(now, offset)) ?? emptyDay(localDay(now, offset)), days,
        hours: Array.from({ length: 24 }, (_, hour) => ({ hour, keys: byHour.get(hour) ?? 0 })),
        recentCombos: this.db.query<{ start: number; end: number; hits: number }, []>("SELECT start, end, hits FROM combos ORDER BY start DESC LIMIT 10").all(),
        achievements: ACHIEVEMENTS.map(a => ({ ...a, progress: metrics[a.metric], unlockedAt: unlocks.get(a.id) ?? null })),
        recordedSince: since, generatedAt: now,
      };
    })();
  }

  clear(): void {
    this.db.transaction(() => {
      for (const table of ["key_events", "combos", "minutes", "days", "hours", "achievements"]) this.db.exec(`DELETE FROM ${table}`);
      this.db.exec("UPDATE totals SET keys = 0, combos = 0, bestCombo = 0, activeMinutes = 0, peakMinute = 0 WHERE id = 1");
    })();
    this.active = null;
    // secure_delete clears deleted payloads; truncate the WAL after the committed reset.
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
    this.active = null;
  }
}
