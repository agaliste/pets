# Floating desktop mode

Run from this repository:

```sh
bun run desktop
```

This builds a small native macOS overlay with the installed Swift compiler, then
starts the desktop mode. The first build can take a few seconds. No Apple
Developer account, Xcode project, paid signing certificate, or new dependency is
needed. Apple Command Line Tools and Bun are required; if the compiler is missing,
install the tools with `xcode-select --install`.

The existing terminal office remains available with `bun start`. Desktop mode
does not change the terminal renderer or its controls. Quit one mode before
starting another if you do not want two independent simulations and music polls.

## What appears

- Each detected live Claude Code, Codex CLI, or OpenCode CLI session gets its
  pixel mascot, hat, and accessory. Hats and accessories stay stable during its lifetime.
- New agents arrive through a blue-and-cyan pixel wormhole: it opens with orbiting
  sparks, reveals the waving mascot and its accessories, then shrinks closed.
  The one-second entrance completes before roaming or football begins. Each live
  session appears in the menu immediately. Pause, Hide, and Reduce Motion skip
  the animation and show the agent directly; changing monitors does not replay it.
- When a session ends, its mascot bursts into an expanding pixel explosion,
  provider-colored fragments, and drifting smoke at its last position. The effect
  lasts 0.85 seconds, including when the last agent leaves. Monitor crossings and
  status changes do not trigger it. Pause, Hide, and Reduce Motion suppress it.
- Idle agents chase and kick a shared football through the air, preferring passes
  to teammates on other monitors. A single idle agent can play on its own.
  Each kick randomly picks an anime-style special shot: **METEOR DRIVE!** leaves
  a flame trail, **THUNDER STRIKE!** crackles with lightning, and **CYCLONE SHOT!**
  spirals with wind. A launch shockwave and pixel callout accompany the shot;
  consecutive kicks avoid repeating the same style. Effects last up to 0.95
  seconds, follow the real ball path, and leave pass speed and physics unchanged.
  Pause, Hide, Reduce Motion, and display changes clear these effects.
- Busy agents float slowly with a laptop. Unknown-status agents roam without
  joining football; a changed status does not interrupt the actual coding agent.
- When an existing agent goes from idle to working, a pixel lightning bolt
  runs from the top edge of its current monitor down to its head, it briefly
  raises its arms, and electric sparks disperse. Connected zigzag segments keep
  the pixel proportions intact even on tall or vertically arranged monitors.
  A bouncing **WORK!** pixel callout appears beside it for 1.15 seconds,
  switching sides near display edges and shrinking away after the strike.
  This 0.55-second effect fires once per idle-to-working transition, not for
  newly discovered busy agents or unknown status. Pause, Hide, and Reduce Motion
  suppress it without replaying it later.
- Playing Spotify brings in a separate roaming singer, microphone, musical notes,
  and a lyric bubble. The singer does not count as a coding session.
- Typing combat adds a miniature 8-bit fight above your text caret. Each new
  keypress throws a strike; sustained typing builds bigger moves and callouts.

Spotify supplies the audio; the mascot is an animated singer, not a generated
voice. Existing [Spotify playback and lyric behavior](SPOTIFY.md) applies,
including LRCLIB requests, unsynced labels, missing-lyric states, and Automation
permission. Allow the existing Spotify Automation request if macOS asks. There
is no Spotify login or OAuth setup.

The overlay passes all clicks through and never takes keyboard focus. Use the
**⚽ menu-bar icon** to see session names/status/hats, pause or resume movement,
hide/show the pets, or quit. **Ctrl+C** in the launching terminal also quits.
The menu shows detection or Spotify errors; with no sessions it tells you to
start Claude, Codex, or OpenCode. Pause freezes movement while playback metadata
and session status continue to update. macOS **Reduce Motion** also freezes movement.

## Displays and Spaces

The scene uses the actual macOS arrangement of all connected displays, including
monitors above or left of the main display and different Retina scaling factors.
Pets and the ball cross touching screen edges; empty gaps in the arrangement are
skipped when traveling toward another display. They bounce or turn at outside
edges. Disconnecting a monitor relocates actors onto a remaining display.
Mirrored screen rectangles get only one overlay.

Transparent panels are configured to join Spaces, full-screen apps, and Stage
Manager using [AppKit window behaviors](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications).
Visibility in those modes still needs a live check on the target Mac. System
surfaces such as the lock screen are outside this mode's scope.

## Typing combat

After starting desktop mode, open **⚽ → Enable typing combat…**. Approve
**Input Monitoring** and **Accessibility** for the process macOS identifies in
System Settings → Privacy & Security. These are new permissions for typing
combat only; ordinary floating pets and the singer continue without them.
If macOS asks you to quit and reopen, restart `bun run desktop`. After granting
access, the menu status should say **Typing combat ready**. No Apple Developer
account is needed. A rebuilt locally signed binary may need permission granted
again; follow the process name shown by macOS rather than guessing the owner.

The listener counts nonrepeating presses of letter and number keys (including
keypad digits), Space, and Return/Enter, excluding Command and Control shortcuts.
Arrows, function keys, Escape, Tab, Backspace/Delete, punctuation keys, and other
keys do not count toward combat or typing history. The filter uses physical ANSI
key positions, not the characters produced by the active keyboard layout;
Shift/Option do not change which positions count. Held keys cannot generate a
combo. Keep the gaps between strikes below **1.4 seconds** to maintain a streak.

| Hits | Callout | Attack progression |
| --- | --- | --- |
| 1–4 | Hit counter | Jabs and kicks |
| 5 | COMBO! | Chained strikes |
| 12 | ON FIRE! | Uppercuts |
| 25 | RAMPAGE! | Spinning strikes |
| 50 | OOOOMMMGGGG! | Energy blasts |
| 100 | GODLIKE! | Stronger finishers |

The orange fighter attacks a small robot opponent; neither represents the
working/idle state of a real coding session. The scene includes recoil, impact
sparks, pixel lettering, and a shrinking combo timer. It disappears shortly
after typing stops. There is no new sound playback. The football and singer
remain available alongside the typing fight.

Caret position is best effort: Accessibility must expose a focused text element,
an insertion range, and bounds for that range. Editors and terminals vary. If
those values are unavailable, effects appear above the mouse pointer. The fight
moves below the anchor near the top edge and stays inside the current display.
There is no continuous mouse tracking; the pointer is sampled during typing.

The native listener is **passive** and does not consume, change, or synthesize
keystrokes. It reads key codes only to filter typing keys and never stores or
transmits those codes. It does not read characters, field values, selected text,
or clipboard contents. Only bounded event timestamps and the caret/pointer
position pass through the local pipe. Anonymous event times and typing statistics
are saved locally as described below; caret/pointer positions are never saved.
Typing data is never sent over the network.
Caret access reads selection metadata and geometry, not the document's content.
Effects are suppressed while macOS Secure Input is active and when the focused
element identifies itself as a secure text field. The app never bypasses Secure
Input. See Apple's [event-listening API](https://developer.apple.com/documentation/coregraphics/cgpreflightlisteneventaccess())
and [range geometry API](https://developer.apple.com/documentation/applicationservices/kaxboundsforrangeparameterizedattribute).

Use **Disable typing combat** to remove the listener for the current run.
Pause, Hide, menu interaction, switching applications, and monitor changes reset
the combo. macOS Reduce Motion preserves a static fighter/counter without lunges,
sparks, or bouncing labels. The menu shows permission failures; quitting removes
the event tap. Enable/disable and the active visual combo are not saved between runs.
Typing history, combo records and achievements persist across restarts. On the
next launch combat starts automatically only if both permissions are available.

## Typing history and achievements

Open **⚽ → Stats & Achievements…** for lifetime totals, today's activity,
keystrokes by hour, the last 30 calendar days, the ten latest combos, and an
achievement collection with locked/unlocked filters and progress. The window
refreshes once per second while open. Unlocks show a quiet five-second desktop
notification without stealing focus or playing a sound.

History is stored in **`~/Library/Application Support/pets/typing.sqlite`** using
Bun's built-in SQLite driver. The directory is private to your user (0700), and
the database is 0600. SQLite may also create `-wal` and `-shm` files there.
No extra dependency, service or permission is needed beyond typing combat.

- `key_events` stores one row per delivered, valid, monitored key pulse: native
  capture time in Unix milliseconds (including fractional milliseconds), plus
  the local UTC offset at capture. It never stores characters, key codes,
  applications, window titles, caret positions, or clipboard content.
- `combos` stores start/last-hit timestamps and an uncapped hit count. A streak
  qualifies once it reaches **5 accepted combat hits**, counts **once**, and ends
  on a gap **greater than 1.4 seconds** or an existing combat reset. A growing
  qualifying streak is updated in place, preserving its latest committed count
  even if pets stops unexpectedly. Restarting begins a new streak.
- The visual fighter retains its 999-hit display cap. Statistics continue above
  999. Its existing 18 ms hit filter can reject a very fast pulse; that pulse
  still counts as a keystroke in history.
- Indexed minute/day/hour summaries and lifetime totals are updated in the same
  transaction as events and combo records. Charts do not scan every raw event.
  Hour/day grouping uses **local time at capture**, even if the Bun process uses
  a different timezone. Travelling does not rebucket older records. A combo
  crossing midnight belongs to its starting day; keystrokes belong to their
  individual capture days. Active minutes are calendar minutes containing a
  pulse, not a measurement of uninterrupted work. Blank chart days mean **no
  recorded activity**, not proof that you did not type.
- **50 achievements** cover lifetime keystrokes (100–10 million), qualifying
  combos (1–50,000, including **10,000 combos**), longest combo (5–2,500), active
  days, consecutive active days, active minutes, daily records and minute
  records. Unlocks persist once, using stable IDs. Minute records are key counts,
  not words per minute. Badges have no effect on pets or permissions.

History begins with the first observed key; older activity cannot be recovered.
The existing listener boundaries remain: monitoring must be enabled and granted,
held-key repeats and Command/Control shortcuts are excluded, Secure Input and
reported secure fields suppress capture, and Pause/Hide/menu interaction suspend
it. Batches are bounded to 32 pulses and events delayed 500 ms or more are ignored,
so this is an activity record, not a guarantee of every physical key press.

Writes use short, atomic SQLite transactions. A storage failure stops history
recording and displays the error in the football menu and stats window; the pets
continue running. Resolve the disk/access problem and use **Refresh** to reopen
history. Unrecorded events during an error are not backfilled. A newer database
schema is refused without deleting it.

**Reset history…** asks for confirmation, then clears timestamps, summaries,
combos and achievements together and resets the current streak. It cannot be
undone. Deleted records are cleared with SQLite secure-delete and a WAL
checkpoint; filesystem/backup copies are outside this reset. There is no automatic
retention cutoff: individual timestamps remain until you reset history. Run only
one desktop instance at a time to avoid counting the same input more than once.

## Implementation and checks

`src/desktop.ts` reuses `SessionTracker` and `MusicTracker`. It sends sprite
placements and lyric text over the native child's stdin; the child returns
display geometry, typing pulses, and menu choices over stdout. There is no local
server, new network integration, persistent agent-session cache, or screen capture.
Only typing combat uses keyboard monitoring and Accessibility.

`src/desktop-scene.ts` owns the independently testable movement and football.
`desktop/Overlay.swift` owns transparent AppKit panels, sprite drawing, lyric
bubbles, and the native menu. Pixel art and palette values come directly from
the terminal's sprite and music modules. Native frames are coalesced under load;
empty, paused, reduced-motion, and hidden scenes update at a lower rate. Closing
the native process stops the parent; parent EOF or a stalled feed closes the
overlay. Nothing is installed as a login item or service.

`desktop/TypingInput.swift` owns permission checks, the listen-only event tap,
bounded asynchronous caret queries, secure-input suppression, and cleanup.
`src/combat.ts` owns combo timing, attack poses, and bitmap lettering, with no
keyboard/content API access. `desktop/main.swift` is the native entry point. `src/typing-stats.ts` owns SQLite
history and rollups; `src/achievements.ts` owns stable milestone definitions.
`desktop/StatsWindow.swift` owns the native SwiftUI stats window and unlock notices.

```sh
bun test
bun run check
bun run build
bun run build:desktop
```

These commands use fixtures/type checks/compilation and do not launch the app.
The native build is `dist/pets-desktop-overlay`; it is a renderer subprocess,
so launch it through `bun run desktop`, not directly. To start again without
rebuilding, use `bun run src/desktop.ts` after a successful desktop build.

Manual verification (run the app yourself):

1. Start live Claude, Codex, and OpenCode CLI sessions and check that hats/statuses
   match the menu. OpenCode has a charcoal terminal mascot; ordinary TUI sessions
   show unknown activity (see [session detection](README.md#session-detection)).
2. Keep typing/clicking in another app while pets cross it; it should retain focus.
3. With idle sessions, watch a pass across monitors. Check a stacked arrangement,
   a mixed-scale display, and unplug/reconnect if available.
4. Play, pause, seek, and skip in Spotify. Check that the singer and lyric bubble
   follow playback and remain readable near display edges.
5. Try Pause, Hide/Show, Reduce Motion, Spaces, full screen, and Stage Manager.
6. Quit from the menu or Ctrl+C and check that pets and the menu icon disappear.
7. Enable typing combat, type a streak in a supported text field, and check
   callouts at 5, 12, 25, 50, and 100 hits. Pause longer than 1.4 seconds to reset.
8. Try a terminal/editor without caret geometry to check pointer fallback. Check
   display edges, a screen above/left of the main screen, held keys, Command
   shortcuts, app switching, and a secure text field using dummy text only.
9. Disable typing combat and verify that new typing no longer causes effects;
   check reduced motion, denied/revoked permissions, and quit cleanup.

10. Open Stats & Achievements, type a five-hit streak in another app, then verify
    the key and combo totals, achievement progress and a nonactivating unlock notice.
11. Quit/restart and verify that history/unlocks persist without replaying notices;
    test a 1,000+ hit streak and compare its record with the capped visual counter.
12. Check Activity/Achievements, filters, Refresh, keyboard navigation, VoiceOver,
    the narrowest window, scrolling, and Cancel in the reset confirmation. Only
    confirm Reset history if you want to delete the collected test history.
13. Verify Pause/Hide, disabled monitoring and a secure dummy field add no events.
    Check hour/day grouping against the Mac's local time, including a midnight
    boundary when practical.

Live appearance, caret support, input permissions, focus behavior, full-screen
visibility, and Automation dialogs cannot be established by compilation or the
fixture tests.

## Quota alerts

Desktop mode reads the existing CodexBar `widget-snapshot.json` in
`~/Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/` every five seconds.
Keep CodexBar refreshing for current Claude/Codex session and weekly limits.
No credentials, provider requests, or new macOS permissions are involved.
Missing quotas stay absent; snapshots older than 15 minutes are ignored.

The first fresh reading shows the remaining allowance. Subsequent changes show
an 8-bit energy bar, percentage left, and UP/DOWN with the change in percentage
points (one decimal precision). Alerts last five seconds at the top of the
monitor containing the pointer when the change arrives. The native process reads
the pointer position only for these notifications and returns only the display
ID. It does not track pointer movement. Multiple changed quotas stack together.
CodexBar account changes reset comparisons when an owner identifier is supplied.

Pause/Hide dismiss and suppress alerts while continuing to refresh the baseline.
Reduce Motion shows static labels/bars. Current values or unavailable/stale state
also appear in the football menu's status text. Failed reads do not create false
zero-percent or refill alerts. Restarting does not retain quota history.

Manual check: run `bun run desktop`, allow CodexBar to refresh, then check the
initial allowance and subsequent consumption/reset on each pointer monitor.
