import { describe, expect, test } from "bun:test";
import { contains, desktopAtlas, DesktopScene, onScreen, travel, type Screen } from "./desktop-scene.ts";
import type { MusicView } from "./music.ts";
import type { AgentSession } from "./sessions.ts";

const screens: Screen[] = [
  { id: "left", x: -1000, y: 0, w: 1000, h: 800 },
  { id: "right", x: 0, y: 0, w: 1200, h: 900 },
];
const session = (pid: number, status: AgentSession["status"] = "idle"): AgentSession => ({
  pid, provider: pid % 2 ? "claude" : "codex", sessionId: `test-${pid}`, name: `project-${pid}`,
  cwd: "/fixture", status, startedAt: 1, lastActivity: 1, version: null, title: null, source: "ps",
});
const song: MusicView = {
  track: { id: "spotify:track:test", title: "Example", artist: "Artist", album: "Album", duration: 180, position: 10 },
  position: 10, text: "A line of lyrics", state: "synced",
};
function random(seed = 123) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }; }
function scene() { const value = new DesktopScene(random()); value.setScreens(screens); return value; }
function settle(sim: DesktopScene, sessions: AgentSession[]) {
  let frame = sim.update(sessions, null, 1 / 30);
  for (let i = 0; i < 35; i++) frame = sim.update(sessions, null, 1 / 30);
  return frame;
}

describe("desktop display geometry", () => {
  test("crosses a continuous seam without bouncing", () => {
    const result = travel({ x: -2, y: 400 }, { x: 100, y: 0 }, 0.05, screens);
    expect(result.point).toEqual({ x: 3, y: 400 });
    expect(result.velocity.x).toBe(100);
  });
  test("skips a physical display gap along the travel direction", () => {
    const separated = [screens[0]!, { ...screens[1]!, x: 300 }];
    const result = travel({ x: -2, y: 400 }, { x: 100, y: 0 }, 0.05, separated);
    expect(result.point.x).toBeCloseTo(300.1);
    expect(result.point.y).toBe(400);
  });
  test("crosses vertically stacked screens with negative coordinates", () => {
    const stacked = [{ id: "a", x: 0, y: -900, w: 1200, h: 900 }, screens[1]!];
    expect(travel({ x: 400, y: 2 }, { x: 0, y: -100 }, 0.05, stacked).point.y).toBe(-3);
  });
  test("bounces off outer edges without landing in empty space", () => {
    const result = travel({ x: 1198, y: 450 }, { x: 100, y: 10 }, 0.05, screens);
    expect(result.velocity.x).toBe(-100);
    expect(result.velocity.y).toBe(10);
    expect(screens.some(s => contains(s, result.point))).toBe(true);
  });
  test("clamps to a real display rather than the enclosing desktop rectangle", () => {
    const offset = [screens[0]!, { ...screens[1]!, y: 1000 }];
    expect(offset.some(s => contains(s, onScreen({ x: 500, y: 900 }, offset, 48)))).toBe(true);
  });
});

describe("floating desktop scene", () => {
  test("empty desktop does not invent agents or football players", () => {
    const frame = scene().update([], null, 0.03);
    expect(frame.sprites).toEqual([]);
    expect(frame.status).toContain("Start Claude or Codex");
  });
  test("one mascot per live session; accessories remain stable and sessions leave", () => {
    const sim = scene();
    sim.update([session(1), session(2)], null, 0.03);
    const hat = sim.pets.get(2)!.hat;
    expect(sim.pets.size).toBe(2);
    expect(sim.pets.get(1)!.hat).not.toBe(hat);
    sim.update([session(2)], null, 0.03);
    expect(sim.pets.size).toBe(1);
    expect(sim.pets.get(2)!.hat).toBe(hat);
  });
  test("busy and unknown agents do not play football", () => {
    const frame = settle(scene(), [session(1, "busy"), session(2, "unknown")]);
    expect(frame.sprites.filter(s => s.sprite === "laptop")).toHaveLength(1);
    expect(frame.sprites.some(s => s.sprite === "ball")).toBe(false);
  });
  test("idle-to-working strikes the agent once, follows its head, and clears", () => {
    const sim = scene();
    settle(sim, [session(1)]);
    const frame = sim.update([session(1, "busy")], null, 1 / 30);
    const bolts = frame.sprites.filter(p => p.sprite === "lightning:bolt");
    const bolt = bolts.at(-1)!;
    const body = frame.sprites.find(p => p.sprite === "claude:wave")!;
    expect(bolt).toBeDefined();
    expect(Math.abs(bolt.x + 18 * bolt.scale! - (body.x + 24))).toBeLessThan(1);
    expect(Math.abs(bolt.y + 88 * bolt.scale! - (body.y + 8))).toBeLessThan(1);
    expect(bolts[0]!.y).toBe(screens.find(s => contains(s, sim.pets.get(1)!))!.y);
    expect(frame.sprites.filter(p => p.sprite === "lightning:spark")).toHaveLength(5);
    expect(frame.sprites.filter(p => p.sprite === "work:callout")).toHaveLength(1);
    expect(frame.sessions[0]).toContain("busy");
    expect(sim.hasEffects).toBe(true);
    for (const p of frame.sprites) expect(desktopAtlas()[p.sprite]).toBeDefined();
    let later = frame;
    for (let i = 0; i < 8; i++) later = sim.update([session(1, "busy")], null, 1 / 30);
    expect(later.sprites.some(p => p.sprite === "lightning:bolt")).toBe(false);
    expect(later.sprites.some(p => p.sprite === "lightning:spark")).toBe(true);
    expect(later.sprites.some(p => p.sprite === "work:callout")).toBe(true);
    for (let i = 0; i < 30; i++) later = sim.update([session(1, "busy")], null, 1 / 30);
    expect(later.sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    expect(later.sprites.some(p => p.sprite === "work:callout")).toBe(false);
    expect(sim.hasEffects).toBe(false);
    sim.update([session(1)], null, 1 / 30);
    expect(sim.update([session(1, "busy")], null, 1 / 30).sprites.some(p => p.sprite === "lightning:bolt")).toBe(true);
  });
  test("new busy agents and unknown-to-busy changes do not trigger lightning", () => {
    const sim = scene();
    expect(sim.update([session(1, "busy"), session(2, "unknown")], null, 1 / 30).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    expect(sim.update([session(1, "busy"), session(2, "busy")], null, 1 / 30).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
  });
  test("work callout bounces beside the agent and fits near either display edge", () => {
    const atlas = desktopAtlas(), label = atlas["work:callout"]!;
    for (const screen of screens) for (const edge of [screen.x + 1, screen.x + screen.w - 1]) {
      const sim = scene();
      sim.setScreens([screen]);
      settle(sim, [session(1)]);
      Object.assign(sim.pets.get(1)!, { x: edge, y: screen.y + 20 });
      const first = sim.update([session(1, "busy")], null, 1 / 30).sprites.find(p => p.sprite === "work:callout")!;
      let second = first;
      for (let i = 0; i < 4; i++) second = sim.update([session(1, "busy")], null, 1 / 30).sprites.find(p => p.sprite === "work:callout")!;
      expect(second.scale).toBeGreaterThan(first.scale!);
      for (const p of [first, second]) {
        expect(p.x).toBeGreaterThanOrEqual(screen.x);
        expect(p.y).toBeGreaterThanOrEqual(screen.y);
        expect(p.x + label.rows[0]!.length * 4 * p.scale!).toBeLessThanOrEqual(screen.x + screen.w);
        expect(p.y + label.rows.length * 4 * p.scale!).toBeLessThanOrEqual(screen.y + screen.h);
      }
    }
  });
  test("detects the transition even if the tracker reuses and mutates a session object", () => {
    const sim = scene(), live = session(2);
    settle(sim, [live]);
    live.status = "busy";
    expect(sim.update([live], null, 1 / 30).sprites.some(p => p.sprite === "lightning:bolt")).toBe(true);
    expect(settle(sim, [live]).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
  });
  test("simultaneous returns to work get separate strikes without hitting idle teammates", () => {
    const sim = scene();
    settle(sim, [session(1), session(2), session(3)]);
    const frame = sim.update([session(1, "busy"), session(2, "busy"), session(3)], null, 1 / 30);
    expect(frame.sprites.filter(p => p.sprite === "lightning:bolt" && p.y === 0)).toHaveLength(2);
    expect(frame.sprites.filter(p => p.sprite === "lightning:spark")).toHaveLength(10);
    expect(frame.sessions).toHaveLength(3);
  });
  test("pause/reduced motion and display changes clear strikes without replay", () => {
    const sim = scene();
    settle(sim, [session(1)]);
    expect(sim.update([session(1, "busy")], null, 0.25, true).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    expect(sim.update([session(1, "busy")], null, 1 / 30).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    sim.update([session(1)], null, 1 / 30);
    sim.update([session(1, "busy")], null, 1 / 30);
    sim.setScreens([screens[1]!]);
    expect(sim.update([session(1, "busy")], null, 1 / 30).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
  });
  test("lightning spans only the current monitor from its top to the agent's head", () => {
    const arranged: Screen[] = [
      { id: "upper", x: -1200, y: -1000, w: 1200, h: 1000 },
      { id: "lower", x: -1200, y: 100, w: 1200, h: 900 },
      { id: "right", x: 0, y: 0, w: 1400, h: 1200 },
    ];
    const sim = scene();
    sim.setScreens(arranged);
    settle(sim, [session(1)]);
    for (const display of arranged) {
      sim.update([session(1)], null, 1 / 30);
      Object.assign(sim.pets.get(1)!, {
        x: display.x + display.w / 2, y: display.y + display.h - 100,
        target: { x: display.x + display.w / 2 + 50, y: display.y + display.h - 100 },
      });
      const frame = sim.update([session(1, "busy")], null, 1 / 30);
      const bolts = frame.sprites.filter(p => p.sprite === "lightning:bolt");
      const body = frame.sprites.find(p => p.sprite === "claude:wave")!;
      expect(bolts.length).toBeGreaterThan(1);
      expect(bolts[0]!.y).toBe(display.y);
      const last = bolts.at(-1)!;
      expect(Math.abs(last.y + 88 * last.scale! - (body.y + 8))).toBeLessThan(1);
      for (let i = 0; i < bolts.length; i++) {
        const p = bolts[i]!;
        expect(p.x).toBeGreaterThanOrEqual(display.x);
        expect(p.x + 36 * p.scale!).toBeLessThanOrEqual(display.x + display.w);
        expect(p.y).toBeGreaterThanOrEqual(display.y);
        expect(p.y + 88 * p.scale!).toBeLessThanOrEqual(display.y + display.h);
        if (i) expect(p.y).toBeCloseTo(bolts[i - 1]!.y + 88 * bolts[i - 1]!.scale!, 8);
      }
    }
  });
  test("departing or returning idle cancels a strike", () => {
    const sim = scene();
    settle(sim, [session(1)]);
    sim.update([session(1, "busy")], null, 1 / 30);
    expect(sim.update([session(1)], null, 1 / 30).sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    sim.update([session(1, "busy")], null, 1 / 30);
    const frame = sim.update([], null, 1 / 30);
    expect(frame.sprites.some(p => p.sprite.startsWith("lightning:"))).toBe(false);
    expect(frame.sprites.some(p => p.sprite.startsWith("airstrike:missile:"))).toBe(true);
  });
  test("a departed session explodes once at its last rendered position, then clears", () => {
    const sim = scene();
    const before = settle(sim, [session(1)]);
    const body = before.sprites.find(s => s.sprite.startsWith("claude:"))!;
    const after = sim.update([], null, 1 / 30);
    expect(after.sprites.some(s => s.sprite.startsWith("airstrike:missile:"))).toBe(true);
    expect(after.sprites.some(s => s.sprite === "explosion:burst")).toBe(false);
    expect(after.sprites.find(s => s.sprite.startsWith("claude:"))).toEqual(body);
    let impact = after;
    for (let i = 0; i < 22; i++) impact = sim.update([], null, 1 / 30);
    const burst = impact.sprites.find(s => s.sprite === "explosion:burst")!;
    expect(sim.pets.size).toBe(0);
    expect(after.sessions).toEqual([]);
    expect(sim.hasEffects).toBe(true);
    expect(impact.sprites.some(s => s.sprite.startsWith("claude:"))).toBe(false);
    expect(Math.abs(burst.x + 18 * burst.scale! - (body.x + 24))).toBeLessThan(1);
    expect(Math.abs(burst.y + 18 * burst.scale! - (body.y + 16))).toBeLessThan(1);
    let frame = impact;
    for (let i = 0; i < 6; i++) frame = sim.update([], null, 1 / 30);
    expect(frame.sprites.some(s => s.sprite === "explosion:ring")).toBe(true);
    expect(frame.sprites.filter(s => s.sprite === "explosion:claude")).toHaveLength(8);
    for (let i = 0; i < 6; i++) frame = sim.update([], null, 1 / 30);
    expect(frame.sprites.some(s => s.sprite === "explosion:smoke")).toBe(true);
    for (const item of frame.sprites) expect(desktopAtlas()[item.sprite]).toBeDefined();
    for (let i = 0; i < 30; i++) frame = sim.update([], null, 1 / 30);
    expect(frame.sprites).toEqual([]);
    expect(sim.hasEffects).toBe(false);
  });
  test("missiles enter from each monitor border and approach the target before impact", () => {
    const directions = new Set<string>();
    for (let pid = 1; pid <= 20; pid++) {
      const sim = scene();
      const screen = { id: "upper", x: -1400, y: -1000, w: 1000, h: 800 };
      sim.setScreens([screen]);
      const before = settle(sim, [session(pid)]);
      const body = before.sprites.find(p => /^(claude|codex):/.test(p.sprite))!;
      const target = { x: body.x + 24, y: body.y + 16 };
      let frame = sim.update([], null, 1 / 30);
      const first = frame.sprites.find(p => p.sprite.startsWith("airstrike:missile:"))!;
      directions.add(first.sprite);
      const start = { x: first.x + 26, y: first.y + 26 };
      expect(start.x === screen.x || start.x === screen.x + screen.w || start.y === screen.y || start.y === screen.y + screen.h).toBe(true);
      for (let i = 0; i < 12; i++) frame = sim.update([], null, 1 / 30);
      const next = frame.sprites.find(p => p.sprite.startsWith("airstrike:missile:"))!;
      expect(Math.hypot(next.x + 26 - target.x, next.y + 26 - target.y)).toBeLessThan(Math.hypot(start.x - target.x, start.y - target.y));
      expect(frame.sprites.some(p => p.sprite === "explosion:burst")).toBe(false);
      for (const item of frame.sprites) expect(desktopAtlas()[item.sprite]).toBeDefined();
      for (let i = 0; i < 16; i++) frame = sim.update([], null, 1 / 30);
      expect(frame.sprites.some(p => p.sprite === "airstrike:cloud")).toBe(true);
      expect(frame.sprites.some(p => p.sprite.startsWith("airstrike:missile:"))).toBe(false);
      sim.setScreens([screen]);
      expect(sim.update([], null, 1 / 30).sprites).toEqual([]);
    }
    expect(directions.size).toBe(4);
  });
  test("simultaneous exits get independent provider-colored bursts", () => {
    const sim = scene();
    sim.update([session(1), session(2), session(3)], null, 1 / 30);
    let frame = sim.update([session(3)], null, 1 / 30);
    expect(frame.sprites.filter(s => s.sprite.startsWith("airstrike:missile:"))).toHaveLength(2);
    for (let i = 0; i < 22; i++) frame = sim.update([session(3)], null, 1 / 30);
    expect(frame.sprites.filter(s => s.sprite === "explosion:burst")).toHaveLength(2);
    expect(frame.sprites.filter(s => s.sprite === "explosion:claude")).toHaveLength(8);
    expect(frame.sprites.filter(s => s.sprite === "explosion:codex")).toHaveLength(8);
    expect(frame.sessions).toHaveLength(1);
  });
  test("monitor changes and status changes do not explode a live agent", () => {
    const sim = scene();
    sim.update([session(1)], null, 1 / 30);
    sim.setScreens([screens[1]!]);
    const frame = sim.update([session(1, "busy")], null, 1 / 30);
    expect(frame.sprites.some(s => s.sprite.startsWith("explosion:"))).toBe(false);
    expect(frame.sprites.some(s => s.sprite === "lightning:bolt")).toBe(true);
  });
  test("paused, hidden and reduced-motion exits do not accumulate delayed explosions", () => {
    const sim = scene();
    sim.update([session(1)], null, 1 / 30);
    expect(sim.update([], null, 0.25, true).sprites).toEqual([]);
    expect(sim.update([], null, 1 / 30).sprites).toEqual([]);
    sim.update([session(2)], null, 1 / 30);
    sim.update([], null, 1 / 30);
    expect(sim.hasEffects).toBe(true);
    sim.update([], null, 0.25, true);
    expect(sim.hasEffects).toBe(false);
  });
  test("an idle player kicks toward a teammate on another monitor", () => {
    const sim = scene();
    settle(sim, [session(1), session(2)]);
    Object.assign(sim.pets.get(1)!, { x: -60, y: 400 });
    Object.assign(sim.pets.get(2)!, { x: 800, y: 400 });
    Object.assign(sim.ball, { x: -40, y: 400, velocity: { x: 0, y: 0 } });
    const frame = sim.update([session(1), session(2)], null, 0.03);
    expect(frame.sprites.some(s => s.sprite.endsWith(":kick"))).toBe(true);
    expect(sim.ball.velocity.x).toBeGreaterThan(300);
    for (let i = 0; i < 15; i++) sim.update([session(1), session(2)], null, 1 / 30);
    expect(sim.ball.x).toBeGreaterThan(0);
  });
  test("new agents emerge from a wormhole with their hats before joining the scene", () => {
    const sim = scene();
    let frame = sim.update([session(1, "busy")], null, 1 / 30);
    const start = { x: sim.pets.get(1)!.x, y: sim.pets.get(1)!.y };
    expect(frame.sessions).toHaveLength(1);
    expect(frame.sprites.some(p => p.sprite.startsWith("portal:vortex"))).toBe(true);
    expect(frame.sprites.some(p => p.sprite.startsWith("claude:"))).toBe(false);
    expect(sim.hasEffects).toBe(true);
    for (let i = 0; i < 10; i++) frame = sim.update([session(1, "busy")], null, 1 / 30);
    const body = frame.sprites.find(p => p.sprite === "claude:wave")!;
    const hat = frame.sprites.find(p => p.sprite.startsWith("hat:"))!;
    expect(body.scale).toBeGreaterThan(0);
    expect(body.scale).toBeLessThan(1);
    expect(hat.scale).toBe(body.scale);
    expect(sim.pets.get(1)!.x).toBe(start.x);
    expect(sim.pets.get(1)!.y).toBe(start.y);
    for (const p of frame.sprites) expect(desktopAtlas()[p.sprite]).toBeDefined();
    frame = settle(sim, [session(1, "busy")]);
    expect(frame.sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
    expect(frame.sprites.find(p => p.sprite.startsWith("claude:"))?.scale).toBe(1);
    expect(sim.hasEffects).toBe(false);
  });
  test("simultaneous arrivals get separate portals that never replay on status updates", () => {
    const sim = scene();
    const frame = sim.update([session(1), session(2)], null, 1 / 30);
    expect(frame.sprites.filter(p => p.sprite.startsWith("portal:vortex"))).toHaveLength(2);
    expect(frame.sprites.some(p => p.sprite === "ball")).toBe(false);
    settle(sim, [session(1), session(2)]);
    const next = sim.update([session(1, "busy"), session(2, "unknown")], null, 1 / 30);
    expect(next.sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
  });
  test("exit during arrival removes the portal and produces only the exit effect", () => {
    const sim = scene();
    sim.update([session(2)], null, 1 / 30);
    const frame = sim.update([], null, 1 / 30);
    expect(frame.sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
    expect(frame.sprites.some(p => p.sprite.startsWith("airstrike:missile:"))).toBe(true);
  });
  test("pause/reduced motion and display changes reveal arrivals without delayed portals", () => {
    const sim = scene();
    sim.update([session(1)], null, 1 / 30);
    const paused = sim.update([session(1), session(2)], null, 0.25, true);
    expect(paused.sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
    expect(paused.sprites.filter(p => /^(claude|codex):/.test(p.sprite))).toHaveLength(2);
    expect(sim.hasEffects).toBe(false);
    expect(sim.update([session(1), session(2)], null, 1 / 30).sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
    sim.update([session(1), session(2), session(3)], null, 1 / 30);
    sim.setScreens([screens[1]!]);
    expect(sim.update([session(1), session(2), session(3)], null, 1 / 30).sprites.some(p => p.sprite.startsWith("portal:"))).toBe(false);
  });
  test("pause and reduced motion freeze physics and animation while metadata updates", () => {
    const sim = scene();
    sim.update([session(1)], song, 0.03, true);
    const before = sim.update([session(1)], song, 0.03, true);
    const next = sim.update([{ ...session(1), name: "renamed" }], song, 9, true);
    expect(next.sprites).toEqual(before.sprites);
    expect(next.bubbles).toEqual(before.bubbles);
    expect(next.sessions[0]).toContain("renamed");
  });
  test("singer follows playback, labels unsynced lyrics, and never counts as an agent", () => {
    const sim = scene();
    const frame = sim.update([], { ...song, state: "plain" }, 0.03);
    expect(frame.sessions).toHaveLength(0);
    expect(frame.sprites.some(s => s.sprite === "microphone")).toBe(true);
    expect(frame.bubbles[0]!.title).toContain("unsynced");
    expect(sim.update([], null, 0.03).sprites).toEqual([]);
  });
  test("long lyrics page through at most two lines and sanitize controls", () => {
    const sim = scene();
    const music = { ...song, text: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "), track: { ...song.track, title: "Title\x1b[31m\nInjected" } };
    const first = sim.update([], music, 0.03);
    for (let i = 0; i < 130; i++) sim.update([], music, 1 / 30);
    const frame = sim.update([], music, 0.03);
    expect(first.bubbles[0]!.lines.length).toBeLessThanOrEqual(2);
    expect(frame.bubbles[0]!.lines).not.toEqual(first.bubbles[0]!.lines);
    expect(frame.bubbles[0]!.title).not.toContain("\x1b");
    expect(frame.bubbles[0]!.title).not.toContain("\n");
  });
  test("paused movement still lets long lyrics page and new songs reset the page", () => {
    const sim = scene();
    const music = { ...song, text: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") };
    const first = sim.update([], music, 0.25, true);
    for (let i = 0; i < 18; i++) sim.update([], music, 0.25, true);
    const next = sim.update([], music, 0.25, true);
    expect(next.sprites).toEqual(first.sprites);
    expect(next.bubbles[0]!.lines).not.toEqual(first.bubbles[0]!.lines);
    const changed = sim.update([], { ...music, track: { ...music.track, id: "spotify:track:new" } }, 0.25, true);
    expect(changed.bubbles[0]!.lines).toEqual(first.bubbles[0]!.lines);
  });
  test("monitor unplug moves all actors and their destinations onto remaining screens", () => {
    const sim = scene();
    sim.update([session(1), session(2)], song, 0.03);
    const single = [screens[1]!];
    sim.setScreens(single);
    expect(contains(single[0]!, sim.ball)).toBe(true);
    for (const pet of sim.pets.values()) {
      expect(contains(single[0]!, pet)).toBe(true);
      expect(contains(single[0]!, pet.target)).toBe(true);
    }
    const frame = sim.update([session(1)], song, 0.03);
    expect(frame.bubbles[0]!.screen).toBe("right");
  });
  test("long simulation stays visible and the singer visits both displays", () => {
    const sim = scene(), visited = new Set<string>(), atlas = desktopAtlas();
    for (let i = 0; i < 9000; i++) {
      const frame = sim.update([session(1), session(2), session(3, "busy")], song, 1 / 30);
      visited.add(frame.bubbles[0]!.screen);
      expect(screens.some(s => contains(s, sim.ball))).toBe(true);
      for (const pet of sim.pets.values()) expect(screens.some(s => contains(s, pet))).toBe(true);
      for (const item of frame.sprites) expect(atlas[item.sprite]).toBeDefined();
    }
    expect(visited.size).toBe(2);
  });
  test("no screens safely clears the frame until displays return", () => {
    const sim = scene();
    sim.setScreens([]);
    expect(sim.update([session(1)], song, 0.03).sprites).toEqual([]);
    sim.setScreens(screens);
    expect(sim.update([session(1)], song, 0.03).sessions).toHaveLength(1);
  });
});
