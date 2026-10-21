// Map generator. Maps are symmetric so nobody starts with a better position:
// point symmetry for 1 v 1, mirror symmetry in both directions for 3-4 players.
import { MAP_W, MAP_H, START_TROOPS } from './config.js';
import { mulberry32 } from './rng.js';

const LO_X = 0.08;
const HI_X = MAP_W - 0.08;
const LO_Y = 0.08;
const HI_Y = MAP_H - 0.08;
const CX = MAP_W / 2;
const CY = MAP_H / 2;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function neutralTroops(kind, d, rnd) {
  // d: distance to the nearest starting castle. Close holdings are cheap to take, far ones cost more.
  if (kind === 'village') return Math.round(4 + d * 9 + rnd() * 3);
  if (kind === 'town') return Math.round(11 + d * 12 + rnd() * 4);
  return Math.round(32 + d * 10 + rnd() * 6);
}

/** Try to place a point in a region, clear of every existing node and of all its own mirror images. */
function place(rnd, nodes, region, mirrors, minD) {
  for (let i = 0; i < 400; i++) {
    const p = { x: region.x0 + rnd() * (region.x1 - region.x0), y: region.y0 + rnd() * (region.y1 - region.y0) };
    const images = mirrors(p);
    let ok = true;
    for (const q of images) {
      if (q.x < LO_X || q.x > HI_X || q.y < LO_Y || q.y > HI_Y) { ok = false; break; }
      for (const n of nodes) if (dist(q, n) < minD) { ok = false; break; }
      if (!ok) break;
    }
    // Images of one point must not crowd each other either (near the mirror lines).
    for (let a = 0; ok && a < images.length; a++) {
      for (let b = a + 1; b < images.length; b++) if (dist(images[a], images[b]) < minD) { ok = false; break; }
    }
    if (ok) return images;
  }
  return null;
}

function duelMap(rnd) {
  const nodes = [];
  const add = (x, y, kind, owner, troops) => nodes.push({ id: nodes.length, x, y, kind, owner, troops });
  const home = [{ x: CX, y: MAP_H - 0.17 }, { x: CX, y: 0.17 }];
  add(home[0].x, home[0].y, 'castle', 0, START_TROOPS);
  add(home[1].x, home[1].y, 'castle', 1, START_TROOPS);
  add(CX, CY, 'castle', -1, 0);
  const mirrors = (p) => [p, { x: MAP_W - p.x, y: MAP_H - p.y }];
  const kinds = ['village', 'village', 'village', 'town', 'village', 'town'];
  if (rnd() < 0.5) kinds.push('village');
  const region = { x0: LO_X, x1: HI_X, y0: CY + 0.05, y1: HI_Y };
  for (const kind of kinds) {
    const imgs = place(rnd, nodes, region, mirrors, 0.2);
    if (!imgs) return null;
    for (const p of imgs) add(p.x, p.y, kind, -1, 0);
  }
  for (const n of nodes) {
    if (n.owner >= 0) continue;
    const d = Math.min(...home.map((h) => dist(h, n)));
    n.troops = neutralTroops(n.kind, d, rnd);
  }
  // Mirror pairs must hold the same garrison.
  for (const n of nodes) {
    const twin = nodes.find((m) => Math.abs(m.x - (MAP_W - n.x)) < 1e-9 && Math.abs(m.y - (MAP_H - n.y)) < 1e-9);
    if (twin && twin.id > n.id) twin.troops = n.troops;
  }
  return nodes;
}

function cornersMap(rnd, format) {
  const nodes = [];
  const add = (x, y, kind, owner, troops) => nodes.push({ id: nodes.length, x, y, kind, owner, troops });
  const BL = { x: 0.15, y: MAP_H - 0.17 };
  const BR = { x: MAP_W - 0.15, y: MAP_H - 0.17 };
  const TL = { x: 0.15, y: 0.17 };
  const TR = { x: MAP_W - 0.15, y: 0.17 };
  // Teams sit on the same side; in free-for-all your nearest rival is not straight across.
  let corners = format.id === 'teams' ? [BL, BR, TL, TR] : [BL, TR, TL, BR];
  if (format.players === 3) {
    // The empty corner sits nearer one player, so who gets it is left to chance.
    corners = corners.slice();
    for (let i = corners.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
  }
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    add(c.x, c.y, 'castle', i < format.players ? i : -1, i < format.players ? START_TROOPS : 45);
  }
  add(CX, CY, 'castle', -1, 0);
  // Axis holdings, symmetric by construction.
  add(CX, 0.42, 'town', -1, 0);
  add(CX, MAP_H - 0.42, 'town', -1, 0);
  add(0.1, CY, 'village', -1, 0);
  add(MAP_W - 0.1, CY, 'village', -1, 0);
  const mirrors = (p) => [p, { x: MAP_W - p.x, y: p.y }, { x: p.x, y: MAP_H - p.y }, { x: MAP_W - p.x, y: MAP_H - p.y }];
  const region = { x0: LO_X, x1: CX - 0.06, y0: CY + 0.06, y1: HI_Y };
  for (const kind of ['village', 'village', 'town']) {
    const imgs = place(rnd, nodes, region, mirrors, 0.165);
    if (!imgs) return null;
    for (const p of imgs) add(p.x, p.y, kind, -1, 0);
  }
  const homes = corners.slice(0, 4);
  for (const n of nodes) {
    if (n.troops) continue;
    const d = Math.min(...homes.map((h) => dist(h, n)));
    n.troops = neutralTroops(n.kind, d, rnd);
  }
  // Every mirror image gets the same garrison as the first of its group.
  const key = (n) => `${Math.min(n.x, MAP_W - n.x).toFixed(6)},${Math.min(n.y, MAP_H - n.y).toFixed(6)}`;
  const first = new Map();
  for (const n of nodes) {
    if (n.owner >= 0 || homes.some((h) => h.x === n.x && h.y === n.y)) continue;
    const k = key(n);
    if (first.has(k)) n.troops = first.get(k);
    else first.set(k, n.troops);
  }
  return nodes;
}

export function generateMap(format, seed) {
  const rnd = mulberry32(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const nodes = format.players === 2 ? duelMap(rnd) : cornersMap(rnd, format);
    if (nodes) return nodes;
  }
  throw new Error('Could not build a map');
}
