import { expect, test } from "bun:test";
import { fetchLyrics, lyricAt, MAX_LYRIC_LINES, MAX_LYRICS_BYTES, MusicTracker, parseLrc, parsePlain, parseSpotify, SPOTIFY_SCRIPT, type Lyrics, type Track } from "./music.ts";

const track: Track = { id: "spotify:track:a", title: "Test & song", artist: "Artist", album: "Album", duration: 120, position: 0 };
const raw = (position = 0, id = track.id) => [id, track.title, track.artist, track.album, 120000, position].join("\x1f") + "\n";
const lyrics: Lyrics = { lines: [{ at: 1, text: "First line" }, { at: 5, text: "Second line" }, { at: 8, text: "" }], plain: [], instrumental: false };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("Spotify parsing preserves delimiters/quotes and converts timing; stopped, ads and episodes are hidden", () => {
  expect(parseSpotify(raw(2.5))).toEqual({ ...track, position: 2.5 });
  expect(parseSpotify(raw().replace("Test & song", 'A, "song"\nname'))?.title).toBe('A, "song"\nname');
  expect(parseSpotify(raw().replace("\x1f0\n", "\x1f2,5\n"))?.position).toBe(2.5);
  expect(parseSpotify("")).toBeNull();
  expect(parseSpotify(raw(0, "spotify:ad:x"))).toBeNull();
  expect(parseSpotify(raw(0, "spotify:episode:x"))).toBeNull();
  expect(parseSpotify(raw(0, "spotify:local:a:b:c"))).not.toBeNull();
  expect(() => parseSpotify("bad data")).toThrow();
  expect(() => parseSpotify(raw(NaN))).toThrow();
  expect(SPOTIFY_SCRIPT.indexOf("is not running")).toBeLessThan(SPOTIFY_SCRIPT.indexOf('tell application "Spotify"'));
});

test("LRC handles timestamps, repeated lines, offsets, blanks, and backwards seeks", () => {
  const lines = parseLrc("[ar:Someone]\n[offset:500]\n[00:05.00]Later\n[00:01.5][00:03.250]Repeat\n[00:06]\n[00:07.00]<00:07.10>Words");
  expect(lines).toEqual([{ at: 1, text: "Repeat" }, { at: 2.75, text: "Repeat" }, { at: 4.5, text: "Later" }, { at: 5.5, text: "" }, { at: 6.5, text: "Words" }]);
  expect(lyricAt(lines, 0)).toBe("");
  expect(lyricAt(lines, 4.5)).toBe("Later");
  expect(lyricAt(lines, 2)).toBe("Repeat");
  expect(lyricAt(lines, 6)).toBe("");
});

test("LRCLIB request encodes metadata and handles synced/plain/missing/errors with mocked HTTP", async () => {
  const signal = new AbortController().signal;
  const result = await fetchLyrics(track, signal, async (url, init) => {
    expect(new URL(url).searchParams.get("track_name")).toBe(track.title);
    expect(new URL(url).searchParams.get("duration")).toBe("120");
    expect(init.signal).toBe(signal);
    return Response.json({ syncedLyrics: "[00:01]Hi", plainLyrics: "Hi\n\nThere", instrumental: false });
  });
  expect(result).toEqual({ lines: [{ at: 1, text: "Hi" }], plain: ["Hi", "There"], instrumental: false });
  expect(await fetchLyrics(track, signal, async () => new Response(null, { status: 404 }))).toBeNull();
  await expect(fetchLyrics(track, signal, async () => new Response(null, { status: 429 }))).rejects.toThrow("429");
  await expect(fetchLyrics(track, signal, async () => Response.json(null))).rejects.toThrow("Invalid lyrics");
});

test("oversized LRCLIB bodies are rejected before buffering and parsed lines are capped", async () => {
  const signal = new AbortController().signal;
  let cancelled = false;
  const declaredBody = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  const declared = new Response(declaredBody, { headers: { "content-length": String(MAX_LYRICS_BYTES + 1) } });
  await expect(fetchLyrics(track, signal, async () => declared)).rejects.toThrow("Oversized");
  expect(cancelled).toBe(true);
  const enhanced = "[00:00]" + Array.from({ length: 45 }, (_, i) => `<00:${String(i).padStart(2, "0")}.00>word `).join("");
  const enhancedLines = parseLrc(enhanced);
  expect(enhancedLines).toEqual([{ at: 0, text: Array(45).fill("word").join(" ") }]);
  expect(enhancedLines[0]!.text).not.toMatch(/[<>]/);
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { produced += 65_536; controller.enqueue(new Uint8Array(65_536).fill(0x20)); },
  });
  await expect(fetchLyrics(track, signal, async () => new Response(stream))).rejects.toThrow("Oversized");
  expect(produced).toBeLessThanOrEqual(MAX_LYRICS_BYTES + 2 * 65_536);
  const huge = Array.from({ length: MAX_LYRIC_LINES * 2 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}]${"x".repeat(1000)}`).join("\n");
  const lines = parseLrc(huge);
  expect(lines.length).toBe(MAX_LYRIC_LINES);
  expect(lines[0]!.text.length).toBe(500);
  expect(parsePlain(huge).length).toBe(MAX_LYRIC_LINES);
});

test("playback interpolates between polls, follows seeks and repeat, and hides on pause/staleness/end", async () => {
  let now = 0, playback = raw(1), lookups = 0;
  const tracker = new MusicTracker(async () => playback, async () => { lookups++; return lyrics; }, () => now);
  await tracker.poll(); await flush();
  expect(tracker.view()?.text).toBe("First line");
  now = 500;
  expect(tracker.view()?.position).toBe(1.5);
  now = 1000; playback = raw(6); await tracker.poll();
  expect(tracker.view()?.text).toBe("Second line");
  now = 2000; playback = raw(1); await tracker.poll();
  expect(tracker.view()?.text).toBe("First line");
  expect(lookups).toBe(1);
  now = 7000;
  expect(tracker.view()).toBeNull();
  playback = ""; await tracker.poll();
  expect(tracker.view()).toBeNull();
  now = 8000; playback = raw(119.5); await tracker.poll(); await flush();
  expect(lookups).toBe(1); // resumed from memory cache
  now = 8600;
  expect(tracker.view()).toBeNull();
  tracker.stop();
});

test("a slow old lyric request cannot replace the current track; pause cancels requests", async () => {
  let now = 0, playback = raw(), resolveOld!: (value: Lyrics) => void;
  const signals: AbortSignal[] = [];
  const tracker = new MusicTracker(async () => playback, async (song, signal) => {
    signals.push(signal);
    if (song.id === track.id) return new Promise((resolve) => { resolveOld = resolve; });
    return { ...lyrics, lines: [{ at: 0, text: "New song" }] };
  }, () => now);
  await tracker.poll();
  expect(tracker.view()?.state).toBe("loading");
  now = 1000; playback = raw(1, "spotify:track:b"); await tracker.poll(); await flush();
  expect(signals[0]!.aborted).toBe(true);
  resolveOld(lyrics); await flush();
  expect(tracker.view()?.text).toBe("New song");
  now = 2000; playback = raw(); await tracker.poll();
  now = 3000; playback = ""; await tracker.poll();
  expect(signals[2]!.aborted).toBe(true);
  tracker.stop();
  resolveOld(lyrics); await flush();
});

test("polls never overlap; stop prevents late results from restarting lyric work", async () => {
  let resolveRead!: (value: string) => void, reads = 0, lookups = 0;
  const tracker = new MusicTracker(async () => { reads++; return new Promise((resolve) => { resolveRead = resolve; }); }, async () => { lookups++; return lyrics; }, () => 0);
  const pending = tracker.poll();
  await tracker.poll();
  expect(reads).toBe(1);
  tracker.stop(); resolveRead(raw()); await pending;
  expect(tracker.view()).toBeNull();
  expect(lookups).toBe(0);
});

test("network failures retry with backoff and recover; permission errors clear stale playback", async () => {
  let now = 0, calls = 0, denied = false;
  const tracker = new MusicTracker(async () => {
    if (denied) throw new Error("Not authorized (-1743)");
    return raw();
  }, async () => { if (++calls === 1) throw new Error("offline"); return lyrics; }, () => now);
  await tracker.poll(); await flush();
  expect(tracker.view()?.state).toBe("error");
  now = 1000; await tracker.poll(); expect(calls).toBe(1);
  now = 31000; await tracker.poll(); await flush();
  expect(calls).toBe(2); expect(tracker.view()?.state).toBe("synced");
  denied = true; now = 32000; await tracker.poll();
  expect(tracker.view()).toBeNull(); expect(tracker.lastError).toContain("Automation");
  denied = false; now = 47000; await tracker.poll(); await flush();
  expect(tracker.lastError).toBeNull(); expect(tracker.view()?.state).toBe("synced");
  tracker.stop();
});

test("plain, missing and instrumental lyrics have honest fallback states", async () => {
  for (const [data, state] of [[null, "missing"], [{ lines: [], plain: ["Plain words"], instrumental: false }, "plain"], [{ lines: [], plain: [], instrumental: true }, "instrumental"]] as const) {
    const tracker = new MusicTracker(async () => raw(), async () => data as Lyrics | null, () => 0);
    await tracker.poll(); await flush();
    expect(tracker.view()?.state).toBe(state);
    expect(tracker.view()?.text).toBe(state === "plain" ? "Plain words" : "♪ ♫ ♪");
    tracker.stop();
  }
});
