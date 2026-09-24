# pets

Pixel companions for your coding sessions: a terminal office or floating macOS
pets, with football, a Spotify singer, typing combat, and local achievements.

Every running **Claude Code**, **Codex CLI**, or **OpenCode** CLI session gets a
mascot. Claude is orange; Codex is a white robot; OpenCode is a charcoal terminal
with a mint prompt. Each wears a hat and an accessory that stay with
it for its lifetime. Working agents get busy, idle agents take breaks, and new
sessions join automatically. The animations are decorative and never send
instructions to your coding agents.

## Quick start

Install [Bun](https://bun.sh), then clone and install the dependencies:

```sh
git clone https://github.com/agaliste/pets.git
cd pets
bun install
```

Start Claude Code, Codex CLI, or [OpenCode](https://opencode.ai/docs/cli/) in
another terminal, in any project directory. Choose a mode from the pets repository:

```sh
# Animated office inside your terminal
bun start

# Floating pets across your Mac's displays
bun run desktop
```

Desktop mode compiles its native overlay before starting. It requires Apple's
Command Line Tools; install them with `xcode-select --install` if needed. No paid
Apple Developer account or Xcode project setup is required.

Use one desktop instance at a time to avoid counting typing more than once.
The two modes are independent: running both creates separate simulations and
Spotify polling.

## Requirements and optional integrations

This project is developed for macOS. Desktop mode and Spotify playback detection
require macOS; terminal session discovery uses `ps` and `lsof`. Other platforms
are not verified.

| Component | Needed for |
| --- | --- |
| Bun | Installing dependencies, running TypeScript, builds, and local SQLite history |
| A terminal with true-color and Unicode block-character support | Rendering the terminal office |
| Running Claude Code, Codex CLI, or OpenCode sessions | Coding-session mascots |
| Apple Command Line Tools / Swift compiler | Building the native desktop overlay |
| Spotify desktop app, already running and playing | Optional singer in either mode |
| Internet access to LRCLIB | Optional lyric lookup |
| CodexBar with a fresh local widget snapshot | Optional desktop quota alerts |
| Input Monitoring and Accessibility permissions | Optional desktop typing combat and history |

There are no API keys, agent hooks, or provider configuration changes to set up
for pets. Spotify and CodexBar are optional; the other features work without them.

## Terminal office

Agents work at desks, wander around, take breaks, and play football in a shared
pixel room. Hats and accessories distinguish sessions. A disco corner hosts the
Spotify singer when there is enough room. The layout adapts when you resize the
terminal, hiding the pitch or disco in smaller windows.

The status bar shows working, idle, and unknown counts, the football score when
the pitch is visible, and a clock. Select a mascot to inspect its provider,
project, session title, status, uptime, hat, accessory, and PID.

| Key | Action |
| --- | --- |
| `Tab`, `→`, `↓`, `j`, `l` | Select the next mascot |
| `←`, `↑`, `k`, `h` | Select the previous mascot |
| `r` | Redraw the screen |
| `q`, `Q`, `Esc`, `Ctrl+C` | Quit |

## Floating desktop pets

Desktop mode uses transparent, click-through native overlays. Pets do not take
keyboard focus or intercept clicks. They move across connected displays using
the Mac's actual screen arrangement, including stacked monitors and different
Retina scaling factors. Disconnecting a monitor relocates them to a remaining
display.

- **Arrivals:** new sessions appear through a blue-and-cyan pixel wormhole.
- **Working:** busy mascots carry laptops. An existing idle mascot that starts
  working receives a lightning strike and a **WORK!** callout.
- **Breaks:** idle mascots pass a football, including across displays. Kicks get
  nine randomized special shots: **METEOR DRIVE!**, **THUNDER STRIKE!**,
  **CYCLONE SHOT!**, **DRAGON ROAR!**, **FROST FANG!**, **SHADOW ECLIPSE!**,
  **SOLAR BURST!**, **GALAXY BREAK!**, and **BICYCLE COMET!**, with pixel impact bursts
  and elemental trails. Bicycle Comet sends the kicker through a backward somersault,
  hat and accessory included.
- **Departures:** a missile flies in from a screen edge toward the departed
  mascot's last position, followed by a pixel blast, fragments, and smoke.
- **Unknown status:** mascots remain visible and roam without joining football.
- **Music:** a separate singer floats with a microphone, notes, and lyric bubble.

Use the **⚽ menu-bar icon** for session summaries, errors, typing controls,
**Stats & Achievements…**, **Enable/Disable Spotify integration**, **Pause movement**,
**Hide pets**, and **Quit pets**. Disabling Spotify stops playback polling and
lyric lookups and hides the singer for the current run; it starts enabled again
on the next launch.
`Ctrl+C` in the launching terminal also quits.

Pause freezes movement while session and song metadata continue updating.
Pause and Hide suspend typing capture and suppress quota alerts. macOS
**Reduce Motion** freezes roaming and suppresses transient movement effects;
typing combat retains static fighters and a counter.

The overlays are configured for Spaces, full-screen apps, and Stage Manager.
Visibility in those environments depends on the target Mac and needs a manual
check. Nothing is installed as a login item or background service.

## Spotify singer and lyrics

Play a song in the Spotify macOS app while either mode is running. Pets reads
playback through AppleScript, polling once per second. It never launches Spotify
or issues playback commands. macOS may request **Automation** permission for
the application that launches pets to access Spotify.

Song title, artist, album, and duration are sent to **LRCLIB** to find lyrics:

- Timestamped lyrics follow playback, including seeks and track changes.
- Plain lyrics cycle with an **unsynced** label.
- Missing lyrics, instrumentals, and lookup failures show notes and a status.
- Long lines wrap and page through the bubble; the header shows artist and song.
- Pausing or stopping playback hides the singer. A stalled poll also hides stale
  playback rather than leaving it visible indefinitely.

The terminal singer uses the disco corner and other mascots occasionally show
short ad-libs. The singer is decorative and does not count as a CLI session.
Spotify supplies the audio; pets does not generate a singing voice or call an AI
model for lyrics or ad-libs.

No Spotify OAuth credentials are needed. Lyrics are cached only in memory and
cleared on exit. Lyrics available inside Spotify may not be available through
LRCLIB. See [SPOTIFY.md](SPOTIFY.md) for timing, caching, and fallback details.

## Typing combat

In desktop mode, choose **⚽ → Enable typing combat…** and grant **Input
Monitoring** and **Accessibility** to the process named by macOS in **System
Settings → Privacy & Security**. Restart pets if macOS requests it. Ordinary
floating pets and music do not require these typing permissions.

A small orange fighter attacks a robot above the text caret as you type. If the
focused editor does not expose caret geometry, the fight appears near the mouse
pointer instead. It disappears after typing stops and stays within the display.

| Hits in the current streak | Callout |
| --- | --- |
| 1–4 | Hit counter |
| 5 | COMBO! |
| 12 | ON FIRE! |
| 25 | RAMPAGE! |
| 50 | OOOOMMMGGGG! |
| 100 | GODLIKE! |

Keep gaps between accepted hits at **1.4 seconds or less** to continue a streak.
Longer gaps, app switches, menu interaction, Pause/Hide, and display changes reset
it. The fight is independent of your coding sessions and produces no sound.

Only nonrepeating presses at physical ANSI letter/number key positions, keypad
digits, Space, and Return/Enter count. Command/Control shortcuts, held-key
repeats, arrows, function keys, punctuation keys, Tab, Escape, and
Backspace/Delete are excluded. The filter uses key positions, not the characters
produced by the active keyboard layout.

The listener is passive: it does not block, change, or synthesize input. It reads
key codes only to classify eligible presses, then discards them. It never reads
typed characters, field values, selected text, or clipboard contents. Capture is
suppressed during macOS Secure Input and for identified secure text fields.

**Disable typing combat** removes the listener for the current run. That choice
is not persisted: on the next launch, monitoring starts automatically if both
permissions are already available.

## Typing history and 56 achievements

Open **⚽ → Stats & Achievements…** for:

- Lifetime totals and today's typing activity.
- An hourly breakdown and the last 30 calendar days.
- The ten latest qualifying combos and your longest streak.
- Typing speed: fastest and average WPM, today's best, the fastest combo of each
  of the last 30 days, and your five fastest combos.
- **56 achievements** with progress and locked/unlocked filters, covering
  keystrokes, combo counts, longest combos, active days, consecutive days,
  active minutes, daily/minute records, and typing speed.

The window refreshes while open. New unlocks produce quiet, nonactivating
five-second notices; unlocks persist across restarts without replaying notices.

A combo counts once when it reaches **five accepted hits**. Its length keeps
growing in history even beyond the visual counter's 999-hit limit. Keystroke
totals can include pulses rejected by the combat animation's rapid-hit filter.
Active minutes mean calendar minutes containing a recorded pulse, and minute
records are key counts, not words per minute. Typing speed is measured per
combo: WPM = (hits − 1) ÷ 5 per minute of combo duration, and only combos of
**25+ hits** get a speed. Hour/day grouping uses local time at capture;
travelling does not regroup old events.

History is stored at:

```text
~/Library/Application Support/pets/typing.sqlite
```

The directory is created with user-only permissions (`0700`) and the database
with `0600`. SQLite may also create `typing.sqlite-wal` and `typing.sqlite-shm`.
Records contain event timestamps, local UTC offsets, combo records, summaries,
and achievement unlocks. Typed text, key codes, app identities, window titles,
and caret/pointer positions are not stored.

**There is no automatic retention cutoff.** Individual timestamps remain until
you choose **Reset history…** in the stats window and confirm. Reset clears all
events, summaries, combos, and achievements; it cannot remove external backups.
Disabling combat stops capture without deleting existing history.

History starts with observed input and is not backfilled. Permission failures,
secure fields, paused/hidden state, and delayed or dropped events can leave gaps.
If storage fails, recording stops while pets continue running; resolve the
storage issue and choose **Refresh** in the stats window to retry.

## CodexBar quota alerts

If you already use CodexBar, desktop mode reads its local widget snapshot every
five seconds:

```text
~/Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json
```

Fresh Claude/Codex session and weekly allowances appear as pixel energy bars
with the percentage remaining. Later changes show **UP/DOWN** and the change in
percentage points. Alerts last five seconds on the display containing the
pointer; current quota status is also shown in the menu.

Keep CodexBar refreshing. Missing data stays unavailable, and snapshots older
than 15 minutes are ignored. Pets does not fetch quotas from provider APIs,
read provider credentials, or persist quota history. No additional pets
permission is required.

## Session detection

Pets observes existing CLI sessions without modifying their configuration:

- `ps` identifies live processes. Codex's Node launcher is deduplicated against
  its native child. Helper commands and Codex desktop/app-server processes are
  excluded.
- Claude Code uses its local `~/.claude/sessions/` registry, with `lsof` working
  directory discovery and transcript activity/title fallbacks.
- Codex uses `lsof` to find the rollout file held open by each live process.
  Sessions sharing a directory stay separate. Custom Codex homes work because
  paths come from open files rather than an assumed home directory.
- Bounded transcript reads supply metadata and activity. Codex turn-start,
  completion, and interruption events determine working/idle status, with
  activity-event fallbacks. Titles come from `session_index.jsonl` when available.
- Missing, unreadable, or ambiguous Codex rollouts leave a live mascot visible
  with **unknown** status. Historical transcripts alone never create mascots.
- OpenCode detects interactive, `run`, and `attach` CLI processes, deduplicating
  npm launchers. Administrative commands and standalone `serve`, `web`, and
  `acp` servers do not create mascots. Each live CLI process gets one mascot;
  saved conversations and database subagents do not create additional pets.
- OpenCode uses `lsof` for the working directory and open SQLite database path,
  including custom data locations. For local `--session <id>` / `-s <id>` runs,
  it reads the exact root session and latest message in read-only mode. Recent
  user/unfinished assistant messages imply working; terminal completions and
  errors imply idle. Old messages from before process startup remain unknown.
- Ordinary OpenCode sessions, `--continue`, forks, remote attachments, and
  missing/ambiguous databases remain visible with **unknown** activity. Pets
  never guesses a conversation from the newest history entry or shared cwd.
  Metadata follows the explicit ID passed at launch; switching conversations
  inside the TUI cannot be detected from process arguments. Activity from stored
  messages is an inference, not OpenCode's live status API.

Agent transcript formats and database schemas are internal and can change.
Unknown status is a fallback, not proof that a session is idle. Pets displays observed status; it
does not control the agents or create AI requests.

## Privacy and permissions at a glance

| Feature | Reads or uses | Stores or sends |
| --- | --- | --- |
| Session mascots | Local processes, session registries, bounded transcript chunks, and matching OpenCode database records | Session metadata stays in memory and is displayed locally; no persistent session cache or network upload |
| Spotify singer | Playback metadata via macOS Automation | Song title, artist, album, and duration go to LRCLIB; lyrics stay in memory |
| Typing combat | Eligible key timing and Accessibility caret geometry, with pointer fallback | Timing and position pass over a local process pipe; text and key codes are never sent or stored |
| Typing history | Captured timestamps and local UTC offsets | Local SQLite events, summaries, combos, and unlocks; no network upload |
| Quota alerts | Existing CodexBar snapshot; pointer's display for placement | In-memory comparisons only; no direct provider requests |

There is no screen recording, local web server, or telemetry integration. Session
titles and project paths can appear on screen, so consider them when sharing
screenshots or recordings. The native renderer communicates with Bun through
stdin/stdout pipes.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No coding mascots | Start a live `claude`, `codex`, or `opencode` CLI session and allow a few seconds for polling. Codex desktop/app-server sessions are excluded. Check the status bar or ⚽ menu for errors. |
| Unknown status or missing title | Metadata may be unavailable, ambiguous, or in an unrecognized format. OpenCode normally shows unknown unless launched with a local explicit `--session` ID and an accessible database. The live process can still appear. |
| Crowded terminal or missing disco | Enlarge the terminal. Small layouts intentionally omit features; the singer hides below 24 columns or 16 rows. |
| No Spotify singer | Open Spotify yourself and play a track. Check Automation permission for the launching application and any displayed error. |
| Lyrics missing or unsynced | Check connectivity to LRCLIB. A track may have only plain lyrics or no matching entry. |
| Desktop build fails | Install Apple's Command Line Tools and check that Bun and the Swift compiler are available. |
| Typing combat does not start | Enable it from the ⚽ menu, grant both permissions to the process macOS identifies, and restart if requested. A rebuilt binary may need permissions granted again. |
| Fight appears near the pointer | The focused app does not expose usable caret geometry; this is the fallback. |
| Typing counts seem low | Check the eligible-key filter, Secure Input, Pause/Hide, and monitoring status. The history is not a complete keyboard audit. |
| Typing history is not recording | Check the menu/stats error, resolve disk or access problems, then use Refresh. |
| Quotas unavailable | Keep CodexBar running with a fresh snapshot containing supported Claude/Codex usage windows. |
| Pets missing in full screen or a Space | Check Hide/Show and the target macOS window environment; these configurations need manual verification. |

## Development and builds

| Command | Purpose |
| --- | --- |
| `bun install` | Install development dependencies |
| `bun start` | Run the terminal office |
| `bun run desktop` | Build and run desktop mode |
| `bun run src/desktop.ts` | Run desktop mode using an already-built overlay |
| `bun test` | Run fixture-based tests |
| `bun run check` | Type-check TypeScript without emitting files |
| `bun run build` | Compile the terminal executable to `dist/pets` |
| `bun run build:desktop` | Compile the native renderer to `dist/pets-desktop-overlay` |

After a terminal build, run `./dist/pets` to use the compiled office. The native
desktop executable is a renderer subprocess and should be started through the
desktop TypeScript entry point, not on its own.

Tests cover session parsing/tracking, music, terminal layout, desktop effects,
typing combat, quota handling, and SQLite history/achievements using fixtures and
mocks. Type checks and builds do not launch the app. They do not establish live
macOS permission behavior, focus handling, caret compatibility, appearance,
Spotify synchronization, or visibility across Spaces; those need manual checks.

| Source | Responsibility |
| --- | --- |
| `src/main.ts`, `src/term.ts`, `src/canvas.ts`, `src/office.ts`, `src/sim.ts` | Terminal input, rendering, room layout, and mascot simulation |
| `src/sessions.ts`, `src/codex.ts`, `src/opencode.ts` | Claude Code, Codex CLI, and OpenCode discovery and activity parsing |
| `src/music.ts`, `src/singer.ts` | Spotify playback, lyric lookup, and singer rendering |
| `src/desktop.ts`, `src/desktop-scene.ts` | Desktop process coordination and scene simulation |
| `src/combat.ts`, `src/typing-stats.ts`, `src/achievements.ts` | Typing effects, SQLite history, and milestones |
| `src/quota.ts` | CodexBar snapshot parsing and quota alerts |
| `desktop/` | Native macOS overlays, input monitoring, and stats window |
| `scripts/build-desktop.ts` | Swift compilation |

See [DESKTOP.md](DESKTOP.md) for detailed desktop behavior and manual checks,
[SPOTIFY.md](SPOTIFY.md) for music integration details, and
[DESIGN.md](DESIGN.md) for rendering and architecture notes.
