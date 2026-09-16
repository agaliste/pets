# pets

A terminal office with one mascot per running Claude Code or Codex CLI session.
Claude has an orange mascot; Codex has a white robot. Both wear hats, work at
desks, and take breaks in the same room. Each also gets sunglasses, round glasses,
a neon visor, an eye patch, a bow tie, or a striped scarf. Accessories stay with
their mascot and are distributed across sessions before repeating.

```sh
bun install
bun start
```

Use Tab or the arrow keys to select a mascot and see its provider, project,
session title, status, and PID. Press `q` to quit.

## Session detection

- `ps` determines which CLI processes are alive. Codex Node launchers are
  deduplicated against their native child. Maintenance commands, helpers, and
  desktop/app-server processes are excluded.
- Claude retains its existing session registry and transcript detection.
- Codex uses `lsof` to find the transcript held open by each process. Sessions
  in the same directory stay separate. Custom Codex homes work because paths
  come from the process's open files.
- Codex reads bounded transcript head/tail chunks for metadata and turn events.
  Turn start means working; completion or interruption means idle. Activity
  events provide a fallback when a long turn's start is outside the tail.
  Titles come from the local `session_index.jsonl` tail when available.
- Missing, unreadable, or ambiguous Codex transcripts leave the live mascot
  visible with unknown status. Historical transcripts alone never create mascots.

Detection is read-only and requires no hooks or Codex configuration changes.
Codex rollout files are an internal format; unrecognized metadata may result
in unknown status. Desktop/app-server conversations are outside this tool's scope.

## Checks and build

```sh
bun test
bun run check
bun run build
```

Tests use temporary fixtures and mocked process/file listings. They do not launch
the office or either coding CLI. The build produces `dist/pets`.
