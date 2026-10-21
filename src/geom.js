// Lane geometry: the road as a polyline, which cells it covers, and how much road a spot can see.
import { COLS, ROWS, PATH, PLOTS } from './config.js';

const segs = [];
let total = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const [x0, y0] = PATH[i];
  const [x1, y1] = PATH[i + 1];
  const len = Math.hypot(x1 - x0, y1 - y0);
  segs.push({ x0, y0, x1, y1, len, start: total, dx: (x1 - x0) / len, dy: (y1 - y0) / len, angle: Math.atan2(y1 - y0, x1 - x0) });
  total += len;
}
export const PATH_SEGS = segs;
export const PATH_LEN = total;

/** Position along the road at distance d. Writes into out and returns it. */
export function pathPos(d, out) {
  let s = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) {
    if (d < segs[i].start + segs[i].len) { s = segs[i]; break; }
  }
  const t = Math.min(Math.max(d - s.start, 0), s.len);
  out.x = s.x0 + s.dx * t;
  out.y = s.y0 + s.dy * t;
  out.a = s.angle;
  return out;
}

const pathCells = new Uint8Array(COLS * ROWS);
for (const s of segs) {
  const steps = Math.ceil(s.len * 8);
  for (let k = 0; k <= steps; k++) {
    const x = s.x0 + (s.x1 - s.x0) * (k / steps);
    const y = s.y0 + (s.y1 - s.y0) * (k / steps);
    const c = Math.floor(x);
    const r = Math.floor(y);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) pathCells[r * COLS + c] = 1;
  }
}

export const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const cellIndex = (c, r) => r * COLS + c;
export const isPath = (c, r) => pathCells[r * COLS + c] === 1;

const plotCells = new Uint8Array(COLS * ROWS);
for (const [c, r] of PLOTS) {
  if (!inGrid(c, r) || isPath(c, r)) throw new Error(`Bad plot ${c},${r}`);
  plotCells[r * COLS + c] = 1;
}
/** Cells a tower can stand on: the stone plots. */
export const BUILD_CELLS = PLOTS.map(([c, r]) => [c, r]);
export const isPlot = (c, r) => inGrid(c, r) && plotCells[r * COLS + c] === 1;

/** The plot nearest a point (in cells), if one is within maxDist of its centre. */
export function nearestPlot(x, y, maxDist = 0.75) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const [c, r] of PLOTS) {
    const dx = c + 0.5 - x;
    const dy = r + 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = { c, r }; }
  }
  return best;
}

// Road sample points inside the board, every 0.2 cells, for coverage estimates.
const STEP = 0.2;
const SAMPLES = [];
{
  const p = { x: 0, y: 0, a: 0 };
  for (let d = 0; d <= PATH_LEN; d += STEP) {
    pathPos(d, p);
    if (p.y >= -0.3 && p.y <= ROWS) SAMPLES.push({ x: p.x, y: p.y, d });
  }
}

/** Length of road (in cells) within range of a point. */
export function coverage(x, y, range) {
  const r2 = range * range;
  let n = 0;
  for (const p of SAMPLES) {
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n * STEP;
}

/** Exit point of the road, at the castle gate. */
export const EXIT = { x: PATH[PATH.length - 1][0], y: ROWS };
