export interface TypingMetrics {
  keys: number;
  combos: number;
  bestCombo: number;
  activeMinutes: number;
  activeDays: number;
  bestDay: number;
  peakMinute: number;
  dayStreak: number;
  bestWpm: number;
}

export interface Achievement {
  id: string;
  title: string;
  category: string;
  description: string;
  metric: keyof TypingMetrics;
  target: number;
}

function milestones(metric: keyof TypingMetrics, category: string, unit: string, targets: number[], titles: string[]): Achievement[] {
  return targets.map((target, i) => ({
    id: `${metric}:${target}`, title: titles[i]!, category, metric, target,
    description: `${target.toLocaleString("en-US")} ${unit}`,
  }));
}

/** Stable IDs are the persistence contract; changing a title never re-unlocks a badge. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  ...milestones("keys", "Keystrokes", "counted keystrokes", [100, 1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000],
    ["Hello, keyboard", "Getting warmed up", "Ten thousand taps", "Key traveller", "Six figures", "Quarter million club", "Keyboard odyssey", "Million-key hero", "Five million strong", "Ten million legends"]),
  ...milestones("combos", "Combos", "qualifying combos", [1, 10, 100, 500, 1_000, 5_000, 10_000, 50_000],
    ["First combo", "Finding the rhythm", "Combo collector", "Chain reaction", "Combo regular", "Combo veteran", "Ten thousand combos", "Combo constellation"]),
  ...milestones("bestCombo", "Longest combo", "hits in one streak", [5, 12, 25, 50, 100, 250, 500, 1_000, 2_500],
    ["Five-hit wonder", "On fire", "Rampage", "Energy blast", "Godlike", "Unbroken", "Endless rhythm", "Beyond the counter", "Legendary chain"]),
  ...milestones("activeDays", "Active days", "days with typing", [1, 7, 30, 100, 365],
    ["Day one", "Seven days of keys", "Thirty-day collection", "A hundred days", "A year in keys"]),
  ...milestones("dayStreak", "Day streaks", "consecutive days with typing", [3, 7, 14, 30, 100],
    ["Three in a row", "A week of rhythm", "Fortnight flow", "Thirty-day rhythm", "Century streak"]),
  ...milestones("activeMinutes", "Active minutes", "minutes containing typing", [10, 60, 300, 1_000, 10_000],
    ["Ten-minute spark", "Sixty little moments", "Five-hour collection", "Thousand-minute club", "Long-haul typist"]),
  ...milestones("bestDay", "Daily records", "keystrokes in one day", [1_000, 5_000, 10_000, 25_000],
    ["A thousand-key day", "Busy keyboard", "Ten-thousand-key day", "A day to remember"]),
  ...milestones("peakMinute", "Minute records", "keystrokes in one calendar minute", [60, 120, 240, 360],
    ["Steady hands", "Double time", "Quick fingers", "Lightning fingers"]),
  ...milestones("bestWpm", "Typing speed", "WPM across a combo of 25+ hits", [40, 60, 80, 100, 120, 150],
    ["Cruising speed", "Quick typist", "Fast fingers", "Triple digits", "Blazing keys", "Speed demon"]),
];

export interface AchievementProgress extends Achievement {
  progress: number;
  unlockedAt: number | null;
}

/** Date-only arithmetic avoids DST changing the distance between local calendar days. */
export function longestDayStreak(days: readonly string[]): number {
  let previous = -Infinity, streak = 0, best = 0;
  for (const day of [...new Set(days)].sort()) {
    const ordinal = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
    streak = ordinal === previous + 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
    previous = ordinal;
  }
  return best;
}
