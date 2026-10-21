// Practice opponents. A bot sees what a player sees and gives the same orders (a direction and
// "drop a keg"); it just decides on a timer. Every decision starts from a danger map: for each
// cell, when the next blast or falling stone will hit it and when it will be safe again.
import { TICK_HZ, FLOOR, CRATE, BASE_SPEED, SPEED_STEP } from './config.js';
import { DIRS } from './sim.js';

// think: ticks between decisions. margin: ticks of safety when timing a run past a blast.
// chains: understands kegs setting off kegs. hunt: how much a rival in reach is worth.
// trap: extra worth when the rival has nowhere to run. wander: chance of an aimless move.
// careful: only drops a keg when the way out avoids every other blast.
export const BOT_PARAMS = {
  easy: { think: 10, jitter: 6, margin: 1, chains: false, hunt: 0.45, trap: 0, wander: 0.15, powers: 0.8, lookahead: 4, careful: false },
  normal: { think: 6, jitter: 3, margin: 2, chains: true, hunt: 1.1, trap: 1.5, wander: 0.04, powers: 1.2, lookahead: 6, careful: false },
  hard: { think: 3, jitter: 1, margin: 2, chains: true, hunt: 1.6, trap: 3, wander: 0, powers: 1.5, lookahead: 8, careful: false },
};

/** Tiny binary heap keyed on arrival time. */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export class Bot {
  constructor(arena, index, difficulty, rng) {
    this.a = arena;
    this.me = index;
    this.P = BOT_PARAMS[difficulty] || BOT_PARAMS.normal;
    this.rng = rng;
    this.path = []; // [{ c, go }]: walk to cell c, not setting off before tick go
    this.mode = 'idle';
    // Each bot breaks ties between equal routes its own way, so no corner of the courtyard is favoured.
    this.dirs = DIRS.slice();
    for (let i = this.dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.dirs[i], this.dirs[j]] = [this.dirs[j], this.dirs[i]];
    }
    this.nextThink = arena.startTick + Math.floor(rng() * (this.P.think + 1));
  }

  /** Call once per tick, before the arena steps. */
  update() {
    const a = this.a;
    const p = a.players[this.me];
    if (!p.alive || a.over) return;
    if (a.tick + 1 < a.startTick) {
      p.input.dir = null;
      return;
    }
    if (a.tick >= this.nextThink) {
      this.think();
      this.nextThink = a.tick + this.P.think + Math.floor(this.rng() * (this.P.jitter + 1));
    }
    this.steer();
  }

  // ---------- seeing danger ----------
  /** D0[c]: ticks until cell c turns deadly; D1[c]: ticks until it's safe again. */
  danger() {
    const a = this.a;
    const N = a.n * a.n;
    const D0 = new Float32Array(N).fill(Infinity);
    const D1 = new Float32Array(N).fill(-Infinity);
    const me = a.players[this.me];
    for (const [c, f] of a.flames) {
      if (a.burnedBy(f, me) === -2) continue; // a teammate's fire can't hurt
      D0[c] = 0;
      D1[c] = Math.max(D1[c], f.ttl);
    }
    const kegs = a.bombs.map((b) => ({ b, t: b.fuse, cells: a.blast(b.x, b.y, b.range) }));
    if (this.P.chains) this.chain(kegs);
    for (const k of kegs) {
      if (k.b.owner !== this.me && a.friendly(k.b.owner, this.me)) continue;
      for (const c of k.cells) {
        D0[c] = Math.min(D0[c], k.t);
        D1[c] = Math.max(D1[c], k.t + a.flameTicks);
      }
    }
    if (a.tick >= a.hurryTick - 6 * TICK_HZ) {
      // Stone due in the next few seconds; anything later can wait.
      for (const g of a.upcomingDrops(10)) {
        if (g.inTicks > 3.5 * TICK_HZ) break;
        for (const c of g.cells) {
          D0[c] = Math.min(D0[c], g.inTicks);
          D1[c] = Infinity;
        }
      }
    }
    return { D0, D1 };
  }

  /** A keg caught in another keg's blast goes off with it. */
  chain(kegs) {
    for (let guard = 0; guard < 8; guard++) {
      let changed = false;
      for (const A of kegs) {
        for (const B of kegs) {
          if (B === A || B.t <= A.t) continue;
          if (A.cells.includes(B.b.cell)) {
            B.t = A.t;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  // ---------- moving ----------
  /**
   * Earliest-arrival search from player q's cell (or cell `from`). Waiting in a safe cell for a
   * blast to burn out is allowed; stepping into a cell while it's deadly is not.
   */
  search(dz, q = this.a.players[this.me], from = -1, margin = this.P.margin, extraKeg = -1) {
    const a = this.a;
    const n = a.n;
    const N = n * n;
    const start = from >= 0 ? from : a.cellOf(q);
    const tpc = TICK_HZ / (BASE_SPEED + SPEED_STEP * q.speedLv);
    const half = tpc * 0.5;
    const arrive = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    arrive[start] = 0; // close enough: you're somewhere in your cell already
    const order = [];
    const heap = new Heap();
    heap.push(arrive[start], start);
    while (heap.size) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      order.push(c);
      const tc = arrive[c];
      // Latest moment we can set off from c and still be out before it turns deadly.
      const sc = dz.D0[c];
      const latest = sc === Infinity || tc - half > dz.D1[c] ? Infinity : sc - half - margin;
      const x = c % n;
      const y = (c - x) / n;
      for (const d of this.dirs) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nc = ny * n + nx;
        if (done[nc] || a.tiles[nc] !== FLOOR || nc === extraKeg || a.bombAt(nc)) continue;
        let t = tc + tpc;
        const s = dz.D0[nc];
        if (s !== Infinity && !(t + half + margin < s)) {
          if (dz.D1[nc] === Infinity) continue; // stone is coming: never
          t = Math.max(t, dz.D1[nc] + half + margin); // wait for it to burn out
        }
        if (t - tpc > latest) continue; // can't wait that long where we are
        if (t < arrive[nc]) {
          arrive[nc] = t;
          prev[nc] = c;
          heap.push(t, nc);
        }
      }
    }
    return { start, arrive, prev, order, tpc };
  }

  /** Steps from the search start to target, each with the tick it may set off. */
  route(S, target) {
    const out = [];
    for (let c = target; c !== S.start && c >= 0; c = S.prev[c]) out.push({ c, go: this.a.tick + S.arrive[c] - S.tpc });
    return out.reverse();
  }

  nearest(S, ok) {
    for (const c of S.order) if (ok(c)) return c;
    return -1;
  }

  steer() {
    const a = this.a;
    const p = a.players[this.me];
    p.input.alt = null;
    while (this.path.length) {
      const step = this.path[0];
      const x = step.c % a.n;
      const y = (step.c - x) / a.n;
      const dx = x - p.x;
      const dy = y - p.y;
      if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) {
        this.path.shift();
        continue;
      }
      if (a.tick + 1 < step.go - 1) {
        // Early: wait in the middle of the current cell until the way ahead has burnt out.
        const hx = Math.round(p.x) - p.x;
        const hy = Math.round(p.y) - p.y;
        if (Math.abs(hx) > 0.06) p.input.dir = { x: Math.sign(hx), y: 0 };
        else if (Math.abs(hy) > 0.06) p.input.dir = { x: 0, y: Math.sign(hy) };
        else p.input.dir = null;
        return;
      }
      p.input.dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      return;
    }
    p.input.dir = null;
  }

  /** The current path is still walkable and ends somewhere no blast will reach. */
  pathOpen(dz) {
    const a = this.a;
    const end = this.path[this.path.length - 1].c;
    if (dz.D0[end] !== Infinity) return false;
    for (const { c } of this.path) {
      if (a.tiles[c] !== FLOOR) return false;
      const b = a.bombAt(c);
      if (b && !b.passers.has(this.me)) return false;
    }
    return true;
  }

  // ---------- judging a keg ----------
  rivals() {
    const a = this.a;
    return a.players.filter((q) => q.alive && q.index !== this.me && !a.friendly(q.index, this.me));
  }

  /** Danger maps with a keg added at cell c going off `t` ticks from now (plus kegs it sets off). */
  withKeg(dz, c, range, t, careful) {
    const a = this.a;
    const n = a.n;
    const D0 = dz.D0.slice();
    const D1 = dz.D1.slice();
    if (careful) {
      // Stay clear of every other blast on the way out, not just its timing.
      for (let k = 0; k < D0.length; k++) {
        if (D0[k] !== Infinity) {
          D0[k] = 0;
          D1[k] = Infinity;
        }
      }
    }
    const mark = (cells, when) => {
      for (const k of cells) {
        D0[k] = Math.min(D0[k], when);
        D1[k] = Math.max(D1[k], when + a.flameTicks);
      }
    };
    const x = c % n;
    const y = (c - x) / n;
    const cells = a.blast(x, y, range);
    mark(cells, t);
    if (this.P.chains) {
      for (const b of a.bombs) if (cells.includes(b.cell) && b.fuse > t) mark(a.blast(b.x, b.y, b.range), t);
    }
    return { D0, D1, cells };
  }

  /** Worth of a keg dropped at cell c: crates it would break and rivals it would catch. */
  kegWorth(c, dz, deep) {
    const a = this.a;
    const p = a.players[this.me];
    const n = a.n;
    const x = c % n;
    const y = (c - x) / n;
    const range = a.final ? a.n : p.range;
    const cells = a.blast(x, y, range);
    let v = 0;
    for (const k of cells) {
      if (a.tiles[k] === CRATE && dz.D0[k] === Infinity) v += 1;
      if (a.items.has(k)) v -= 0.6;
    }
    for (const q of this.rivals()) {
      const qc = a.cellOf(q);
      if (!cells.includes(qc)) continue;
      const far = Math.abs((qc % n) - x) + Math.abs(Math.floor(qc / n) - y);
      // In the last stand there's nowhere to hide: press harder.
      let w = this.P.hunt * (a.final ? 1.6 : 1) * (far <= 1 ? 1.4 : far <= 3 ? 1 : 0.5);
      if (deep && this.P.trap) {
        // Can the rival get clear of this keg in time?
        const t = Math.min(a.fuseTicks, dz.D0[c]);
        const D = this.withKeg(dz, c, range, t, false);
        const S = this.search(D, q, -1, 0, c);
        if (this.nearest(S, (k) => D.D0[k] === Infinity) < 0) w += this.P.trap;
      }
      v += w;
    }
    return v;
  }

  /** If a keg is dropped at c (now, or after walking there for `delay` ticks), the way out (or null). */
  escapeAfterKeg(c, dz, delay = 0, fromCell = false) {
    const a = this.a;
    const p = a.players[this.me];
    let base = dz;
    if (delay) {
      // Looking ahead: move the known dangers to the moment the keg would be dropped.
      const D0 = dz.D0.slice();
      const D1 = dz.D1.slice();
      for (let k = 0; k < D0.length; k++) {
        if (D0[k] !== Infinity) {
          D0[k] -= delay;
          D1[k] -= delay;
        }
      }
      base = { D0, D1 };
    }
    const t = Math.min(a.fuseTicks, base.D0[c]);
    const D = this.withKeg(base, c, a.final ? a.n : p.range, t, this.P.careful);
    const S = this.search(D, p, fromCell ? c : -1);
    const safe = this.nearest(S, (k) => D.D0[k] === Infinity);
    return safe >= 0 ? this.route(S, safe) : null;
  }

  // ---------- deciding ----------
  think() {
    const a = this.a;
    const p = a.players[this.me];
    const P = this.P;
    const n = a.n;
    const dz = this.danger();
    const here = a.cellOf(p);

    // 1. Standing where a blast will land: run to the nearest cell nothing will reach.
    if (dz.D0[here] !== Infinity) {
      if (this.mode === 'flee' && this.path.length && this.pathOpen(dz)) return;
      let S = this.search(dz);
      let safe = this.nearest(S, (c) => dz.D0[c] === Infinity);
      if (safe < 0) {
        S = this.search(dz, p, -1, 0);
        safe = this.nearest(S, (c) => dz.D0[c] === Infinity);
      }
      if (safe >= 0) {
        this.path = this.route(S, safe);
      } else {
        let best = here;
        for (const c of S.order) if (dz.D0[c] > dz.D0[best]) best = c;
        this.path = best === here ? [{ c: here, go: 0 }] : this.route(S, best);
      }
      this.mode = 'flee';
      return;
    }
    const S = this.search(dz);

    // 2. A keg here would hit something worthwhile and there's a way out: drop it and run.
    if (p.active < p.kegs && !a.bombAt(here) && a.tiles[here] === FLOOR) {
      if (this.kegWorth(here, dz, true) >= 1) {
        const out = this.escapeAfterKeg(here, dz);
        if (out && out.length) {
          p.input.bomb = true;
          this.path = out;
          this.mode = 'flee';
          return;
        }
      }
    }

    // 3. Keep going if the current plan still leads somewhere safe.
    if (this.mode === 'go' && this.path.length) {
      const end = this.path[this.path.length - 1].c;
      if (S.arrive[end] !== Infinity && dz.D0[end] === Infinity && this.rng() < 0.7) {
        this.path = this.route(S, end);
        return;
      }
    }

    // 4. Pick the best place to be: power-ups, spots to break crates from, spots to catch rivals.
    const rivals = this.rivals();
    const centre = (n - 1) / 2;
    const canKeg = p.active < p.kegs;
    const tpc = S.tpc;
    let best = -1;
    let bestScore = 0;
    if (P.wander && this.rng() < P.wander) {
      const pool = S.order.filter((c) => dz.D0[c] === Infinity);
      if (pool.length) {
        best = pool[Math.floor(this.rng() * pool.length)];
        bestScore = 1;
      }
    }
    if (best < 0) {
      const cands = [];
      for (const c of S.order) {
        if (dz.D0[c] !== Infinity) continue;
        const d = S.arrive[c] / tpc;
        if (d > 16) continue;
        let v = 0;
        let kegV = 0;
        const item = a.items.get(c);
        if (item) v += (item === 'boots' ? 2.5 : 4) * P.powers;
        if (canKeg && d <= P.lookahead) kegV = this.kegWorth(c, dz, false);
        // Drift towards rivals, and towards the middle once stone is about to fall.
        let near = Infinity;
        const cx = c % n;
        const cy = (c - cx) / n;
        for (const q of rivals) near = Math.min(near, Math.abs(q.x - cx) + Math.abs(q.y - cy));
        // In the last stand there's nothing left to break: go after the others.
        if (near < Infinity) v += ((a.final ? 1.5 : 0.35) * P.hunt) / (1 + near);
        if (a.tick > a.hurryTick - 8 * TICK_HZ) v += 2.5 * Math.max(0, 1 - (Math.abs(cx - centre) + Math.abs(cy - centre)) / (centre + 1));
        if (v + kegV <= 0) continue;
        cands.push({ c, d, v, kegV, score: (v + kegV) / (1 + d * 0.45) });
      }
      cands.sort((x, y) => y.score - x.score);
      // Look harder at the best few spots that would catch a rival: can they get away?
      if (P.trap) {
        let looked = 0;
        for (const k of cands) {
          if (looked >= 5) break;
          if (k.kegV < P.hunt * 0.5) continue;
          looked++;
          k.kegV = this.kegWorth(k.c, dz, true);
          k.score = (k.v + k.kegV) / (1 + k.d * 0.45);
        }
        cands.sort((x, y) => y.score - x.score);
      }
      // A spot is only worth a keg if there's somewhere to hide from it once it's down.
      let checks = 0;
      for (const k of cands) {
        if (k.kegV > 0) {
          if (checks >= 8) break;
          checks++;
          if (!this.escapeAfterKeg(k.c, dz, S.arrive[k.c], true)) {
            k.kegV = 0;
            k.score = k.v / (1 + k.d * 0.45);
            if (k.score <= 0) continue;
          }
        }
        if (k.score > bestScore) {
          bestScore = k.score;
          best = k.c;
        }
      }
    }
    if (best >= 0 && best !== here) {
      this.path = this.route(S, best);
      this.mode = 'go';
    } else {
      this.path = [{ c: here, go: 0 }]; // settle into the middle of the cell and wait
      this.mode = 'idle';
    }
  }
}
