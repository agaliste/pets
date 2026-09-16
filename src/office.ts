// Office layout and furniture rendering. Everything is in canvas pixels.

import { Canvas, mix, type RGB } from "./canvas.ts";
import { CLOCK, COFFEE_MACHINE, COUCH, MASCOT_H, PLANT, WHITEBOARD } from "./sprites.ts";

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export interface Desk {
  id: number;
  x: number; // table top-left
  y: number;
  seat: Pt; // mascot top-left when seated
  labelCol: number; // terminal cell of the name plate
  labelRow: number;
  labelWidth: number;
}

export interface Layout {
  w: number;
  h: number; // canvas pixel height available to the room (status bar excluded)
  wallH: number;
  door: Rect;
  spawn: Pt;
  window: Rect | null;
  clock: Pt | null;
  whiteboard: Pt | null;
  desks: Desk[];
  coffee: { pos: Pt; stand: Pt } | null;
  plant: Pt | null;
  couch: { pos: Pt; seat: Pt } | null;
  disco: Rect | null;
  pitch: Rect | null;
  goalL: Rect | null;
  goalR: Rect | null;
  floor: Rect; // walkable area for wandering
}

export const DESK_W = 20;
export const DESK_H = 7; // top surface (2) + front (3) + legs (2)
const DESK_PITCH_X = 24;
const DESK_PITCH_Y = 20;
const MAX_DESKS = 30;

export interface Drawable {
  depth: number;
  draw: (cv: Canvas) => void;
}

export function computeLayout(w: number, h: number): Layout {
  const wallH = 12;
  const door: Rect = { x: 2, y: 1, w: 8, h: wallH - 1 };
  const spawn: Pt = { x: door.x, y: wallH - MASCOT_H + 2 };

  // Reserve a music corner above a compact pitch. Football players can extend
  // five pixels above the touchline, so leave a six-pixel aisle between them.
  const cornerW = w >= 56 ? Math.min(48, Math.max(36, Math.round(w * 0.34))) : 0;
  // Grow the dance floor when space allows, retaining both areas on short screens.
  const discoH = Math.max(12, Math.min(16, h - 32));
  const disco: Rect | null = cornerW && h >= 28
    ? { x: w - cornerW - 1, y: wallH, w: cornerW, h: discoH }
    : null;
  const pitchTop = disco ? disco.y + disco.h + 6 : wallH + 3;
  const pitchH = Math.min(24, h - pitchTop - 2);
  const pitchW = Math.min(32, Math.max(24, Math.round(w * 0.3) - 8));
  const pitch: Rect | null = cornerW > 0 && pitchH >= 12
    ? { x: w - pitchW - 1, y: h - pitchH - 2, w: pitchW, h: pitchH }
    : null;
  const corner = disco ?? pitch;

  let goalL: Rect | null = null, goalR: Rect | null = null;
  if (pitch) {
    const gy = pitch.y + Math.floor(pitch.h / 2) - 4;
    goalL = { x: pitch.x, y: gy, w: 3, h: 8 };
    goalR = { x: pitch.x + pitch.w - 3, y: gy, w: 3, h: 8 };
  }

  const areaX = 12;
  const areaRight = corner ? corner.x - 4 : w - 2;
  const areaW = Math.max(0, areaRight - areaX);

  // Coffee corner against the wall at the right end of the desk area.
  let coffee: Layout["coffee"] = null;
  let deskAreaRight = areaRight;
  if (areaW >= DESK_PITCH_X + 14) {
    const cx = areaRight - 9;
    coffee = { pos: { x: cx, y: wallH - 4 }, stand: { x: cx - 13, y: wallH - 4 } };
    deskAreaRight = cx - 2;
  }

  const desks: Desk[] = [];
  const cols = Math.floor((deskAreaRight - areaX) / DESK_PITCH_X);
  const rows = Math.max(0, Math.floor((h - wallH - 24) / DESK_PITCH_Y) + 1);
  if (cols > 0 && rows > 0) {
    const x0 = areaX + Math.floor((deskAreaRight - areaX - cols * DESK_PITCH_X) / 2) + 2;
    let id = 0;
    for (let r = 0; r < rows && desks.length < MAX_DESKS; r++) {
      for (let c = 0; c < cols && desks.length < MAX_DESKS; c++) {
        const x = x0 + c * DESK_PITCH_X;
        const y = wallH + 14 + r * DESK_PITCH_Y;
        desks.push({
          id: id++,
          x,
          y,
          seat: { x: x + 1, y: y - 6 },
          labelCol: x + 1,
          labelRow: (y + 2) >> 1,
          labelWidth: DESK_W - 2,
        });
      }
    }
  }

  const window: Rect | null = w >= 40
    ? { x: Math.max(door.x + door.w + 10, Math.floor(w * 0.3)), y: 2, w: 14, h: wallH - 5 }
    : null;
  const clock: Pt | null = window && window.x + window.w + 8 < w - 8
    ? { x: window.x + window.w + 5, y: 3 }
    : null;
  const whiteboard: Pt | null = clock && clock.x + 26 < (pitch ? w : w - 4)
    ? { x: clock.x + 9, y: 2 }
    : null;

  const plant: Pt | null = { x: door.x + door.w + 1, y: wallH - 5 };

  // Couch in the bottom-left strip if there is room below the last desk row.
  const lastDeskBottom = desks.length > 0 ? desks[desks.length - 1]!.y + DESK_H : wallH + 4;
  let couch: Layout["couch"] = null;
  if (h - lastDeskBottom >= 9 && (pitch ? pitch.x : w) > 22) {
    const pos: Pt = { x: 3, y: h - 7 };
    couch = { pos, seat: { x: pos.x + 2, y: pos.y - 4 } };
  }

  const floor: Rect = {
    x: 1,
    y: wallH + 1,
    w: (corner ? corner.x - 2 : w - 2),
    h: h - wallH - 2,
  };

  return { w, h, wallH, door, spawn, window, clock, whiteboard, desks, coffee, plant, couch, disco, pitch, goalL, goalR, floor };
}

const COL = {
  wall: 0x2b2f3a,
  wallTrim: 0x1f222b,
  floorA: 0x3b3f4a,
  floorB: 0x373b46,
  doorFrame: 0x3a2a1a,
  door: 0x6e4b2a,
  knob: 0xe8b923,
  windowFrame: 0xd0d0d0,
  deskTop: 0xa9743f,
  deskFront: 0x7a5230,
  deskLeg: 0x5a3b20,
  keyboard: 0x2a2d35,
  chair: 0x3f4652,
  chairDark: 0x2f353f,
  monitor: 0x3a3f4b,
  monitorEdge: 0x555c6b,
  grass: 0x2f7d3a,
  grassB: 0x2a7033,
  line: 0xe8f0e8,
  net: 0x9fb39f,
  discoBase: 0x202331,
  discoCyan: 0x54c9d4,
  discoPink: 0xcb6ab7,
  discoGold: 0xd5b96d,
};

function drawDisco(cv: Canvas, d: Rect, now: number, playing: boolean): void {
  cv.fillRect(d.x, d.y, d.w, d.h, COL.discoBase);
  cv.strokeRect(d.x, d.y, d.w, d.h, playing ? COL.discoCyan : COL.monitorEdge);
  const colors = [COL.discoCyan, COL.discoPink, COL.discoGold];
  // Softly pulsing floor tiles; the room stays quiet when playback stops.
  for (let row = 0; row < Math.floor((d.h - 5) / 2); row++) {
    for (let col = 0; col < Math.floor((d.w - 2) / 4); col++) {
      const light = playing ? 0.35 + 0.2 * Math.sin(now / 900 + col + row * 2) : 0.08;
      cv.fillRect(d.x + 1 + col * 4, d.y + 5 + row * 2, 3, 1,
        mix(COL.discoBase, colors[(col + row) % colors.length]!, light));
    }
  }
  // A hanging mirror ball, offset left so the performer and microphone stay clear.
  const bx = d.x + 7, by = d.y + 2;
  cv.fillRect(bx + 2, d.y, 1, 2, COL.monitorEdge);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if ((row === 0 || row === 4) && (col === 0 || col === 4)) continue;
      const bright = (col + row + Math.floor(now / 900)) % 3 === 0;
      cv.set(bx + col, by + row, playing && bright ? COL.line : COL.monitorEdge);
    }
  }
  for (const sx of [d.x + 1, d.x + d.w - 4]) {
    const sy = d.y + d.h - 8;
    cv.fillRect(sx, sy, 3, 7, COL.wallTrim);
    cv.set(sx + 1, sy + 1, playing ? COL.discoPink : COL.monitorEdge);
    cv.fillRect(sx + 1, sy + 4, 1, 2, COL.monitorEdge);
  }
}

function skyColor(now: Date): { sky: RGB; moon: boolean } {
  const hr = now.getHours() + now.getMinutes() / 60;
  if (hr >= 7 && hr < 19) return { sky: 0x6fa8dc, moon: false };
  if (hr >= 19 && hr < 21) return { sky: mix(0x6fa8dc, 0x1a1f3a, (hr - 19) / 2), moon: false };
  if (hr >= 5 && hr < 7) return { sky: mix(0x1a1f3a, 0x6fa8dc, (hr - 5) / 2), moon: false };
  return { sky: 0x1a1f3a, moon: true };
}

/** Wall, floor, door, window, pitch: everything nothing can walk behind. */
export function drawBackground(cv: Canvas, L: Layout, now: Date, musicPlaying = false): void {
  cv.fillRect(0, 0, L.w, L.wallH, COL.wall);
  cv.fillRect(0, L.wallH - 1, L.w, 1, COL.wallTrim);
  for (let y = L.wallH; y < L.h; y += 4) {
    for (let x = 0; x < L.w; x += 8) {
      const odd = (((x >> 3) + ((y - L.wallH) >> 2)) & 1) === 1;
      cv.fillRect(x, y, 8, 4, odd ? COL.floorA : COL.floorB);
    }
  }
  cv.fillRect(0, L.h, L.w, cv.h - L.h, 0x14161c);

  // Door
  const d = L.door;
  cv.fillRect(d.x - 1, d.y - 1, d.w + 2, d.h + 1, COL.doorFrame);
  cv.fillRect(d.x, d.y, d.w, d.h, COL.door);
  cv.fillRect(d.x + 1, d.y + 1, d.w - 2, 3, mix(COL.door, 0x000000, 0.2));
  cv.fillRect(d.x + 1, d.y + 5, d.w - 2, 3, mix(COL.door, 0x000000, 0.2));
  cv.set(d.x + d.w - 2, d.y + 5, COL.knob);

  // Window
  if (L.window) {
    const wn = L.window;
    const { sky, moon } = skyColor(now);
    cv.fillRect(wn.x - 1, wn.y - 1, wn.w + 2, wn.h + 2, COL.windowFrame);
    cv.fillRect(wn.x, wn.y, wn.w, wn.h, sky);
    cv.fillRect(wn.x + (wn.w >> 1), wn.y, 1, wn.h, COL.windowFrame);
    cv.fillRect(wn.x, wn.y + (wn.h >> 1), wn.w, 1, COL.windowFrame);
    if (moon) {
      cv.fillRect(wn.x + 2, wn.y + 1, 2, 2, 0xf4f1c1);
      cv.set(wn.x + wn.w - 3, wn.y + 2, 0xf4f1c1);
    } else {
      cv.fillRect(wn.x + 2, wn.y + 1, 3, 1, 0xf7f7f7);
      cv.fillRect(wn.x + 9, wn.y + 4, 4, 1, 0xf7f7f7);
    }
  }
  if (L.clock) cv.blit(CLOCK, L.clock.x, L.clock.y);
  if (L.whiteboard) cv.blit(WHITEBOARD, L.whiteboard.x, L.whiteboard.y);
  if (L.disco) drawDisco(cv, L.disco, now.getTime(), musicPlaying);

  // Football pitch
  if (L.pitch) {
    const p = L.pitch;
    for (let y = 0; y < p.h; y++) {
      cv.fillRect(p.x, p.y + y, p.w, 1, ((y >> 2) & 1) === 0 ? COL.grass : COL.grassB);
    }
    cv.strokeRect(p.x, p.y, p.w, p.h, COL.line);
    const cx = p.x + (p.w >> 1);
    cv.fillRect(cx, p.y, 1, p.h, COL.line);
    const cy = p.y + (p.h >> 1);
    cv.strokeRect(cx - 3, cy - 3, 7, 7, COL.line);
    for (const g of [L.goalL, L.goalR]) {
      if (!g) continue;
      cv.fillRect(g.x, g.y, g.w, g.h, COL.net);
      cv.fillRect(g.x, g.y, g.w, 1, COL.line);
      cv.fillRect(g.x, g.y + g.h - 1, g.w, 1, COL.line);
      const postX = g === L.goalL ? g.x : g.x + g.w - 1;
      cv.fillRect(postX, g.y, 1, g.h, COL.line);
    }
  }
}

export type DeskState = "empty" | "idle" | "working";

/** Props and desks as depth-sorted drawables. */
export function roomDrawables(L: Layout, deskStates: Map<number, DeskState>, tick: number, labels: Map<number, string>): Drawable[] {
  const out: Drawable[] = [];
  for (const dk of L.desks) {
    const state = deskStates.get(dk.id) ?? "empty";
    // Chair back sits behind the mascot.
    out.push({
      depth: dk.y - 1,
      draw: (cv) => {
        cv.fillRect(dk.x + 3, dk.y - 8, 10, 7, COL.chair);
        cv.fillRect(dk.x + 4, dk.y - 9, 8, 1, COL.chair);
        cv.fillRect(dk.x + 4, dk.y - 7, 8, 1, COL.chairDark);
      },
    });
    out.push({
      depth: dk.y + DESK_H,
      draw: (cv) => {
        cv.fillRect(dk.x, dk.y, DESK_W, 2, COL.deskTop);
        cv.fillRect(dk.x, dk.y + 2, DESK_W, 3, COL.deskFront);
        cv.fillRect(dk.x + 1, dk.y + 5, 2, 2, COL.deskLeg);
        cv.fillRect(dk.x + DESK_W - 3, dk.y + 5, 2, 2, COL.deskLeg);
        cv.fillRect(dk.x + 4, dk.y + 1, 6, 1, COL.keyboard);
        // Monitor seen from behind, on the right side of the desk.
        const mx = dk.x + 14, my = dk.y - 5;
        cv.fillRect(mx, my, 5, 5, COL.monitor);
        cv.fillRect(mx + 2, my + 5, 1, 1, COL.monitor);
        cv.fillRect(mx + 1, my + 6, 3, 1, COL.monitorEdge);
        if (state === "working") {
          const glow = (tick >> 2) % 3 === 0 ? 0x7fb2ff : 0x4f86e0;
          cv.fillRect(mx - 1, my, 1, 5, glow);
          cv.fillRect(mx, my - 1, 5, 1, glow);
          cv.fillRect(mx + 5, my, 1, 5, glow);
        } else if (state === "idle") {
          cv.fillRect(mx - 1, my, 1, 5, 0x3d5a8a);
          cv.fillRect(mx + 5, my, 1, 5, 0x3d5a8a);
        }
        const label = labels.get(dk.id);
        if (label !== undefined) {
          const text = label.length > dk.labelWidth ? label.slice(0, dk.labelWidth - 1) + "…" : label;
          const col = dk.labelCol + Math.floor((dk.labelWidth - text.length) / 2);
          cv.putText(col, dk.labelRow, text, 0xf3e4cf, COL.deskFront);
        }
      },
    });
  }
  if (L.coffee) {
    const c = L.coffee.pos;
    out.push({ depth: c.y + 8, draw: (cv) => cv.blit(COFFEE_MACHINE, c.x, c.y) });
  }
  if (L.plant) {
    const p = L.plant;
    out.push({ depth: p.y + 7, draw: (cv) => cv.blit(PLANT, p.x, p.y) });
  }
  if (L.couch) {
    const c = L.couch.pos;
    out.push({ depth: c.y + 6, draw: (cv) => cv.blit(COUCH, c.x, c.y) });
  }
  return out;
}
