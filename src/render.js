// Canvas drawing: a war-table map on parchment. Towers stand on stone plots and change look
// with each level (wooden post, stone tower, fortified keep). Reads simulation state only.
import { COLS, ROWS, PATH, PLOTS, TOWERS, ENEMIES } from './config.js';
import { isPath, isPlot, PATH_LEN } from './geom.js';
import { mulberry32 } from './rng.js';

export const TOP = 0.6; // cells of forest above the grid
export const BOTTOM = 0.75; // cells of castle wall below the grid
export const BOARD_ROWS = ROWS + TOP + BOTTOM;

const C = {
  ground: '#d6c49b',
  speckDark: 'rgba(120, 95, 55, 0.10)',
  speckLight: 'rgba(255, 248, 225, 0.16)',
  roadEdge: '#8d6f47',
  road: '#c3a573',
  roadMark: 'rgba(118, 90, 54, 0.32)',
  forest: '#2b3a2d',
  treeA: '#3b4f3b',
  treeB: '#22301f',
  wall: '#5a616c',
  wallTop: '#6d7581',
  wallLine: 'rgba(30, 34, 40, 0.35)',
  gate: '#171b21',
  portcullis: '#3d434d',
  pad: '#bcae8e',
  padHi: '#d9cdb1',
  padLo: '#8f8264',
  rock: '#a89f8b',
  rockLine: '#867d6a',
  tuft: '#8b8f57',
  bushA: '#77804f',
  bushB: '#606a40',
  ink: '#2a2118',
  brass: '#cfa552',
  brassDark: '#8c6d2c',
  brassLight: '#e6c272',
  bone: '#ece2cc',
  frost: '#a8dcf5',
  hpGood: '#6cc08a',
  hpMid: '#e7b04a',
  hpLow: '#ec6d64',
  select: '#cfa552',
};

const ENEMY_STYLE = {
  goblin: { fill: '#5f7d45', line: '#24301b' },
  scout: { fill: '#7c5a3b', line: '#2a1d12' },
  shield: { fill: '#6f7c8a', line: '#232a33' },
  ogre: { fill: '#a07f48', line: '#3b2a14' },
  giant: { fill: '#6e2f2f', line: '#2b1010' },
};

const TAU = Math.PI * 2;
const CHEAPEST_TOWER = Math.min(...Object.values(TOWERS).map((t) => t.levels[0].cost));

export class Renderer {
  constructor(canvas, { colorOf }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colorOf = colorOf; // player id -> banner colour
    this.cs = 32;
    this.dpr = 1;
    this.bg = null;
    this.fx = [];
    this.selection = null; // { c, r, range }
    this.bannerColor = '#3e74c8';
  }

  /** Fit the board into the given CSS box. Returns the CSS size used. */
  layout(boxW, boxH) {
    const cs = Math.max(18, Math.min(60, Math.floor(Math.min(boxW / COLS, boxH / BOARD_ROWS))));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = cs * COLS;
    const h = Math.round(cs * BOARD_ROWS);
    if (cs !== this.cs || dpr !== this.dpr || !this.bg) {
      this.cs = cs;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.bg = this.buildBackground(w, h);
    }
    return { w, h, cs };
  }

  sx(x) { return x * this.cs; }
  sy(y) { return (y + TOP) * this.cs; }

  /** Board position (in cells) under a point in CSS pixels relative to the canvas. */
  boardAt(px, py) {
    return { x: px / this.cs, y: py / this.cs - TOP };
  }

  // ---------- background ----------
  buildBackground(W, H) {
    const cs = this.cs;
    const off = document.createElement('canvas');
    off.width = Math.round(W * this.dpr);
    off.height = Math.round(H * this.dpr);
    const g = off.getContext('2d');
    g.scale(this.dpr, this.dpr);

    g.fillStyle = C.ground;
    g.fillRect(0, 0, W, H);
    const rnd = mulberry32(1234);
    const specks = Math.round((W * H) / 26);
    for (let i = 0; i < specks; i++) {
      g.fillStyle = rnd() < 0.55 ? C.speckDark : C.speckLight;
      const s = 0.8 + rnd() * 1.8;
      g.fillRect(rnd() * W, rnd() * H, s, s);
    }

    // Scenery on grass that can't be built on, so the stone plots read as the only building spots.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isPath(c, r) || isPlot(c, r)) continue;
        const n = rnd() < 0.25 ? 2 : rnd() < 0.75 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const x = (c + 0.2 + rnd() * 0.6) * cs;
          const y = this.sy(r + 0.2 + rnd() * 0.6);
          const kind = rnd();
          if (kind < 0.4) drawTuft(g, x, y, cs, rnd);
          else if (kind < 0.72) drawRock(g, x, y, cs, rnd);
          else drawBush(g, x, y, cs, rnd);
        }
      }
    }

    // Forest edge where the enemies come from.
    g.fillStyle = C.forest;
    g.fillRect(0, 0, W, TOP * cs);
    const roadX = this.sx(PATH[0][0]);
    for (let x = cs * 0.2; x < W; x += cs * 0.42) {
      if (Math.abs(x - roadX) < cs * 0.55) continue;
      const h = cs * (0.42 + rnd() * 0.22);
      const base = TOP * cs + cs * 0.06;
      g.fillStyle = rnd() < 0.5 ? C.treeA : C.treeB;
      g.beginPath();
      g.moveTo(x, base - h);
      g.lineTo(x + cs * 0.22, base);
      g.lineTo(x - cs * 0.22, base);
      g.closePath();
      g.fill();
    }

    // Road.
    g.lineJoin = 'round';
    g.lineCap = 'butt';
    const roadPath = () => {
      g.beginPath();
      PATH.forEach(([x, y], i) => (i ? g.lineTo(this.sx(x), this.sy(y)) : g.moveTo(this.sx(x), this.sy(y))));
    };
    roadPath();
    g.strokeStyle = C.roadEdge;
    g.lineWidth = cs * 0.84;
    g.stroke();
    roadPath();
    g.strokeStyle = C.road;
    g.lineWidth = cs * 0.7;
    g.stroke();
    roadPath();
    g.strokeStyle = C.roadMark;
    g.lineWidth = Math.max(1, cs * 0.04);
    g.setLineDash([cs * 0.16, cs * 0.14]);
    g.stroke();
    g.setLineDash([]);

    // Stone plots.
    for (const [c, r] of PLOTS) drawPad(g, this.sx(c + 0.5), this.sy(r + 0.5), cs);

    // Castle wall with the gate the road runs into.
    const wy = this.sy(ROWS);
    const wh = BOTTOM * cs;
    g.fillStyle = C.wall;
    g.fillRect(0, wy + cs * 0.12, W, wh);
    g.fillStyle = C.wallTop;
    const merlon = cs * 0.34;
    for (let x = 0; x < W; x += merlon * 2) g.fillRect(x, wy, merlon, cs * 0.16);
    g.strokeStyle = C.wallLine;
    g.lineWidth = 1;
    g.beginPath();
    for (let y = wy + cs * 0.36; y < wy + wh; y += cs * 0.24) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    const gx = this.sx(PATH[PATH.length - 1][0]);
    const gw = cs * 0.78;
    g.fillStyle = C.gate;
    g.beginPath();
    g.moveTo(gx - gw / 2, wy + wh);
    g.lineTo(gx - gw / 2, wy + cs * 0.38);
    g.arc(gx, wy + cs * 0.38, gw / 2, Math.PI, 0);
    g.lineTo(gx + gw / 2, wy + wh);
    g.closePath();
    g.fill();
    g.strokeStyle = C.portcullis;
    g.lineWidth = Math.max(1, cs * 0.035);
    g.beginPath();
    for (let i = -2; i <= 2; i++) { g.moveTo(gx + i * gw * 0.18, wy + cs * 0.12); g.lineTo(gx + i * gw * 0.18, wy + wh); }
    g.stroke();

    // Soft vignette so the board edges sit back.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(60, 40, 15, 0)');
    vg.addColorStop(1, 'rgba(60, 40, 15, 0.22)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    return off;
  }

  // ---------- effects ----------
  addEvents(events, now) {
    for (const e of events) {
      switch (e.t) {
        case 'blast': this.fx.push({ k: 'blast', x: e.x, y: e.y, r: e.r, kind: e.kind, t0: now, dur: 320 }); break;
        case 'hit': if (e.kind === 'frost') this.fx.push({ k: 'frost', x: e.x, y: e.y, t0: now, dur: 260 }); break;
        case 'kill': this.fx.push({ k: 'kill', x: e.x, y: e.y, kind: e.kind, bounty: e.bounty, t0: now, dur: 520 }); break;
        case 'leak': this.fx.push({ k: 'leak', lost: e.lost, t0: now, dur: 900 }); break;
        case 'build': this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, dur: 420 }); break;
        case 'upgrade': this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, dur: 650, big: true }); break;
        case 'sell': this.fx.push({ k: 'text', x: e.x, y: e.y, text: `+${e.value}`, t0: now, dur: 900 }); break;
        case 'fire': if (e.kind === 'cannon' || e.kind === 'ballista') this.fx.push({ k: 'muzzle', x: e.x, y: e.y, t0: now, dur: 120 }); break;
        default: break;
      }
    }
    if (this.fx.length > 220) this.fx.splice(0, this.fx.length - 220);
  }

  // ---------- frame ----------
  /** opts.gold: the viewer's gold when this is their own lane (lights up plots they can afford). */
  draw(lane, alpha, now, opts = {}) {
    const g = this.ctx;
    const cs = this.cs;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.drawImage(this.bg, 0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    this.drawBanners(g);
    this.drawPlotMarks(g, lane, opts, now);

    const sel = this.selection;
    if (sel) {
      g.strokeStyle = C.select;
      g.lineWidth = Math.max(2, cs * 0.07);
      roundRect(g, this.sx(sel.c) + cs * 0.06, this.sy(sel.r) + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.16);
      g.stroke();
      if (sel.range) this.drawRange(g, sel.c + 0.5, sel.r + 0.5, sel.range);
    }

    for (const t of lane.towerList) this.drawTower(g, t);
    for (const e of lane.enemies) if (e.alive) this.drawEnemy(g, e, alpha);
    for (const p of lane.projectiles) if (p.alive) this.drawProjectile(g, p, alpha);
    this.drawFx(g, now);
  }

  /** "+" on each empty plot: bright when the viewer can afford a tower there. */
  drawPlotMarks(g, lane, opts, now) {
    const cs = this.cs;
    const mine = opts.gold != null;
    const afford = mine && opts.gold >= CHEAPEST_TOWER;
    const pulse = afford && opts.pulse ? 0.5 + 0.5 * Math.sin(now / 260) : 0;
    for (const [c, r] of PLOTS) {
      if (lane.towerAt(c, r)) continue;
      const x = this.sx(c + 0.5);
      const y = this.sy(r + 0.5);
      if (afford) {
        g.strokeStyle = `rgba(207, 165, 82, ${0.75 + 0.25 * pulse})`;
        g.lineWidth = Math.max(1.5, cs * (0.05 + 0.03 * pulse));
        roundRect(g, x - cs * 0.42, y - cs * 0.42, cs * 0.84, cs * 0.84, cs * 0.14);
        g.stroke();
      }
      g.strokeStyle = afford ? C.brassDark : 'rgba(143, 130, 100, 0.75)';
      g.lineWidth = Math.max(1.5, cs * 0.06);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x - cs * 0.12, y);
      g.lineTo(x + cs * 0.12, y);
      g.moveTo(x, y - cs * 0.12);
      g.lineTo(x, y + cs * 0.12);
      g.stroke();
      g.lineCap = 'butt';
    }
  }

  drawBanners(g) {
    const cs = this.cs;
    const wy = this.sy(ROWS);
    const gx = this.sx(PATH[PATH.length - 1][0]);
    for (const side of [-1, 1]) {
      const x = gx + side * cs * 0.75;
      g.fillStyle = this.bannerColor;
      g.fillRect(x - cs * 0.11, wy + cs * 0.2, cs * 0.22, cs * 0.42);
      g.beginPath();
      g.moveTo(x - cs * 0.11, wy + cs * 0.62);
      g.lineTo(x, wy + cs * 0.52);
      g.lineTo(x + cs * 0.11, wy + cs * 0.62);
      g.fillStyle = C.wall;
      g.fill();
    }
  }

  drawRange(g, x, y, range) {
    g.beginPath();
    g.arc(this.sx(x), this.sy(y), range * this.cs, 0, TAU);
    g.fillStyle = 'rgba(207, 165, 82, 0.13)';
    g.fill();
    g.strokeStyle = 'rgba(140, 109, 44, 0.85)';
    g.lineWidth = Math.max(1, this.cs * 0.035);
    g.setLineDash([this.cs * 0.12, this.cs * 0.1]);
    g.stroke();
    g.setLineDash([]);
  }

  drawTower(g, t) {
    drawTowerToken(g, this.sx(t.x), this.sy(t.y), this.cs, t.type, t.level, t.angle, this.bannerColor);
  }

  drawEnemy(g, e, alpha) {
    const cs = this.cs;
    const x = this.sx(e.px + (e.x - e.px) * alpha);
    const y = this.sy(e.py + (e.y - e.py) * alpha);
    const r = e.r * cs;
    drawEnemyBody(g, x, y, r, cs, e.kind, e.a);
    if (e.slow > 0) {
      g.beginPath();
      g.arc(x, y, r + cs * 0.06, 0, TAU);
      g.strokeStyle = 'rgba(191, 232, 255, 0.95)';
      g.lineWidth = Math.max(1, cs * 0.04);
      g.stroke();
    }
    if (e.sentBy != null) {
      const color = this.colorOf(e.sentBy);
      const px = x - r * 0.75;
      const py = y - r * 0.55;
      g.strokeStyle = C.ink;
      g.lineWidth = Math.max(1, cs * 0.03);
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px, py - cs * 0.34);
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(px, py - cs * 0.34);
      g.lineTo(px + cs * 0.22, py - cs * 0.27);
      g.lineTo(px, py - cs * 0.2);
      g.closePath();
      g.fill();
    }
    if (e.hp < e.maxHp) {
      const w = Math.max(cs * 0.5, r * 2.3);
      const h = Math.max(2, cs * 0.075);
      const bx = x - w / 2;
      const by = y - r - cs * 0.17;
      const f = Math.max(0, e.hp / e.maxHp);
      g.fillStyle = 'rgba(20, 16, 10, 0.6)';
      g.fillRect(bx - 1, by - 1, w + 2, h + 2);
      g.fillStyle = f > 0.5 ? C.hpGood : f > 0.25 ? C.hpMid : C.hpLow;
      g.fillRect(bx, by, w * f, h);
    }
  }

  drawProjectile(g, p, alpha) {
    const cs = this.cs;
    const x = this.sx(p.px + (p.x - p.px) * alpha);
    const y = this.sy(p.py + (p.y - p.py) * alpha);
    let dx = p.x - p.px;
    let dy = p.y - p.py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    switch (p.kind) {
      case 'archer':
        g.strokeStyle = C.ink;
        g.lineWidth = Math.max(1, cs * 0.035);
        g.beginPath();
        g.moveTo(x - dx * cs * 0.24, y - dy * cs * 0.24);
        g.lineTo(x, y);
        g.stroke();
        break;
      case 'cannon':
        g.fillStyle = 'rgba(40, 30, 15, 0.25)';
        g.beginPath();
        g.arc(x + cs * 0.04, y + cs * 0.06, cs * 0.075, 0, TAU);
        g.fill();
        g.fillStyle = '#22252b';
        g.beginPath();
        g.arc(x, y, cs * 0.08, 0, TAU);
        g.fill();
        break;
      case 'frost':
        g.fillStyle = 'rgba(168, 220, 245, 0.35)';
        g.beginPath();
        g.arc(x, y, cs * 0.17, 0, TAU);
        g.fill();
        g.fillStyle = '#e4f6ff';
        g.beginPath();
        g.arc(x, y, cs * 0.075, 0, TAU);
        g.fill();
        break;
      case 'ballista':
        g.strokeStyle = '#4a3420';
        g.lineWidth = Math.max(1.5, cs * 0.06);
        g.beginPath();
        g.moveTo(x - dx * cs * 0.46, y - dy * cs * 0.46);
        g.lineTo(x, y);
        g.stroke();
        break;
      default: break;
    }
  }

  drawFx(g, now) {
    const cs = this.cs;
    let keep = 0;
    for (const f of this.fx) {
      const p = (now - f.t0) / f.dur;
      if (p >= 1) continue;
      this.fx[keep++] = f;
      if (p < 0) continue;
      switch (f.k) {
        case 'blast': {
          const isFrost = f.kind === 'frost';
          const r = f.r * cs * (0.35 + 0.65 * p);
          g.beginPath();
          g.arc(this.sx(f.x), this.sy(f.y), r, 0, TAU);
          g.fillStyle = isFrost ? `rgba(168, 220, 245, ${0.28 * (1 - p)})` : `rgba(224, 128, 52, ${0.26 * (1 - p)})`;
          g.fill();
          g.strokeStyle = isFrost ? `rgba(140, 200, 235, ${0.9 * (1 - p)})` : `rgba(196, 98, 34, ${0.9 * (1 - p)})`;
          g.lineWidth = Math.max(1, cs * 0.05);
          g.stroke();
          break;
        }
        case 'frost': {
          g.beginPath();
          g.arc(this.sx(f.x), this.sy(f.y), cs * (0.1 + 0.2 * p), 0, TAU);
          g.strokeStyle = `rgba(168, 220, 245, ${1 - p})`;
          g.lineWidth = Math.max(1, cs * 0.04);
          g.stroke();
          break;
        }
        case 'kill': {
          const st = ENEMY_STYLE[f.kind] || ENEMY_STYLE.goblin;
          g.globalAlpha = 0.55 * (1 - p);
          g.fillStyle = st.fill;
          g.beginPath();
          g.arc(this.sx(f.x), this.sy(f.y), cs * (0.14 + 0.3 * p), 0, TAU);
          g.fill();
          g.globalAlpha = 1;
          if (f.bounty >= 3) this.floatText(g, f.x, f.y, `+${f.bounty}`, p, C.brassDark);
          break;
        }
        case 'leak': {
          const wy = this.sy(ROWS);
          g.fillStyle = `rgba(236, 109, 100, ${0.5 * (1 - p)})`;
          g.fillRect(0, wy, COLS * cs, BOTTOM * cs);
          this.floatText(g, PATH[PATH.length - 1][0], ROWS - 0.2, `−${f.lost}`, p, '#b3322b');
          break;
        }
        case 'ring': {
          g.beginPath();
          g.arc(this.sx(f.x), this.sy(f.y), cs * (0.3 + (f.big ? 0.5 : 0.3) * p), 0, TAU);
          g.strokeStyle = `rgba(207, 165, 82, ${1 - p})`;
          g.lineWidth = Math.max(1.5, cs * (f.big ? 0.09 : 0.06));
          g.stroke();
          break;
        }
        case 'text':
          this.floatText(g, f.x, f.y, f.text, p, C.brassDark);
          break;
        case 'range':
          g.globalAlpha = 1 - p * p;
          this.drawRange(g, f.x, f.y, f.range);
          g.globalAlpha = 1;
          break;
        case 'muzzle':
          g.fillStyle = `rgba(255, 214, 140, ${0.8 * (1 - p)})`;
          g.beginPath();
          g.arc(this.sx(f.x), this.sy(f.y), cs * 0.2, 0, TAU);
          g.fill();
          break;
        default: break;
      }
    }
    this.fx.length = keep;
  }

  floatText(g, x, y, text, p, color) {
    const cs = this.cs;
    g.font = `700 ${Math.round(cs * 0.36)}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = 1 - p * p;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(236, 226, 204, 0.9)';
    const ty = this.sy(y) - cs * (0.3 + 0.5 * p);
    g.strokeText(text, this.sx(x), ty);
    g.fillStyle = color;
    g.fillText(text, this.sx(x), ty);
    g.globalAlpha = 1;
  }
}

// ---------- the march track: a whole road squeezed into one line ----------

/**
 * Shows a lane's road as a straight line from the forest (left) to the castle (right), with
 * every enemy on it as a dot by how far along it is. Units a player sent are drawn larger in
 * that player's colour, so you can follow your attack down the other road.
 */
export class TrackView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.hits = []; // { t0, text }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
  }

  hit(lost, now) {
    this.hits.push({ t0: now, text: `−${lost}` });
    if (this.hits.length > 6) this.hits.shift();
  }

  /** lane: the lane to show; castleColor: its owner's banner; colorOf: player id -> colour. */
  draw(lane, { castleColor, colorOf, highlight }, alpha, now) {
    const g = this.ctx;
    const { w, h } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cy = Math.round(h / 2) + 0.5;
    const x0 = 16;
    const x1 = w - 24;

    // Forest.
    g.fillStyle = C.treeA;
    for (const [dx, s] of [[2, 1], [8, 0.8]]) {
      g.beginPath();
      g.moveTo(dx + 4 * s, cy - 8 * s);
      g.lineTo(dx + 9 * s, cy + 5);
      g.lineTo(dx - 1 * s, cy + 5);
      g.closePath();
      g.fill();
    }

    // Road.
    g.strokeStyle = C.roadEdge;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, cy);
    g.lineTo(x1, cy);
    g.stroke();
    g.strokeStyle = C.road;
    g.lineWidth = 4;
    g.stroke();
    g.lineCap = 'butt';

    // Castle, flashing red when something gets through.
    let flash = 0;
    for (const hh of this.hits) flash = Math.max(flash, 1 - (now - hh.t0) / 700);
    const cx = w - 12;
    g.fillStyle = flash > 0 ? `rgb(${Math.round(110 + 126 * flash)}, ${Math.round(117 - 30 * flash)}, ${Math.round(129 - 40 * flash)})` : '#6d7581';
    g.fillRect(cx - 9, cy - 5, 18, 11);
    for (let i = 0; i < 3; i++) g.fillRect(cx - 9 + i * 7, cy - 9, 4, 4);
    g.fillStyle = C.gate;
    g.fillRect(cx - 2.5, cy + 1, 5, 5);
    g.fillStyle = castleColor;
    g.fillRect(cx - 1, cy - 15, 1.5, 7);
    g.beginPath();
    g.moveTo(cx + 0.5, cy - 15);
    g.lineTo(cx + 7, cy - 13);
    g.lineTo(cx + 0.5, cy - 11);
    g.closePath();
    g.fill();

    // Enemies: wave units small and pale, sent units bigger in their sender's colour.
    const span = x1 - x0;
    const sent = [];
    for (const e of lane.enemies) {
      if (!e.alive) continue;
      const d = e.d;
      const x = x0 + Math.min(1, Math.max(0, d / PATH_LEN)) * span;
      if (e.sentBy != null) { sent.push({ e, x }); continue; }
      g.fillStyle = 'rgba(236, 226, 204, 0.85)';
      g.beginPath();
      g.arc(x, cy, e.kind === 'giant' ? 4 : e.kind === 'ogre' ? 3.2 : 2.2, 0, TAU);
      g.fill();
    }
    for (const { e, x } of sent) {
      const r = e.kind === 'giant' ? 7 : e.kind === 'ogre' ? 5.5 : 4.2;
      g.fillStyle = colorOf(e.sentBy);
      g.strokeStyle = e.sentBy === highlight ? '#ffffff' : 'rgba(20, 16, 10, 0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, cy, r, 0, TAU);
      g.fill();
      g.stroke();
      if (e.slow > 0) {
        g.strokeStyle = 'rgba(191, 232, 255, 0.95)';
        g.beginPath();
        g.arc(x, cy, r + 2, 0, TAU);
        g.stroke();
      }
    }

    // "−2" floating up from the castle.
    g.font = '700 12px "IBM Plex Mono", ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const hh of this.hits) {
      const p = (now - hh.t0) / 1200;
      if (p < 0 || p >= 1) continue;
      g.globalAlpha = 1 - p;
      g.fillStyle = C.hpLow;
      g.fillText(hh.text, cx - 12, cy - 4 - p * 6);
    }
    g.globalAlpha = 1;
    this.hits = this.hits.filter((hh) => now - hh.t0 < 1200);
  }
}

// ---------- shared drawing (board and button thumbnails) ----------

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPad(g, x, y, cs) {
  const s = cs * 0.84;
  const r = cs * 0.14;
  g.fillStyle = 'rgba(70, 55, 30, 0.22)';
  roundRect(g, x - s / 2 + cs * 0.03, y - s / 2 + cs * 0.05, s, s, r);
  g.fill();
  g.fillStyle = C.pad;
  roundRect(g, x - s / 2, y - s / 2, s, s, r);
  g.fill();
  g.strokeStyle = C.padLo;
  g.lineWidth = Math.max(1, cs * 0.035);
  g.stroke();
  // Flagstone joints.
  g.strokeStyle = 'rgba(143, 130, 100, 0.55)';
  g.lineWidth = Math.max(1, cs * 0.02);
  g.beginPath();
  g.moveTo(x - s / 2 + r * 0.6, y + cs * 0.02);
  g.lineTo(x + s / 2 - r * 0.6, y - cs * 0.03);
  g.moveTo(x - cs * 0.05, y - s / 2 + r * 0.5);
  g.lineTo(x - cs * 0.02, y + s / 2 - r * 0.5);
  g.stroke();
  g.strokeStyle = C.padHi;
  g.lineWidth = Math.max(1, cs * 0.025);
  g.beginPath();
  g.moveTo(x - s / 2 + r, y - s / 2 + cs * 0.035);
  g.lineTo(x + s / 2 - r, y - s / 2 + cs * 0.035);
  g.stroke();
}

function drawTuft(g, x, y, cs, rnd) {
  g.strokeStyle = C.tuft;
  g.lineWidth = Math.max(1, cs * 0.028);
  g.lineCap = 'round';
  g.beginPath();
  for (let i = -1; i <= 1; i++) {
    g.moveTo(x + i * cs * 0.04, y);
    g.lineTo(x + i * cs * (0.07 + rnd() * 0.03), y - cs * (0.09 + rnd() * 0.05));
  }
  g.stroke();
  g.lineCap = 'butt';
}

function drawRock(g, x, y, cs, rnd) {
  const rx = cs * (0.06 + rnd() * 0.05);
  const ry = rx * (0.6 + rnd() * 0.25);
  g.fillStyle = C.rock;
  g.strokeStyle = C.rockLine;
  g.lineWidth = Math.max(1, cs * 0.02);
  g.beginPath();
  g.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, TAU);
  g.fill();
  g.stroke();
}

function drawBush(g, x, y, cs, rnd) {
  const r = cs * (0.06 + rnd() * 0.03);
  g.fillStyle = C.bushB;
  g.beginPath();
  g.arc(x + r * 0.6, y + r * 0.2, r, 0, TAU);
  g.fill();
  g.fillStyle = C.bushA;
  g.beginPath();
  g.arc(x - r * 0.3, y - r * 0.1, r * 1.05, 0, TAU);
  g.fill();
}

function octagonPath(g, x, y, R) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const px = x + Math.cos(a) * R;
    const py = y + Math.sin(a) * R;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

function crenellatedPath(g, x, y, R, depth, n) {
  const seg = TAU / n;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = i * seg - Math.PI / 2;
    const a1 = a0 + seg * 0.55;
    g.arc(x, y, R, a0, a1);
    g.arc(x, y, R - depth, a1, a0 + seg);
  }
  g.closePath();
}

const BASE_R = [0.33, 0.39, 0.43];
const WEAPON_SCALE = [0.82, 1, 1.08];

/**
 * A tower seen from above. Each level has its own base so upgrades read at a glance:
 * 1 wooden post, 2 stone tower with brass studs, 3 crenellated keep with a gold ring and a banner.
 */
export function drawTowerToken(g, x, y, cs, type, level, angle = -Math.PI / 2, banner = '#3e74c8') {
  const R = BASE_R[level] * cs;
  const lw = (v) => Math.max(1, cs * v);

  g.fillStyle = 'rgba(40, 30, 15, 0.32)';
  g.beginPath();
  g.ellipse(x + cs * 0.04, y + cs * 0.07, R * 1.04, R * 0.95, 0, 0, TAU);
  g.fill();

  if (level === 0) {
    g.fillStyle = '#8a6239';
    g.beginPath();
    g.arc(x, y, R, 0, TAU);
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = '#6b4a29';
    g.lineWidth = lw(0.025);
    g.beginPath();
    for (let k = -2; k <= 2; k++) { g.moveTo(x - R, y + k * cs * 0.11); g.lineTo(x + R, y + k * cs * 0.11); }
    g.stroke();
    g.restore();
    g.strokeStyle = '#3f2a14';
    g.lineWidth = lw(0.05);
    g.beginPath();
    g.arc(x, y, R, 0, TAU);
    g.stroke();
  } else if (level === 1) {
    octagonPath(g, x, y, R);
    g.fillStyle = '#8d949e';
    g.fill();
    g.strokeStyle = '#363b44';
    g.lineWidth = lw(0.05);
    g.stroke();
    octagonPath(g, x, y, R * 0.76);
    g.strokeStyle = 'rgba(220, 226, 233, 0.55)';
    g.lineWidth = lw(0.025);
    g.stroke();
    g.fillStyle = C.brass;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86, cs * 0.035, 0, TAU);
      g.fill();
    }
  } else {
    crenellatedPath(g, x, y, R * 1.06, cs * 0.085, 8);
    g.fillStyle = '#a7aeb8';
    g.fill();
    g.strokeStyle = '#363b44';
    g.lineWidth = lw(0.045);
    g.stroke();
    g.fillStyle = '#7b828c';
    g.beginPath();
    g.arc(x, y, R * 0.78, 0, TAU);
    g.fill();
    g.strokeStyle = C.brass;
    g.lineWidth = lw(0.05);
    g.stroke();
  }

  g.save();
  g.translate(x, y);
  g.scale(WEAPON_SCALE[level], WEAPON_SCALE[level]);
  switch (type) {
    case 'archer': drawArcher(g, cs, level, angle); break;
    case 'cannon': drawCannon(g, cs, level, angle); break;
    case 'frost': drawFrost(g, cs, level); break;
    case 'ballista': drawBallista(g, cs, level, angle); break;
    default: break;
  }
  g.restore();

  if (level === 2) {
    // Banner on the keep, in the owner's colour.
    const px = x - R * 0.72;
    const py = y - R * 0.72;
    g.strokeStyle = C.ink;
    g.lineWidth = lw(0.03);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, py - cs * 0.32);
    g.stroke();
    g.fillStyle = banner;
    g.beginPath();
    g.moveTo(px, py - cs * 0.32);
    g.lineTo(px + cs * 0.24, py - cs * 0.25);
    g.lineTo(px, py - cs * 0.18);
    g.closePath();
    g.fill();
  }

  // Level pips: one per level.
  const n = level + 1;
  for (let i = 0; i < n; i++) {
    const px = x + (i - (n - 1) / 2) * cs * 0.13;
    const py = y + R + cs * 0.02;
    g.fillStyle = C.brass;
    g.strokeStyle = 'rgba(28, 22, 7, 0.75)';
    g.lineWidth = lw(0.015);
    g.beginPath();
    g.arc(px, py, cs * 0.045, 0, TAU);
    g.fill();
    g.stroke();
  }
}

function drawBow(g, cs, color, tip) {
  const lw = (v) => Math.max(1, cs * v);
  g.strokeStyle = color;
  g.lineWidth = lw(0.05);
  g.beginPath();
  g.arc(-cs * 0.06, 0, cs * 0.21, -1.15, 1.15);
  g.stroke();
  const ex = -cs * 0.06 + cs * 0.21 * Math.cos(1.15);
  const ey = cs * 0.21 * Math.sin(1.15);
  g.strokeStyle = C.bone;
  g.lineWidth = lw(0.02);
  g.beginPath();
  g.moveTo(ex, -ey);
  g.lineTo(ex - cs * 0.05, 0);
  g.lineTo(ex, ey);
  g.stroke();
  g.lineWidth = lw(0.035);
  g.beginPath();
  g.moveTo(-cs * 0.13, 0);
  g.lineTo(cs * 0.24, 0);
  g.stroke();
  g.fillStyle = tip;
  g.beginPath();
  g.moveTo(cs * 0.3, 0);
  g.lineTo(cs * 0.2, -cs * 0.06);
  g.lineTo(cs * 0.2, cs * 0.06);
  g.closePath();
  g.fill();
}

function drawArcher(g, cs, level, angle) {
  g.rotate(angle);
  if (level === 2) {
    for (const off of [-0.11, 0.11]) {
      g.save();
      g.translate(0, off * cs);
      g.scale(0.82, 0.82);
      drawBow(g, cs, C.brassLight, C.brass);
      g.restore();
    }
    return;
  }
  drawBow(g, cs, C.bone, level === 1 ? C.brass : C.bone);
  if (level === 1) {
    // Quiver at the back.
    g.fillStyle = '#6b4a29';
    g.strokeStyle = '#3f2a14';
    g.lineWidth = Math.max(1, cs * 0.02);
    g.beginPath();
    g.rect(-cs * 0.27, cs * 0.1, cs * 0.15, cs * 0.08);
    g.fill();
    g.stroke();
    g.fillStyle = C.bone;
    for (let i = 0; i < 3; i++) g.fillRect(-cs * 0.3, cs * (0.105 + i * 0.025), cs * 0.035, cs * 0.015);
  }
}

function drawCannon(g, cs, level, angle) {
  g.rotate(angle);
  g.fillStyle = '#4b525c';
  g.beginPath();
  g.arc(0, 0, cs * 0.16, 0, TAU);
  g.fill();
  const barrels = level === 2 ? [-0.08, 0.08] : [0];
  const len = level === 0 ? 0.24 : 0.31;
  const w = level === 2 ? 0.11 : level === 1 ? 0.15 : 0.13;
  for (const off of barrels) {
    const y0 = off * cs - (w * cs) / 2;
    g.fillStyle = '#9aa4b0';
    g.strokeStyle = C.ink;
    g.lineWidth = Math.max(1, cs * 0.022);
    g.beginPath();
    g.rect(-cs * 0.02, y0, len * cs, w * cs);
    g.fill();
    g.stroke();
    g.fillStyle = '#c7ced6';
    g.fillRect((len - 0.06) * cs, y0 - cs * 0.015, cs * 0.05, w * cs + cs * 0.03);
    if (level >= 1) {
      g.fillStyle = C.brass;
      g.fillRect(cs * 0.07, y0, cs * 0.03, w * cs);
      g.fillRect(cs * 0.15, y0, cs * 0.03, w * cs);
    }
  }
}

function drawFrost(g, cs, level) {
  const lw = (v) => Math.max(1, cs * v);
  if (level === 2) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, cs * 0.36);
    gr.addColorStop(0, 'rgba(200, 238, 255, 0.85)');
    gr.addColorStop(1, 'rgba(168, 220, 245, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, cs * 0.36, 0, TAU);
    g.fill();
  } else {
    g.fillStyle = 'rgba(168, 220, 245, 0.2)';
    g.beginPath();
    g.arc(0, 0, cs * (level === 0 ? 0.22 : 0.28), 0, TAU);
    g.fill();
  }
  if (level === 0) {
    g.fillStyle = '#d4f0fd';
    g.strokeStyle = '#6fb8de';
    g.lineWidth = lw(0.025);
    g.beginPath();
    g.moveTo(0, -cs * 0.19);
    g.lineTo(cs * 0.1, 0);
    g.lineTo(0, cs * 0.19);
    g.lineTo(-cs * 0.1, 0);
    g.closePath();
    g.fill();
    g.stroke();
    return;
  }
  const arm = level === 2 ? 0.27 : 0.24;
  g.strokeStyle = level === 2 ? '#e6f7ff' : C.frost;
  g.lineWidth = lw(0.045);
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    g.save();
    g.rotate((i * Math.PI) / 3 + Math.PI / 2);
    g.beginPath();
    g.moveTo(-cs * arm, 0);
    g.lineTo(cs * arm, 0);
    for (const s of [-1, 1]) {
      g.moveTo(s * cs * arm * 0.65, 0);
      g.lineTo(s * cs * arm * 0.92, -cs * 0.065);
      g.moveTo(s * cs * arm * 0.65, 0);
      g.lineTo(s * cs * arm * 0.92, cs * 0.065);
    }
    g.stroke();
    g.restore();
  }
  g.lineCap = 'butt';
  if (level === 2) {
    g.fillStyle = C.brass;
    g.beginPath();
    g.arc(0, 0, cs * 0.05, 0, TAU);
    g.fill();
  }
}

function drawBallista(g, cs, level, angle) {
  const lw = (v) => Math.max(1, cs * v);
  g.rotate(angle);
  const limb = level === 2 ? C.brassLight : level === 1 ? '#b7bec7' : '#d9b27a';
  if (level === 2) {
    g.strokeStyle = C.brass;
    g.lineWidth = lw(0.045);
    g.beginPath();
    g.arc(-cs * 0.12, 0, cs * 0.22, -1.15, 1.15);
    g.stroke();
  }
  g.strokeStyle = limb;
  g.lineWidth = lw(level === 0 ? 0.055 : 0.065);
  g.beginPath();
  g.arc(-cs * 0.04, 0, cs * 0.26, -1.2, 1.2);
  g.stroke();
  const ex = -cs * 0.04 + cs * 0.26 * Math.cos(1.2);
  const ey = cs * 0.26 * Math.sin(1.2);
  g.strokeStyle = C.bone;
  g.lineWidth = lw(0.02);
  g.beginPath();
  g.moveTo(ex, -ey);
  g.lineTo(-cs * 0.12, 0);
  g.lineTo(ex, ey);
  g.stroke();
  g.strokeStyle = level >= 1 ? '#5b4630' : '#b88a4a';
  g.lineWidth = lw(0.07);
  g.beginPath();
  g.moveTo(-cs * 0.22, 0);
  g.lineTo(cs * 0.17, 0);
  g.stroke();
  g.strokeStyle = C.bone;
  g.lineWidth = lw(0.03);
  g.beginPath();
  g.moveTo(cs * 0.12, 0);
  g.lineTo(cs * 0.3, 0);
  g.stroke();
  if (level >= 1) {
    g.fillStyle = C.brass;
    g.beginPath();
    g.moveTo(cs * 0.36, 0);
    g.lineTo(cs * 0.28, -cs * 0.05);
    g.lineTo(cs * 0.28, cs * 0.05);
    g.closePath();
    g.fill();
  }
}

export function drawEnemyBody(g, x, y, r, cs, kind, angle = Math.PI / 2) {
  const st = ENEMY_STYLE[kind] || ENEMY_STYLE.goblin;
  const lw = (v) => Math.max(1, cs * v);
  g.save();
  g.translate(x, y);
  switch (kind) {
    case 'goblin': {
      g.fillStyle = st.fill;
      g.strokeStyle = st.line;
      g.lineWidth = lw(0.035);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.stroke();
      g.rotate(angle);
      g.fillStyle = st.line;
      g.beginPath();
      g.moveTo(r * 0.2, -r * 0.95);
      g.lineTo(r * 0.75, -r * 1.25);
      g.lineTo(r * 0.55, -r * 0.6);
      g.moveTo(r * 0.2, r * 0.95);
      g.lineTo(r * 0.75, r * 1.25);
      g.lineTo(r * 0.55, r * 0.6);
      g.fill();
      break;
    }
    case 'scout': {
      g.rotate(angle);
      g.fillStyle = st.fill;
      g.strokeStyle = st.line;
      g.lineWidth = lw(0.035);
      g.beginPath();
      g.ellipse(0, 0, r * 1.3, r * 0.75, 0, 0, TAU);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(r * 1.2, -r * 0.35);
      g.lineTo(r * 1.65, 0);
      g.lineTo(r * 1.2, r * 0.35);
      g.fill();
      g.fillStyle = '#3a2c22';
      g.beginPath();
      g.arc(-r * 0.15, 0, r * 0.45, 0, TAU);
      g.fill();
      break;
    }
    case 'shield': {
      g.fillStyle = st.fill;
      g.strokeStyle = st.line;
      g.lineWidth = lw(0.035);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.stroke();
      g.rotate(angle);
      g.fillStyle = '#d6dce3';
      g.beginPath();
      g.moveTo(r * 0.55, -r * 0.85);
      g.quadraticCurveTo(r * 1.15, -r * 0.8, r * 1.2, 0);
      g.quadraticCurveTo(r * 1.15, r * 0.8, r * 0.55, r * 0.85);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'ogre': {
      g.fillStyle = st.fill;
      g.strokeStyle = st.line;
      g.lineWidth = lw(0.045);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.stroke();
      g.rotate(angle);
      g.fillStyle = '#f1e7d0';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(r * 0.72, s * r * 0.35, r * 0.15, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'giant': {
      g.fillStyle = st.fill;
      g.strokeStyle = st.line;
      g.lineWidth = lw(0.055);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = C.brass;
      g.beginPath();
      const w = r * 0.9;
      g.moveTo(-w, -r * 0.15);
      g.lineTo(-w, -r * 0.6);
      g.lineTo(-w * 0.5, -r * 0.35);
      g.lineTo(0, -r * 0.75);
      g.lineTo(w * 0.5, -r * 0.35);
      g.lineTo(w, -r * 0.6);
      g.lineTo(w, -r * 0.15);
      g.closePath();
      g.fill();
      break;
    }
    default: break;
  }
  g.restore();
}

/** Small picture of a tower (at a level) or an enemy for buttons, as a data URL. */
export function thumbnail(kind, what, size = 48, level = 0, banner = '#3e74c8') {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 2);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  if (what === 'tower') {
    drawTowerToken(g, size / 2, size / 2 - size * 0.02, size * 0.98, kind, level, -Math.PI / 4, banner);
  } else {
    const r = Math.min(ENEMIES[kind].radius, 0.36) * size * 1.55;
    drawEnemyBody(g, size / 2, size / 2 + 2, r, size * 0.9, kind, 0);
  }
  return c.toDataURL('image/png');
}
