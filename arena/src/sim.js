// One round of Powder Keg: movement on the cell grid, kegs, blasts, power-ups and the closing-in
// stones. Fixed 30 Hz tick, no DOM, deterministic for a given layout and inputs.
import {
  TICK_HZ, DT, FLOOR, PILLAR, CRATE, BURNING, BLOCK,
  FUSE, FLAME_TIME, BASE_SPEED, SPEED_STEP, MAX_SPEED_LV, START_KEGS, MAX_KEGS, START_RANGE, MAX_RANGE,
  COUNTDOWN, HURRY_AT, DROP_EVERY, END_GRACE, FINAL_SIZE, FINAL_PAUSE, FINAL_DROP_EVERY, FINAL_FUSE,
} from './config.js';

export const DIRS = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
// Flame arm bits: which neighbours a burning cell connects to (for drawing beams).
export const ARM = [1, 2, 4, 8]; // left, right, up, down

/** Stones fall ring by ring from the edge, four at a time, one on each side. */
function closingOrder(n) {
  const groups = [];
  for (let r = 0; r < Math.ceil(n / 2); r++) {
    const lo = r;
    const hi = n - 1 - r;
    if (lo === hi) { groups.push([lo * n + lo]); break; }
    for (let x = lo; x < hi; x++) {
      // (x, lo) and its turns by a quarter around the centre.
      const pts = [[x, lo], [hi - (x - lo), hi], [lo, hi - (x - lo)], [hi, x]];
      groups.push(pts.map(([px, py]) => py * n + px));
    }
  }
  return groups;
}

export class Arena {
  /**
   * layout: from generateArena. players: [{ name, team, kind: 'human'|'bot', difficulty }].
   */
  constructor({ layout, players }) {
    const n = layout.n;
    this.n = n;
    this.tiles = Uint8Array.from(layout.tiles);
    this.hidden = new Map(layout.hidden); // power-ups still inside crates
    this.items = new Map(); // power-ups lying on the floor: cell -> kind
    this.bombs = [];
    this.flames = new Map(); // cell -> { ttl, owner, arms }
    this.burning = new Map(); // crate cell -> ticks left
    this.nextBombId = 1;
    this.players = players.map((p, i) => {
      const s = layout.spawns[i];
      return {
        index: i,
        name: p.name,
        team: p.team,
        kind: p.kind,
        difficulty: p.difficulty || null,
        x: s.x,
        y: s.y,
        px: s.x,
        py: s.y,
        alive: true,
        diedAt: null,
        killer: null,
        kegs: START_KEGS,
        range: START_RANGE,
        speedLv: 0,
        active: 0,
        face: { x: s.x === 0 ? 1 : -1, y: 0 },
        moving: false,
        walk: 0,
        input: { dir: null, alt: null, bomb: false },
        stats: { kegs: 0, crates: 0, powers: 0, kills: 0, selfKills: 0 },
      };
    });
    this.tick = 0;
    this.startTick = Math.round(COUNTDOWN * TICK_HZ);
    this.hurryTick = this.startTick + Math.round((HURRY_AT[n] || 60) * TICK_HZ);
    this.dropTicks = Math.max(1, Math.round(DROP_EVERY * TICK_HZ));
    this.dropOrder = closingOrder(n);
    // Where the open middle starts: stone pauses there before closing in on the last stand.
    const rings = Math.max(0, Math.floor((n - FINAL_SIZE) / 2));
    let finalIdx = 0;
    for (let r = 0; r < rings; r++) finalIdx += Math.max(1, n - 1 - 2 * r);
    this.finalIdx = finalIdx;
    this.dropIdx = 0;
    this.nextDrop = this.hurryTick;
    this.fuseTicks = Math.round(FUSE * TICK_HZ);
    this.flameTicks = Math.round(FLAME_TIME * TICK_HZ);
    this.events = [];
    this.endTick = null;
    this.final = false; // stone has reached the middle
    this.over = false;
    this.result = null;
  }

  // ---------- helpers ----------
  ev(e) { this.events.push(e); }
  idx(x, y) { return y * this.n + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; }
  cellOf(p) { return this.idx(Math.round(p.x), Math.round(p.y)); }
  bombAt(c) {
    for (const b of this.bombs) if (b.cell === c) return b;
    return null;
  }
  team(i) { return i >= 0 ? this.players[i].team : -1; }
  friendly(a, b) { return a >= 0 && b >= 0 && this.team(a) === this.team(b); }
  get frozen() { return this.tick < this.startTick; }
  /** Seconds since the round started (negative during the countdown). */
  get time() { return (this.tick - this.startTick) / TICK_HZ; }
  get hurry() { return this.tick >= this.hurryTick; }
  speedOf(p) { return BASE_SPEED + SPEED_STEP * p.speedLv; }

  passable(x, y, p) {
    if (!this.inside(x, y)) return false;
    const c = this.idx(x, y);
    if (this.tiles[c] !== FLOOR) return false;
    const b = this.bombAt(c);
    return !b || (p != null && b.passers.has(p.index));
  }

  // ---------- movement ----------
  movePlayer(p) {
    const inp = p.input;
    p.moving = false;
    if (!inp.dir && !inp.alt) return;
    const dist = this.speedOf(p) * DT;
    for (const d of [inp.dir, inp.alt]) {
      if (!d) continue;
      const moved = this.tryMove(p, d, dist);
      if (moved > 1e-6) {
        p.face = { x: d.x, y: d.y };
        p.moving = true;
        p.walk += moved;
        return;
      }
    }
    if (inp.dir) p.face = { x: inp.dir.x, y: inp.dir.y };
  }

  /** Move along d, first sliding onto the nearest open lane if needed. Returns distance moved. */
  tryMove(p, d, dist) {
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    if (d.x !== 0) {
      const off = p.y - cy;
      if (Math.abs(off) > 1e-4) {
        if (this.passable(cx + d.x, cy, p)) return this.slide(p, 'y', cy, dist);
        const oy = cy + Math.sign(off);
        if (Math.abs(off) > 0.2 && this.passable(cx, oy, p) && this.passable(cx + d.x, oy, p)) return this.slide(p, 'y', oy, dist);
        return 0;
      }
      p.y = cy;
      return this.advance(p, 'x', cx, d.x, this.passable(cx + d.x, cy, p), dist);
    }
    const off = p.x - cx;
    if (Math.abs(off) > 1e-4) {
      if (this.passable(cx, cy + d.y, p)) return this.slide(p, 'x', cx, dist);
      const ox = cx + Math.sign(off);
      if (Math.abs(off) > 0.2 && this.passable(ox, cy, p) && this.passable(ox, cy + d.y, p)) return this.slide(p, 'x', ox, dist);
      return 0;
    }
    p.x = cx;
    return this.advance(p, 'y', cy, d.y, this.passable(cx, cy + d.y, p), dist);
  }

  slide(p, axis, target, dist) {
    const delta = target - p[axis];
    const step = Math.min(Math.abs(delta), dist);
    p[axis] += Math.sign(delta) * step;
    return step;
  }

  advance(p, axis, c, s, open, dist) {
    if (open) {
      p[axis] += s * dist;
      return dist;
    }
    // Blocked ahead: walk to the middle of the current cell and stop.
    const room = (c - p[axis]) * s;
    if (room <= 1e-6) return 0;
    const step = Math.min(room, dist);
    p[axis] += s * step;
    return step;
  }

  // ---------- kegs and blasts ----------
  placeBomb(p) {
    if (p.active >= p.kegs) return false;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const c = this.idx(x, y);
    if (this.tiles[c] !== FLOOR || this.bombAt(c)) return false;
    // Anyone standing on the cell may walk off the keg; nobody may walk back on.
    const passers = new Set();
    for (const q of this.players) if (q.alive && this.cellOf(q) === c) passers.add(q.index);
    // In the last stand every blast reaches all the way across.
    const range = this.final ? this.n : p.range;
    this.bombs.push({ id: this.nextBombId++, cell: c, x, y, owner: p.index, fuse: this.fuseTicks, fuse0: this.fuseTicks, range, passers, born: this.tick });
    p.active++;
    p.stats.kegs++;
    this.ev({ t: 'keg', owner: p.index, cell: c });
    return true;
  }

  /**
   * Cells a blast from (x, y) reaches: it stops at stone, at the first crate (which burns),
   * at another keg (which goes off too) and at a power-up (which burns).
   * With apply false nothing changes (bots use this to look ahead).
   */
  blast(x, y, range, apply = false, owner = -1) {
    const centre = this.idx(x, y);
    const out = [centre];
    let centreArms = 0;
    for (let k = 0; k < 4; k++) {
      const d = DIRS[k];
      const back = ARM[k ^ 1];
      let last = -1;
      for (let i = 1; i <= range; i++) {
        const cx = x + d.x * i;
        const cy = y + d.y * i;
        if (!this.inside(cx, cy)) break;
        const c = this.idx(cx, cy);
        const t = this.tiles[c];
        if (t === PILLAR || t === BLOCK) break;
        out.push(c);
        if (i === 1) centreArms |= ARM[k];
        if (apply) {
          if (last >= 0) this.flames.get(last).arms |= ARM[k];
          this.setFlame(c, owner, back);
          last = c;
        }
        if (t === CRATE || t === BURNING) {
          if (apply && t === CRATE) {
            this.tiles[c] = BURNING;
            this.burning.set(c, this.flameTicks);
            if (owner >= 0) this.players[owner].stats.crates++;
            this.ev({ t: 'crate', cell: c, owner });
          }
          break;
        }
        const keg = this.bombAt(c);
        if (keg) {
          if (apply) keg.fuse = 0;
          break;
        }
        if (this.items.has(c)) {
          if (apply) {
            this.items.delete(c);
            this.ev({ t: 'burnItem', cell: c });
          }
          break;
        }
      }
    }
    if (apply) this.setFlame(centre, owner, centreArms | 16);
    return out;
  }

  setFlame(c, owner, arms) {
    const bit = owner >= 0 ? 1 << owner : 0;
    const f = this.flames.get(c);
    if (f) {
      f.ttl = this.flameTicks;
      f.arms |= arms;
      f.owner = owner;
      f.owners |= bit;
    } else {
      this.flames.set(c, { ttl: this.flameTicks, owner, owners: bit, arms, born: this.tick });
    }
  }

  /** Who a flame kills p for: a rival's fire first, then p's own; a teammate's fire never. -2: harmless. */
  burnedBy(f, p) {
    let self = false;
    for (const q of this.players) {
      if (!(f.owners & (1 << q.index))) continue;
      if (q.index === p.index) self = true;
      else if (!this.friendly(q.index, p.index)) return q.index;
    }
    if (self) return p.index;
    return f.owners ? -2 : -1;
  }

  explode(b) {
    this.bombs.splice(this.bombs.indexOf(b), 1);
    const owner = this.players[b.owner];
    owner.active = Math.max(0, owner.active - 1);
    const cells = this.blast(b.x, b.y, b.range, true, b.owner);
    this.ev({ t: 'blast', owner: b.owner, cell: b.cell, size: cells.length });
  }

  // ---------- closing in ----------
  dropStones() {
    while (this.dropIdx < this.dropOrder.length) {
      if (this.dropIdx === this.finalIdx && !this.final) {
        // The middle is all that's left: a pause, then stone keeps coming, slower.
        this.final = true;
        this.fuseTicks = Math.round(FINAL_FUSE * TICK_HZ);
        this.dropTicks = Math.max(1, Math.round(FINAL_DROP_EVERY * TICK_HZ));
        this.nextDrop = this.tick + Math.round(FINAL_PAUSE * TICK_HZ) - this.dropTicks;
        this.ev({ t: 'final' });
        return;
      }
      const group = this.dropOrder[this.dropIdx++];
      const cells = group.filter((c) => this.tiles[c] !== PILLAR && this.tiles[c] !== BLOCK);
      if (!cells.length) continue; // nothing to cover here: no time spent
      for (const c of cells) {
        this.tiles[c] = BLOCK;
        this.hidden.delete(c);
        this.items.delete(c);
        this.burning.delete(c);
        this.flames.delete(c);
        const b = this.bombAt(c);
        if (b) {
          this.bombs.splice(this.bombs.indexOf(b), 1);
          const o = this.players[b.owner];
          o.active = Math.max(0, o.active - 1);
        }
        for (const p of this.players) if (p.alive && this.cellOf(p) === c) this.kill(p, -1);
      }
      this.ev({ t: 'drop', cells });
      return;
    }
  }

  /** The next few groups of stones to fall, for warnings: [{ cells, inTicks }]. */
  upcomingDrops(count) {
    const out = [];
    let t = Math.max(0, this.nextDrop - this.tick);
    for (let g = this.dropIdx; g < this.dropOrder.length && out.length < count; g++) {
      const cells = this.dropOrder[g].filter((c) => this.tiles[c] !== PILLAR && this.tiles[c] !== BLOCK);
      if (!cells.length) continue;
      out.push({ cells, inTicks: t });
      t += this.dropTicks;
    }
    return out;
  }

  // ---------- life and death ----------
  kill(p, by) {
    if (!p.alive) return;
    p.alive = false;
    p.diedAt = this.tick;
    p.killer = by;
    p.input.dir = null;
    p.input.alt = null;
    if (by === p.index) p.stats.selfKills++;
    else if (by >= 0) this.players[by].stats.kills++;
    this.ev({ t: 'death', player: p.index, by });
  }

  applyPower(p, kind) {
    if (kind === 'keg') p.kegs = Math.min(MAX_KEGS, p.kegs + 1);
    else if (kind === 'fire') p.range = Math.min(MAX_RANGE, p.range + 1);
    else if (kind === 'boots') p.speedLv = Math.min(MAX_SPEED_LV, p.speedLv + 1);
    p.stats.powers++;
    this.ev({ t: 'power', player: p.index, kind });
  }

  checkEnd() {
    const alive = this.players.filter((p) => p.alive);
    const teams = new Set(alive.map((p) => p.team));
    if (this.endTick == null) {
      // A short grace: if the last one standing is caught in a blast a moment later, it's a draw.
      if (teams.size <= 1) this.endTick = this.tick + Math.round(END_GRACE * TICK_HZ);
      return;
    }
    if (this.tick >= this.endTick || alive.length === 0) {
      this.over = true;
      this.result = { team: teams.size === 1 ? [...teams][0] : null, tick: this.tick };
      this.ev({ t: 'over', result: this.result });
    }
  }

  // ---------- the tick ----------
  step() {
    if (this.over) return;
    this.tick++;
    for (const p of this.players) {
      p.px = p.x;
      p.py = p.y;
    }
    if (this.tick < this.startTick) return;
    if (this.tick === this.startTick) this.ev({ t: 'go' });

    for (const p of this.players) {
      if (!p.alive) {
        p.input.bomb = false;
        continue;
      }
      // The keg drops where you stand, then you move.
      if (p.input.bomb) {
        this.placeBomb(p);
        p.input.bomb = false;
      }
      this.movePlayer(p);
    }
    for (const b of this.bombs) {
      for (const i of b.passers) {
        const q = this.players[i];
        if (!q.alive || this.cellOf(q) !== b.cell) b.passers.delete(i);
      }
    }

    for (const [c, f] of this.flames) {
      if (--f.ttl <= 0) this.flames.delete(c);
    }
    for (const [c, t] of this.burning) {
      if (t > 1) {
        this.burning.set(c, t - 1);
        continue;
      }
      this.burning.delete(c);
      this.tiles[c] = FLOOR;
      const kind = this.hidden.get(c);
      if (kind) {
        this.hidden.delete(c);
        this.items.set(c, kind);
        this.ev({ t: 'reveal', cell: c, kind });
      }
    }

    for (const b of this.bombs) b.fuse--;
    for (let guard = 0; guard < 64; guard++) {
      const b = this.bombs.find((q) => q.fuse <= 0);
      if (!b) break;
      this.explode(b);
    }

    if (this.tick === this.hurryTick) this.ev({ t: 'hurry' });
    if (this.tick >= this.nextDrop && this.dropIdx < this.dropOrder.length) {
      this.dropStones();
      this.nextDrop += this.dropTicks;
    }

    for (const p of this.players) {
      if (!p.alive) continue;
      const f = this.flames.get(this.cellOf(p));
      if (!f) continue;
      // Your own blasts hurt you; a teammate's don't.
      const by = this.burnedBy(f, p);
      if (by !== -2) this.kill(p, by);
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const c = this.cellOf(p);
      const kind = this.items.get(c);
      if (kind) {
        this.items.delete(c);
        this.applyPower(p, kind);
      }
    }
    this.checkEnd();
  }
}
