// Canvas drawing for one lane: a war-table map on parchment, with towers as brass-rimmed
// tokens and enemies as inked pieces. Reads simulation state; never changes it.
import { COLS, ROWS, PATH, TOWERS, ENEMIES } from './config.js';
import { mulberry32 } from './rng.js';

export const TOP = 0.6; // cells of forest above the grid
export const BOTTOM = 0.75; // cells of castle wall below the grid
export const BOARD_ROWS = ROWS + TOP + BOTTOM;

const C = {
  ground: '#d6c49b',
  speckDark: 'rgba(120, 95, 55, 0.10)',
  speckLight: 'rgba(255, 248, 225, 0.16)',
  grid: 'rgba(90, 70, 40, 0.09)',
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
  ink: '#2a2118',
  brass: '#cfa552',
  brassDark: '#8c6d2c',
  token: '#2b313b',
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
    this.reducedMotion = false;
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

  /** Grid cell under a point in CSS pixels relative to the canvas. */
  cellAt(px, py) {
    return { c: Math.floor(px / this.cs), r: Math.floor(py / this.cs - TOP) };
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

    // Cell lines, faint, so placement reads without a heavy grid.
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 1; c < COLS; c++) { g.moveTo(c * cs + 0.5, this.sy(0)); g.lineTo(c * cs + 0.5, this.sy(ROWS)); }
    for (let r = 1; r < ROWS; r++) { g.moveTo(0, this.sy(r) + 0.5); g.lineTo(W, this.sy(r) + 0.5); }
    g.stroke();

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
        case 'upgrade': this.fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, dur: 520, big: true }); break;
        case 'sell': this.fx.push({ k: 'text', x: e.x, y: e.y, text: `+${e.value}`, t0: now, dur: 900 }); break;
        case 'fire': if (e.kind === 'cannon' || e.kind === 'ballista') this.fx.push({ k: 'muzzle', x: e.x, y: e.y, t0: now, dur: 120 }); break;
        default: break;
      }
    }
    if (this.fx.length > 220) this.fx.splice(0, this.fx.length - 220);
  }

  // ---------- frame ----------
  draw(lane, alpha, now) {
    const g = this.ctx;
    const cs = this.cs;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.drawImage(this.bg, 0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    // Castle banner in this player's colour.
    this.drawBanners(g);

    const sel = this.selection;
    if (sel) {
      g.strokeStyle = C.select;
      g.lineWidth = Math.max(1.5, cs * 0.05);
      g.setLineDash([cs * 0.14, cs * 0.1]);
      g.strokeRect(this.sx(sel.c) + 1.5, this.sy(sel.r) + 1.5, cs - 3, cs - 3);
      g.setLineDash([]);
      if (sel.range) this.drawRange(g, sel.c + 0.5, sel.r + 0.5, sel.range);
    }

    for (const t of lane.towerList) this.drawTower(g, t);
    for (const e of lane.enemies) if (e.alive) this.drawEnemy(g, e, alpha);
    for (const p of lane.projectiles) if (p.alive) this.drawProjectile(g, p, alpha);
    this.drawFx(g, now);
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
    drawTowerToken(g, this.sx(t.x), this.sy(t.y), this.cs, t.type, t.level, t.angle);
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
          g.arc(this.sx(f.x), this.sy(f.y), cs * (0.3 + (f.big ? 0.45 : 0.3) * p), 0, TAU);
          g.strokeStyle = `rgba(207, 165, 82, ${1 - p})`;
          g.lineWidth = Math.max(1.5, cs * 0.06);
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

// ---------- shared drawing (board and menu thumbnails) ----------

export function drawTowerToken(g, x, y, cs, type, level, angle = -Math.PI / 2) {
  const R = cs * 0.4;
  g.fillStyle = 'rgba(40, 30, 15, 0.28)';
  g.beginPath();
  g.ellipse(x + cs * 0.035, y + cs * 0.06, R, R * 0.92, 0, 0, TAU);
  g.fill();
  g.fillStyle = C.token;
  g.beginPath();
  g.arc(x, y, R, 0, TAU);
  g.fill();
  g.strokeStyle = C.brass;
  g.lineWidth = Math.max(1.5, cs * (level === 2 ? 0.085 : 0.06));
  g.stroke();
  if (level >= 1) {
    g.beginPath();
    g.arc(x, y, R - cs * 0.1, 0, TAU);
    g.strokeStyle = level === 2 ? C.brass : C.brassDark;
    g.lineWidth = Math.max(1, cs * 0.025);
    g.stroke();
  }

  g.save();
  g.translate(x, y);
  const lw = (v) => Math.max(1, cs * v);
  switch (type) {
    case 'archer': {
      g.rotate(angle);
      g.strokeStyle = C.bone;
      g.lineWidth = lw(0.05);
      g.beginPath();
      g.arc(-cs * 0.06, 0, cs * 0.21, -1.15, 1.15);
      g.stroke();
      const ex = -cs * 0.06 + cs * 0.21 * Math.cos(1.15);
      const ey = cs * 0.21 * Math.sin(1.15);
      g.lineWidth = lw(0.02);
      g.beginPath();
      g.moveTo(ex, -ey);
      g.lineTo(ex - cs * 0.05, 0);
      g.lineTo(ex, ey);
      g.stroke();
      g.lineWidth = lw(0.035);
      g.beginPath();
      g.moveTo(-cs * 0.13, 0);
      g.lineTo(cs * 0.25, 0);
      g.stroke();
      g.fillStyle = C.bone;
      g.beginPath();
      g.moveTo(cs * 0.29, 0);
      g.lineTo(cs * 0.2, -cs * 0.055);
      g.lineTo(cs * 0.2, cs * 0.055);
      g.closePath();
      g.fill();
      break;
    }
    case 'cannon': {
      g.rotate(angle);
      g.fillStyle = '#59616c';
      g.beginPath();
      g.arc(0, 0, cs * 0.15, 0, TAU);
      g.fill();
      g.fillStyle = '#9aa4b0';
      g.strokeStyle = C.ink;
      g.lineWidth = lw(0.025);
      g.beginPath();
      g.rect(-cs * 0.02, -cs * 0.075, cs * 0.31, cs * 0.15);
      g.fill();
      g.stroke();
      g.fillStyle = '#c7ced6';
      g.fillRect(cs * 0.24, -cs * 0.09, cs * 0.05, cs * 0.18);
      break;
    }
    case 'frost': {
      g.fillStyle = 'rgba(168, 220, 245, 0.18)';
      g.beginPath();
      g.arc(0, 0, cs * 0.29, 0, TAU);
      g.fill();
      g.strokeStyle = C.frost;
      g.lineWidth = lw(0.045);
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate((i * Math.PI) / 3 + Math.PI / 2);
        g.beginPath();
        g.moveTo(-cs * 0.25, 0);
        g.lineTo(cs * 0.25, 0);
        for (const s of [-1, 1]) {
          g.moveTo(s * cs * 0.16, 0);
          g.lineTo(s * cs * 0.23, -cs * 0.06);
          g.moveTo(s * cs * 0.16, 0);
          g.lineTo(s * cs * 0.23, cs * 0.06);
        }
        g.stroke();
        g.restore();
      }
      g.lineCap = 'butt';
      break;
    }
    case 'ballista': {
      g.rotate(angle);
      g.strokeStyle = '#d9b27a';
      g.lineWidth = lw(0.055);
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
      g.strokeStyle = '#b88a4a';
      g.lineWidth = lw(0.07);
      g.beginPath();
      g.moveTo(-cs * 0.22, 0);
      g.lineTo(cs * 0.17, 0);
      g.stroke();
      g.strokeStyle = C.bone;
      g.lineWidth = lw(0.03);
      g.beginPath();
      g.moveTo(cs * 0.12, 0);
      g.lineTo(cs * 0.31, 0);
      g.stroke();
      break;
    }
    default: break;
  }
  g.restore();

  // Level pips under the token.
  if (level > 0) {
    g.fillStyle = C.brass;
    for (let i = 0; i <= level; i++) {
      const px = x + (i - level / 2) * cs * 0.13;
      g.beginPath();
      g.arc(px, y + R - cs * 0.01, cs * 0.045, 0, TAU);
      g.fill();
    }
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

/** Small picture of a tower or enemy for buttons, as a data URL. */
export function thumbnail(kind, what, size = 48) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 2);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  if (what === 'tower') {
    drawTowerToken(g, size / 2, size / 2, size * 1.05, kind, 0, -Math.PI / 4);
  } else {
    const r = Math.min(ENEMIES[kind].radius, 0.36) * size * 1.55;
    drawEnemyBody(g, size / 2, size / 2 + 2, r, size * 0.9, kind, 0);
  }
  return c.toDataURL('image/png');
}

export { C as COLORS, TOWERS as TOWER_DEFS };
