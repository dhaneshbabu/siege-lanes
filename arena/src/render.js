// Drawing for Powder Keg: a walled courtyard seen from slightly above, with crates and stones that
// stand up off the floor, powder kegs with spitting fuses, blasts that leave smoke and scorch marks,
// power-up medallions with name tags, and little knights in their side's colours.
import { FLOOR, PILLAR, CRATE, BURNING, BLOCK, SIDES, POWERS } from './config.js';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
import { ARM } from './sim.js';

const TAU = Math.PI * 2;

// ---------- looks ----------
export const THEMES = {
  castle: {
    name: 'Castle courtyard',
    floor: ['#d9c9a1', '#d2c196', '#cdbb90', '#d6c59b'],
    grout: 'rgba(105, 85, 50, 0.3)',
    crack: 'rgba(95, 75, 45, 0.4)',
    wallTop: '#596579',
    wallFace: '#3c4554',
    wallDark: '#262d38',
    merlon: '#6b788d',
    towerTop: '#647086',
    stone: { top: '#c3cad3', face: '#8b94a1', edge: '#e1e6ec', dark: '#5a616c', line: 'rgba(45, 50, 60, 0.35)' },
    block: { top: '#6d7581', face: '#4b525d', edge: '#838c98', dark: '#363b43', line: 'rgba(0, 0, 0, 0.3)' },
    light: { kind: 'torch', color: '255, 170, 70' },
    deco: 'castle',
  },
  winter: {
    name: 'Winter keep',
    floor: ['#eaf0f6', '#e2e9f2', '#dce5ef', '#e7eef5'],
    grout: 'rgba(120, 145, 175, 0.3)',
    crack: 'rgba(130, 165, 200, 0.55)',
    wallTop: '#eef4fa',
    wallFace: '#56677d',
    wallDark: '#36414f',
    merlon: '#ffffff',
    towerTop: '#e6eef7',
    stone: { top: '#dcf2ff', face: '#93c7ea', edge: '#ffffff', dark: '#5f95bd', line: 'rgba(255, 255, 255, 0.7)', ice: true },
    block: { top: '#7f8fa5', face: '#5b6a7f', edge: '#9eadc0', dark: '#3f4a59', line: 'rgba(0, 0, 0, 0.25)' },
    light: { kind: 'lantern', color: '170, 215, 255' },
    deco: 'winter',
  },
  forest: {
    name: 'Greenwood fort',
    floor: ['#8fb859', '#87b052', '#94bd5f', '#8bb456'],
    grout: 'rgba(55, 85, 30, 0.16)',
    crack: 'rgba(70, 100, 40, 0.35)',
    wallTop: '#8b6439',
    wallFace: '#5c3d20',
    wallDark: '#3f2913',
    merlon: '#a3784a',
    towerTop: '#7a5532',
    stone: { top: '#a7ae9b', face: '#737c6c', edge: '#c3c9b8', dark: '#4f5749', line: 'rgba(40, 50, 35, 0.3)', moss: '#5c8c38' },
    block: { top: '#666e5f', face: '#4a5144', edge: '#7e8776', dark: '#353a30', line: 'rgba(0, 0, 0, 0.3)' },
    light: { kind: 'torch', color: '255, 175, 80' },
    deco: 'forest',
  },
};

const WOOD = { top: '#b7803f', light: '#d7a25f', dark: '#6d4520', seam: 'rgba(80, 45, 15, 0.55)', metal: '#8a9099' };
const STEEL = '#d5dbe2';
const STEEL_DARK = '#8a939e';
const INK = '#2a2118';
const BRASS = '#cfa552';

// Power-up medallions: colour, glow and the name shown on the tag.
export const POWER_STYLE = {
  keg: { a: '#f0905a', b: '#a8441b', glow: '240, 140, 80' },
  fire: { a: '#ffd862', b: '#e07f0c', glow: '255, 196, 70' },
  boots: { a: '#8ae0ff', b: '#2a86c2', glow: '120, 210, 255' },
};

// ---------- small helpers ----------
function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function hash(x, y, k) {
  const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const gg = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r}, ${gg}, ${bl})`;
}

function canvasOf(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  return { c, g };
}

// ---------- tiles that stand up off the floor ----------
// Each is drawn into a sprite: a top face (cs × cs) lifted by `lift`, a front face below it,
// and a soft shadow to the lower right. The sprite is placed at (cellX, cellY - lift).

function drawStoneTile(g, cs, lift, st, seed) {
  // Shadow.
  g.fillStyle = 'rgba(30, 20, 10, 0.22)';
  roundRect(g, cs * 0.12, lift + cs * 0.14, cs * 1.0, cs * 0.98, cs * 0.12);
  g.fill();
  if (st.moss) {
    // A mossy boulder.
    g.fillStyle = st.dark;
    roundRect(g, cs * 0.02, cs * 0.18, cs * 0.96, cs + lift - cs * 0.2, cs * 0.3);
    g.fill();
    g.fillStyle = st.face;
    roundRect(g, cs * 0.04, cs * 0.16, cs * 0.92, cs + lift - cs * 0.26, cs * 0.28);
    g.fill();
    g.fillStyle = st.top;
    roundRect(g, cs * 0.06, cs * 0.04, cs * 0.88, cs * 0.82, cs * 0.3);
    g.fill();
    g.fillStyle = st.edge;
    g.beginPath();
    g.ellipse(cs * 0.36, cs * 0.26, cs * 0.18, cs * 0.09, -0.4, 0, TAU);
    g.fill();
    g.fillStyle = st.moss;
    g.beginPath();
    g.ellipse(cs * 0.6, cs * 0.18, cs * 0.26, cs * 0.12, 0.2, 0, TAU);
    g.ellipse(cs * 0.28, cs * 0.62, cs * 0.16, cs * 0.1, 0.4, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.18)';
    g.beginPath();
    g.ellipse(cs * 0.55, cs * 0.14, cs * 0.14, cs * 0.05, 0.2, 0, TAU);
    g.fill();
    return;
  }
  // Front face.
  g.fillStyle = st.dark;
  g.fillRect(0, cs - 1, cs, lift + 1);
  g.fillStyle = st.face;
  g.fillRect(cs * 0.03, cs, cs * 0.94, lift - cs * 0.05);
  // Top face with a bevel.
  g.fillStyle = st.dark;
  g.fillRect(0, 0, cs, cs);
  g.fillStyle = st.top;
  g.fillRect(cs * 0.05, cs * 0.05, cs * 0.9, cs * 0.9);
  g.fillStyle = st.edge;
  g.fillRect(cs * 0.05, cs * 0.05, cs * 0.9, cs * 0.07);
  g.fillRect(cs * 0.05, cs * 0.05, cs * 0.07, cs * 0.9);
  if (st.ice) {
    // Shine streaks across an ice block.
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = Math.max(1, cs * 0.06);
    g.beginPath();
    g.moveTo(cs * 0.2, cs * 0.62);
    g.lineTo(cs * 0.62, cs * 0.2);
    g.moveTo(cs * 0.36, cs * 0.78);
    g.lineTo(cs * 0.78, cs * 0.36);
    g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fillRect(cs * 0.03, cs + lift * 0.15, cs * 0.94, lift * 0.25);
    return;
  }
  // Mortar lines: two blocks on top, bricks on the front.
  g.strokeStyle = st.line;
  g.lineWidth = Math.max(1, cs * 0.035);
  g.beginPath();
  const v = 0.42 + hash(seed, 1, 3) * 0.16;
  g.moveTo(cs * v, cs * 0.12);
  g.lineTo(cs * v, cs * 0.88);
  g.moveTo(cs * 0.12, cs * 0.55);
  g.lineTo(cs * v, cs * 0.55);
  g.moveTo(cs * 0.12, cs + lift * 0.5);
  g.lineTo(cs * 0.88, cs + lift * 0.5);
  g.moveTo(cs * 0.35, cs);
  g.lineTo(cs * 0.35, cs + lift * 0.5);
  g.moveTo(cs * 0.7, cs + lift * 0.5);
  g.lineTo(cs * 0.7, cs + lift);
  g.stroke();
}

function drawCrateTile(g, cs, lift, snow, burnt) {
  const top = burnt ? '#6e4a2c' : WOOD.top;
  const light = burnt ? '#7d5634' : WOOD.light;
  const dark = burnt ? '#3d2512' : WOOD.dark;
  g.fillStyle = 'rgba(30, 20, 10, 0.22)';
  roundRect(g, cs * 0.12, lift + cs * 0.14, cs * 1.0, cs * 0.98, cs * 0.08);
  g.fill();
  // Front face: planks with iron corners.
  g.fillStyle = dark;
  g.fillRect(cs * 0.04, cs - 1, cs * 0.92, lift + 1);
  g.fillStyle = mix(top, '#000000', 0.25);
  g.fillRect(cs * 0.06, cs, cs * 0.88, lift - cs * 0.05);
  g.strokeStyle = WOOD.seam;
  g.lineWidth = Math.max(1, cs * 0.03);
  g.beginPath();
  g.moveTo(cs * 0.06, cs + lift * 0.5);
  g.lineTo(cs * 0.94, cs + lift * 0.5);
  g.stroke();
  g.fillStyle = WOOD.metal;
  g.fillRect(cs * 0.04, cs, cs * 0.1, lift);
  g.fillRect(cs * 0.86, cs, cs * 0.1, lift);
  // Top face: a framed lid with a diagonal brace.
  g.fillStyle = dark;
  g.fillRect(cs * 0.04, cs * 0.02, cs * 0.92, cs * 0.98);
  g.fillStyle = top;
  g.fillRect(cs * 0.06, cs * 0.04, cs * 0.88, cs * 0.94);
  g.fillStyle = light;
  g.fillRect(cs * 0.06, cs * 0.04, cs * 0.88, cs * 0.06);
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1.2, cs * 0.07);
  g.strokeRect(cs * 0.13, cs * 0.11, cs * 0.74, cs * 0.8);
  g.beginPath();
  g.moveTo(cs * 0.16, cs * 0.14);
  g.lineTo(cs * 0.84, cs * 0.88);
  g.stroke();
  g.strokeStyle = WOOD.seam;
  g.lineWidth = Math.max(1, cs * 0.025);
  g.beginPath();
  g.moveTo(cs * 0.5, cs * 0.12);
  g.lineTo(cs * 0.5, cs * 0.9);
  g.stroke();
  g.fillStyle = WOOD.metal;
  for (const [nx, ny] of [[0.13, 0.11], [0.87, 0.11], [0.13, 0.91], [0.87, 0.91]]) {
    g.beginPath();
    g.arc(cs * nx, cs * ny, Math.max(1, cs * 0.04), 0, TAU);
    g.fill();
  }
  if (snow && !burnt) {
    g.fillStyle = '#f4f8fc';
    g.beginPath();
    g.moveTo(cs * 0.04, cs * 0.3);
    g.quadraticCurveTo(cs * 0.04, cs * 0.0, cs * 0.3, cs * 0.02);
    g.lineTo(cs * 0.75, cs * 0.0);
    g.quadraticCurveTo(cs * 0.98, cs * 0.0, cs * 0.96, cs * 0.24);
    g.quadraticCurveTo(cs * 0.7, cs * 0.34, cs * 0.5, cs * 0.26);
    g.quadraticCurveTo(cs * 0.25, cs * 0.4, cs * 0.04, cs * 0.3);
    g.fill();
  }
  if (burnt) {
    g.fillStyle = 'rgba(20, 10, 5, 0.45)';
    for (const [bx, by, br] of [[0.3, 0.35, 0.16], [0.65, 0.6, 0.2], [0.4, 0.75, 0.12]]) {
      g.beginPath();
      g.arc(cs * bx, cs * by, cs * br, 0, TAU);
      g.fill();
    }
  }
}

// ---------- kegs, flames, knights, medallions ----------
function drawKeg(g, x, y, s, left, now, color) {
  // A powder keg standing on its cell. It swells faster and glows as the fuse burns down.
  const rate = 3 + (1 - left) * 12;
  const pulse = 1 + 0.07 * Math.sin((now / 1000) * rate * Math.PI);
  const w = s * 0.62 * pulse;
  const h = s * 0.68 * pulse;
  const bot = y + s * 0.3;
  const top = bot - h;
  const body = left < 0.3 ? mix('#8a5528', '#d0442c', 0.5 + 0.5 * Math.sin(now / 55)) : '#8a5528';
  drawKegBody(g, x, bot, s, w, h, body, color);
  const fl = 0.6 + 0.4 * Math.sin(now / 35);
  g.fillStyle = `rgba(255, 210, 90, ${fl})`;
  g.beginPath();
  g.arc(x + w * 0.3, top - h * 0.36, s * 0.1 * (0.8 + fl * 0.5), 0, TAU);
  g.fill();
  g.fillStyle = '#fff6d8';
  g.beginPath();
  g.arc(x + w * 0.3, top - h * 0.36, s * 0.045, 0, TAU);
  g.fill();
  return { fx: x + w * 0.3, fy: top - h * 0.36 };
}

/** The keg standing with its bottom at (x, bot), w × h, with its shadow and its fuse (not the spark). */
function drawKegBody(g, x, bot, s, w, h, body, color) {
  const top = bot - h;
  const mid = (top + bot) / 2;
  g.fillStyle = 'rgba(30, 18, 8, 0.3)';
  g.beginPath();
  g.ellipse(x + s * 0.04, bot, w * 0.55, h * 0.12, 0, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.moveTo(x - w * 0.4, top);
  g.quadraticCurveTo(x - w * 0.62, mid, x - w * 0.4, bot);
  g.lineTo(x + w * 0.4, bot);
  g.quadraticCurveTo(x + w * 0.62, mid, x + w * 0.4, top);
  g.closePath();
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = '#4a2a10';
  g.lineWidth = Math.max(1, s * 0.035);
  g.stroke();
  g.clip();
  g.strokeStyle = 'rgba(60, 30, 10, 0.55)';
  g.lineWidth = Math.max(1, s * 0.025);
  g.beginPath();
  g.moveTo(x - w * 0.18, top);
  g.quadraticCurveTo(x - w * 0.24, mid, x - w * 0.18, bot);
  g.moveTo(x + w * 0.18, top);
  g.quadraticCurveTo(x + w * 0.24, mid, x + w * 0.18, bot);
  g.stroke();
  g.fillStyle = 'rgba(255, 220, 170, 0.18)';
  g.fillRect(x - w * 0.5, top, w * 0.3, h);
  g.fillStyle = BRASS;
  g.fillRect(x - w, top + h * 0.14, w * 2, h * 0.11);
  g.fillRect(x - w, bot - h * 0.25, w * 2, h * 0.11);
  g.fillStyle = color;
  g.fillRect(x - w, mid - h * 0.07, w * 2, h * 0.14);
  g.restore();
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
}

/** A blast in one cell. With a sprite kit, it's stamped from pictures of each shape. */
function drawFlame(g, x, y, s, arms, life, now, kit = null) {
  const phase = now / 38 + x * 0.31 + y * 0.53;
  if (kit) {
    // Six steps as it dies down and three of its flicker look as lively as drawing it. The fade
    // is in the picture, so the bright core still shows through the fading edge. Fire is soft,
    // so its pictures are a little less sharp than the rest (and take less memory).
    const lq = Math.round(Math.min(1, Math.max(0, life)) * 6);
    const pq = Math.round((((phase % TAU) + TAU) % TAU) / (TAU / 3)) % 3;
    if (lq <= 0) return;
    stamp(g, flameSprite(kit, s, arms, lq, pq), x, y);
    return;
  }
  g.globalAlpha = Math.min(1, life * 2.2);
  drawFlameShape(g, x, y, s, arms, life, phase);
  g.globalAlpha = 1;
}

function flameSprite(kit, s, arms, lq, pq) {
  return kit.get(`fl:${arms}:${lq}:${pq}:${s}`, s * 1.5, s * 1.5, s * 0.75, s * 0.75, (q) => {
    q.globalAlpha = Math.min(1, (lq / 6) * 2.2);
    drawFlameShape(q, 0, 0, s, arms, lq / 6, (pq * TAU) / 3);
  }, kit.scale * 0.75);
}

function drawFlameShape(g, x, y, s, arms, life, phase) {
  const wob = (k) => 0.9 + 0.1 * Math.sin(phase + k);
  const layers = [
    ['#d9431a', 0.46],
    ['#f5952a', 0.34],
    ['#ffe07a', 0.21],
    ['#fffbea', 0.09],
  ];
  layers.forEach(([col, wv], k) => {
    const w = s * wv * wob(k) * (0.72 + 0.28 * life);
    g.fillStyle = col;
    if (arms & ARM[0]) g.fillRect(x - s / 2 - 0.5, y - w, s / 2 + 0.5, w * 2);
    if (arms & ARM[1]) g.fillRect(x, y - w, s / 2 + 0.5, w * 2);
    if (arms & ARM[2]) g.fillRect(x - w, y - s / 2 - 0.5, w * 2, s / 2 + 0.5);
    if (arms & ARM[3]) g.fillRect(x - w, y, w * 2, s / 2 + 0.5);
    const round = (cx, cy, rr) => {
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.fill();
    };
    round(x, y, w * (arms & 16 ? 1.45 : 1.08));
    // Rounded tips where a beam ends.
    const tip = (dx, dy) => round(x + dx * s * 0.32, y + dy * s * 0.32, w * 0.95);
    if (!(arms & 16)) {
      if ((arms & ARM[0]) && !(arms & ARM[1])) tip(-0.2, 0);
      if ((arms & ARM[1]) && !(arms & ARM[0])) tip(0.2, 0);
      if ((arms & ARM[2]) && !(arms & ARM[3])) tip(0, -0.2);
      if ((arms & ARM[3]) && !(arms & ARM[2])) tip(0, 0.2);
    }
  });
}

/**
 * A knight from above and slightly in front. opts: { alpha, spin, scale, ring }.
 */
function drawKnight(g, x, y, s, side, face, walk, now, opts = {}) {
  const r = s * 0.42;
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  if (opts.spin || opts.scale) {
    g.translate(x, y);
    if (opts.spin) g.rotate(opts.spin);
    if (opts.scale) g.scale(opts.scale, opts.scale);
    g.translate(-x, -y);
  }
  const step = walk ? Math.sin(walk * Math.PI * 2.2) : 0;
  const bob = walk ? Math.abs(step) * s * 0.05 : Math.sin(now / 400) * s * 0.012;
  if (opts.ring) {
    // A ring on the ground marks your own knight.
    g.strokeStyle = `rgba(157, 188, 240, ${0.55 + 0.25 * Math.sin(now / 300)})`;
    g.lineWidth = Math.max(1.5, s * 0.06);
    g.beginPath();
    g.ellipse(x, y + r * 0.78, r * 1.05, r * 0.42, 0, 0, TAU);
    g.stroke();
  }
  g.fillStyle = 'rgba(30, 18, 8, 0.3)';
  g.beginPath();
  g.ellipse(x, y + r * 0.78, r * 0.85, r * 0.3, 0, 0, TAU);
  g.fill();
  drawKnightBody(g, x, y - bob, s, side, face, step);
  g.restore();
}

/** The knight himself, standing at (x, yy), without his shadow: step is the stride, -1 to 1. */
function drawKnightBody(g, x, yy, s, side, face, step) {
  const r = s * 0.42;
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
  g.fillStyle = side.light;
  g.fillRect(x - r * 0.08, yy + r * 0.02, r * 0.16, r * 0.62);
  g.fillRect(x - r * 0.32, yy + r * 0.22, r * 0.64, r * 0.14);
  // Arms, and a small shield on the off-hand side.
  g.fillStyle = STEEL_DARK;
  g.beginPath();
  g.arc(x - r * 0.78, yy + r * 0.2 - swing * 0.4, r * 0.17, 0, TAU);
  g.arc(x + r * 0.78, yy + r * 0.2 + swing * 0.4, r * 0.17, 0, TAU);
  g.fill();
  if (face.y !== -1) {
    const sx = x + (face.x > 0 ? -r * 0.86 : face.x < 0 ? r * 0.86 : -r * 0.86);
    const sy = yy + r * 0.3;
    g.fillStyle = side.dark;
    g.beginPath();
    g.moveTo(sx - r * 0.26, sy - r * 0.26);
    g.lineTo(sx + r * 0.26, sy - r * 0.26);
    g.lineTo(sx + r * 0.26, sy + r * 0.02);
    g.quadraticCurveTo(sx + r * 0.22, sy + r * 0.28, sx, sy + r * 0.36);
    g.quadraticCurveTo(sx - r * 0.22, sy + r * 0.28, sx - r * 0.26, sy + r * 0.02);
    g.closePath();
    g.fill();
    g.strokeStyle = BRASS;
    g.lineWidth = Math.max(1, s * 0.03);
    g.stroke();
  }
  // Helmet.
  const hx = x + face.x * r * 0.1;
  const hy = yy - r * 0.32;
  g.strokeStyle = 'rgba(20, 15, 10, 0.8)';
  g.lineWidth = Math.max(1.2, s * 0.05);
  g.fillStyle = STEEL;
  g.beginPath();
  g.arc(hx, hy, r * 0.56, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  g.beginPath();
  g.arc(hx - r * 0.18, hy - r * 0.2, r * 0.16, 0, TAU);
  g.fill();
  g.fillStyle = side.light;
  g.strokeStyle = side.dark;
  g.lineWidth = Math.max(1, s * 0.03);
  g.beginPath();
  g.ellipse(hx - face.x * r * 0.3, hy - r * 0.55, r * 0.17, r * 0.3, -face.x * 0.6, 0, TAU);
  g.fill();
  g.stroke();
  if (face.y !== -1) {
    g.fillStyle = INK;
    if (face.x === 0) roundRect(g, hx - r * 0.34, hy - r * 0.02, r * 0.68, r * 0.15, r * 0.06);
    else roundRect(g, hx + (face.x > 0 ? r * 0.06 : -r * 0.5), hy - r * 0.02, r * 0.44, r * 0.15, r * 0.06);
    g.fill();
  }
}

/** The white symbol on a power-up: a barrel with a plus, a blast burst, or a boot with speed lines. */
function drawPowerGlyph(g, x, y, s, kind, dark) {
  g.save();
  g.lineJoin = 'round';
  g.fillStyle = '#ffffff';
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1, s * 0.16);
  if (kind === 'keg') {
    g.beginPath();
    g.moveTo(x - s * 0.42, y - s * 0.68);
    g.quadraticCurveTo(x - s * 0.72, y + s * 0.02, x - s * 0.42, y + s * 0.72);
    g.lineTo(x + s * 0.3, y + s * 0.72);
    g.quadraticCurveTo(x + s * 0.6, y + s * 0.02, x + s * 0.3, y - s * 0.68);
    g.closePath();
    g.translate(-s * 0.12, 0);
    g.stroke();
    g.fill();
    g.strokeStyle = dark;
    g.lineWidth = Math.max(1, s * 0.13);
    g.beginPath();
    g.moveTo(x - s * 0.58, y - s * 0.25);
    g.lineTo(x + s * 0.46, y - s * 0.25);
    g.moveTo(x - s * 0.58, y + s * 0.3);
    g.lineTo(x + s * 0.46, y + s * 0.3);
    g.stroke();
    g.translate(s * 0.12, 0);
    // The plus.
    const px = x + s * 0.62;
    const py = y - s * 0.55;
    const a = s * 0.34;
    const t = s * 0.15;
    g.beginPath();
    g.moveTo(px - t, py - a);
    g.lineTo(px + t, py - a);
    g.lineTo(px + t, py - t);
    g.lineTo(px + a, py - t);
    g.lineTo(px + a, py + t);
    g.lineTo(px + t, py + t);
    g.lineTo(px + t, py + a);
    g.lineTo(px - t, py + a);
    g.lineTo(px - t, py + t);
    g.lineTo(px - a, py + t);
    g.lineTo(px - a, py - t);
    g.lineTo(px - t, py - t);
    g.closePath();
    g.lineWidth = Math.max(1, s * 0.12);
    g.stroke();
    g.fill();
  } else if (kind === 'fire') {
    // A four-way burst: the shape of a blast, reaching out.
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const rr = i % 2 === 0 ? s * 0.95 : s * 0.34;
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    g.stroke();
    g.fill();
    g.fillStyle = '#ff9a2e';
    g.beginPath();
    g.arc(x, y, s * 0.24, 0, TAU);
    g.fill();
  } else {
    // A boot running to the right, with speed lines behind it.
    const bx = x + s * 0.12;
    g.beginPath();
    g.moveTo(bx - s * 0.34, y - s * 0.86);
    g.lineTo(bx + s * 0.2, y - s * 0.86);
    g.lineTo(bx + s * 0.2, y);
    g.quadraticCurveTo(bx + s * 0.32, y + s * 0.1, bx + s * 0.56, y + s * 0.16);
    g.quadraticCurveTo(bx + s * 0.9, y + s * 0.24, bx + s * 0.88, y + s * 0.66);
    g.lineTo(bx - s * 0.34, y + s * 0.66);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillStyle = dark;
    g.fillRect(bx - s * 0.34, y + s * 0.5, s * 1.22, s * 0.16);
    g.fillRect(bx - s * 0.34, y - s * 0.86, s * 0.54, s * 0.16);
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.2, s * 0.16);
    g.strokeStyle = '#ffffff';
    for (const [ly, lx] of [[-0.5, 0.95], [-0.12, 1.05], [0.26, 0.85]]) {
      g.beginPath();
      g.moveTo(x - s * lx, y + s * ly);
      g.lineTo(x - s * 0.42, y + s * ly);
      g.stroke();
    }
  }
  g.restore();
}

function drawMedallion(g, x, y, r, kind, now, glow = true) {
  if (glow) drawMedallionGlow(g, x, y, r, kind, 0.55 + 0.25 * Math.sin(now / 260));
  drawMedallionBody(g, x, y, r, kind);
}

function drawMedallionGlow(g, x, y, r, kind, pulse) {
  const st = POWER_STYLE[kind];
  const gr = g.createRadialGradient(x, y, r * 0.4, x, y, r * 1.9);
  gr.addColorStop(0, `rgba(${st.glow}, ${pulse})`);
  gr.addColorStop(1, `rgba(${st.glow}, 0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r * 1.9, 0, TAU);
  g.fill();
}

function drawMedallionBody(g, x, y, r, kind) {
  const st = POWER_STYLE[kind];
  const dg = g.createLinearGradient(x - r, y - r, x + r, y + r);
  dg.addColorStop(0, st.a);
  dg.addColorStop(1, st.b);
  g.fillStyle = 'rgba(25, 15, 5, 0.55)';
  g.beginPath();
  g.arc(x, y, r + Math.max(1, r * 0.1), 0, TAU);
  g.fill();
  g.fillStyle = dg;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  g.lineWidth = Math.max(1.2, r * 0.11);
  g.beginPath();
  g.arc(x, y, r * 0.9, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.25)';
  g.beginPath();
  g.ellipse(x - r * 0.25, y - r * 0.4, r * 0.45, r * 0.22, -0.4, 0, TAU);
  g.fill();
  drawPowerGlyph(g, x, y, r * 0.6, kind, st.b);
}

function drawPill(g, x, y, text, border, alpha = 1, size = 11) {
  g.save();
  g.globalAlpha = alpha;
  g.font = `800 ${size}px "Alegreya Sans", system-ui, sans-serif`;
  const tw = g.measureText(text).width;
  const w = tw + size * 1.1;
  const h = size * 1.75;
  g.fillStyle = 'rgba(21, 26, 34, 0.92)';
  roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  g.strokeStyle = border;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 0.5);
  g.restore();
}

function drawTag(g, x, y, text, color, alpha, now, k = 1) {
  const bob = Math.sin(now / 200) * 2 * k;
  g.save();
  g.globalAlpha = alpha;
  g.font = `800 ${13 * k}px "Alegreya Sans", system-ui, sans-serif`;
  const tw = g.measureText(text).width;
  const w = tw + 14 * k;
  const h = 20 * k;
  const yy = y + bob;
  g.fillStyle = color;
  roundRect(g, x - w / 2, yy - h / 2, w, h, 6 * k);
  g.fill();
  g.beginPath();
  g.moveTo(x - 6 * k, yy + h / 2 - 1);
  g.lineTo(x + 6 * k, yy + h / 2 - 1);
  g.lineTo(x, yy + h / 2 + 6 * k);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, yy + 1);
  g.restore();
}

function drawStar(g, x, y, r, rot) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.35;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
}

/** Words floating up off the courtyard, such as a power-up's name when it's picked up. */
function drawFloatText(g, x, y, text, color, size, ts) {
  g.font = `800 ${size}px "Alegreya Sans", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 4 * ts;
  g.strokeStyle = 'rgba(20, 15, 10, 0.9)';
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/** A torch flame on the wall at (x, y); fl is its flicker and sway leans it, -1 to 1. */
function drawTorchFlame(g, x, y, cs, fl, sway) {
  const fh = cs * 0.26 * fl;
  g.fillStyle = '#e8641e';
  g.beginPath();
  g.moveTo(x - cs * 0.08, y - cs * 0.04);
  g.quadraticCurveTo(x - cs * 0.07, y - fh, x + sway * cs * 0.03, y - fh * 1.25);
  g.quadraticCurveTo(x + cs * 0.07, y - fh, x + cs * 0.08, y - cs * 0.04);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffd774';
  g.beginPath();
  g.ellipse(x, y - fh * 0.45, cs * 0.04, fh * 0.35, 0, 0, TAU);
  g.fill();
}

/** A corner tower's flag on its pole, waving (wave: -1 to 1). */
function drawFlag(g, px, py, cs, color, dark, wave) {
  const ph = cs * 0.9;
  g.strokeStyle = '#3a2c1d';
  g.lineWidth = Math.max(1.5, cs * 0.06);
  g.beginPath();
  g.moveTo(px, py + cs * 0.1);
  g.lineTo(px, py - ph);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(px, py - ph);
  g.quadraticCurveTo(px + cs * 0.3, py - ph - cs * 0.08 * wave, px + cs * 0.6, py - ph + cs * 0.02);
  g.lineTo(px + cs * 0.48, py - ph + cs * 0.17);
  g.lineTo(px + cs * 0.6, py - ph + cs * 0.32);
  g.quadraticCurveTo(px + cs * 0.3, py - ph + cs * 0.38 + cs * 0.08 * wave, px, py - ph + cs * 0.34);
  g.closePath();
  g.fill();
  g.strokeStyle = dark;
  g.lineWidth = 1;
  g.stroke();
}

// ---------- sprites: draw a picture once, then stamp it ----------
// Curves, outlines, clips and gradients are slow on a TV's graphics chip, while copying a picture
// (drawImage) is quick. With a SpriteKit, each knight pose, keg, power-up, label and glow is drawn
// once into a small canvas and stamped from then on. The phone and computer game doesn't use one.
export class SpriteKit {
  constructor(scale = 2) {
    this.scale = scale; // picture pixels per CSS pixel: the sharpest the courtyard is ever drawn
    this.map = new Map();
    this.dots = new Map(); // filled circles: colour -> by size
    this.made = 0;
    // Each picture is swapped for an ImageBitmap once one is ready: a TV copies those faster
    // than a small canvas.
    this.bitmaps = typeof createImageBitmap === 'function';
    this.measurer = document.createElement('canvas').getContext('2d');
    // Labels drawn before the game's fonts arrived are drawn again with them.
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => this.forget('t:'));
  }

  forget(prefix) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }

  /** The picture for key: w × h CSS px, drawn by draw(g) with (ax, ay) as the origin. */
  get(key, w, h, ax, ay, draw, scale = this.scale) {
    let s = this.map.get(key);
    if (s) return s;
    if (this.map.size > 2500) this.map.clear();
    const { c, g } = canvasOf(w, h, scale);
    g.translate(ax, ay);
    draw(g);
    s = { c, w: c.width / scale, h: c.height / scale, ax, ay };
    this.map.set(key, s);
    this.made++;
    this.freeze(s);
    return s;
  }

  /** Swap a picture's canvas for an ImageBitmap of it, when that's ready. */
  freeze(s, field = 'c') {
    if (!this.bitmaps) return;
    createImageBitmap(s[field]).then((b) => { s[field] = b; }, () => {});
  }

  textWidth(font, text) {
    this.measurer.font = font;
    return this.measurer.measureText(text).width;
  }

  /** A label's picture: measured and drawn only the first time it's needed. */
  label(key, font, text, pad, draw) {
    const s = this.map.get(key);
    if (s) return s;
    const [w, h, ax, ay] = pad(this.textWidth(font, text));
    return this.get(key, w, h, ax, ay, draw);
  }
}

// While warming up, pictures are only made, not stamped.
let warming = false;

/** Stamp a picture with its origin at (x, y), k times its size. */
function stamp(g, s, x, y, k = 1) {
  if (warming) return;
  g.drawImage(s.c, x - s.ax * k, y - s.ay * k, s.w * k, s.h * k);
}

// Embers cool from yellow to red in seven steps.
const EMBERS = [0, 1, 2, 3, 4, 5, 6].map((k) => `rgb(255, ${200 - k * 20}, 60)`);

// Filled circles come in a few sizes, so that none is shrunk or stretched by more than double.
const DOT_SIZES = [3, 6, 12, 24, 48];
function dotSprite(kit, color, r) {
  let i = 0;
  while (i < DOT_SIZES.length - 1 && DOT_SIZES[i] < r) i++;
  let byColor = kit.dots.get(color);
  if (!byColor) kit.dots.set(color, (byColor = []));
  let s = byColor[i];
  if (!s) {
    const R = DOT_SIZES[i];
    const { c, g } = canvasOf(R * 2 + 2, R * 2 + 2, kit.scale);
    g.fillStyle = color;
    g.beginPath();
    g.arc(R + 1, R + 1, R, 0, TAU);
    g.fill();
    s = byColor[i] = { c, w: c.width / kit.scale, h: c.height / kit.scale, ax: R + 1, ay: R + 1, R };
    kit.made++;
    kit.freeze(s);
  }
  return s;
}

/** A filled circle of radius r (its colour opaque; use globalAlpha for see-through). */
function dot(kit, g, x, y, r, color) {
  const s = dotSprite(kit, color, r);
  stamp(g, s, x, y, r / s.R);
}

/** A filled ellipse, rx × ry. */
function oval(kit, g, x, y, rx, ry, color) {
  const s = dotSprite(kit, color, Math.max(rx, ry));
  const kx = rx / s.R;
  const ky = ry / s.R;
  if (!warming) g.drawImage(s.c, x - s.ax * kx, y - s.ay * ky, s.w * kx, s.h * ky);
}

function knightFast(kit, g, x, y, s, side, face, walk, now, opts = {}) {
  const r = s * 0.42;
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  if (alpha <= 0) return;
  const step = walk ? Math.sin(walk * Math.PI * 2.2) : 0;
  const bob = walk ? Math.abs(step) * s * 0.05 : Math.sin(now / 400) * s * 0.012;
  const turned = opts.spin || opts.scale;
  if (turned) {
    g.save();
    g.translate(x, y);
    if (opts.spin) g.rotate(opts.spin);
    if (opts.scale) g.scale(opts.scale, opts.scale);
    x = 0;
    y = 0;
  }
  if (opts.ring) {
    const lw = Math.max(1.5, s * 0.06);
    const ring = kit.get(`ring:${s}`, r * 2.1 + lw * 2 + 2, r * 0.84 + lw * 2 + 2, r * 1.05 + lw + 1, r * 0.42 + lw + 1, (q) => {
      q.strokeStyle = 'rgb(157, 188, 240)';
      q.lineWidth = lw;
      q.beginPath();
      q.ellipse(0, 0, r * 1.05, r * 0.42, 0, 0, TAU);
      q.stroke();
    });
    g.globalAlpha = alpha * (0.55 + 0.25 * Math.sin(now / 300));
    stamp(g, ring, x, y + r * 0.78);
  }
  g.globalAlpha = alpha * 0.3;
  oval(kit, g, x, y + r * 0.78, r * 0.85, r * 0.3, 'rgb(30, 18, 8)');
  g.globalAlpha = alpha;
  // Nine poses through a stride look as smooth as drawing every one.
  const q = Math.round(step * 4) / 4;
  const body = kit.get(`k:${side.color}:${face.x},${face.y}:${q}:${s}`, r * 2.6, r * 2.7, r * 1.3, r * 1.38, (gg) => drawKnightBody(gg, 0, 0, s, side, face, q));
  stamp(g, body, x, y - bob);
  g.globalAlpha = 1;
  if (turned) g.restore();
}

function kegFast(kit, g, x, y, s, left, now, color) {
  const rate = 3 + (1 - left) * 12;
  const pulse = 1 + 0.07 * Math.sin((now / 1000) * rate * Math.PI);
  const w0 = s * 0.62;
  const h0 = s * 0.68;
  const bot = y + s * 0.3;
  // Nearly out: the keg flashes red, in five shades.
  const t = left < 0.3 ? Math.round((0.5 + 0.5 * Math.sin(now / 55)) * 4) / 4 : -1;
  const body = kit.get(`keg:${color}:${t}:${s}`, s * 0.92, s * 1.12, s * 0.46, s * 1.0, (q) => drawKegBody(q, 0, 0, s, w0, h0, t < 0 ? '#8a5528' : mix('#8a5528', '#d0442c', t), color));
  stamp(g, body, x, bot, pulse);
  const w = w0 * pulse;
  const h = h0 * pulse;
  const fx = x + w * 0.3;
  const fy = bot - h - h * 0.36;
  const fl = 0.6 + 0.4 * Math.sin(now / 35);
  g.globalAlpha = fl;
  dot(kit, g, fx, fy, s * 0.1 * (0.8 + fl * 0.5), 'rgb(255, 210, 90)');
  g.globalAlpha = 1;
  dot(kit, g, fx, fy, s * 0.045, '#fff6d8');
  return { fx, fy };
}

function medallionFast(kit, g, x, y, r, kind, now) {
  const glow = kit.get(`mg:${kind}:${r}`, r * 3.8 + 2, r * 3.8 + 2, r * 1.9 + 1, r * 1.9 + 1, (q) => drawMedallionGlow(q, 0, 0, r, kind, 1));
  g.globalAlpha = 0.55 + 0.25 * Math.sin(now / 260);
  stamp(g, glow, x, y);
  g.globalAlpha = 1;
  stamp(g, kit.get(`mb:${kind}:${r}`, r * 2.4 + 4, r * 2.4 + 4, r * 1.2 + 2, r * 1.2 + 2, (q) => drawMedallionBody(q, 0, 0, r, kind)), x, y);
}

const labelFont = (size) => `800 ${size}px "Alegreya Sans", system-ui, sans-serif`;

function pillFast(kit, g, x, y, text, border, alpha, size) {
  const s = kit.label(`t:p:${text}:${border}:${size}`, labelFont(size), text, (tw) => {
    const w = tw + size * 1.1 + 4;
    const h = size * 1.75 + 4;
    return [w, h, w / 2, h / 2];
  }, (q) => drawPill(q, 0, 0, text, border, 1, size));
  g.globalAlpha = alpha;
  stamp(g, s, x, y);
  g.globalAlpha = 1;
}

function tagFast(kit, g, x, y, text, color, alpha, now, k) {
  const s = kit.label(`t:g:${text}:${color}:${k}`, labelFont(13 * k), text, (tw) => {
    const w = tw + 14 * k + 4;
    return [w, 26 * k + 4, w / 2, 10 * k + 2];
  }, (q) => drawTag(q, 0, 0, text, color, 1, 0, k));
  g.globalAlpha = alpha;
  stamp(g, s, x, y + Math.sin(now / 200) * 2 * k);
  g.globalAlpha = 1;
}

function floatTextFast(kit, g, x, y, text, color, size, ts) {
  const lw = 4 * ts;
  stamp(g, kit.label(`t:x:${text}:${color}:${size}`, labelFont(size), text, (tw) => {
    const w = tw + lw * 2 + 4;
    const h = size * 1.5 + lw * 2;
    return [w, h, w / 2, h / 2];
  }, (q) => drawFloatText(q, 0, 0, text, color, size, ts)), x, y);
}

function tileSprite(kit, kind, cs, lift, th) {
  const W = cs * 1.15;
  const H = cs + lift + cs * 0.16;
  return kit.get(`tile:${kind}:${cs}`, W, H, 0, 0, (g) => {
    if (kind === 'stone') drawStoneTile(g, cs, lift, th.stone, 3);
    else drawCrateTile(g, cs, lift, false, true);
  });
}

// ---------- the renderer ----------
export class ArenaRenderer {
  /** opts: { kit: a SpriteKit to stamp pictures instead of drawing them (the TV app) }. */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.kit = opts.kit || null;
    // The courtyard covers the whole canvas, so with a kit (on a TV) it needn't be see-through.
    this.ctx = this.kit ? canvas.getContext('2d', { alpha: false }) : canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.n = 0;
    this.cs = 32;
    this.lift = 7;
    this.ox = 0;
    this.oy = 0;
    this.bg = null;
    this.bgKey = '';
    this.sprites = null;
    this.spriteKey = '';
    this.parts = [];
    this.decals = [];
    this.fx = this.parts; // older code clears this between rounds
    this.revealed = new Map(); // item cell -> time it appeared
    this.lights = [];
    this.flags = [];
    this.lastNow = 0;
    this.shake = [];
    this.sparkAcc = 0;
    this.me = 0; // whose knight gets the ring and the big pick-up labels
    this.sides = SIDES; // colours by seat (2 v 2 has its own)
    this.pixelRatio = 0; // 0: the screen's own
    this.debug = {}; // the TV app's performance checks switch parts of the drawing off
    this.textScale = 1; // labels drawn on the courtyard (bigger on a TV)
    this.scorchQueue = []; // with a kit: scorch marks still to burn into the floor
    this.scorched = new Set(); // ...and the cells that have one
  }

  /** Colours by seat for the coming match. */
  setSides(list) {
    this.sides = list;
    this.bgKey = '';
  }

  /** Fit an n×n courtyard (plus its wall) into the canvas's CSS box. */
  layout(arena, rect = this.canvas.getBoundingClientRect()) {
    // The TV app picks its own render resolution (pixelRatio); otherwise match the screen.
    const dpr = this.pixelRatio || Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const n = arena.n;
    // Room for the wall, the corner towers and the lifted top row as well as the courtyard itself.
    // Cells line up with the pixels; with a kit, with its pictures' pixels, so a change of render
    // resolution on a TV doesn't change the cell size and every picture with it.
    const snap = this.kit ? this.kit.scale : dpr;
    const cs = Math.floor(Math.min(w / (n + 1.85), h / (n + 2.1)) * snap) / snap;
    this.w = w;
    this.h = h;
    this.n = n;
    this.cs = cs;
    this.lift = Math.round(cs * 0.22);
    this.ox = Math.round((w - n * cs) / 2);
    this.oy = Math.round((h - (n + 2.02) * cs) / 2 + cs * 1.12);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.arena = arena;
    if (!this.kit) this.bgKey = '';
  }

  /** A fresh round: forget the old one's smoke, scorch marks and tags. */
  reset() {
    this.parts.length = 0;
    this.decals.length = 0;
    this.scorchQueue.length = 0;
    this.shake.length = 0;
    this.revealed.clear();
  }

  cx(x) { return this.ox + (x + 0.5) * this.cs; }
  cy(y) { return this.oy + (y + 0.5) * this.cs; }
  get theme() { return THEMES[(this.arena && this.arena.theme) || 'castle'] || THEMES.castle; }

  /** Pixels per CSS pixel for pictures drawn once: the kit's own, or the canvas's. */
  get picScale() { return this.kit ? this.kit.scale : this.dpr; }

  spritesFor() {
    const key = `${this.cs}@${this.picScale}:${(this.arena && this.arena.theme) || 'castle'}`;
    if (this.sprites && this.spriteKey === key) return this.sprites;
    const { cs, lift } = this;
    const dpr = this.picScale;
    const th = this.theme;
    const W = cs * 1.15;
    const H = cs + lift + cs * 0.16;
    const make = (draw) => {
      const { c, g } = canvasOf(W, H, dpr);
      draw(g);
      return c;
    };
    this.sprites = {
      stone: [0, 1, 2].map((k) => make((g) => drawStoneTile(g, cs, lift, th.stone, k * 7 + 3))),
      block: make((g) => drawStoneTile(g, cs, lift, th.block, 5)),
      crate: make((g) => drawCrateTile(g, cs, lift, th.deco === 'winter', false)),
      burnt: make((g) => drawCrateTile(g, cs, lift, false, true)),
    };
    if (this.kit) {
      const sp = this.sprites;
      [0, 1, 2].forEach((k) => this.kit.freeze(sp.stone, k));
      for (const f of ['block', 'crate', 'burnt']) this.kit.freeze(sp, f);
    }
    this.spriteKey = key;
    return this.sprites;
  }

  /** Walls, towers, floor and decorations never change during a round: draw them once. */
  background(arena) {
    // Keyed on the round, not the object: a phone in a game with friends draws copies of the round.
    const key = `${this.w}x${this.h}@${this.picScale}:${this.n}:${arena.theme}:${arena.uid}`;
    if (this.bg && this.bgKey === key) return this.bg;
    const { w, h, cs, n, ox, oy, lift } = this;
    const th = this.theme;
    const { c, g } = canvasOf(w, h, this.picScale);
    this.scorched.clear();
    g.fillStyle = '#151a22';
    g.fillRect(0, 0, w, h);
    const span = n * cs;
    const b = cs * 0.62;
    // Wall ring.
    g.fillStyle = th.wallDark;
    roundRect(g, ox - b - 3, oy - b - lift - 3, span + 2 * b + 6, span + 2 * b + lift + 6, 12);
    g.fill();
    g.fillStyle = th.wallTop;
    roundRect(g, ox - b, oy - b - lift, span + 2 * b, span + 2 * b + lift, 9);
    g.fill();
    // Merlons along the outer edge.
    g.fillStyle = th.merlon;
    const m = cs * 0.34;
    for (let i = 0; i * m * 2 < span + 2 * b; i++) {
      const t = ox - b + i * m * 2 + m * 0.5;
      if (t + m > ox + span + b) break;
      g.fillRect(t, oy - b - lift + 2, m, b * 0.32);
      g.fillRect(t, oy + span + b - b * 0.32 - 2, m, b * 0.32);
    }
    for (let i = 0; i * m * 2 < span + 2 * b; i++) {
      const t = oy - b - lift + i * m * 2 + m * 0.5;
      if (t + m > oy + span + b) break;
      g.fillRect(ox - b + 2, t, b * 0.32, m);
      g.fillRect(ox + span + b - b * 0.32 - 2, t, b * 0.32, m);
    }
    // The courtyard floor.
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = hash(x, y, 1);
        g.fillStyle = th.floor[Math.floor(v * th.floor.length) % th.floor.length];
        g.fillRect(ox + x * cs, oy + y * cs, cs, cs);
      }
    }
    if (th.deco !== 'forest') {
      g.strokeStyle = th.grout;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < n; i++) {
        g.moveTo(ox + i * cs + 0.5, oy);
        g.lineTo(ox + i * cs + 0.5, oy + span);
        g.moveTo(ox, oy + i * cs + 0.5);
        g.lineTo(ox + span, oy + i * cs + 0.5);
      }
      g.stroke();
    }
    this.decorate(g, arena, th);
    // The inner face of the top wall, seen at an angle.
    g.fillStyle = th.wallFace;
    g.fillRect(ox - b * 0.2, oy - lift, span + b * 0.4, lift);
    g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ox, oy - lift * 0.5);
    g.lineTo(ox + span, oy - lift * 0.5);
    for (let i = 0; i < n * 2; i++) {
      const bx = ox + i * cs * 0.5 + (i % 2 ? cs * 0.25 : 0);
      g.moveTo(bx, oy - lift);
      g.lineTo(bx, oy - lift * 0.5);
    }
    g.stroke();
    // Shade where the walls meet the floor.
    const sh = g.createLinearGradient(0, oy, 0, oy + cs * 0.35);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = sh;
    g.fillRect(ox, oy, span, cs * 0.35);
    const sl = g.createLinearGradient(ox, 0, ox + cs * 0.25, 0);
    sl.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    sl.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = sl;
    g.fillRect(ox, oy, cs * 0.25, span);
    // Corner towers; a flag on each shows whose corner it is.
    const tr = b * 1.1;
    const corners = [
      [ox - b * 0.35, oy - lift - b * 0.35, 0, 0],
      [ox + span + b * 0.35, oy - lift - b * 0.35, n - 1, 0],
      [ox - b * 0.35, oy + span + b * 0.35, 0, n - 1],
      [ox + span + b * 0.35, oy + span + b * 0.35, n - 1, n - 1],
    ];
    this.flags = [];
    for (const [tx, ty, cxi, cyi] of corners) {
      g.fillStyle = th.wallDark;
      g.beginPath();
      g.arc(tx, ty, tr + 2, 0, TAU);
      g.fill();
      g.fillStyle = th.towerTop;
      g.beginPath();
      g.arc(tx, ty, tr, 0, TAU);
      g.fill();
      g.fillStyle = th.merlon;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        g.save();
        g.translate(tx + Math.cos(a) * tr * 0.82, ty + Math.sin(a) * tr * 0.82);
        g.rotate(a);
        g.fillRect(-tr * 0.13, -tr * 0.16, tr * 0.26, tr * 0.32);
        g.restore();
      }
      g.fillStyle = th.wallFace;
      g.beginPath();
      g.arc(tx, ty, tr * 0.58, 0, TAU);
      g.fill();
      const owner = (arena.spawns || []).findIndex((sp) => sp.x === cxi && sp.y === cyi);
      this.flags.push({ x: tx, y: ty, color: owner >= 0 ? this.sides[owner].color : '#8f8264', dark: owner >= 0 ? this.sides[owner].dark : '#5c5340' });
    }
    // Torches or lanterns on the walls.
    this.lights = [];
    const lx = [0.3, 0.7];
    for (const f of lx) {
      this.lights.push({ x: ox + span * f, y: oy - lift * 0.55, side: 'top' });
      this.lights.push({ x: ox + span * f, y: oy + span + b * 0.45, side: 'bottom' });
    }
    this.lights.push({ x: ox - b * 0.5, y: oy + span * 0.5, side: 'left' });
    this.lights.push({ x: ox + span + b * 0.5, y: oy + span * 0.5, side: 'right' });
    for (const L of this.lights) {
      g.fillStyle = '#2b2118';
      g.fillRect(L.x - cs * 0.06, L.y - cs * 0.02, cs * 0.12, cs * 0.2);
      g.fillStyle = '#4a3a2a';
      g.fillRect(L.x - cs * 0.12, L.y - cs * 0.06, cs * 0.24, cs * 0.07);
    }
    this.bg = c;
    this.bgKey = key;
    return c;
  }

  /** Cracks, pebbles, grass, snow and flowers scattered over the floor. */
  decorate(g, arena, th) {
    const { cs, n, ox, oy } = this;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (arena.tiles[y * n + x] === PILLAR) continue;
        const px = ox + x * cs;
        const py = oy + y * cs;
        const r1 = hash(x, y, 2);
        const r2 = hash(x, y, 3);
        const r3 = hash(x, y, 4);
        if (th.deco === 'castle') {
          if (r1 < 0.16) {
            g.strokeStyle = th.crack;
            g.lineWidth = 1;
            g.beginPath();
            const sx = px + cs * (0.2 + r2 * 0.5);
            const sy = py + cs * (0.2 + r3 * 0.5);
            g.moveTo(sx, sy);
            g.lineTo(sx + cs * 0.15, sy + cs * 0.08);
            g.lineTo(sx + cs * 0.22, sy + cs * 0.22);
            g.moveTo(sx + cs * 0.15, sy + cs * 0.08);
            g.lineTo(sx + cs * 0.28, sy + cs * 0.02);
            g.stroke();
          } else if (r1 < 0.26) {
            g.fillStyle = 'rgba(120, 100, 70, 0.35)';
            for (let k = 0; k < 3; k++) {
              g.beginPath();
              g.arc(px + cs * hash(x, y, 10 + k), py + cs * hash(x, y, 20 + k), cs * 0.035, 0, TAU);
              g.fill();
            }
          } else if (r1 < 0.33) {
            g.strokeStyle = '#7f9a4a';
            g.lineWidth = 1.2;
            g.beginPath();
            const gx = px + (r2 < 0.5 ? 1 : cs - 1);
            const gy = py + cs * (0.3 + r3 * 0.4);
            for (let k = -1; k <= 1; k++) {
              g.moveTo(gx, gy);
              g.lineTo(gx + k * cs * 0.06 + (r2 < 0.5 ? cs * 0.05 : -cs * 0.05), gy - cs * 0.14);
            }
            g.stroke();
          }
        } else if (th.deco === 'winter') {
          if (r1 < 0.2) {
            g.fillStyle = 'rgba(255, 255, 255, 0.9)';
            g.beginPath();
            g.ellipse(px + cs * (0.3 + r2 * 0.4), py + cs * (0.3 + r3 * 0.4), cs * (0.18 + r2 * 0.1), cs * 0.1, r3, 0, TAU);
            g.fill();
          } else if (r1 < 0.32) {
            g.fillStyle = 'rgba(190, 225, 248, 0.75)';
            g.beginPath();
            g.ellipse(px + cs * 0.5, py + cs * 0.5, cs * 0.3, cs * 0.18, r2 * 3, 0, TAU);
            g.fill();
            g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(px + cs * 0.38, py + cs * 0.44);
            g.lineTo(px + cs * 0.55, py + cs * 0.4);
            g.stroke();
          } else if (r1 < 0.42) {
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.arc(px + cs * r2, py + cs * r3, 1.2, 0, TAU);
            g.fill();
          }
        } else if (th.deco === 'forest') {
          if (r1 < 0.16) {
            const cols = ['#e05a5a', '#f2d14b', '#ffffff', '#b98ae0'];
            const col = cols[Math.floor(r2 * cols.length)];
            for (let k = 0; k < 3; k++) {
              const fx = px + cs * (0.2 + hash(x, y, 30 + k) * 0.6);
              const fy = py + cs * (0.2 + hash(x, y, 40 + k) * 0.6);
              g.fillStyle = col;
              for (let p = 0; p < 4; p++) {
                g.beginPath();
                g.arc(fx + Math.cos(p * 1.57) * cs * 0.035, fy + Math.sin(p * 1.57) * cs * 0.035, cs * 0.03, 0, TAU);
                g.fill();
              }
              g.fillStyle = '#f7d35a';
              g.beginPath();
              g.arc(fx, fy, cs * 0.022, 0, TAU);
              g.fill();
            }
          } else if (r1 < 0.45) {
            g.strokeStyle = 'rgba(60, 100, 35, 0.55)';
            g.lineWidth = 1.2;
            g.beginPath();
            const gx = px + cs * (0.2 + r2 * 0.6);
            const gy = py + cs * (0.3 + r3 * 0.5);
            for (let k = -1; k <= 1; k++) {
              g.moveTo(gx, gy);
              g.lineTo(gx + k * cs * 0.07, gy - cs * 0.13);
            }
            g.stroke();
          } else if (r1 < 0.52) {
            g.fillStyle = 'rgba(140, 105, 60, 0.35)';
            g.beginPath();
            g.ellipse(px + cs * 0.5, py + cs * 0.5, cs * 0.32, cs * 0.2, r2 * 3, 0, TAU);
            g.fill();
          }
        }
      }
    }
  }

  // ---------- particles and events ----------
  spawn(p) {
    if (this.parts.length > (this.kit ? 200 : 340)) this.parts.shift();
    p.t = p.t || 0;
    this.parts.push(p);
  }

  addEvents(events, arena, now) {
    const n = arena.n;
    const cs = this.cs;
    const at = (c) => ({ x: this.cx(c % n), y: this.cy(Math.floor(c / n)) });
    for (const e of events) {
      if (e.t === 'blast') {
        this.shake.push({ t0: now, dur: 200, amp: Math.min(5, 1.5 + e.size * 0.22) });
        for (const c of e.cells || [e.cell]) {
          const p = at(c);
          const mark = { cell: c, x: p.x, y: p.y, t0: now, life: 6000, r: cs * (0.3 + Math.random() * 0.1), rot: Math.random() * TAU };
          // On a TV, scorch marks are burned into the floor picture for the rest of the round
          // (one per cell) rather than drawn, and fading, every frame.
          if (this.kit) this.scorchQueue.push(mark);
          else this.decals.push(mark);
          for (let k = 0; k < (this.kit ? 1 : 2); k++) {
            const a = Math.random() * TAU;
            const sp = cs * (1.5 + Math.random() * 2.5);
            this.spawn({ k: 'ember', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cs, life: 0.4 + Math.random() * 0.4, s: cs * (0.04 + Math.random() * 0.04) });
          }
          this.spawn({ k: 'smoke', x: p.x + (Math.random() - 0.5) * cs * 0.3, y: p.y, vx: (Math.random() - 0.5) * cs * 0.3, vy: -cs * (0.5 + Math.random() * 0.4), life: 1.1 + Math.random() * 0.5, s: cs * 0.28, t: -0.35 - Math.random() * 0.15 });
        }
      } else if (e.t === 'crate') {
        const p = at(e.cell);
        for (let k = 0; k < 7; k++) {
          const a = Math.random() * TAU;
          const sp = cs * (1.6 + Math.random() * 2.2);
          this.spawn({ k: 'plank', x: p.x, y: p.y - this.lift * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: 0, vz: cs * (2 + Math.random() * 2), life: 0.65 + Math.random() * 0.3, s: cs * (0.12 + Math.random() * 0.12), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 18 });
        }
      } else if (e.t === 'reveal') {
        const p = at(e.cell);
        this.revealed.set(e.cell, now);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          this.spawn({ k: 'sparkle', x: p.x, y: p.y, vx: Math.cos(a) * cs * 1.6, vy: Math.sin(a) * cs * 1.6, life: 0.6, s: cs * 0.12, color: POWER_STYLE[e.kind].a });
        }
      } else if (e.t === 'burnItem') {
        const p = at(e.cell);
        this.spawn({ k: 'smoke', x: p.x, y: p.y, vx: 0, vy: -cs * 0.6, life: 0.9, s: cs * 0.25 });
      } else if (e.t === 'power') {
        const pl = arena.players[e.player];
        const x = this.cx(pl.x);
        const y = this.cy(pl.y);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU;
          this.spawn({ k: 'sparkle', x, y, vx: Math.cos(a) * cs * 2.2, vy: Math.sin(a) * cs * 2.2, life: 0.55, s: cs * 0.13, color: POWER_STYLE[e.kind].a });
        }
        this.spawn({ k: 'text', x, y: y - cs * 0.9, vx: 0, vy: -cs * 0.9, life: 1.3, text: `${POWERS[e.kind].short}!`, color: POWER_STYLE[e.kind].a, big: e.player === this.me });
      } else if (e.t === 'death') {
        const p = arena.players[e.player];
        const x = this.cx(p.x);
        const y = this.cy(p.y);
        this.spawn({ k: 'ghost', x, y, vx: 0, vy: -cs * 0.5, life: 1.1, side: this.sides[p.index], face: p.face });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          this.spawn({ k: 'smoke', x: x + Math.cos(a) * cs * 0.2, y: y + Math.sin(a) * cs * 0.2, vx: Math.cos(a) * cs * 0.6, vy: Math.sin(a) * cs * 0.6 - cs * 0.3, life: 0.9, s: cs * 0.22 });
        }
        this.decals.push({ x, y: y + cs * 0.2, t0: now, life: 5000, r: cs * 0.3, rot: 0, helmet: true });
      } else if (e.t === 'drop') {
        this.shake.push({ t0: now, dur: 120, amp: 2 });
        for (const c of e.cells) {
          const p = at(c);
          this.spawn({ k: 'fall', x: p.x, y: p.y, life: 0.26 });
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * TAU + Math.random();
            this.spawn({ k: 'dust', x: p.x + Math.cos(a) * cs * 0.4, y: p.y + Math.sin(a) * cs * 0.4, vx: Math.cos(a) * cs * 1.2, vy: Math.sin(a) * cs * 1.2, life: 0.55, s: cs * 0.2, t: -0.24 });
          }
        }
      } else if (e.t === 'keg') {
        const p = at(e.cell);
        this.spawn({ k: 'ring', x: p.x, y: p.y + cs * 0.25, life: 0.25 });
      }
    }
  }

  stepParts(dt) {
    let keep = 0;
    for (const p of this.parts) {
      p.t += dt;
      if (p.t >= p.life) continue;
      this.parts[keep++] = p;
      if (p.t < 0) continue;
      if (p.vx != null) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = p.k === 'plank' ? 0.9 : p.k === 'ember' ? 0.94 : 0.97;
        const f = Math.pow(drag, dt * 60);
        p.vx *= f;
        p.vy *= f;
      }
      if (p.vz != null) {
        p.z += p.vz * dt;
        p.vz -= this.cs * 12 * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz = -p.vz * 0.3;
        }
        p.rot += p.vr * dt;
      }
    }
    this.parts.length = keep;
  }

  drawParts(g, layer) {
    const cs = this.cs;
    const kit = this.kit;
    for (const p of this.parts) {
      if (p.t < 0) continue;
      const f = p.t / p.life;
      if (layer === 'low' && p.k !== 'dust' && p.k !== 'ring' && p.k !== 'fall') continue;
      if (layer === 'high' && (p.k === 'dust' || p.k === 'ring' || p.k === 'fall' || p.k === 'text')) continue;
      if (layer === 'text' && p.k !== 'text') continue;
      switch (p.k) {
        case 'smoke': {
          const r = p.s * (0.8 + f * 1.4);
          if (kit) {
            g.globalAlpha = 0.42 * (1 - f);
            dot(kit, g, p.x, p.y, r, 'rgb(90, 90, 95)');
            g.globalAlpha = 1;
            break;
          }
          g.fillStyle = `rgba(90, 90, 95, ${0.42 * (1 - f)})`;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, TAU);
          g.fill();
          break;
        }
        case 'dust': {
          const r = p.s * (0.7 + f * 1.2);
          if (kit) {
            g.globalAlpha = 0.5 * (1 - f);
            dot(kit, g, p.x, p.y, r, 'rgb(150, 140, 125)');
            g.globalAlpha = 1;
            break;
          }
          g.fillStyle = `rgba(150, 140, 125, ${0.5 * (1 - f)})`;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, TAU);
          g.fill();
          break;
        }
        case 'ember': {
          if (kit) {
            // From yellow to red in seven steps.
            g.globalAlpha = 1 - f;
            dot(kit, g, p.x, p.y, p.s * (1 - f * 0.5), EMBERS[Math.round(f * 6)]);
            g.globalAlpha = 1;
            break;
          }
          g.fillStyle = `rgba(255, ${Math.round(200 - f * 120)}, 60, ${1 - f})`;
          g.beginPath();
          g.arc(p.x, p.y, p.s * (1 - f * 0.5), 0, TAU);
          g.fill();
          break;
        }
        case 'spark': {
          if (kit) {
            g.globalAlpha = 1 - f;
            g.fillStyle = 'rgb(255, 230, 140)';
            g.fillRect(p.x - 1, p.y - 1, 2, 2);
            g.globalAlpha = 1;
            break;
          }
          g.fillStyle = `rgba(255, 230, 140, ${1 - f})`;
          g.fillRect(p.x - 1, p.y - 1, 2, 2);
          break;
        }
        case 'plank': {
          if (kit) {
            // Sixteen turns of a plank, drawn once each.
            const S = cs * 0.24;
            const rq = Math.round((((p.rot % TAU) + TAU) % TAU) / (TAU / 16)) % 16;
            const plank = kit.get(`pl:${rq}:${cs}`, S * 2.2 + 2, S * 2.2 + 2, S * 1.1 + 1, S * 1.1 + 1, (q) => {
              q.rotate((rq * TAU) / 16);
              q.fillStyle = WOOD.light;
              q.fillRect(-S, -S * 0.22, S * 2, S * 0.44);
              q.fillStyle = WOOD.dark;
              q.fillRect(-S, S * 0.05, S * 2, S * 0.17);
            });
            g.globalAlpha = 1 - f * f;
            stamp(g, plank, p.x, p.y - p.z, p.s / S);
            g.globalAlpha = 1;
            break;
          }
          g.save();
          g.globalAlpha = 1 - f * f;
          g.translate(p.x, p.y - p.z);
          g.rotate(p.rot);
          g.fillStyle = WOOD.light;
          g.fillRect(-p.s, -p.s * 0.22, p.s * 2, p.s * 0.44);
          g.fillStyle = WOOD.dark;
          g.fillRect(-p.s, p.s * 0.05, p.s * 2, p.s * 0.17);
          g.restore();
          break;
        }
        case 'sparkle': {
          const color = f < 0.5 ? '#ffffff' : p.color;
          g.globalAlpha = 1 - f;
          if (kit) {
            const R = 8;
            const star = kit.get(`star:${color}`, R * 2 + 2, R * 2 + 2, R + 1, R + 1, (q) => {
              q.fillStyle = color;
              drawStar(q, 0, 0, R, 0);
            });
            g.save();
            g.translate(p.x, p.y);
            g.rotate(f * 3);
            stamp(g, star, 0, 0, (p.s * (1 - f * 0.4)) / R);
            g.restore();
          } else {
            g.fillStyle = color;
            drawStar(g, p.x, p.y, p.s * (1 - f * 0.4), f * 3);
          }
          g.globalAlpha = 1;
          break;
        }
        case 'ring': {
          if (kit) {
            const ring = kit.get(`pring:${cs}`, cs * 1.2 + 6, cs * 0.48 + 6, cs * 0.6 + 3, cs * 0.24 + 3, (q) => {
              q.strokeStyle = '#ffffff';
              q.lineWidth = 2;
              q.beginPath();
              q.ellipse(0, 0, cs * 0.6, cs * 0.24, 0, 0, TAU);
              q.stroke();
            });
            g.globalAlpha = 0.55 * (1 - f);
            stamp(g, ring, p.x, p.y, (0.25 + f * 0.35) / 0.6);
            g.globalAlpha = 1;
            break;
          }
          g.strokeStyle = `rgba(255, 255, 255, ${0.55 * (1 - f)})`;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(p.x, p.y, cs * (0.25 + f * 0.35), cs * (0.1 + f * 0.14), 0, 0, TAU);
          g.stroke();
          break;
        }
        case 'fall': {
          // A stone dropping in: big and faint above its cell, landing with a thud.
          const s = 1 + (1 - f) * 0.7;
          g.globalAlpha = 0.25 + 0.75 * f;
          const sp = this.spritesFor().block;
          const w = sp.width / this.picScale;
          const h = sp.height / this.picScale;
          g.drawImage(sp, p.x - (cs / 2) * s, p.y - (cs / 2) * s - this.lift * s - (1 - f) * cs * 0.8, w * s, h * s);
          g.globalAlpha = 1;
          break;
        }
        case 'ghost': {
          const spin = f * 2.4;
          const opts = { alpha: 1 - f, spin, scale: 1 - f * 0.5 };
          if (kit) knightFast(kit, g, p.x, p.y, cs, p.side, p.face, 0, 0, opts);
          else drawKnight(g, p.x, p.y, cs, p.side, p.face, 0, 0, opts);
          break;
        }
        case 'text': {
          const a = f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25;
          const size = (p.big ? 15 : 12) * this.textScale;
          g.save();
          g.globalAlpha = a;
          if (kit) floatTextFast(kit, g, p.x, p.y, p.text, p.color, size, this.textScale);
          else drawFloatText(g, p.x, p.y, p.text, p.color, size, this.textScale);
          g.restore();
          break;
        }
        default: break;
      }
    }
  }

  // ---------- the frame ----------
  /** ui: { me, alpha, you: { until } | null } */
  draw(arena, ui, now) {
    this.me = ui.me;
    const g = this.ctx;
    const { cs, n, lift } = this;
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastNow || now)) / 1000));
    this.lastNow = now;
    this.stepParts(dt);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    let sx = 0;
    let sy = 0;
    let keepShake = 0;
    for (const s of this.shake) {
      const t = (now - s.t0) / s.dur;
      if (t >= 1) continue;
      this.shake[keepShake++] = s;
      if (t < 0) continue;
      const a = s.amp * (1 - t);
      sx += Math.sin(now * 0.09 + s.t0) * a;
      sy += Math.cos(now * 0.11 + s.t0) * a;
    }
    this.shake.length = keepShake;
    const dbg = this.debug;
    const kit = this.kit;
    // Development (the TV's debug.json): where the drawing time goes, section by section.
    const prof = dbg.prof ? (this.profAcc || (this.profAcc = { frames: 0 })) : null;
    let pt = prof ? performance.now() : 0;
    const pm = (name) => {
      if (!prof) return;
      const t = performance.now();
      prof[name] = (prof[name] || 0) + t - pt;
      pt = t;
    };
    const bg = this.background(arena);
    if (kit && this.scorchQueue.length) this.burnScorches(bg);
    if (!dbg.noBg) g.drawImage(bg, 0, 0, this.w, this.h);
    pm('bg');
    if (sx || sy) g.translate(sx, sy);
    const sp = this.spritesFor();

    // Scorch marks and dropped helmets on the floor.
    let keepDec = 0;
    for (const d of this.decals) {
      const t = (now - d.t0) / d.life;
      if (t >= 1) continue;
      this.decals[keepDec++] = d;
      const a = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      if (d.helmet && kit) {
        const r = d.r;
        const helmet = kit.get(`helm:${r}`, r * 1.4, r * 1.1, r * 0.7, r * 0.55, (q) => {
          q.fillStyle = STEEL_DARK;
          q.beginPath();
          q.ellipse(0, 0, r * 0.55, r * 0.4, 0.3, 0, TAU);
          q.fill();
          q.fillStyle = INK;
          q.fillRect(-r * 0.3, -r * 0.04, r * 0.6, r * 0.1);
        });
        g.globalAlpha = 0.85 * a;
        stamp(g, helmet, d.x, d.y);
        g.globalAlpha = 1;
        continue;
      }
      if (d.helmet) {
        g.globalAlpha = 0.85 * a;
        g.fillStyle = STEEL_DARK;
        g.beginPath();
        g.ellipse(d.x, d.y, d.r * 0.55, d.r * 0.4, 0.3, 0, TAU);
        g.fill();
        g.fillStyle = INK;
        g.fillRect(d.x - d.r * 0.3, d.y - d.r * 0.04, d.r * 0.6, d.r * 0.1);
        g.globalAlpha = 1;
        continue;
      }
      g.fillStyle = `rgba(40, 25, 15, ${0.24 * a})`;
      g.beginPath();
      g.ellipse(d.x, d.y, d.r, d.r * 0.82, d.rot, 0, TAU);
      g.fill();
    }
    this.decals.length = keepDec;

    pm('decals');
    // Where ticking kegs will blast: redder as the fuse burns down. Your ally's blasts can't hurt
    // you, so theirs glow faintly in their own colour instead (drawn first, under any red).
    const mine = arena.players[ui.me];
    const friendly = (b) => !!(mine && b.owner !== ui.me && arena.players[b.owner].team === mine.team);
    let danger = null;
    if (kit) {
      if (!this.dangerBuf || this.dangerBuf.length !== n * n) this.dangerBuf = new Float32Array(n * n);
      danger = this.dangerBuf;
      danger.fill(0);
    }
    for (const pass of [true, false]) {
      for (const b of arena.bombs) {
        if (friendly(b) !== pass) continue;
        if (danger && !pass) {
          const left = b.fuse / (b.fuse0 || arena.fuseTicks);
          const a = 0.08 + 0.3 * (1 - left) + (left < 0.3 ? 0.08 * Math.sin(now / 60) : 0);
          for (const c of arena.blast(b.x, b.y, b.range)) if (arena.tiles[c] === FLOOR) danger[c] = 1 - (1 - danger[c]) * (1 - a);
          continue;
        }
        const left = b.fuse / (b.fuse0 || arena.fuseTicks);
        const a = 0.08 + 0.3 * (1 - left) + (left < 0.3 ? 0.08 * Math.sin(now / 60) : 0);
        g.fillStyle = pass ? `rgba(${rgb(this.sides[b.owner].color)}, ${0.1 + a * 0.75})` : `rgba(225, 60, 35, ${a})`;
        for (const c of arena.blast(b.x, b.y, b.range)) {
          if (arena.tiles[c] !== FLOOR) continue;
          const x = c % n;
          const y = (c - x) / n;
          g.fillRect(this.ox + x * cs + 1, this.oy + y * cs + 1, cs - 2, cs - 2);
        }
      }
    }
    if (danger) {
      g.fillStyle = 'rgb(225, 60, 35)';
      for (let c = 0; c < danger.length; c++) {
        if (danger[c] <= 0) continue;
        const x = c % n;
        const y = (c - x) / n;
        g.globalAlpha = danger[c];
        g.fillRect(this.ox + x * cs + 1, this.oy + y * cs + 1, cs - 2, cs - 2);
      }
      g.globalAlpha = 1;
    }

    // Warnings where stone will fall next.
    if (arena.tick >= arena.hurryTick - 1) {
      arena.upcomingDrops(3).forEach((grp, i) => {
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
    pm('danger');
    this.drawParts(g, 'low');
    pm('low');

    // Row by row from the back, so nearer things stand in front of farther ones.
    const rowsKeg = new Map();
    const rowsKnight = new Map();
    for (const b of arena.bombs) {
      if (!rowsKeg.has(b.y)) rowsKeg.set(b.y, []);
      rowsKeg.get(b.y).push(b);
    }
    for (const p of arena.players) {
      if (!p.alive) continue;
      const yy = p.py + (p.y - p.py) * ui.alpha;
      const r = Math.min(n - 1, Math.max(0, Math.round(yy)));
      if (!rowsKnight.has(r)) rowsKnight.set(r, []);
      rowsKnight.get(r).push(p);
    }
    const me = arena.players[ui.me];
    const sparksDue = dt * 26;
    if (kit) {
      this.drawStandingKit(g, arena, ui, now, rowsKeg, rowsKnight, sparksDue, sp);
      pm('rows');
    }
    else for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = y * n + x;
        const t = arena.tiles[c];
        if (t === FLOOR) {
          const kind = arena.items.get(c);
          if (kind) {
            const bob = Math.sin(now / 260 + x * 1.3 + y) * cs * 0.05;
            if (kit) {
              g.globalAlpha = 0.25;
              oval(kit, g, this.cx(x), this.cy(y) + cs * 0.3, cs * 0.26, cs * 0.08, 'rgb(30, 18, 8)');
              g.globalAlpha = 1;
              medallionFast(kit, g, this.cx(x), this.cy(y) - cs * 0.05 + bob, cs * 0.34, kind, now);
              continue;
            }
            g.fillStyle = 'rgba(30, 18, 8, 0.25)';
            g.beginPath();
            g.ellipse(this.cx(x), this.cy(y) + cs * 0.3, cs * 0.26, cs * 0.08, 0, 0, TAU);
            g.fill();
            drawMedallion(g, this.cx(x), this.cy(y) - cs * 0.05 + bob, cs * 0.34, kind, now);
          }
          continue;
        }
        let img = null;
        if (dbg.noTiles) continue;
        if (t === PILLAR) img = sp.stone[(x * 7 + y * 3) % 3];
        else if (t === CRATE) img = sp.crate;
        else if (t === BURNING) img = sp.burnt;
        else if (t === BLOCK) img = sp.block;
        if (img) g.drawImage(img, this.ox + x * cs, this.oy + y * cs - lift, img.width / this.picScale, img.height / this.picScale);
      }
      for (const b of dbg.noKegs ? [] : rowsKeg.get(y) || []) {
        const tip = (kit ? kegFast.bind(null, kit) : drawKeg)(g, this.cx(b.x), this.cy(b.y), cs, b.fuse / (b.fuse0 || arena.fuseTicks), now, this.sides[b.owner].color);
        if (Math.random() < (kit ? sparksDue / 2 : sparksDue)) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
          this.spawn({ k: 'spark', x: tip.fx, y: tip.fy, vx: Math.cos(a) * cs * 1.4, vy: Math.sin(a) * cs * 1.4, life: 0.25 + Math.random() * 0.15 });
        }
      }
      for (const p of dbg.noKnights ? [] : rowsKnight.get(y) || []) {
        const xx = p.px + (p.x - p.px) * ui.alpha;
        const yy = p.py + (p.y - p.py) * ui.alpha;
        if (kit) knightFast(kit, g, this.cx(xx), this.cy(yy), cs, this.sides[p.index], p.face, p.moving ? p.walk : 0, now, { ring: p.index === ui.me });
        else drawKnight(g, this.cx(xx), this.cy(yy), cs, this.sides[p.index], p.face, p.moving ? p.walk : 0, now, { ring: p.index === ui.me });
      }
    }

    // Blasts on top of everything standing.
    for (const [c, f] of dbg.noFlames ? [] : arena.flames) {
      const x = c % n;
      const y = (c - x) / n;
      drawFlame(g, this.cx(x), this.cy(y) - lift * 0.3, cs, f.arms, f.ttl / arena.flameTicks, now, kit);
    }
    pm('flames');
    if (!dbg.noParts) this.drawParts(g, 'high');
    pm('high');
    if (!dbg.noLights) this.drawLights(g, now);
    pm('lights');

    // Name tags on power-ups: when they first appear, and whenever you're close.
    for (const [c, kind] of arena.items) {
      if (arena.tiles[c] !== FLOOR) continue;
      const x = c % n;
      const y = (c - x) / n;
      const shown = this.revealed.get(c);
      const fresh = shown != null && now - shown < 2600;
      const near = me && me.alive && Math.abs(me.x - x) + Math.abs(me.y - y) <= 2.6;
      if (!fresh && !near) continue;
      const a = fresh && !near ? Math.min(1, (2600 - (now - shown)) / 500) : 1;
      const size = (cs >= 30 ? 11 : 10) * this.textScale;
      if (kit) pillFast(kit, g, this.cx(x), this.cy(y) - cs * 0.68, POWERS[kind].short, POWER_STYLE[kind].a, a, size);
      else drawPill(g, this.cx(x), this.cy(y) - cs * 0.68, POWERS[kind].short, POWER_STYLE[kind].a, a, size);
    }
    this.drawParts(g, 'text');
    const tag = kit ? tagFast.bind(null, kit) : drawTag;
    if (ui.you && now < ui.you.until && me && me.alive) {
      const fade = Math.min(1, (ui.you.until - now) / 500);
      tag(g, this.cx(me.x), this.cy(me.y) - cs * 0.95, 'YOU', this.sides[ui.me].color, fade, now, this.textScale);
      // Your teammate gets a tag too, so you know who's on your side.
      for (const p of arena.players) {
        if (p.index === ui.me || !p.alive || p.team !== me.team) continue;
        tag(g, this.cx(p.x), this.cy(p.y) - cs * 0.95, ui.allyTag || 'ALLY', this.sides[p.index].color, fade, now, this.textScale);
      }
    }
    // On a shared screen (the TV app): everyone's name over their knight as the round starts.
    if (ui.labels && ui.you && now < ui.you.until) {
      const fade = Math.min(1, (ui.you.until - now) / 500);
      for (const { i, text } of ui.labels) {
        const p = arena.players[i];
        if (p && p.alive) tag(g, this.cx(p.x), this.cy(p.y) - cs * 0.95, text, this.sides[i].color, fade, now, this.textScale);
      }
    }
    pm('labels');
    if (arena.final) {
      // The last stand: the edges glow red.
      const pulse = 0.18 + 0.08 * Math.sin(now / 220);
      if (kit) {
        // A soft gradient loses nothing drawn small and stretched.
        const { w, h } = this;
        const vig = kit.get(`vig:${w}x${h}`, w + 20, h + 20, 10, 10, (q) => {
          const vg = q.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.75);
          vg.addColorStop(0, 'rgba(180, 30, 20, 0)');
          vg.addColorStop(1, 'rgba(180, 30, 20, 1)');
          q.fillStyle = vg;
          q.fillRect(-10, -10, w + 20, h + 20);
        }, 0.25);
        g.globalAlpha = pulse;
        stamp(g, vig, 0, 0);
        g.globalAlpha = 1;
      } else {
        const vg = g.createRadialGradient(this.w / 2, this.h / 2, this.w * 0.3, this.w / 2, this.h / 2, this.w * 0.75);
        vg.addColorStop(0, 'rgba(180, 30, 20, 0)');
        vg.addColorStop(1, `rgba(180, 30, 20, ${pulse})`);
        g.fillStyle = vg;
        g.fillRect(-10, -10, this.w + 20, this.h + 20);
      }
    }
    pm('final');
    if (prof) prof.frames++;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  tileImg(sp, t, x, y) {
    if (t === PILLAR) return sp.stone[(x * 7 + y * 3) % 3];
    if (t === CRATE) return sp.crate;
    if (t === BURNING) return sp.burnt;
    if (t === BLOCK) return sp.block;
    return null;
  }

  /** With a kit: new scorch marks go into the floor picture itself. */
  burnScorches(bg) {
    const kit = this.kit;
    const q = bg.getContext('2d');
    const R = this.cs * 0.4;
    for (const d of this.scorchQueue) {
      if (this.scorched.has(d.cell)) continue;
      this.scorched.add(d.cell);
      // Eight turns of the oval cover every angle (it looks the same half a turn round).
      const rq = Math.round((((d.rot % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 8)) % 8;
      const mark = kit.get(`sc:${rq}:${this.cs}`, R * 2 + 2, R * 2 + 2, R + 1, R + 1, (m) => {
        m.rotate((rq * Math.PI) / 8);
        m.fillStyle = 'rgb(40, 25, 15)';
        m.beginPath();
        m.ellipse(0, 0, R, R * 0.82, 0, 0, TAU);
        m.fill();
      });
      q.globalAlpha = 0.24;
      stamp(q, mark, d.x, d.y, d.r / R);
      q.globalAlpha = 1;
    }
    this.scorchQueue.length = 0;
  }

  /** With a kit: the light a wall torch or lantern throws, as one picture. */
  glowSprite() {
    const th = this.theme;
    const R = this.cs * 1.6;
    return this.kit.get(`lg:${th.light.color}:${this.cs}`, R * 2 + 2, R * 2 + 2, R + 1, R + 1, (q) => {
      const gr = q.createRadialGradient(0, 0, 0, 0, 0, R);
      gr.addColorStop(0, `rgba(${th.light.color}, 0.3)`);
      gr.addColorStop(1, `rgba(${th.light.color}, 0)`);
      q.fillStyle = gr;
      q.beginPath();
      q.arc(0, 0, R, 0, TAU);
      q.fill();
    });
  }

  /**
   * With a kit: every standing tile in one picture, with the wall lights' glow over them. When
   * tiles change, only the patch around each is drawn again.
   */
  boardFor(arena, sp) {
    const { n, cs, lift, ox, oy } = this;
    const ps = this.picScale;
    const key = `${this.w}x${this.h}:${cs}:${ps}:${arena.theme}:${arena.uid}`;
    const tiles = arena.tiles;
    const W = Math.ceil(this.w * ps);
    const H = Math.ceil(this.h * ps);
    const fresh = this.boardKey !== key || !this.boardTiles || this.boardTiles.length !== tiles.length
      || !this.boardCanvas || this.boardCanvas.width !== W || this.boardCanvas.height !== H;
    let changed = null;
    if (!fresh) {
      for (let i = 0; i < tiles.length; i++) {
        if (this.boardTiles[i] !== tiles[i]) (changed || (changed = [])).push(i);
      }
      if (!changed) return this.boardCanvas;
    }
    if (this.profAcc) this.profAcc.boards = (this.profAcc.boards || 0) + 1;
    if (!this.boardCanvas || this.boardCanvas.width !== W || this.boardCanvas.height !== H) {
      this.boardCanvas = document.createElement('canvas');
      this.boardCanvas.width = W;
      this.boardCanvas.height = H;
    }
    const q = this.boardCanvas.getContext('2d');
    const glow = this.glowSprite();
    const tw = Math.ceil(cs * 1.15 * ps) / ps; // a tile picture's size
    const th = Math.ceil((cs + lift + cs * 0.16) * ps) / ps;
    // Tiles from the back row forwards, then the light, as clipped to (rx, ry, rw, rh).
    const paint = (x0, x1, y0, y1) => {
      for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) {
          const img = this.tileImg(sp, tiles[y * n + x], x, y);
          if (img) q.drawImage(img, ox + x * cs, oy + y * cs - lift, img.width / ps, img.height / ps);
        }
      }
      for (const L of this.lights) stamp(q, glow, L.x, L.y);
    };
    if (fresh) {
      q.setTransform(1, 0, 0, 1, 0, 0);
      q.clearRect(0, 0, W, H);
      q.setTransform(ps, 0, 0, ps, 0, 0);
      paint(0, n - 1, 0, n - 1);
    } else {
      q.setTransform(ps, 0, 0, ps, 0, 0);
      for (const c of changed) {
        const x = c % n;
        const y = (c - x) / n;
        // The patch the changed tile's picture covers; neighbours' pictures may reach into it.
        const rx = ox + x * cs;
        const ry = oy + y * cs - lift;
        q.save();
        q.beginPath();
        q.rect(rx, ry, tw, th);
        q.clip();
        q.clearRect(rx, ry, tw, th);
        paint(x - 1, x + 1, y - 1, y + 1);
        q.restore();
      }
    }
    this.boardKey = key;
    this.boardTiles = tiles.slice();
    return this.boardCanvas;
  }

  /**
   * With a kit: the tiles in one stamp, then power-ups, kegs and knights row by row. The front of
   * the next row's tiles is stamped again over whatever stands just behind it, as if drawn in order.
   */
  drawStandingKit(g, arena, ui, now, rowsKeg, rowsKnight, sparksDue, sp) {
    const kit = this.kit;
    const dbg = this.debug;
    const { n, cs, lift } = this;
    const ps = this.picScale;
    const board = dbg.noTiles ? null : this.boardFor(arena, sp);
    if (board) g.drawImage(board, 0, 0, this.w, this.h);
    if (!this.coverBuf || this.coverBuf.length !== n) this.coverBuf = new Uint8Array(n);
    const cover = this.coverBuf;
    for (let y = 0; y < n; y++) {
      cover.fill(0);
      let any = false;
      const mark = (x) => {
        for (let c = Math.max(0, x - 1); c <= Math.min(n - 1, x + 1); c++) cover[c] = 1;
        any = true;
      };
      for (let x = 0; x < n; x++) {
        const c = y * n + x;
        if (arena.tiles[c] !== FLOOR) continue;
        const kind = arena.items.get(c);
        if (!kind) continue;
        const bob = Math.sin(now / 260 + x * 1.3 + y) * cs * 0.05;
        g.globalAlpha = 0.25;
        oval(kit, g, this.cx(x), this.cy(y) + cs * 0.3, cs * 0.26, cs * 0.08, 'rgb(30, 18, 8)');
        g.globalAlpha = 1;
        medallionFast(kit, g, this.cx(x), this.cy(y) - cs * 0.05 + bob, cs * 0.34, kind, now);
        mark(x);
      }
      for (const b of dbg.noKegs ? [] : rowsKeg.get(y) || []) {
        const tip = kegFast(kit, g, this.cx(b.x), this.cy(b.y), cs, b.fuse / (b.fuse0 || arena.fuseTicks), now, this.sides[b.owner].color);
        if (Math.random() < sparksDue / 2) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
          this.spawn({ k: 'spark', x: tip.fx, y: tip.fy, vx: Math.cos(a) * cs * 1.4, vy: Math.sin(a) * cs * 1.4, life: 0.25 + Math.random() * 0.15 });
        }
        mark(b.x);
      }
      for (const p of dbg.noKnights ? [] : rowsKnight.get(y) || []) {
        const xx = p.px + (p.x - p.px) * ui.alpha;
        const yy = p.py + (p.y - p.py) * ui.alpha;
        knightFast(kit, g, this.cx(xx), this.cy(yy), cs, this.sides[p.index], p.face, p.moving ? p.walk : 0, now, { ring: p.index === ui.me });
        mark(Math.round(xx));
      }
      if (!board || !any || y + 1 >= n) continue;
      for (let x = 0; x < n; x++) {
        if (!cover[x]) continue;
        const img = this.tileImg(sp, arena.tiles[(y + 1) * n + x], x, y + 1);
        // Only the tile's solid top and front: its see-through shadow is already on the board.
        if (img) g.drawImage(img, 0, 0, cs * ps, (cs + lift) * ps, this.ox + x * cs, this.oy + (y + 1) * cs - lift, cs, cs + lift);
      }
    }
  }

  /** Torch or lantern flames on the walls, the light they throw, and the corner flags. */
  drawLights(g, now) {
    const cs = this.cs;
    const th = this.theme;
    const kit = this.kit;
    for (const L of this.lights) {
      const fl = 0.85 + 0.15 * Math.sin(now / 70 + L.x) + 0.08 * Math.sin(now / 23 + L.y);
      // With a kit the glow is in the board picture, steady; only the flame flickers.
      if (!kit) {
        const glow = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, cs * 1.6 * fl);
        glow.addColorStop(0, `rgba(${th.light.color}, 0.3)`);
        glow.addColorStop(1, `rgba(${th.light.color}, 0)`);
        g.fillStyle = glow;
        g.beginPath();
        g.arc(L.x, L.y, cs * 1.6 * fl, 0, TAU);
        g.fill();
      }
      if (th.light.kind === 'lantern') {
        g.fillStyle = '#2e3846';
        g.fillRect(L.x - cs * 0.1, L.y - cs * 0.24, cs * 0.2, cs * 0.24);
        g.fillStyle = `rgba(${th.light.color}, ${0.8 * fl})`;
        g.fillRect(L.x - cs * 0.07, L.y - cs * 0.21, cs * 0.14, cs * 0.17);
      } else if (kit) {
        // Five leans; the flicker stretches the picture up and down.
        const sway = Math.round(Math.sin(now / 90) * 2) / 2;
        const torch = kit.get(`torch:${sway}:${cs}`, cs * 0.3, cs * 0.44, cs * 0.15, cs * 0.4, (q) => drawTorchFlame(q, 0, 0, cs, 1, sway));
        g.drawImage(torch.c, L.x - torch.ax, L.y - torch.ay * fl, torch.w, torch.h * fl);
      } else {
        drawTorchFlame(g, L.x, L.y, cs, fl, Math.sin(now / 90));
      }
    }
    for (const F of this.flags) {
      const wave = Math.sin(now / 240 + F.x * 0.05);
      if (kit) {
        const wq = Math.round(wave * 4) / 4;
        const flag = kit.get(`flag:${F.color}:${wq}:${cs}`, cs * 0.8, cs * 1.3, cs * 0.1, cs * 1.12, (q) => drawFlag(q, 0, 0, cs, F.color, F.dark, wq));
        stamp(g, flag, F.x, F.y);
      } else {
        drawFlag(g, F.x, F.y, cs, F.color, F.dark, wave);
      }
    }
  }

  /**
   * With a kit: line up pictures to draw ahead of time, a few each frame (warmStep), for these
   * sides: every knight pose, keg, power-up and shape of blast.
   */
  queueWarm(sides) {
    const kit = this.kit;
    if (!kit || !this.n) return;
    const { cs } = this;
    const q = (this.warmQueue = []);
    const g = this.warmCtx || (this.warmCtx = document.createElement('canvas').getContext('2d'));
    const faces = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];
    for (const side of sides) {
      for (const face of faces) {
        for (let k = 0; k <= 8; k++) {
          const step = -1 + k / 4;
          q.push(() => knightFast(kit, g, 0, 0, cs, side, face, Math.asin(step) / (Math.PI * 2.2) || 0, 0, {}));
        }
      }
      q.push(() => { for (let k = 0; k < 24; k++) kegFast(kit, g, 0, 0, cs, k < 2 ? 0.5 : 0.2, k * 15, side.color); });
    }
    for (const kind of Object.keys(POWER_STYLE)) q.push(() => medallionFast(kit, g, 0, 0, cs * 0.34, kind, 0));
    // Blasts: the middle of one, the beams and their ends first; then where beams cross.
    const masks = [];
    for (let m = 16; m < 32; m++) masks.push(m);
    masks.push(1 | 2, 4 | 8, 1, 2, 4, 8);
    for (let m = 1; m < 16; m++) if (!masks.includes(m)) masks.push(m);
    for (const m of masks) for (let lq = 6; lq >= 1; lq--) for (let pq = 0; pq < 3; pq++) q.push(() => flameSprite(kit, cs, m, lq, pq));
  }

  /** Work through the queue for up to ms milliseconds. True while there's more to do. */
  warmStep(ms) {
    const q = this.warmQueue;
    if (!q || !q.length) return false;
    const t0 = performance.now();
    let i = 0;
    warming = true;
    try {
      while (i < q.length && performance.now() - t0 < ms) q[i++]();
    } finally {
      warming = false;
      q.splice(0, i);
    }
    return q.length > 0;
  }

  /** With a kit: draw the pictures a round will need before it starts, not in the middle of it. */
  prewarm(arena) {
    const kit = this.kit;
    if (!kit || !this.n) return 0;
    const t0 = performance.now();
    if (!this.warmCtx) this.warmCtx = document.createElement('canvas').getContext('2d');
    const g = this.warmCtx;
    const { cs } = this;
    warming = true;
    try {
      const faces = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];
      arena.players.forEach((p) => {
        const side = this.sides[p.index];
        for (const face of faces) {
          for (let k = 0; k <= 8; k++) {
            // walk values whose stride lands on each of the nine poses
            const step = -1 + k / 4;
            knightFast(kit, g, 0, 0, cs, side, face, Math.asin(step) / (Math.PI * 2.2) || 0, 0, {});
          }
        }
        for (const t of [0.5, 0.2]) for (let k = 0; k < 24; k++) kegFast(kit, g, 0, 0, cs, t, k * 15, side.color);
      });
      for (const kind of Object.keys(POWER_STYLE)) medallionFast(kit, g, 0, 0, cs * 0.34, kind, 0);
    } finally {
      warming = false;
    }
    return performance.now() - t0;
  }
}

// ---------- pictures for the menu, the how-to page and the controls ----------
/** A power-up medallion on its own. */
export function powerThumb(kind, size = 40) {
  const { c, g } = canvasOf(size, size, 2);
  drawMedallion(g, size / 2, size / 2, size * 0.4, kind, 0, false);
  return c.toDataURL();
}

/** Other how-to pictures: a keg, a crate, a stone, a knight. */
export function pieceThumb(kind, size = 44) {
  const { c, g } = canvasOf(size, size, 2);
  g.fillStyle = THEMES.castle.floor[0];
  roundRect(g, 0, 0, size, size, 8);
  g.fill();
  const cs = size * 0.72;
  const lift = Math.round(cs * 0.22);
  const ox = (size - cs) / 2;
  const oy = (size - cs) / 2 + lift * 0.5;
  if (kind === 'keg') drawKeg(g, size / 2, size / 2, size * 0.86, 0.8, 0, SIDES[0].color);
  else if (kind === 'crate') {
    g.save();
    g.translate(ox, oy - lift);
    drawCrateTile(g, cs, lift, false, false);
    g.restore();
  } else if (kind === 'stone') {
    g.save();
    g.translate(ox, oy - lift);
    drawStoneTile(g, cs, lift, THEMES.castle.stone, 3);
    g.restore();
  } else if (kind === 'knight') drawKnight(g, size / 2, size / 2 + size * 0.04, size * 0.9, SIDES[0], { x: 0, y: 1 }, 0, 0);
  return c.toDataURL();
}

/** The keg on the big button: no floor behind it. */
export function kegIcon(size = 60) {
  const { c, g } = canvasOf(size, size, 2);
  drawKeg(g, size / 2, size * 0.5, size * 1.05, 1, 0, '#cfa552');
  return c.toDataURL();
}

/**
 * The picture at the top of the menu: a knight about to be surprised by his own keg,
 * a blast breaking a crate open, and the power-ups that came out of it.
 */
export function drawMenuScene(canvas, now, kit = null) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = Math.min(46, h / 3.2);
  const lift = Math.round(cs * 0.22);
  const oy = h - cs * 1.6;
  const base = oy + cs * 0.1;
  const col = (k) => (w * k);
  // The floor, the stone and the crate never move: with a kit, one picture.
  const still = (q) => {
    const th = THEMES.castle;
    const cols = Math.ceil(w / cs) + 1;
    q.fillStyle = '#151a22';
    q.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) {
      for (let x = 0; x < cols; x++) {
        q.fillStyle = th.floor[Math.floor(hash(x, r, 1) * 4) % 4];
        q.fillRect(x * cs, oy - cs * 0.4 + r * cs, cs, cs);
      }
    }
    const fade = q.createLinearGradient(0, oy - cs * 0.6, 0, oy + cs * 0.3);
    fade.addColorStop(0, 'rgba(21, 26, 34, 1)');
    fade.addColorStop(1, 'rgba(21, 26, 34, 0)');
    q.fillStyle = fade;
    q.fillRect(0, oy - cs * 0.6, w, cs * 0.9);
    // A stone on the left, a crate breaking on the right.
    q.save();
    q.translate(col(0.04), base - cs * 0.5 - lift);
    drawStoneTile(q, cs, lift, th.stone, 3);
    q.restore();
    q.save();
    q.translate(col(0.78), base - cs * 0.5 - lift);
    drawCrateTile(q, cs, lift, false, true);
    q.restore();
  };
  if (kit) g.drawImage(kit.get(`scene:${w}x${h}`, w, h, 0, 0, still, dpr).c, 0, 0, w, h);
  else still(g);
  // The knight, the keg, and a blast.
  const knight = kit ? knightFast.bind(null, kit) : drawKnight;
  knight(g, col(0.24), base, cs, SIDES[0], { x: 1, y: 0 }, now / 300, now);
  (kit ? kegFast.bind(null, kit) : drawKeg)(g, col(0.42), base, cs, 0.35 + 0.3 * Math.sin(now / 700), now, SIDES[0].color);
  const life = 0.6 + 0.3 * Math.sin(now / 160);
  drawFlame(g, col(0.62), base - cs * 0.1, cs, 1 | 2 | 16, life, now, kit);
  drawFlame(g, col(0.62) + cs, base - cs * 0.1, cs, 1 | 2, life, now, kit);
  knight(g, col(0.94), base, cs, SIDES[1], { x: -1, y: 0 }, 0, now);
  // Power-ups popping out.
  const kinds = ['keg', 'fire', 'boots'];
  kinds.forEach((k, i) => {
    const x = col(0.55) + i * cs * 0.85;
    const y = base - cs * 1.15 - Math.abs(Math.sin(now / 420 + i)) * cs * 0.18;
    if (kit) medallionFast(kit, g, x, y, cs * 0.26, k, now);
    else drawMedallion(g, x, y, cs * 0.26, k, now);
  });
}
