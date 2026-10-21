// Drawing for Powder Keg: a walled courtyard seen from above, wooden crates, powder kegs with
// lit fuses, blasts, and little knights in their side's colours.
import { FLOOR, PILLAR, CRATE, BURNING, BLOCK, SIDES } from './config.js';
import { ARM } from './sim.js';

const TAU = Math.PI * 2;
const C = {
  night: '#151a22',
  floorA: '#d3c39b',
  floorB: '#c9b88e',
  grout: 'rgba(110, 90, 55, 0.22)',
  wall: '#3a4452',
  wallTop: '#4a5566',
  wallDark: '#28303c',
  stone: '#9aa3ae',
  stoneTop: '#b7bfc8',
  stoneDark: '#5d646e',
  block: '#59616d',
  blockTop: '#6c7480',
  wood: '#b07a3e',
  woodDark: '#6e4520',
  woodLight: '#cf9a58',
  keg: '#3b2a1c',
  kegLight: '#5a4130',
  brass: '#cfa552',
  ink: '#2a2118',
  steel: '#d5dbe2',
  steelDark: '#8a939e',
};

export const POWER_COLORS = { keg: '#c8443c', fire: '#e7842a', boots: '#3e74c8' };

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.n = 0;
    this.cs = 32;
    this.ox = 0;
    this.oy = 0;
    this.bg = null;
    this.bgKey = '';
    this.fx = [];
  }

  /** Fit an n×n courtyard (plus its wall) into the canvas's CSS box. */
  layout(arena) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const n = arena.n;
    const cs = Math.floor((Math.min(w, h) / (n + 1.1)) * dpr) / dpr;
    this.w = w;
    this.h = h;
    this.n = n;
    this.cs = cs;
    this.ox = Math.round((w - n * cs) / 2);
    this.oy = Math.round((h - n * cs) / 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.arena = arena;
    this.bgKey = '';
  }

  cx(x) { return this.ox + (x + 0.5) * this.cs; }
  cy(y) { return this.oy + (y + 0.5) * this.cs; }

  /** Floor, wall and pillars never change during a round: draw them once. */
  background(arena) {
    const key = `${this.w}x${this.h}@${this.dpr}:${this.n}:${arena.tiles.length}`;
    if (this.bg && this.bgKey === key && this.bgArena === arena) return this.bg;
    const { w, h, dpr, cs, n, ox, oy } = this;
    const off = document.createElement('canvas');
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const g = off.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = C.night;
    g.fillRect(0, 0, w, h);
    // The wall around the courtyard.
    const b = cs * 0.5;
    g.fillStyle = C.wallDark;
    roundRect(g, ox - b - 2, oy - b - 2, n * cs + 2 * b + 4, n * cs + 2 * b + 4, 10);
    g.fill();
    g.fillStyle = C.wall;
    roundRect(g, ox - b, oy - b, n * cs + 2 * b, n * cs + 2 * b, 8);
    g.fill();
    // Crenellations along the wall top.
    g.fillStyle = C.wallTop;
    const step = cs * 0.5;
    for (let i = 0; i < n * 2; i += 2) {
      const t = ox + i * step + step * 0.15;
      g.fillRect(t, oy - b + 2, step * 0.7, b * 0.45);
      g.fillRect(t, oy + n * cs + b * 0.5 - 2, step * 0.7, b * 0.45);
      const u = oy + i * step + step * 0.15;
      g.fillRect(ox - b + 2, u, b * 0.45, step * 0.7);
      g.fillRect(ox + n * cs + b * 0.5 - 2, u, b * 0.45, step * 0.7);
    }
    // Flagstones.
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 ? C.floorA : C.floorB;
        g.fillRect(ox + x * cs, oy + y * cs, cs, cs);
      }
    }
    g.strokeStyle = C.grout;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < n; i++) {
      g.moveTo(ox + i * cs + 0.5, oy);
      g.lineTo(ox + i * cs + 0.5, oy + n * cs);
      g.moveTo(ox, oy + i * cs + 0.5);
      g.lineTo(ox + n * cs, oy + i * cs + 0.5);
    }
    g.stroke();
    // Inner shadow from the wall.
    g.fillStyle = 'rgba(0, 0, 0, 0.18)';
    g.fillRect(ox, oy, n * cs, cs * 0.12);
    g.fillRect(ox, oy, cs * 0.12, n * cs);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (arena.tiles[y * n + x] === PILLAR) drawStone(g, ox + x * cs, oy + y * cs, cs, C.stone, C.stoneTop, C.stoneDark);
      }
    }
    this.bg = off;
    this.bgKey = key;
    this.bgArena = arena;
    return off;
  }

  addEvents(events, arena, now) {
    const n = arena.n;
    for (const e of events) {
      if (e.t === 'blast') this.fx.push({ k: 'shake', t0: now, dur: 180, amp: Math.min(5, 1.5 + e.size * 0.25) });
      else if (e.t === 'crate') this.fx.push({ k: 'splinters', x: e.cell % n, y: Math.floor(e.cell / n), t0: now, dur: 420, seed: e.cell });
      else if (e.t === 'death') {
        const p = arena.players[e.player];
        this.fx.push({ k: 'puff', x: p.x, y: p.y, color: SIDES[p.index].color, t0: now, dur: 900 });
      } else if (e.t === 'power') {
        const p = arena.players[e.player];
        this.fx.push({ k: 'pickup', x: p.x, y: p.y, kind: e.kind, t0: now, dur: 700 });
      } else if (e.t === 'drop') {
        for (const c of e.cells) this.fx.push({ k: 'fall', x: c % n, y: Math.floor(c / n), t0: now, dur: 260 });
      } else if (e.t === 'keg') {
        this.fx.push({ k: 'thud', x: e.cell % n, y: Math.floor(e.cell / n), t0: now, dur: 220 });
      }
    }
    if (this.fx.length > 120) this.fx.splice(0, this.fx.length - 120);
  }

  /** ui: { me, alpha, you: { until } | null } */
  draw(arena, ui, now) {
    const g = this.ctx;
    const { cs, n } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // A little shake when kegs go off.
    let sx = 0;
    let sy = 0;
    for (const f of this.fx) {
      if (f.k !== 'shake') continue;
      const t = (now - f.t0) / f.dur;
      if (t < 0 || t >= 1) continue;
      const a = f.amp * (1 - t);
      sx += Math.sin(now * 0.09 + f.t0) * a;
      sy += Math.cos(now * 0.11 + f.t0) * a;
    }
    g.drawImage(this.background(arena), 0, 0, this.w, this.h);
    if (sx || sy) g.translate(sx, sy);

    const tiles = arena.tiles;
    // Warnings where stone will fall next.
    if (arena.tick >= arena.hurryTick - 1) {
      const next = arena.upcomingDrops(3);
      next.forEach((grp, i) => {
        const k = Math.max(0, 1 - grp.inTicks / (arena.dropTicks * 3));
        for (const c of grp.cells) {
          const x = c % n;
          const y = (c - x) / n;
          g.fillStyle = `rgba(30, 20, 15, ${0.12 + 0.35 * k})`;
          const s = cs * (0.5 + 0.5 * k);
          g.fillRect(this.cx(x) - s / 2, this.cy(y) - s / 2, s, s);
          if (i === 0) {
            g.strokeStyle = `rgba(236, 109, 100, ${0.5 + 0.5 * Math.sin(now / 90)})`;
            g.lineWidth = 2;
            g.strokeRect(this.ox + x * cs + 2, this.oy + y * cs + 2, cs - 4, cs - 4);
          }
        }
      });
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const t = tiles[y * n + x];
        if (t === FLOOR || t === PILLAR) continue;
        const px = this.ox + x * cs;
        const py = this.oy + y * cs;
        if (t === CRATE) drawCrate(g, px, py, cs, false);
        else if (t === BURNING) drawCrate(g, px, py, cs, true);
        else if (t === BLOCK) drawStone(g, px, py, cs, C.block, C.blockTop, '#3a4049');
      }
    }

    for (const [c, kind] of arena.items) {
      const x = c % n;
      const y = (c - x) / n;
      drawPower(g, this.cx(x), this.cy(y), cs, kind, now);
    }

    for (const b of arena.bombs) {
      drawKeg(g, this.cx(b.x), this.cy(b.y), cs, b.fuse / (b.fuse0 || arena.fuseTicks), now, SIDES[b.owner].color);
    }

    // Flames: beams joining burning cells, brightest when fresh.
    for (const [c, f] of arena.flames) {
      const x = c % n;
      const y = (c - x) / n;
      const life = f.ttl / arena.flameTicks;
      drawFlame(g, this.cx(x), this.cy(y), cs, f.arms, life, now);
    }

    // Knights, lowest on screen drawn last.
    const order = arena.players.filter((p) => p.alive).sort((a, b) => a.y - b.y);
    for (const p of order) {
      const x = p.px + (p.x - p.px) * ui.alpha;
      const y = p.py + (p.y - p.py) * ui.alpha;
      drawKnight(g, this.cx(x), this.cy(y), cs, SIDES[p.index], p.face, p.moving ? p.walk : 0, now);
    }

    this.drawFx(g, now);
    if (ui.you && now < ui.you.until) {
      const p = arena.players[ui.me];
      if (p.alive) drawTag(g, this.cx(p.x), this.cy(p.y) - cs * 0.85, 'YOU', SIDES[ui.me].color, Math.min(1, (ui.you.until - now) / 500), now);
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  drawFx(g, now) {
    const cs = this.cs;
    let keep = 0;
    for (const f of this.fx) {
      const t = (now - f.t0) / f.dur;
      if (t >= 1) continue;
      this.fx[keep++] = f;
      if (t < 0) continue;
      if (f.k === 'puff') {
        const x = this.cx(f.x);
        const y = this.cy(f.y);
        g.globalAlpha = 1 - t;
        g.fillStyle = 'rgba(70, 70, 70, 0.8)';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const r = cs * (0.15 + t * 0.55);
          g.beginPath();
          g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r - t * cs * 0.4, cs * 0.18 * (1 - t * 0.5), 0, TAU);
          g.fill();
        }
        g.fillStyle = f.color;
        g.beginPath();
        g.arc(x, y - t * cs * 0.8, cs * 0.16, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      } else if (f.k === 'pickup') {
        const x = this.cx(f.x);
        const y = this.cy(f.y) - cs * 0.6 - t * cs * 0.6;
        g.globalAlpha = 1 - t;
        drawPowerIcon(g, x, y, cs * 0.34, f.kind);
        g.globalAlpha = 1;
      } else if (f.k === 'splinters') {
        const x = this.cx(f.x);
        const y = this.cy(f.y);
        g.fillStyle = C.woodLight;
        for (let i = 0; i < 7; i++) {
          const a = ((f.seed * 37 + i * 53) % 360) * (Math.PI / 180);
          const r = cs * (0.2 + t * 0.6);
          g.globalAlpha = 1 - t;
          g.fillRect(x + Math.cos(a) * r - 2, y + Math.sin(a) * r - 2, 4, 3);
        }
        g.globalAlpha = 1;
      } else if (f.k === 'fall') {
        const x = this.ox + f.x * cs;
        const y = this.oy + f.y * cs;
        const s = 1 + (1 - t) * 0.6;
        g.globalAlpha = 0.35 + 0.65 * t;
        drawStone(g, x + (cs - cs * s) / 2, y + (cs - cs * s) / 2 - (1 - t) * cs * 0.4, cs * s, C.block, C.blockTop, '#3a4049');
        g.globalAlpha = 1;
      } else if (f.k === 'thud') {
        g.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - t)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(this.cx(f.x), this.cy(f.y), cs * (0.3 + t * 0.3), 0, TAU);
        g.stroke();
      }
    }
    this.fx.length = keep;
  }
}

// ---------- pieces ----------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawStone(g, x, y, s, body, top, dark) {
  const i = Math.max(1, s * 0.06);
  g.fillStyle = dark;
  g.fillRect(x + i * 0.5, y + i * 0.5, s - i, s - i);
  g.fillStyle = body;
  g.fillRect(x + i, y + i, s - 2 * i, s - 2.6 * i);
  g.fillStyle = top;
  g.fillRect(x + i, y + i, s - 2 * i, s * 0.22);
  g.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + s * 0.5, y + s * 0.3);
  g.lineTo(x + s * 0.5, y + s * 0.62);
  g.moveTo(x + i, y + s * 0.62);
  g.lineTo(x + s - i, y + s * 0.62);
  g.stroke();
}

function drawCrate(g, x, y, s, burning) {
  const i = s * 0.08;
  g.fillStyle = C.woodDark;
  g.fillRect(x + i, y + i, s - 2 * i, s - 2 * i);
  g.fillStyle = burning ? '#7a4a28' : C.wood;
  g.fillRect(x + i * 1.8, y + i * 1.8, s - 3.6 * i, s - 3.6 * i);
  g.strokeStyle = C.woodDark;
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(x + i * 1.8, y + s / 2);
  g.lineTo(x + s - i * 1.8, y + s / 2);
  g.moveTo(x + i * 2, y + i * 2);
  g.lineTo(x + s - i * 2, y + s - i * 2);
  g.stroke();
  g.fillStyle = 'rgba(255, 230, 180, 0.25)';
  g.fillRect(x + i * 1.8, y + i * 1.8, s - 3.6 * i, s * 0.08);
  if (burning) {
    g.fillStyle = 'rgba(30, 15, 5, 0.35)';
    g.fillRect(x + i, y + i, s - 2 * i, s - 2 * i);
  }
}

function drawKeg(g, x, y, s, left, now, color) {
  // A powder keg seen from the side. It swells faster and glows as the fuse burns down.
  const rate = 3 + (1 - left) * 12;
  const pulse = 1 + 0.07 * Math.sin((now / 1000) * rate * Math.PI);
  const w = s * 0.62 * pulse;
  const h = s * 0.66 * pulse;
  const top = y - h * 0.42;
  const bot = y + h * 0.5;
  g.fillStyle = 'rgba(40, 25, 10, 0.3)';
  g.beginPath();
  g.ellipse(x, bot, w * 0.52, h * 0.1, 0, 0, TAU);
  g.fill();
  const body = left < 0.3 ? mix('#8a5528', '#c8402a', 0.5 + 0.5 * Math.sin(now / 55)) : '#8a5528';
  g.save();
  g.beginPath();
  g.moveTo(x - w * 0.4, top);
  g.quadraticCurveTo(x - w * 0.62, (top + bot) / 2, x - w * 0.4, bot);
  g.lineTo(x + w * 0.4, bot);
  g.quadraticCurveTo(x + w * 0.62, (top + bot) / 2, x + w * 0.4, top);
  g.closePath();
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = '#4a2a10';
  g.lineWidth = Math.max(1, s * 0.035);
  g.stroke();
  g.clip();
  // Staves.
  g.strokeStyle = 'rgba(60, 30, 10, 0.55)';
  g.lineWidth = Math.max(1, s * 0.025);
  g.beginPath();
  g.moveTo(x - w * 0.18, top);
  g.quadraticCurveTo(x - w * 0.24, (top + bot) / 2, x - w * 0.18, bot);
  g.moveTo(x + w * 0.18, top);
  g.quadraticCurveTo(x + w * 0.24, (top + bot) / 2, x + w * 0.18, bot);
  g.stroke();
  // Hoops, and a band in the dropper's colour.
  g.fillStyle = C.brass;
  g.fillRect(x - w, top + h * 0.14, w * 2, h * 0.11);
  g.fillRect(x - w, bot - h * 0.25, w * 2, h * 0.11);
  g.fillStyle = color;
  g.fillRect(x - w, y - h * 0.08, w * 2, h * 0.14);
  g.restore();
  // Lid.
  g.fillStyle = '#a8703a';
  g.beginPath();
  g.ellipse(x, top, w * 0.4, h * 0.07, 0, 0, TAU);
  g.fill();
  // Fuse and spark.
  g.strokeStyle = '#f1e4c4';
  g.lineWidth = Math.max(1.2, s * 0.045);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x + w * 0.02, top);
  g.quadraticCurveTo(x + w * 0.05, top - h * 0.3, x + w * 0.3, top - h * 0.36);
  g.stroke();
  g.lineCap = 'butt';
  const fl = 0.6 + 0.4 * Math.sin(now / 35);
  g.fillStyle = `rgba(255, 210, 90, ${fl})`;
  g.beginPath();
  g.arc(x + w * 0.3, top - h * 0.36, s * 0.1 * (0.8 + fl * 0.5), 0, TAU);
  g.fill();
  g.fillStyle = '#fff6d8';
  g.beginPath();
  g.arc(x + w * 0.3, top - h * 0.36, s * 0.045, 0, TAU);
  g.fill();
}

function drawFlame(g, x, y, s, arms, life, now) {
  const fade = Math.min(1, life * 2.2);
  const flick = 0.92 + 0.08 * Math.sin(now / 40 + x * 0.3 + y * 0.7);
  const layers = [
    ['#e5531f', 0.44],
    ['#f6a32b', 0.32],
    ['#ffe48a', 0.19],
    ['#fffbe8', 0.08],
  ];
  g.globalAlpha = fade;
  for (const [col, wv] of layers) {
    const w = s * wv * flick * (0.75 + 0.25 * life);
    g.fillStyle = col;
    // Beam towards each neighbour this cell connects to, plus a blob in the middle.
    if (arms & ARM[0]) g.fillRect(x - s / 2 - 0.5, y - w, s / 2 + 0.5, w * 2);
    if (arms & ARM[1]) g.fillRect(x, y - w, s / 2 + 0.5, w * 2);
    if (arms & ARM[2]) g.fillRect(x - w, y - s / 2 - 0.5, w * 2, s / 2 + 0.5);
    if (arms & ARM[3]) g.fillRect(x - w, y, w * 2, s / 2 + 0.5);
    g.beginPath();
    g.arc(x, y, w * (arms & 16 ? 1.35 : 1.05), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawPowerIcon(g, x, y, r, kind) {
  g.fillStyle = POWER_COLORS[kind];
  roundRect(g, x - r, y - r, r * 2, r * 2, r * 0.45);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  g.lineWidth = Math.max(1, r * 0.12);
  g.stroke();
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  if (kind === 'keg') {
    g.beginPath();
    g.arc(x, y + r * 0.08, r * 0.48, 0, TAU);
    g.fill();
    g.lineWidth = Math.max(1, r * 0.12);
    g.beginPath();
    g.moveTo(x + r * 0.15, y - r * 0.35);
    g.quadraticCurveTo(x + r * 0.35, y - r * 0.7, x + r * 0.5, y - r * 0.62);
    g.stroke();
  } else if (kind === 'fire') {
    g.beginPath();
    g.moveTo(x, y - r * 0.68);
    g.bezierCurveTo(x + r * 0.55, y - r * 0.2, x + r * 0.55, y + r * 0.55, x, y + r * 0.6);
    g.bezierCurveTo(x - r * 0.55, y + r * 0.55, x - r * 0.55, y - r * 0.05, x - r * 0.12, y - r * 0.25);
    g.bezierCurveTo(x - r * 0.05, y - r * 0.4, x, y - r * 0.5, x, y - r * 0.68);
    g.fill();
  } else {
    // A boot with a little wing.
    g.beginPath();
    g.moveTo(x - r * 0.25, y - r * 0.6);
    g.lineTo(x + r * 0.12, y - r * 0.6);
    g.lineTo(x + r * 0.12, y + r * 0.1);
    g.lineTo(x + r * 0.58, y + r * 0.22);
    g.lineTo(x + r * 0.58, y + r * 0.55);
    g.lineTo(x - r * 0.25, y + r * 0.55);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x - r * 0.3, y - r * 0.35);
    g.lineTo(x - r * 0.7, y - r * 0.5);
    g.lineTo(x - r * 0.55, y - r * 0.15);
    g.closePath();
    g.fill();
  }
}

function drawPower(g, x, y, s, kind, now) {
  const bob = Math.sin(now / 260 + x) * s * 0.04;
  g.fillStyle = 'rgba(40, 25, 10, 0.25)';
  g.beginPath();
  g.ellipse(x, y + s * 0.3, s * 0.28, s * 0.09, 0, 0, TAU);
  g.fill();
  drawPowerIcon(g, x, y + bob, s * 0.3, kind);
}

function drawKnight(g, x, y, s, side, face, walk, now) {
  // A little knight from above and slightly in front: feet, a tabard in the side's colour,
  // a steel helmet with a plume, and a visor that shows which way they face.
  const r = s * 0.42;
  const step = walk ? Math.sin(walk * Math.PI * 2.2) : 0;
  const bob = walk ? Math.abs(step) * s * 0.05 : Math.sin(now / 400) * s * 0.012;
  g.fillStyle = 'rgba(40, 25, 10, 0.32)';
  g.beginPath();
  g.ellipse(x, y + r * 0.78, r * 0.85, r * 0.3, 0, 0, TAU);
  g.fill();
  const yy = y - bob;
  const swing = step * r * 0.28;
  g.fillStyle = '#2b2620';
  g.beginPath();
  if (face.y !== 0) {
    g.ellipse(x - r * 0.36, yy + r * 0.68 + swing * face.y, r * 0.2, r * 0.16, 0, 0, TAU);
    g.ellipse(x + r * 0.36, yy + r * 0.68 - swing * face.y, r * 0.2, r * 0.16, 0, 0, TAU);
  } else {
    g.ellipse(x - r * 0.2 + swing, yy + r * 0.72, r * 0.22, r * 0.15, 0, 0, TAU);
    g.ellipse(x + r * 0.2 - swing, yy + r * 0.72, r * 0.22, r * 0.15, 0, 0, TAU);
  }
  g.fill();
  // Tabard.
  g.strokeStyle = 'rgba(20, 15, 10, 0.8)';
  g.lineWidth = Math.max(1.2, s * 0.05);
  g.fillStyle = side.color;
  g.beginPath();
  g.moveTo(x - r * 0.72, yy - r * 0.05);
  g.quadraticCurveTo(x - r * 0.8, yy + r * 0.7, x - r * 0.5, yy + r * 0.72);
  g.lineTo(x + r * 0.5, yy + r * 0.72);
  g.quadraticCurveTo(x + r * 0.8, yy + r * 0.7, x + r * 0.72, yy - r * 0.05);
  g.closePath();
  g.fill();
  g.stroke();
  // A pale cross on the tabard.
  g.fillStyle = side.light;
  g.fillRect(x - r * 0.08, yy + r * 0.02, r * 0.16, r * 0.62);
  g.fillRect(x - r * 0.32, yy + r * 0.22, r * 0.64, r * 0.14);
  // Arms.
  g.fillStyle = C.steelDark;
  g.beginPath();
  g.arc(x - r * 0.78, yy + r * 0.2 - swing * 0.4, r * 0.17, 0, TAU);
  g.arc(x + r * 0.78, yy + r * 0.2 + swing * 0.4, r * 0.17, 0, TAU);
  g.fill();
  // Helmet.
  const hx = x + face.x * r * 0.1;
  const hy = yy - r * 0.32;
  g.fillStyle = C.steel;
  g.beginPath();
  g.arc(hx, hy, r * 0.56, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.beginPath();
  g.arc(hx - r * 0.18, hy - r * 0.2, r * 0.16, 0, TAU);
  g.fill();
  // Plume in the side's colour, on the side away from where they face.
  g.fillStyle = side.light;
  g.strokeStyle = side.dark;
  g.lineWidth = Math.max(1, s * 0.03);
  g.beginPath();
  g.ellipse(hx - face.x * r * 0.3, hy - r * 0.55, r * 0.17, r * 0.3, -face.x * 0.6, 0, TAU);
  g.fill();
  g.stroke();
  // Visor: a dark slit on the facing side; none when they face away.
  if (face.y !== -1) {
    g.fillStyle = C.ink;
    if (face.x === 0) roundRect(g, hx - r * 0.34, hy - r * 0.02, r * 0.68, r * 0.15, r * 0.06);
    else roundRect(g, hx + (face.x > 0 ? r * 0.06 : -r * 0.5), hy - r * 0.02, r * 0.44, r * 0.15, r * 0.06);
    g.fill();
  }
}

function drawTag(g, x, y, text, color, alpha, now) {
  const bob = Math.sin(now / 200) * 2;
  g.globalAlpha = alpha;
  g.font = '800 13px "Alegreya Sans", system-ui, sans-serif';
  const tw = g.measureText(text).width;
  const w = tw + 14;
  const h = 20;
  const yy = y + bob;
  g.fillStyle = color;
  roundRect(g, x - w / 2, yy - h / 2, w, h, 6);
  g.fill();
  g.beginPath();
  g.moveTo(x - 6, yy + h / 2 - 1);
  g.lineTo(x + 6, yy + h / 2 - 1);
  g.lineTo(x, yy + h / 2 + 6);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, yy + 1);
  g.globalAlpha = 1;
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const gg = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r}, ${gg}, ${bl})`;
}

/** A power-up badge on its own, for the how-to page and the HUD. */
export function powerThumb(kind, size = 40) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawPowerIcon(g, size / 2, size / 2, size * 0.42, kind);
  return c.toDataURL();
}

/** Other thumbnails for the how-to page: a keg, a crate, a stone, a knight. */
export function pieceThumb(kind, size = 44) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = C.floorA;
  roundRect(g, 0, 0, size, size, 8);
  g.fill();
  const s = size * 0.8;
  const o = (size - s) / 2;
  if (kind === 'keg') drawKeg(g, size / 2, size / 2 + 3, s, 0.8, 0, SIDES[0].color);
  else if (kind === 'crate') drawCrate(g, o, o, s, false);
  else if (kind === 'stone') drawStone(g, o, o, s, C.stone, C.stoneTop, C.stoneDark);
  else if (kind === 'blast') drawFlame(g, size / 2, size / 2, s, 1 | 2 | 4 | 8 | 16, 1, 0);
  else if (kind === 'knight') drawKnight(g, size / 2, size / 2, s * 1.1, SIDES[0], { x: 0, y: 1 }, 0, 0);
  return c.toDataURL();
}

/** The keg on the big button: no floor behind it. */
export function kegIcon(size = 60) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawKeg(g, size / 2, size * 0.56, size * 1.05, 1, 0, '#cfa552');
  return c.toDataURL();
}
