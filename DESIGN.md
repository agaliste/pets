---
version: alpha
name: Agent Office
description: A terminal pixel office for local coding-agent mascots and a Spotify singer.
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

# Agent Office design

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
