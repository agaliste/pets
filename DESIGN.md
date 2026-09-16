---
version: alpha
name: pets
description: A terminal pixel office and optional floating desktop mode for local coding-agent mascots and a Spotify singer.
colors:
  background: "#14161c"
  text: "#f3e4cf"
  accent: "#7fb2ff"
  muted: "#9aa0a6"
typography:
  mono:
    fontFamily: "monospace"
omitted:
  - section: spacing
    reason: Layout uses terminal cells and half-block pixels, not CSS lengths.
  - section: rounded
    reason: Bubble corners are box-drawing characters.
  - section: components
    reason: Runtime ownership is documented in the Components section.
---

# pets design

## Overview

A small animated pixel office viewed in a Mac terminal while coding. Preserve
the existing orange Claude and white Codex sprites, furniture and football game.
The singer adds a microphone and lyric bubble to the same room. The audience is
the local developer; copy is English and song text retains its original language.
This is a terminal tool with no web routes or forms. No market-specific rules apply.

## Colors

Existing runtime values remain canonical. The colors above mirror
`MUSIC_COLORS` in `src/singer.ts`, consumed by the singer and shared
speech bubbles. They reuse the office's dark status-bar background, cream labels,
blue monitor accent and silver details. Status labels communicate meaning in text.

## Typography

Use the user's terminal font. `Canvas.putText` owns grapheme segmentation, terminal
cell width and control-character removal. `wrapBubble` wraps words and long tokens
by terminal width; the shared renderer clips without splitting a grapheme.

## Layout

`computeLayout` remains the owner of room geometry. Keep two status rows clear.
The singer walks from the door toward the right side of the room; lyric bubbles
sit above a disco corner with a mirror ball, speakers and softly pulsing tiles.
The disco lights dim when playback stops. A smaller football pitch sits below
the disco with an aisle wide enough to keep football players off the stage.
The disco expands to 48 columns by 16 half-block pixels when space allows,
keeping a shorter dance floor on small terminals so the pitch still fits.
`COL.discoBase`, `COL.discoCyan`, `COL.discoPink` and `COL.discoGold` in
`src/office.ts` own the stage palette; `drawDisco` is its only renderer.
Lyric bubbles
are bounded to the viewport. The singer hides below 24 columns or 16 terminal rows.
Keep the lyric area to two content lines; longer text pages rather than covering
the whole room. The bubble header identifies the artist and song; there is no
separate caption below the singer.

## Elevation & Depth

The existing room remains depth sorted. Music is an overlay above the room and
below the status bar. Suppress audience bubbles that collide with the lyric bubble.

## Shapes

Retain half-block pixel sprites. Bubbles use one-cell box-drawing borders, a short
tail and a dark fill; the microphone uses the same pixel scale as the mascots.

## Components

`Canvas` owns text and pixel output. `drawBubble` in `src/singer.ts` is the shared
primitive for lyric and ad-lib bubbles. `Singer` owns only decorative animation;
real agent counts, selection and activities remain owned by `Sim` and `App`.
`MusicTracker` owns playback/lyrics state independently of the frame loop.

Show loading, synced, unsynced, missing, instrumental and unavailable states in
the bubble. AppleScript failures use the existing status bar. Pause/stop hides
music. Motion follows the existing office animation style; no new controls steal
keyboard focus. Existing Tab/arrow selection and quit controls remain unchanged.
No reduced-motion setting currently exists; this feature does not claim one.

## Do's and Don'ts

- Keep synced text tied to measured playback position.
- Label plain lyrics as unsynced and preserve room status information.
- Use short, occasional ad-libs; never invoke the real agents for decoration.
- Do not introduce web UI conventions or change the office's established palette.

Verification is static and through mocked unit/component tests. The user prohibits
launching apps for testing; live terminal appearance and macOS Automation remain
manual checks.

## Desktop mode

The approved additional desktop mode removes the room boundary: the same pixel
characters float over the user's desktop, pass a football across monitors, and
accompany Spotify with a roaming singer. The terminal office remains a separate,
unchanged mode. Keep the desktop transparent, with no dashboard or permanent
status bar covering the user's work.

Football kicks have randomized, original anime-style special-shot effects:
METEOR DRIVE! (flames), THUNDER STRIKE! (electric arcs), and CYCLONE SHOT!
(spiraling wind), with a launch shockwave and outlined bitmap name. Avoid
immediately repeating a style. `FootballEffects` in `src/football-effects.ts`
owns the bounded 0.95-second effect and at most 12 recent ball samples, using a
separate random stream so decoration cannot change movement or pass physics.
Render the ball over its aura/trail, follow actual bounces, and clear trail samples
on screen-gap jumps. No sound, camera shake, or screen-wide flash. Pause, Hide,
Reduce Motion, display changes, and the kicker leaving idle clear the effect.

New CLI sessions materialize through a one-second blue-and-cyan pixel wormhole.
An opening vortex and orbiting sparks sit behind the mascot as it scales into
view with its hat and accessory, then the portal closes. `DesktopScene` owns
arrival timing and atlas assets using `MUSIC_COLORS` and `CODEX_PALETTE`.
Arriving agents are already listed in the menu but begin movement/football only
after the entrance completes. Pause, Hide, Reduce Motion, and display changes
reveal agents immediately without replaying their entrance. An agent exiting
during arrival loses its portal and uses the existing departure explosion.

A departed CLI session leaves a brief pixel explosion at the mascot's last
position: an expanding warm burst, fragments in its provider's body color, and
small smoke puffs that shrink away within 0.85 seconds. `DesktopScene` owns the
effect lifecycle and atlas using the existing mascot/music palettes. Crossing a
display edge or changing status never triggers it. Pause, Hide, Reduce Motion,
and display reconfiguration clear effects without replaying them later.

An existing agent transitioning from idle to busy receives a short pixel lightning
strike from its current monitor's top edge to its head, a raised-arm reaction,
and outward electric sparks. Tile connected zigzag segments with square pixels
instead of stretching one sprite; use that display's origin, not the global
desktop top, including when the agent moves between vertically arranged monitors.
Use up to 2.5× sprite scale for the thick bolt and larger, wider-spreading impact
sparks; the segment count fits the available height without extending past the head.
The paired WORK! bitmap callout pops beside the agent, bounces, and shrinks
away over 1.15 seconds. It switches sides and clamps to the monitor bounds.
`src/pixel-font.ts` owns the shared 5x7 alphabet for combat and work callouts;
the callout uses the existing cream text with a dark pixel outline.
`DesktopScene` snapshots the previous status independently of tracker objects and
owns the 0.55-second lifecycle. Only idle-to-busy triggers it; initial discovery,
unknown-to-busy, and repeated busy polls do not. Existing music accent/text colors
own the bolt palette. Keep it local to the mascot with no screen-wide flash or
sound. Pause, Hide, Reduce Motion, departure, and display changes clear the effect.

`src/sprites.ts` remains the canonical sprite/palette owner; `desktopAtlas` in
`src/desktop-scene.ts` exports those assets to the native renderer at four macOS
points per pixel. `MUSIC_COLORS` in `src/singer.ts` owns bubble and music colors
for both modes. `src/desktop.ts` sends these values to `Overlay.swift`; Swift
does not maintain an independent palette. Desktop lyric text uses the system
monospaced font at 13 points; its song header uses the system font at 11 points.
The native menu keeps macOS typography, accessibility, and keyboard navigation.

`DesktopScene` owns free-flight animation and agent identity without changing
real session status. Idle agents play; busy agents carry a small laptop; unknown
status never implies idle. `MusicTracker` owns real lyric timing in both modes.
The desktop shares `wrapBubble` for grapheme-safe two-line lyric pagination, with
native bubbles constrained to the singer's current screen. Screen gaps are
skipped, display removal relocates actors, and mirrored displays are deduplicated.

`PetView` is the single native sprite/bubble renderer. Its panels are decorative,
nonactivating, and click-through; a native menu-bar menu owns pause, hide/show,
quit, session summaries, and error/empty states. There are no global hotkeys.
Pause and macOS Reduce Motion stop decorative motion while
song/session information stays current. See [DESKTOP.md](DESKTOP.md) for startup,
runtime boundaries, and the manual verification matrix.

### Typing combat

The approved typing interaction uses passive keyboard timing and Accessibility
caret geometry, with mouse-pointer fallback. Its privacy boundary is explicit:
no key text/codes, field values, document content, clipboard, or network
transmission. The approved typing history persists only anonymous event times,
local UTC offsets, combo records, summaries, and achievement unlocks. The menu owns enable/disable and permission
status. Secure Input is respected; reported secure text fields suppress effects.
The native hook never changes or swallows input, and caret queries run off the
main thread with bounded timeouts.

The signature is a miniature arcade fight immediately above the insertion point:
an orange fighter chains jabs, kicks, uppercuts, spinning strikes, and energy
blasts against a robot opponent. This is decorative and independent of real
coding-session state. A short hit counter and dotted combo timer sit below the
fighters; transient bitmap callouts climb from COMBO! to ON FIRE!, RAMPAGE!,
OOOOMMMGGGG!, and GODLIKE! The whole scene disappears after a typing pause, moves
below the anchor at the upper display edge, and never steals focus.

`src/combat.ts` owns original combat sprite poses, combo
thresholds, placement, and reduced-motion rendering. Its palette adapts existing
`C`, `MASCOT_PALETTE`, `CODEX_PALETTE`, and `MUSIC_COLORS`; it is exported through
the same atlas and drawn by `PetView.drawSprites` above pets and lyric bubbles.
`TypingInput.swift` owns capture/geometry; `TypingCombat` receives only time and
position. Reduced Motion keeps static figures and counters without strike motion,
sparks, or label bounce. Pause, Hide, menu interaction, app switching, and display
changes clear effects. No sounds or screen-wide flashes are added.

### Quota alerts

`src/quota.ts` owns the local CodexBar snapshot adapter, percentage comparisons,
and transient desktop quota renderer. Reuse `pixelLabel` and the existing sprite
renderer; do not add a second text/drawing system. Stack up to four compact alerts
below the monitor's top edge, selecting the pointer's display on notification.
Each carries provider, session/weekly window, percentage remaining, explicit
UP/DOWN and signed percentage-point change, plus a discrete energy bar. Cream
is the initial reading, teal an increase, and amber consumption. Meaning never
relies on color alone. Use a short pixel bounce and directional sparks; Reduce
Motion removes both. Pause/Hide suppress alerts, and unknown/missing/stale quotas
never become zero. The native menu retains the latest status after alerts expire.
The snapshot is the only usage integration; no credentials or quota history are
written, and no direct provider API is contacted.

### Typing stats and achievements

The approved history lives in local SQLite, with one timestamp per monitored key
and one record per qualifying streak (at least five hits). Keep the desktop
unobstructed: **Stats & Achievements…** opens a separate, user-activated native
window from the football menu. Its signature is a small keyboard arcade record
book: a monospaced score grid, a 24-hour rhythm strip and a persistent trophy
collection. Reuse the existing background, cream text, muted labels and blue
accent; no new palette, remote fonts, web server or web routes.

`MUSIC_COLORS` → setup pipe → `StatsModel.colors` owns the SwiftUI color adapter.
System typography handles prose and native controls; system monospaced typography
handles scores, hour labels and the arcade caption. `StatsWindowController` owns
window lifecycle and nonactivating, static five-second unlock notices. SwiftUI
owns buttons, segmented tabs, native picker menus, keyboard focus, scrollbars,
progress semantics and the reset alert. Existing `Overlay` owns the entry menu
and private pipe. `StatsView` owns the bounded 30-day chart, 24-hour chart,
ten-combo list and finite 50-item achievement collection; numeric chart values
are available through accessibility labels and help. Color is not the only way
to distinguish a locked badge from an unlocked one.

Activity and Achievements share one vertical content scroller and retain tab /
filter selection within the window session. The day chart has horizontal scroll
ownership. The window resizes to a 590×480-point minimum. Header/actions stay in
place while history loads, with an inline progress indicator. Empty states
explain how to begin collecting history. Failures name the storage problem and
keep Refresh available. Confirmation names all reset data, warns that it cannot
be undone, and defaults to Cancel; no success is shown before the database reply.
UI copy is English; capture-time local offsets define historical hour/day bins,
while native date formatting presents record timestamps in the Mac's timezone.
The achievement list remains the durable record after transient notices expire.

`src/typing-stats.test.ts` verifies records, rollups, unlock persistence, reset and
failure rollback with isolated databases. TypeScript checks and native compilation
verify integration statically. The user's no-app-launch rule leaves visual,
VoiceOver, focus and permission verification to the manual checks in DESKTOP.md.
