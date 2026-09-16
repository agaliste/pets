# Spotify singer

While the office is open, playing a song in the Spotify macOS app brings in a
Claude or Codex singer with a microphone. Its appearance is stable for each song.
At normal terminal widths, the singer performs in a top-right disco with a mirror
ball, speakers and softly pulsing floor lights. A compact football field sits
below it. The lights dim when playback stops. Narrow terminals omit the disco;
short terminals hide the pitch when there is not enough room for both.
Other mascots occasionally display short ad-libs without invoking any AI model.
The singer is decorative: it does not count as a CLI session or occupy a desk.

Start the office normally with `bun start`. On first use, macOS may ask to let
your terminal control Spotify. Allow it for playback detection. If denied,
enable Spotify under System Settings → Privacy & Security → Automation for the
application that launches the office. Spotify must already be running; the
office does not launch it or issue playback commands. Non-macOS hosts simply
keep the existing office behavior.

Playback is sampled using AppleScript once per second and interpolated between
samples. Pause/stop hides the singer on the next poll; seeking, repeating and
skipping resynchronize it. A stalled poll hides stale playback after four seconds.
The singer and bubbles hide in terminals smaller than 24 columns or 16 rows.

Lyrics are looked up by title, artist, album and duration through
[LRCLIB](https://lrclib.net/docs). These song details are sent to LRCLIB, without
Spotify credentials or agent/session information. There is no Spotify OAuth setup.
Responses are cached only in memory, up to 32 tracks, and cleared on exit.

- Timestamped lyrics follow playback, one line at a time. Long lines wrap and
  cycle through two-line pages.
- Plain lyrics cycle every five seconds and are labeled **unsynced**; they are
  not aligned with the vocals.
- Instrumentals, missing lyrics, or network failures show musical notes and a
  status label. Transient errors retry after 30 seconds. Missing matches are
  cached for five minutes; successful responses for an hour.
- Ad-libs last 1.8 seconds and occur at most every 8–18 seconds after an initial
  six-second delay. Bubbles that would overlap the singer's lyrics are suppressed.

Coverage depends on LRCLIB and the track's edition; lyrics available inside
Spotify may not be available through LRCLIB. No lyrics are invented. Text is
displayed only; the feature does not produce singing audio.

Validation uses mocked AppleScript/HTTP responses and in-memory canvas rendering.
For a manual check, start Spotify and the office yourself, then try playback,
pause/resume, a seek, a skip, and resizing. Live Automation permission and lyric
timing need checking on your Mac.
