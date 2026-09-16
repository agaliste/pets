import { expect, test } from "bun:test";
import { Canvas, cleanText, clipText } from "./canvas.ts";
import { computeLayout } from "./office.ts";
import { drawBubble, Singer, wrapBubble } from "./singer.ts";
import type { MusicView } from "./music.ts";
import type { Agent } from "./sim.ts";
import { ACCESSORIES, HATS } from "./sprites.ts";

const visible = (cv: Canvas) => cv.renderRows().map((row) => Bun.stripANSI(row));
const music: MusicView = {
  track: { id: "spotify:track:test", title: "A song", artist: "An artist", album: "Album", duration: 120, position: 1 },
  position: 1, text: "Here are some lyrics", state: "synced",
};

test("text rendering preserves graphemes and terminal width, including overlapping wide glyphs", () => {
  const cv = new Canvas(20, 3);
  cv.clear(0);
  cv.putText(0, 0, "歌 🎤 café e\u0301", 0xffffff);
  expect(visible(cv)[0]).toContain("歌 🎤 café e\u0301");
  for (const row of visible(cv)) expect(Bun.stringWidth(row)).toBe(20);
  cv.putText(1, 0, "x", 0xffffff); // replace the second half of 歌
  expect(visible(cv)[0]?.startsWith(" x")).toBe(true);
  cv.putText(0, 0, "歌", 0xffffff);
  cv.putText(0, 0, "歌", 0xffffff); // same wide glyph must survive an overwrite
  for (const row of visible(cv)) expect(Bun.stringWidth(row)).toBe(20);
  expect(visible(cv)[0]?.startsWith("歌")).toBe(true);
  cv.putText(19, 1, "歌", 0xffffff); // never emit half a glyph at the edge
  expect(Bun.stringWidth(visible(cv)[1]!)).toBe(20);
  expect(cleanText("Hi\x1b]52;evil\x07\nthere")).not.toMatch(/[\x00-\x1f]/);
  expect(clipText("歌🎤abc", 4)).toBe("歌🎤");
});

test("bubble wraps long multilingual lyrics, clamps edges, and strips control characters", () => {
  const lines = wrapBubble("café 歌詞 🎤 abcdefghijklmnop\x1b[2J", 12);
  expect(lines.length).toBeGreaterThan(2);
  for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(12);
  const cv = new Canvas(24, 12);
  cv.clear(0);
  drawBubble(cv, -10, 0, 40, lines.slice(0, 2), "Lyrics · unsynced");
  for (const row of visible(cv)) expect(Bun.stringWidth(row)).toBe(24);
  expect(visible(cv).join("\n")).toContain("unsynced");
});

test("singer hides without music; renders song in the bubble header without a bottom caption or touching status rows", () => {
  for (const [cols, rows] of [[24, 16], [80, 24], [140, 40], [18, 8]]) {
    const cv = new Canvas(cols!, rows!);
    const L = computeLayout(cols!, (rows! - 2) * 2);
    const singer = new Singer(() => 0);
    cv.clear(0);
    singer.draw(cv, L, null, [], 0, 0.25);
    expect(visible(cv).join("").trim()).toBe("");
    for (let i = 0; i < 50; i++) { cv.clear(0); singer.draw(cv, L, music, [], i * 100, 0.1); }
    const out = visible(cv);
    for (const row of out) expect(Bun.stringWidth(row)).toBe(cols!);
    expect(out.slice(-2).join("").trim()).toBe("");
    if (cols! >= 24) {
      expect(out.join("\n")).not.toContain("LRCLIB");
      const songRows = out.filter((row) => row.includes("An artist"));
      expect(songRows).toHaveLength(1);
      expect(songRows[0]).toContain("│ An artist · A song");
    }
    cv.clear(0); singer.draw(cv, L, null, [], 6000, 0.1);
    expect(visible(cv).join("").trim()).toBe("");
  }
});

test("ad-libs are temporary, spaced out, and do not mutate real agent state", () => {
  const cv = new Canvas(100, 40), L = computeLayout(100, 76);
  const agent = { pid: 42, x: 8, y: 50, hat: HATS[0]!, accessory: ACCESSORIES[0]!, act: { kind: "work" } } as Agent;
  const before = JSON.stringify(agent);
  const singer = new Singer(() => 0);
  for (let i = 0; i <= 60; i++) { cv.clear(0); singer.draw(cv, L, music, [agent], i * 100, 0.1); }
  expect(visible(cv).join("\n")).toContain("yeah!");
  cv.clear(0); singer.draw(cv, L, music, [agent], 8000, 0.1);
  expect(visible(cv).join("\n")).not.toContain("yeah!");
  expect(JSON.stringify(agent)).toBe(before);
});
