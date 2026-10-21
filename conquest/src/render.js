// Drawing for Castle Conquest: a parchment war map with holdings, banners and marching columns.
// Upright phones show the map as is; sideways phones show it turned so your side is on the left.
import { MAP_W, MAP_H, KINDS, SIDES, NEUTRAL, MARCH_SPEED, TICK_HZ } from './config.js';
import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;
const C = {
  ground: '#d8c79f',
  speckDark: 'rgba(120, 95, 55, 0.10)',
  speckLight: 'rgba(255, 248, 225, 0.16)',
  tree: '#6f7a4c',
  treeDark: '#58613c',
  hill: 'rgba(140, 115, 70, 0.22)',
  plot: '#c8b68c',
  plotEdge: '#8f8264',
  roof: '#9a4d36',
  roofDark: '#6e3424',
  wall: '#e6dcc2',
  stone: '#a7aeb8',
  stoneDark: '#5d646e',
  ink: '#2a2118',
  bone: '#ece2cc',
  brass: '#cfa552',
  good: '#3f9b62',
  bad: '#c0463e',
};

export function sideColor(owner) { return owner >= 0 ? SIDES[owner].color : NEUTRAL.color; }
export function sideLight(owner) { return owner >= 0 ? SIDES[owner].light : NEUTRAL.light; }

export class MapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.s = 100; // pixels per map unit
    this.ox = 0;
    this.oy = 0;
    this.rot = false; // sideways: map turned so the bottom of the map is on the left
    this.bg = null;
    this.fx = [];
    this.seed = 1;
    this.nodesForBg = [];
  }

  /** Fit the map into the canvas's CSS box. */
  layout(nodes, seed) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const pad = 0.045;
    // Turn the map whenever that draws it bigger (a phone held sideways).
    const sUp = Math.min(w / (MAP_W + pad * 2), h / (MAP_H + pad * 2));
    const sRot = Math.min(w / (MAP_H + pad * 2), h / (MAP_W + pad * 2));
    this.rot = sRot > sUp * 1.02;
    const mw = this.rot ? MAP_H : MAP_W;
    const mh = this.rot ? MAP_W : MAP_H;
    const s = this.rot ? sRot : sUp;
    const changed = w !== this.w || h !== this.h || dpr !== this.dpr || s !== this.s || seed !== this.seed || nodes !== this.nodesForBg;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.s = s;
    this.ox = (w - mw * s) / 2;
    this.oy = (h - mh * s) / 2;
    if (changed) {
      this.seed = seed;
      this.nodesForBg = nodes;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.bg = this.buildBackground(nodes);
    }
  }

  toScreen(x, y) {
    if (this.rot) return { x: this.ox + (MAP_H - y) * this.s, y: this.oy + x * this.s };
    return { x: this.ox + x * this.s, y: this.oy + y * this.s };
  }

  toMap(px, py) {
    if (this.rot) return { x: (py - this.oy) / this.s, y: MAP_H - (px - this.ox) / this.s };
    return { x: (px - this.ox) / this.s, y: (py - this.oy) / this.s };
  }

  radius(kind) { return KINDS[kind].r * this.s; }

  /** The holding under a screen point, with a generous margin for fingers. */
  hit(nodes, px, py, slack = 16) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const p = this.toScreen(n.x, n.y);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= this.radius(n.kind) + slack && d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  buildBackground(nodes) {
    const { w, h, dpr } = this;
    const off = document.createElement('canvas');
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const g = off.getContext('2d');
    g.scale(dpr, dpr);
    const rnd = mulberry32(this.seed ^ 0x9e3779b9);

    g.fillStyle = '#151a22';
    g.fillRect(0, 0, w, h);
    // The parchment sheet.
    const a = this.toScreen(-0.03, -0.03);
    const b = this.toScreen(MAP_W + 0.03, MAP_H + 0.03);
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const sw = Math.abs(b.x - a.x);
    const sh = Math.abs(b.y - a.y);
    g.save();
    roundRect(g, x0, y0, sw, sh, 12);
    g.clip();
    g.fillStyle = C.ground;
    g.fillRect(x0, y0, sw, sh);
    const specks = Math.round((sw * sh) / 24);
    for (let i = 0; i < specks; i++) {
      g.fillStyle = rnd() < 0.55 ? C.speckDark : C.speckLight;
      const s = 0.8 + rnd() * 1.8;
      g.fillRect(x0 + rnd() * sw, y0 + rnd() * sh, s, s);
    }
    // Hills and woods away from the holdings.
    const clear = (mx, my, d) => nodes.every((n) => Math.hypot(n.x - mx, n.y - my) > d);
    for (let i = 0; i < 14; i++) {
      const mx = rnd() * MAP_W;
      const my = rnd() * MAP_H;
      if (!clear(mx, my, 0.12)) continue;
      const p = this.toScreen(mx, my);
      g.fillStyle = C.hill;
      g.beginPath();
      g.ellipse(p.x, p.y, this.s * (0.06 + rnd() * 0.05), this.s * (0.03 + rnd() * 0.02), 0, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 70; i++) {
      const mx = rnd() * MAP_W;
      const my = rnd() * MAP_H;
      if (!clear(mx, my, 0.085)) continue;
      const p = this.toScreen(mx, my);
      const r = this.s * (0.011 + rnd() * 0.008);
      g.fillStyle = C.treeDark;
      g.beginPath();
      g.arc(p.x + r * 0.5, p.y + r * 0.3, r, 0, TAU);
      g.fill();
      g.fillStyle = C.tree;
      g.beginPath();
      g.arc(p.x - r * 0.2, p.y - r * 0.1, r * 1.05, 0, TAU);
      g.fill();
    }
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(sw, sh) * 0.35, w / 2, h / 2, Math.max(sw, sh) * 0.7);
    vg.addColorStop(0, 'rgba(60, 40, 15, 0)');
    vg.addColorStop(1, 'rgba(60, 40, 15, 0.25)');
    g.fillStyle = vg;
    g.fillRect(x0, y0, sw, sh);
    g.restore();
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 1;
    roundRect(g, x0 + 0.5, y0 + 0.5, sw - 1, sh - 1, 12);
    g.stroke();
    return off;
  }

  addEvents(events, world, now) {
    for (const e of events) {
      if (e.t === 'capture') this.fx.push({ k: 'capture', node: e.node, owner: e.owner, t0: now, dur: 700 });
      else if (e.t === 'repelled') this.fx.push({ k: 'clash', node: e.node, t0: now, dur: 380 });
      else if (e.t === 'upgrade') this.fx.push({ k: 'upgrade', node: e.node, owner: e.owner, t0: now, dur: 800 });
    }
    if (this.fx.length > 80) this.fx.splice(0, this.fx.length - 80);
  }

  /**
   * ui: { me, selected: Set of node ids, pointer: {x, y} | null, hover: node | null,
   *       preview: { count, need } | null, alpha, threat: Set of node ids, you: { id, until } | null }
   */
  draw(world, ui, now) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.drawImage(this.bg, 0, 0, this.w, this.h);

    const sel = ui.selected;
    // Holdings of yours with enemy soldiers marching on them.
    if (ui.threat && ui.threat.size) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      g.strokeStyle = `rgba(236, 109, 100, ${0.55 + pulse * 0.45})`;
      g.lineWidth = 3;
      g.setLineDash([6, 5]);
      for (const id of ui.threat) {
        const n = world.nodes[id];
        const p = this.toScreen(n.x, n.y);
        g.beginPath();
        g.arc(p.x, p.y, this.radius(n.kind) + 9 + pulse * 2, 0, TAU);
        g.stroke();
      }
      g.setLineDash([]);
    }
    // Drag lines under everything else.
    if (ui.pointer && sel.size) {
      const col = sideColor(ui.me);
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.setLineDash([8, 6]);
      g.lineCap = 'round';
      const end = ui.hover ? this.toScreen(ui.hover.x, ui.hover.y) : ui.pointer;
      for (const id of sel) {
        if (ui.hover && ui.hover.id === id) continue;
        const n = world.nodes[id];
        const p = this.toScreen(n.x, n.y);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(end.x, end.y);
        g.stroke();
      }
      g.setLineDash([]);
      g.lineCap = 'butt';
    }

    for (const f of world.fleets) if (f.alive) this.drawFleet(g, f, ui.alpha);
    for (const n of world.nodes) this.drawNode(g, n, sel.has(n.id), now, ui.me);

    if (ui.hover && sel.size) {
      const p = this.toScreen(ui.hover.x, ui.hover.y);
      const r = this.radius(ui.hover.kind);
      g.strokeStyle = C.brass;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, r + 7, 0, TAU);
      g.stroke();
      if (ui.preview) this.drawPreview(g, p.x, p.y - r - 24, ui.preview);
    }
    this.drawFx(g, world, now);
    if (ui.you && now < ui.you.until) this.drawYou(g, world.nodes[ui.you.id], ui.me, (ui.you.until - now) / 1000);
  }

  /** "You" marker over your first castle at the start of a match. */
  drawYou(g, n, me, left) {
    const p = this.toScreen(n.x, n.y);
    const r = this.radius(n.kind);
    const a = Math.min(1, left / 0.6);
    const bob = Math.sin(performance.now() / 220) * 3;
    const y = p.y - r - 30 + bob;
    g.globalAlpha = a;
    g.font = '800 14px "Alegreya Sans", system-ui, sans-serif';
    const tw = g.measureText('YOU').width;
    const w = tw + 18;
    const h = 24;
    g.fillStyle = sideColor(me);
    roundRect(g, p.x - w / 2, y - h / 2, w, h, 8);
    g.fill();
    g.beginPath();
    g.moveTo(p.x - 7, y + h / 2 - 1);
    g.lineTo(p.x + 7, y + h / 2 - 1);
    g.lineTo(p.x, y + h / 2 + 8);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('YOU', p.x, y + 1);
    g.globalAlpha = 1;
  }

  drawPreview(g, x, y, pv) {
    const text = pv.need == null ? `+${pv.count}` : `${pv.count} vs ${pv.need}`;
    g.font = '700 13px "IBM Plex Mono", ui-monospace, Menlo, monospace';
    const tw = g.measureText(text).width;
    const w = tw + 16;
    const h = 22;
    const bx = Math.max(4, Math.min(this.w - w - 4, x - w / 2));
    const by = Math.max(4, y - h / 2);
    g.fillStyle = pv.need == null ? 'rgba(21, 26, 34, 0.9)' : pv.count >= pv.need ? 'rgba(31, 92, 55, 0.95)' : 'rgba(130, 40, 34, 0.95)';
    roundRect(g, bx, by, w, h, 7);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + w / 2, by + h / 2 + 0.5);
  }

  drawFleet(g, f, alpha) {
    const along = Math.min(f.len, f.done + MARCH_SPEED * (alpha || 0) / TICK_HZ);
    const ux = (f.x1 - f.x0) / f.len;
    const uy = (f.y1 - f.y0) / f.len;
    const col = sideColor(f.owner);
    const dots = Math.max(1, Math.min(10, Math.ceil(f.count / 4)));
    const gap = 9 / this.s;
    for (let i = dots - 1; i >= 0; i--) {
      const d = Math.max(0, along - i * gap);
      const p = this.toScreen(f.x0 + ux * d, f.y0 + uy * d);
      const r = i === 0 ? 5 : 3.4;
      g.fillStyle = col;
      g.strokeStyle = 'rgba(20, 16, 10, 0.85)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TAU);
      g.fill();
      g.stroke();
    }
    const head = this.toScreen(f.x0 + ux * along, f.y0 + uy * along);
    const label = String(f.count);
    g.font = '700 11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(21, 26, 34, 0.85)';
    g.strokeText(label, head.x, head.y - 11);
    g.fillStyle = '#fff';
    g.fillText(label, head.x, head.y - 11);
  }

  drawNode(g, n, selected, now, me) {
    const p = this.toScreen(n.x, n.y);
    const r = this.radius(n.kind);
    const col = sideColor(n.owner);

    // Ground shadow and plot.
    g.fillStyle = 'rgba(60, 40, 15, 0.28)';
    g.beginPath();
    g.ellipse(p.x + 1.5, p.y + 3, r + 2, r * 0.92 + 2, 0, 0, TAU);
    g.fill();
    g.fillStyle = C.plot;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.fill();

    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      g.strokeStyle = sideLight(me);
      g.lineWidth = 4 + pulse * 2;
      g.beginPath();
      g.arc(p.x, p.y, r + 6 + pulse * 2, 0, TAU);
      g.stroke();
    }

    drawHolding(g, p.x, p.y, r, n.kind, col);

    // Ring in the owner's colour.
    g.strokeStyle = col;
    g.lineWidth = n.owner >= 0 ? Math.max(3, r * 0.16) : 2;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.stroke();

    // Garrison count.
    const text = String(Math.floor(n.troops));
    g.font = `700 ${Math.round(Math.max(12, r * 0.62))}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    const tw = g.measureText(text).width;
    const pw = Math.max(tw + 10, 24);
    const ph = Math.round(Math.max(17, r * 0.78));
    const py = p.y + r - ph * 0.15;
    g.fillStyle = n.owner >= 0 ? col : 'rgba(70, 62, 48, 0.92)';
    roundRect(g, p.x - pw / 2, py, pw, ph, ph / 2);
    g.fill();
    g.strokeStyle = 'rgba(20, 16, 10, 0.6)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, p.x, py + ph / 2 + 0.5);
  }

  drawFx(g, world, now) {
    let keep = 0;
    for (const f of this.fx) {
      const t = (now - f.t0) / f.dur;
      if (t >= 1) continue;
      this.fx[keep++] = f;
      if (t < 0) continue;
      const n = world.nodes[f.node];
      const p = this.toScreen(n.x, n.y);
      const r = this.radius(n.kind);
      if (f.k === 'capture') {
        g.strokeStyle = sideColor(f.owner);
        g.globalAlpha = 1 - t;
        g.lineWidth = 5 * (1 - t) + 1;
        g.beginPath();
        g.arc(p.x, p.y, r + 4 + t * r * 1.6, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      } else if (f.k === 'clash') {
        g.strokeStyle = `rgba(255, 236, 200, ${1 - t})`;
        g.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + t;
          g.beginPath();
          g.moveTo(p.x + Math.cos(a) * (r + 2), p.y + Math.sin(a) * (r + 2));
          g.lineTo(p.x + Math.cos(a) * (r + 6 + t * 8), p.y + Math.sin(a) * (r + 6 + t * 8));
          g.stroke();
        }
      } else if (f.k === 'upgrade') {
        g.strokeStyle = `rgba(207, 165, 82, ${1 - t})`;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(p.x, p.y, r + 3 + t * 14, 0, TAU);
        g.stroke();
      }
    }
    this.fx.length = keep;
  }
}

/** A holding drawn on its own, for the how-to page. */
export function holdingThumb(kind, color, size = 64) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const r = size * 0.36;
  const x = size / 2;
  const y = size / 2;
  g.fillStyle = C.ground;
  roundRect(g, 0, 0, size, size, 10);
  g.fill();
  g.fillStyle = C.plot;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  drawHolding(g, x, y, r, kind, color);
  g.strokeStyle = color;
  g.lineWidth = Math.max(2.5, r * 0.14);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.stroke();
  return c.toDataURL();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function house(g, x, y, s, wall, roof) {
  g.fillStyle = wall;
  g.fillRect(x - s * 0.5, y - s * 0.2, s, s * 0.7);
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(x - s * 0.66, y - s * 0.18);
  g.lineTo(x, y - s * 0.72);
  g.lineTo(x + s * 0.66, y - s * 0.18);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(42, 33, 24, 0.75)';
  g.fillRect(x - s * 0.1, y + s * 0.12, s * 0.2, s * 0.38);
}

function flag(g, x, y, s, col) {
  g.strokeStyle = C.ink;
  g.lineWidth = Math.max(1, s * 0.08);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - s);
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y - s);
  g.lineTo(x + s * 0.75, y - s * 0.78);
  g.lineTo(x, y - s * 0.56);
  g.closePath();
  g.fill();
}

/** Village: one house. Town: three houses behind a wall. Castle: a keep with towers. */
export function drawHolding(g, x, y, r, kind, col) {
  if (kind === 'village') {
    house(g, x, y + r * 0.05, r * 0.75, C.wall, C.roof);
    flag(g, x + r * 0.42, y - r * 0.1, r * 0.55, col);
    return;
  }
  if (kind === 'town') {
    house(g, x - r * 0.34, y + r * 0.08, r * 0.5, C.wall, C.roofDark);
    house(g, x + r * 0.34, y + r * 0.08, r * 0.5, C.wall, C.roofDark);
    house(g, x, y - r * 0.12, r * 0.58, C.wall, C.roof);
    g.strokeStyle = C.stoneDark;
    g.lineWidth = Math.max(1.2, r * 0.07);
    g.beginPath();
    g.arc(x, y, r * 0.82, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    flag(g, x + r * 0.05, y - r * 0.5, r * 0.45, col);
    return;
  }
  // Castle.
  const w = r * 1.0;
  const h = r * 0.62;
  g.fillStyle = C.stone;
  g.fillRect(x - w / 2, y - h * 0.35, w, h);
  const tw = r * 0.28;
  for (const sx of [-1, 1]) {
    g.fillRect(x + sx * (w / 2) - tw / 2, y - h * 0.65, tw, h * 1.3);
    for (let i = 0; i < 2; i++) g.fillRect(x + sx * (w / 2) - tw / 2 + i * tw * 0.6, y - h * 0.82, tw * 0.4, h * 0.2);
  }
  g.fillRect(x - r * 0.22, y - h * 0.8, r * 0.44, h * 0.6);
  for (let i = 0; i < 3; i++) g.fillRect(x - r * 0.22 + i * r * 0.17, y - h * 0.98, r * 0.1, h * 0.2);
  g.fillStyle = C.stoneDark;
  g.beginPath();
  g.moveTo(x - r * 0.12, y + h * 0.65);
  g.lineTo(x - r * 0.12, y + h * 0.2);
  g.arc(x, y + h * 0.2, r * 0.12, Math.PI, 0);
  g.lineTo(x + r * 0.12, y + h * 0.65);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(42, 33, 24, 0.5)';
  g.lineWidth = 1;
  g.strokeRect(x - w / 2, y - h * 0.35, w, h);
  flag(g, x, y - h * 0.95, r * 0.5, col);
}
