import { execFile } from "node:child_process";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds (Spotify's dictionary reports milliseconds)
  position: number; // seconds
}
export interface LyricLine { at: number; text: string }
export interface Lyrics { lines: LyricLine[]; plain: string[]; instrumental: boolean }
export type LyricsState = "loading" | "synced" | "plain" | "missing" | "instrumental" | "error";
export interface MusicView {
  track: Track;
  position: number;
  text: string;
  state: LyricsState;
}

// No playback commands. The running check prevents launching Spotify.
// Fixed delimiters avoid quoting song titles as source code or shell arguments.
export const SPOTIFY_SCRIPT = `
if application "Spotify" is not running then return ""
tell application "Spotify"
  if player state is not playing then return ""
  set song to current track
  set fields to {id of song, name of song, artist of song, album of song, duration of song as text, player position as text}
end tell
set AppleScript's text item delimiters to ASCII character 31
return fields as text
`;

export function readSpotify(): Promise<string> {
  if (process.platform !== "darwin") return Promise.resolve("");
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", SPOTIFY_SCRIPT], { timeout: 2500, maxBuffer: 16_384 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export function parseSpotify(raw: string): Track | null {
  if (!raw.trim()) return null;
  const fields = raw.trimEnd().split("\x1f");
  if (fields.length !== 6) throw new Error("Invalid Spotify response");
  const [id, title, artist, album, durationText, positionText] = fields as [string, string, string, string, string, string];
  const duration = Number(durationText.replace(",", ".")) / 1000;
  const position = Number(positionText.replace(",", "."));
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0) {
    throw new Error("Invalid Spotify timing");
  }
  // Ads/episodes do not have song lyrics; local music is still matchable by metadata.
  if (!/^spotify:(track|local):/.test(id) || !title || !artist) return null;
  return { id, title, artist, album, duration, position: Math.min(position, duration) };
}

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  for (const row of source.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const last = stamps[stamps.length - 1]!;
    const text = row.slice(last.index! + last[0].length).replace(/<\d+:\d+(?:\.\d+)?>/g, "").trim();
    for (const stamp of stamps) {
      const at = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] ?? "0"}`) - offset;
      lines.push({ at: Math.max(0, at), text });
    }
  }
  return lines.sort((a, b) => a.at - b.at);
}

export function lyricAt(lines: LyricLine[], position: number): string {
  let lo = 0, hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid]!.at <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo ? lines[lo - 1]!.text : "";
}

export async function fetchLyrics(track: Track, signal: AbortSignal, fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<Lyrics | null> {
  const query = new URLSearchParams({
    track_name: track.title, artist_name: track.artist,
    album_name: track.album, duration: String(Math.round(track.duration)),
  });
  const response = await fetcher(`https://lrclib.net/api/get?${query}`, {
    signal, headers: { "User-Agent": "AgentOffice/0.1.0 (personal desktop lyrics display)" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lyrics request failed (${response.status})`);
  const data = await response.json() as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid lyrics response");
  return {
    lines: typeof data.syncedLyrics === "string" ? parseLrc(data.syncedLyrics) : [],
    plain: typeof data.plainLyrics === "string" ? data.plainLyrics.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [],
    instrumental: data.instrumental === true,
  };
}

type CacheEntry = { lyrics: Lyrics | null; expires: number };

/** Playback polling never waits for the network. All clock/IO dependencies are mockable. */
export class MusicTracker {
  lastError: string | null = null;
  private track: Track | null = null;
  private sampledAt = 0;
  private nextPoll = 0;
  private polling = false;
  private closed = false;
  private lyrics: Lyrics | null = null;
  private state: LyricsState = "loading";
  private request: AbortController | null = null;
  private retryAt = 0;
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly read = readSpotify,
    private readonly lookup = fetchLyrics,
    private readonly clock = () => performance.now(),
  ) {}

  async poll(): Promise<void> {
    const now = this.clock();
    if (this.closed || this.polling || now < this.nextPoll) return;
    this.polling = true;
    this.nextPoll = now + 1000;
    try {
      const next = parseSpotify(await this.read());
      if (this.closed) return;
      const changed = this.key(next) !== this.key(this.track);
      this.track = next;
      this.sampledAt = this.clock();
      this.lastError = null;
      if (changed) {
        this.request?.abort();
        this.request = null;
        this.lyrics = null;
        this.state = "loading";
        this.retryAt = 0;
      }
      if (next && !this.request && (changed || (this.state === "error" && this.clock() >= this.retryAt))) {
        void this.load(next);
      }
    } catch (error) {
      this.track = null;
      this.request?.abort();
      this.request = null;
      const message = String(error);
      this.lastError = message.includes("-1743")
        ? "Allow Spotify in System Settings > Privacy & Security > Automation"
        : "Spotify unavailable; retrying";
      this.nextPoll = this.clock() + 15_000;
    } finally {
      this.polling = false;
    }
  }

  view(): MusicView | null {
    const now = this.clock();
    if (!this.track || now - this.sampledAt > 4000) return null;
    const position = Math.min(this.track.duration, this.track.position + Math.max(0, now - this.sampledAt) / 1000);
    if (position >= this.track.duration) return null;
    let text = "♪ ♫ ♪";
    if (this.state === "synced") text = lyricAt(this.lyrics!.lines, position) || text;
    // Plain lyrics have no timestamps: a clearly labeled reading carousel, never claimed as karaoke.
    if (this.state === "plain") {
      const lines = this.lyrics!.plain;
      text = lines[Math.floor(position / 5) % lines.length]!;
    }
    return { track: this.track, position, text, state: this.state };
  }

  stop(): void {
    this.closed = true;
    this.track = null;
    this.request?.abort();
  }

  private key(track: Track | null): string {
    return track ? JSON.stringify([track.id, track.title, track.artist, track.album, track.duration]) : "";
  }

  private accept(lyrics: Lyrics | null): void {
    this.lyrics = lyrics;
    this.state = lyrics?.instrumental ? "instrumental" : lyrics?.lines.length ? "synced" : lyrics?.plain.length ? "plain" : "missing";
  }

  private async load(track: Track): Promise<void> {
    const key = this.key(track), cached = this.cache.get(key);
    if (cached && cached.expires > this.clock()) { this.accept(cached.lyrics); return; }
    const request = new AbortController();
    this.request = request;
    this.state = "loading";
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const lyrics = await this.lookup(track, request.signal);
      if (request.signal.aborted || this.closed || this.request !== request || key !== this.key(this.track)) return;
      this.cache.delete(key);
      this.cache.set(key, { lyrics, expires: this.clock() + (lyrics ? 3_600_000 : 300_000) });
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      this.accept(lyrics);
    } catch {
      if (this.request === request && !this.closed) {
        this.state = "error";
        this.retryAt = this.clock() + 30_000;
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === request) {
        this.request = null;
        if (this.state === "loading") {
          this.state = "error";
          this.retryAt = this.clock() + 30_000;
        }
      }
    }
  }
}
