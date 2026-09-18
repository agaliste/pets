---
name: testing-desktop-overlay
description: How to set up and drive the pets desktop overlay (Bun + Swift AppKit) end-to-end on macOS, including fake sessions, typing combat, and the achievement toast
---

# Testing the pets desktop overlay on macOS

## Setup

- Bun is not preinstalled: `curl -fsSL https://bun.sh/install | bash`, then add `~/.bun/bin` to PATH.
- `bun install` in the repo, then `bun run build:desktop` (or `bun run desktop` which builds first).
- Launch headless-friendly via `bun run src/desktop.ts` in the background — the native child
  `dist/pets-desktop-overlay` connects to WindowServer even when spawned from a non-GUI shell.
- Log goes to stdout of the bun process; overlay stderr is inherited.

## Making pets render without real agent CLIs

Session detection keys on `ps` command names. A fake Claude session works:
`ln -sf /bin/sleep /tmp/claude && /tmp/claude 3600 &`
This registers as `Claude · devin · unknown · <party cone>` in the ⚽ menu and renders a roaming mascot.
Kill it afterwards (`pkill -f /tmp/claude`).

## Menu bar

- The ⚽ status item is at roughly x≈865, y≈11 in the 1024×768 VM. Synthetic clicks DO open its menu —
  it just takes a couple of tries to land on the small icon.
- Menu contents: status line, session rows, typing combat status + toggle, "Typing history ready ·
  Stats & Achievements…", "Stats & Achievements…", Pause/Hide/Quit.

## Typing combat / achievement toast

- In the test VM, Input Monitoring + Accessibility were ALREADY granted (menu showed "Typing combat
  ready · caret / pointer fallback" on first run). If not, "Enable typing combat…" triggers the TCC
  prompts; toggle in System Settings → Privacy & Security (admin password: devin).
- The listener counts letter/number/space/return keyDown events (no autorepeat, no Cmd/Ctrl).
  `computer` `type` actions count. Keystrokes land in `~/Library/Application Support/pets/typing.sqlite`.
- The toast lives ~5 s and renders at the TOP-RIGHT of the screen containing the pointer
  (x≈800–1010, y≈35–90 at 1024×768). It can be covered by macOS notification banners — dismiss them.
- Screenshot timing matters: take the screenshot immediately after the keystroke that crosses the
  threshold, or the 5 s window expires. Good low thresholds: `keys:100` ("Hello, keyboard"),
  `peakMinute:60` ("Steady hands"), `combos:1`/`bestCombo:5` (first 5-hit streak). Verify unlocks via
  `sqlite3 ~/Library/Application\ Support/pets/typing.sqlite "SELECT id FROM achievements"`.
- The 18 ms combat-hit filter rejects very fast synthetic typing for COMBO metrics — raw key counts
  still record. For combo thresholds, pace keystrokes.

## Quitting

"Quit pets" in the menu or Ctrl+C kills both processes; verify with `pgrep -fl pets-desktop-overlay`.
