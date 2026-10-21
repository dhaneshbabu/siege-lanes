// Courtyard generator. Pillars on a fixed grid, crates scattered with mirror symmetry in both
// directions so every corner gets the same layout, and the corners themselves kept clear.
import { SIZE, FLOOR, PILLAR, CRATE, CRATE_FILL, POWER_SHARE, POWER_MIX } from './config.js';
import { mulberry32 } from './rng.js';

function pickPower(rnd) {
  let r = rnd();
  for (const [kind, share] of POWER_MIX) {
    if (r < share) return kind;
    r -= share;
  }
  return POWER_MIX[0][0];
}

/** Spawn corners in seat order: you are always bottom left. */
function corners(n, format, rnd) {
  const BL = { x: 0, y: n - 1 };
  const BR = { x: n - 1, y: n - 1 };
  const TL = { x: 0, y: 0 };
  const TR = { x: n - 1, y: 0 };
  if (format.id === 'duel') return [BL, TR];
  if (format.id === 'teams') return [BL, BR, TL, TR];
  if (format.id === 'four') return [BL, TR, TL, BR];
  // Three players: you bottom left, the other two in two of the three remaining corners.
  const rest = [TR, TL, BR];
  const skip = Math.floor(rnd() * 3);
  return [BL, ...rest.filter((_, i) => i !== skip)];
}

/**
 * Returns { n, tiles: Uint8Array(n*n), hidden: Map(cell -> power), spawns: [{x, y}] }.
 */
export function generateArena(format, seed) {
  const rnd = mulberry32(seed);
  const n = SIZE[format.id];
  const tiles = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (x % 2 === 1 && y % 2 === 1) tiles[y * n + x] = PILLAR;
  }
  // Every corner keeps itself and its two neighbours clear, so nobody is boxed in at the start.
  const clear = new Set();
  for (const c of [{ x: 0, y: 0 }, { x: n - 1, y: 0 }, { x: 0, y: n - 1 }, { x: n - 1, y: n - 1 }]) {
    clear.add(c.y * n + c.x);
    const sx = c.x === 0 ? 1 : -1;
    const sy = c.y === 0 ? 1 : -1;
    clear.add(c.y * n + (c.x + sx));
    clear.add((c.y + sy) * n + c.x);
  }
  const hidden = new Map();
  const half = (n - 1) / 2;
  for (let y = 0; y <= half; y++) {
    for (let x = 0; x <= half; x++) {
      const images = new Set([
        y * n + x,
        y * n + (n - 1 - x),
        (n - 1 - y) * n + x,
        (n - 1 - y) * n + (n - 1 - x),
      ]);
      const first = y * n + x;
      if (tiles[first] !== FLOOR || clear.has(first)) {
        rnd(); rnd();
        continue;
      }
      const crate = rnd() < CRATE_FILL;
      const power = rnd() < POWER_SHARE ? pickPower(rnd) : null;
      if (!crate) continue;
      for (const c of images) {
        if (clear.has(c) || tiles[c] !== FLOOR) continue;
        tiles[c] = CRATE;
        if (power) hidden.set(c, power);
      }
    }
  }
  return { n, tiles, hidden, spawns: corners(n, format, rnd) };
}
