// One player's lane: towers, enemies, projectiles, gold, income and lives.
// Pure simulation with a fixed tick; no DOM. Each phone simulates its own lane.
import { COLS, ROWS, DT, TICK_HZ, ECON, START_LIVES, ENEMIES, TOWERS } from './config.js';
import { PATH_LEN, pathPos, isPath, inGrid, cellIndex } from './geom.js';

const tmp = { x: 0, y: 0, a: 0 };

export class Lane {
  constructor({ id, pace = 1, emit = false }) {
    this.id = id;
    this.pace = pace;
    this.emit = emit; // collect events for rendering and sound
    this.gold = ECON.startGold;
    this.income = ECON.baseIncome;
    this.lives = START_LIVES;
    this.livesMul = 1;
    this.towers = new Array(COLS * ROWS).fill(null);
    this.towerList = [];
    this.enemies = [];
    this.projectiles = [];
    this.queue = []; // pending spawns, sorted by tick
    this.tick = 0;
    this.incomeEvery = Math.max(1, Math.round((ECON.incomeEvery / pace) * TICK_HZ));
    this.nextIncome = this.incomeEvery;
    this.events = [];
    this.nextId = 1;
    this.recentLeaks = []; // ticks of recent leaks (used by bots)
    this.stats = { kills: 0, leaks: 0, livesLost: 0, built: 0, upgrades: 0, sends: 0, unitsSent: 0, towerGold: 0, sendGold: 0, peakIncome: this.income };
  }

  ev(e) { if (this.emit) this.events.push(e); }

  // ---------- actions ----------
  canBuild(c, r) { return inGrid(c, r) && !isPath(c, r) && !this.towers[cellIndex(c, r)]; }
  towerAt(c, r) { return inGrid(c, r) ? this.towers[cellIndex(c, r)] : null; }

  build(type, c, r) {
    const def = TOWERS[type];
    if (!def) return { ok: false, reason: 'unknown' };
    if (!this.canBuild(c, r)) return { ok: false, reason: 'blocked' };
    const cost = def.levels[0].cost;
    if (this.gold < cost) return { ok: false, reason: 'gold' };
    this.gold -= cost;
    const t = { id: this.nextId++, type, c, r, x: c + 0.5, y: r + 0.5, level: 0, cd: 0.25, angle: -Math.PI / 2, spent: cost, builtAt: this.tick, kills: 0, shots: 0 };
    this.towers[cellIndex(c, r)] = t;
    this.towerList.push(t);
    this.stats.built++;
    this.stats.towerGold += cost;
    this.ev({ t: 'build', x: t.x, y: t.y, type });
    return { ok: true, tower: t };
  }

  upgradeCost(t) {
    const levels = TOWERS[t.type].levels;
    return t.level + 1 < levels.length ? levels[t.level + 1].cost : null;
  }

  upgrade(c, r) {
    const t = this.towerAt(c, r);
    if (!t) return { ok: false, reason: 'none' };
    const cost = this.upgradeCost(t);
    if (cost == null) return { ok: false, reason: 'max' };
    if (this.gold < cost) return { ok: false, reason: 'gold' };
    this.gold -= cost;
    t.level++;
    t.spent += cost;
    this.stats.upgrades++;
    this.stats.towerGold += cost;
    this.ev({ t: 'upgrade', x: t.x, y: t.y, type: t.type, level: t.level });
    return { ok: true, tower: t };
  }

  /** Full refund shortly after building (an undo for mis-taps); otherwise a share. */
  canUndo(t) { return t.level === 0 && this.tick - t.builtAt <= ECON.undoSeconds * TICK_HZ; }
  sellValue(t) { return this.canUndo(t) ? t.spent : Math.floor(t.spent * ECON.sellRefund); }

  sell(c, r) {
    const t = this.towerAt(c, r);
    if (!t) return { ok: false, reason: 'none' };
    const value = this.sellValue(t);
    this.gold += value;
    this.towers[cellIndex(c, r)] = null;
    this.towerList.splice(this.towerList.indexOf(t), 1);
    this.ev({ t: 'sell', x: t.x, y: t.y, value });
    return { ok: true, value };
  }

  // ---------- spawning ----------
  enqueue(kind, at, hpMul = 1, sentBy = null) {
    const item = { kind, at, hpMul, sentBy };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].at > at) i--;
    this.queue.splice(i, 0, item);
  }

  spawn(q) {
    const def = ENEMIES[q.kind];
    const hp = Math.max(1, Math.round(def.hp * q.hpMul));
    pathPos(0, tmp);
    this.enemies.push({
      id: this.nextId++, kind: q.kind, hp, maxHp: hp, d: 0,
      x: tmp.x, y: tmp.y, px: tmp.x, py: tmp.y, a: tmp.a,
      speed: def.speed, armor: def.armor || 0, resist: def.resist || null, slowResist: def.slowResist || 0,
      slow: 0, slowUntil: 0, lives: def.lives, bounty: def.bounty, r: def.radius,
      sentBy: q.sentBy, alive: true, born: this.tick,
    });
  }

  // ---------- simulation ----------
  step() {
    const tick = ++this.tick;

    while (this.queue.length && this.queue[0].at <= tick) this.spawn(this.queue.shift());

    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.px = e.x;
      e.py = e.y;
      if (e.slow && tick >= e.slowUntil) e.slow = 0;
      const v = e.speed * (1 - e.slow * (1 - e.slowResist));
      e.d += v * DT;
      if (e.d >= PATH_LEN) {
        e.alive = false;
        this.leak(e);
        continue;
      }
      pathPos(e.d, tmp);
      e.x = tmp.x;
      e.y = tmp.y;
      e.a = tmp.a;
    }

    for (const t of this.towerList) {
      const L = TOWERS[t.type].levels[t.level];
      if (t.cd > 0) t.cd -= DT;
      if (t.cd > 0) continue;
      const target = TOWERS[t.type].targeting === 'strong' ? this.findStrongest(t.x, t.y, L.range) : this.findTarget(t.x, t.y, L.range);
      if (!target) { t.cd = 0; continue; }
      t.angle = Math.atan2(target.y - t.y, target.x - t.x);
      t.cd += 1 / L.rate;
      this.fire(t, L, target);
    }

    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.px = p.x;
      p.py = p.y;
      if (p.target.alive) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = p.speed * DT;
      if (dist <= stepLen) {
        p.x = p.tx;
        p.y = p.ty;
        p.alive = false;
        this.impact(p);
      } else {
        p.x += (dx / dist) * stepLen;
        p.y += (dy / dist) * stepLen;
      }
    }

    if (tick >= this.nextIncome) {
      this.gold += this.income;
      this.nextIncome += this.incomeEvery;
      this.ev({ t: 'income', amount: this.income });
    }

    if (tick % 20 === 0) {
      this.enemies = this.enemies.filter((e) => e.alive);
      this.projectiles = this.projectiles.filter((p) => p.alive);
      const cutoff = tick - 20 * TICK_HZ;
      while (this.recentLeaks.length && this.recentLeaks[0] < cutoff) this.recentLeaks.shift();
    }
  }

  /** Targets the enemy furthest along the road within range. */
  findTarget(x, y, range) {
    const r2 = range * range;
    let best = null;
    let bestD = -1;
    for (const e of this.enemies) {
      if (!e.alive || e.y < -0.3) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2 && e.d > bestD) { bestD = e.d; best = e; }
    }
    return best;
  }

  /** Targets the enemy with the most hit points left within range (ties: furthest along). */
  findStrongest(x, y, range) {
    const r2 = range * range;
    let best = null;
    for (const e of this.enemies) {
      if (!e.alive || e.y < -0.3) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      if (!best || e.hp > best.hp || (e.hp === best.hp && e.d > best.d)) best = e;
    }
    return best;
  }

  fire(t, L, target) {
    const def = TOWERS[t.type];
    t.shots++;
    this.projectiles.push({
      x: t.x, y: t.y, px: t.x, py: t.y, tx: target.x, ty: target.y, target,
      speed: def.projSpeed, dmg: L.dmg, dtype: def.dtype, splash: L.splash || 0,
      slow: L.slow || 0, slowDur: L.slowDur || 0, pierce: !!def.pierceArmor,
      kind: t.type, from: t, alive: true,
    });
    this.ev({ t: 'fire', kind: t.type, x: t.x, y: t.y });
  }

  impact(p) {
    if (p.splash > 0) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const rr = p.splash + e.r;
        if (dx * dx + dy * dy <= rr * rr) this.hit(e, p);
      }
      this.ev({ t: 'blast', kind: p.kind, x: p.x, y: p.y, r: p.splash });
    } else if (p.target.alive) {
      this.hit(p.target, p);
      this.ev({ t: 'hit', kind: p.kind, x: p.x, y: p.y });
    }
  }

  hit(e, p) {
    let dmg = p.dmg;
    if (e.resist && e.resist[p.dtype] != null) dmg *= e.resist[p.dtype];
    if (!p.pierce) dmg -= e.armor;
    dmg = Math.max(dmg, p.dmg * 0.15);
    e.hp -= dmg;
    if (p.slow > 0) {
      e.slow = Math.max(e.slow, p.slow);
      e.slowUntil = Math.max(e.slowUntil, this.tick + Math.round(p.slowDur * TICK_HZ));
    }
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      this.kill(e, p);
    }
  }

  kill(e, p) {
    const bounty = e.sentBy != null ? Math.max(1, Math.round(e.bounty * ECON.sentBountyShare)) : e.bounty;
    this.gold += bounty;
    this.stats.kills++;
    if (p && p.from) p.from.kills++;
    this.ev({ t: 'kill', kind: e.kind, x: e.x, y: e.y, bounty, sentBy: e.sentBy });
  }

  leak(e) {
    const lost = e.lives * this.livesMul;
    this.lives = Math.max(0, this.lives - lost);
    this.stats.leaks++;
    this.stats.livesLost += lost;
    this.recentLeaks.push(this.tick);
    this.ev({ t: 'leak', kind: e.kind, lost, sentBy: e.sentBy });
  }

  /** Total hit points of enemies alive or waiting to enter (optionally only those sent by players). */
  pendingHp({ sentOnly = false } = {}) {
    let hp = 0;
    for (const e of this.enemies) if (e.alive && (!sentOnly || e.sentBy != null)) hp += e.hp;
    for (const q of this.queue) if (!sentOnly || q.sentBy != null) hp += ENEMIES[q.kind].hp * q.hpMul;
    return hp;
  }
}
