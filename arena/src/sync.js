// Keeping every phone's courtyard identical in Play with friends.
//
// The host runs the real game. Each tick it sends every phone the orders it applied for every
// knight (a direction, a fallback direction and "drop a keg": one small number each). The rules
// are deterministic, so each phone replays those orders and gets exactly the host's courtyard.
// A hash every second catches any drift; a full snapshot repairs it, and also lets a phone that
// dropped out mid-round rejoin.
//
// A guest's own knight can't wait for the round trip, so each phone also keeps a forecast: the
// host's latest courtyard plus its own orders the host hasn't applied yet. That's what it draws,
// so its knight answers the stick at once and kegs tick down in step with it.
import { Arena } from './sim.js';

const DIR_LIST = [null, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

export function dirCode(d) {
  if (!d || (!d.x && !d.y)) return 0;
  if (d.x) return d.x < 0 ? 1 : 2;
  return d.y < 0 ? 3 : 4;
}

/** One knight's orders for one tick as a number 0..49. */
export function encodeInput(inp) {
  return dirCode(inp.dir) + 5 * dirCode(inp.alt) + (inp.bomb ? 25 : 0);
}

export function applyInput(p, code) {
  const c = Number.isInteger(code) && code >= 0 && code < 50 ? code : 0;
  p.input.dir = DIR_LIST[c % 5];
  p.input.alt = DIR_LIST[Math.floor(c / 5) % 5];
  p.input.bomb = c >= 25;
}

export const validCode = (c) => Number.isInteger(c) && c >= 0 && c < 50;

// ---------- snapshots ----------
const PLAYER_KEYS = ['x', 'y', 'px', 'py', 'alive', 'diedAt', 'killer', 'kegs', 'range', 'speedLv', 'active', 'moving', 'walk'];
const ARENA_KEYS = ['tick', 'nextBombId', 'startTick', 'hurryTick', 'dropTicks', 'finalIdx', 'dropIdx', 'nextDrop', 'fuseTicks', 'flameTicks', 'endTick', 'final', 'over'];

/** Everything that changes during a round, as plain JSON. */
export function snapshotArena(a) {
  const s = {};
  for (const k of ARENA_KEYS) s[k] = a[k];
  s.result = a.result ? { ...a.result } : null;
  s.tiles = Array.from(a.tiles).join('');
  s.hidden = [...a.hidden];
  s.items = [...a.items];
  s.burning = [...a.burning];
  s.bombs = a.bombs.map((b) => [b.id, b.cell, b.x, b.y, b.owner, b.fuse, b.fuse0, b.range, [...b.passers], b.born]);
  s.flames = [...a.flames].map(([c, f]) => [c, f.ttl, f.owner, f.owners, f.arms, f.born]);
  s.players = a.players.map((p) => {
    const o = {};
    for (const k of PLAYER_KEYS) o[k] = p[k];
    o.face = [p.face.x, p.face.y];
    o.input = encodeInput(p.input);
    o.stats = { ...p.stats };
    return o;
  });
  return s;
}

/** Put a snapshot into an arena built from the same layout. Returns false if it doesn't fit. */
export function restoreArena(a, s) {
  if (!s || typeof s !== 'object' || typeof s.tiles !== 'string' || s.tiles.length !== a.tiles.length) return false;
  if (!Array.isArray(s.players) || s.players.length !== a.players.length) return false;
  for (const k of ARENA_KEYS) if (k in s) a[k] = s[k];
  a.result = s.result ? { ...s.result } : null;
  for (let i = 0; i < a.tiles.length; i++) a.tiles[i] = s.tiles.charCodeAt(i) - 48;
  a.hidden = new Map(s.hidden);
  a.items = new Map(s.items);
  a.burning = new Map(s.burning);
  a.bombs = s.bombs.map(([id, cell, x, y, owner, fuse, fuse0, range, passers, born]) => ({ id, cell, x, y, owner, fuse, fuse0, range, passers: new Set(passers), born }));
  a.flames = new Map(s.flames.map(([c, ttl, owner, owners, arms, born]) => [c, { ttl, owner, owners, arms, born }]));
  s.players.forEach((o, i) => {
    const p = a.players[i];
    for (const k of PLAYER_KEYS) if (k in o) p[k] = o[k];
    p.face = { x: o.face[0], y: o.face[1] };
    applyInput(p, o.input);
    p.stats = { ...p.stats, ...o.stats };
  });
  a.events = [];
  return true;
}

/** A fingerprint of the state that matters, to check two phones still agree. */
export function hashArena(a) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
  };
  mix(a.tick);
  for (let i = 0; i < a.tiles.length; i++) mix(a.tiles[i]);
  for (const p of a.players) {
    mix(Math.round(p.x * 4096));
    mix(Math.round(p.y * 4096));
    mix(p.alive ? 1 : 2);
    mix(p.kegs * 64 + p.range * 8 + p.speedLv);
    mix(p.active);
  }
  for (const b of a.bombs) {
    mix(b.cell);
    mix(b.fuse);
    mix(b.owner);
  }
  for (const [c, k] of a.items) mix(c * 7 + k.length);
  mix(a.flames.size);
  mix(a.dropIdx);
  return h >>> 0;
}

// ---------- the forecast ----------
/**
 * A copy of the courtyard that runs ahead of the host's. Nobody dies in it (only the host decides
 * that); if your own knight is caught, it just stops there until the host's verdict arrives.
 */
export class Forecast extends Arena {
  kill(p) {
    if (p.index === this.me) this.meHit = true;
  }

  checkEnd() { /* the host ends the round */ }
}

/** A fresh forecast starting from the host's courtyard. */
export function forecastFrom(src, me) {
  const a = Object.create(Forecast.prototype);
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === null || typeof v !== 'object') a[k] = v;
  }
  a.spawns = src.spawns; // never change during a round
  a.dropOrder = src.dropOrder;
  a.tiles = src.tiles.slice();
  a.hidden = new Map(src.hidden);
  a.items = new Map(src.items);
  a.burning = new Map(src.burning);
  a.bombs = src.bombs.map((b) => ({ ...b, passers: new Set(b.passers) }));
  a.flames = new Map();
  for (const [c, f] of src.flames) a.flames.set(c, { ...f });
  a.players = src.players.map((p) => ({ ...p, face: { ...p.face }, input: { ...p.input }, stats: { ...p.stats } }));
  a.result = src.result ? { ...src.result } : null;
  a.events = [];
  a.me = me;
  a.meHit = false;
  return a;
}

/** One forecast tick: your orders, everyone else standing still (their real moves come from the host). */
export function stepForecast(f, code) {
  for (const p of f.players) {
    if (p.index === f.me) continue;
    p.input.dir = null;
    p.input.alt = null;
    p.input.bomb = false;
  }
  applyInput(f.players[f.me], f.meHit ? 0 : code);
  f.step();
}
