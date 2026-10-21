// Practice opponent. It plays by the same rules and with the same actions as a person:
// it builds and upgrades in its own lane and sends enemies at you. It sees only its own lane,
// the public wave schedule and what has been sent at it, never your towers.
import { TICK_HZ, TOWERS, TOWER_ORDER, ENEMIES, ENEMY_ORDER, SENDS, SEND_BY_ID, SPAWN_GAP, waveHpMul, sentHpMul } from './config.js';
import { BUILD_CELLS, coverage, PATH_LEN } from './geom.js';

// goldMul: share of normal income and bounties. Hard earns a little more, Easy a little less,
// on top of playing sharper or sloppier.
export const BOT_PARAMS = {
  easy: { goldMul: 0.85, think: 3.0, comfort: 0.85, safety: 1.2, sendShare: 0.5, spotTop: 16, mistake: 0.35, reserve: 15, saveForGiant: false, maxSends: 1, eco: 0.5, upgradeBias: 0.7, react: 0.5 },
  normal: { goldMul: 1.0, think: 1.2, comfort: 0.75, safety: 1.45, sendShare: 0.75, spotTop: 4, mistake: 0.08, reserve: 25, saveForGiant: true, maxSends: 2, eco: 0.85, upgradeBias: 1.0, react: 0.8 },
  hard: { goldMul: 1.15, think: 0.5, comfort: 0.7, safety: 1.55, sendShare: 1.0, spotTop: 1, mistake: 0, reserve: 30, saveForGiant: true, maxSends: 3, eco: 1.2, upgradeBias: 1.05, react: 1.0 },
};

// How tightly each enemy bunches up, for splash value.
const CLUSTER = { goblin: 1.6, scout: 0.8, shield: 0.9, ogre: 0.35, giant: 0 };

// How much of a tower's time really goes to each kind in a mixed crowd. Towers that shoot the
// leading enemy spend much of their time on small fry that run ahead of the big ones; the
// ballista picks the toughest target, so it is the reverse.
const FOCUS = {
  archer: { goblin: 1, scout: 1, shield: 0.8, ogre: 0.55, giant: 0.55 },
  cannon: { goblin: 1, scout: 1, shield: 0.85, ogre: 0.6, giant: 0.6 },
  frost: { goblin: 1, scout: 1, shield: 0.9, ogre: 0.7, giant: 0.7 },
  ballista: { goblin: 0.6, scout: 0.6, shield: 0.9, ogre: 1, giant: 1 },
};

// Best cells for each tower type, by how much road they can reach.
const SPOT_RANK = {};
for (const type of TOWER_ORDER) {
  const range = TOWERS[type].levels[0].range;
  SPOT_RANK[type] = BUILD_CELLS
    .map(([c, r]) => ({ c, r, cov: coverage(c + 0.5, r + 0.5, range) }))
    .sort((a, b) => b.cov - a.cov);
}

const covCache = new Map();
/** Cells of road a tower at this cell can reach. */
function cov(c, r, range) {
  const key = `${c},${r},${range}`;
  let v = covCache.get(key);
  if (v === undefined) {
    v = coverage(c + 0.5, r + 0.5, range);
    covCache.set(key, v);
  }
  return v;
}

function perHit(def, L, kind) {
  const E = ENEMIES[kind];
  let d = L.dmg;
  if (E.resist && E.resist[def.dtype] != null) d *= E.resist[def.dtype];
  if (!def.pierceArmor) d -= E.armor || 0;
  return Math.max(d, L.dmg * 0.15);
}

const dpsCache = new Map();
/**
 * Damage per second of a tower level against each enemy kind at a given toughness.
 * Splash counts extra for bunched enemies; single-target damage beyond a unit's hit points is wasted.
 */
export function dpsByKind(type, level, hpMul = 1) {
  const step = Math.round(hpMul * 4) / 4;
  const key = `${type}${level}@${step}`;
  let v = dpsCache.get(key);
  if (!v) {
    const def = TOWERS[type];
    const L = def.levels[level];
    v = {};
    for (const kind of ENEMY_ORDER) {
      const splash = L.splash ? 1 + L.splash * CLUSTER[kind] : 1;
      let hit = perHit(def, L, kind);
      if (!L.splash) hit = Math.min(hit, ENEMIES[kind].hp * step);
      v[kind] = hit * L.rate * splash * FOCUS[type][kind];
    }
    dpsCache.set(key, v);
  }
  return v;
}

const zero = () => ({ goblin: 0, scout: 0, shield: 0, ogre: 0, giant: 0 });

/** Share of tower time needed to deal `need` hit points per kind, given capacity per kind. */
function loadOf(need, cap) {
  let load = 0;
  for (const k of ENEMY_ORDER) if (need[k] > 0) load += need[k] / Math.max(cap[k], 1);
  return load;
}

export class Bot {
  constructor(match, player, difficulty, rng) {
    this.match = match;
    this.player = player;
    this.lane = player.lane;
    this.difficulty = BOT_PARAMS[difficulty] ? difficulty : 'normal';
    this.P = BOT_PARAMS[this.difficulty];
    this.rng = rng;
    this.nextThink = Math.round(TICK_HZ * (0.5 + rng()));
    this.sentMemory = []; // { tick, kind, hp } of enemies sent at this bot
    // Closed loop: how much extra defence this bot keeps, raised when enemies get deep, lowered when they don't.
    this.margin = this.P.safety;
    this.danger = 0;
    this.leaksSeen = 0;
  }

  /** Track how far enemies get down the road and adjust the defence margin. */
  adapt() {
    const lane = this.lane;
    let deepest = -1;
    for (const e of lane.enemies) {
      if (!e.alive || e.hp < e.maxHp * 0.25) continue;
      deepest = Math.max(deepest, e.d / PATH_LEN);
    }
    if (lane.stats.leaks > this.leaksSeen) {
      this.margin *= 1 + 0.12 * Math.min(4, lane.stats.leaks - this.leaksSeen);
      this.leaksSeen = lane.stats.leaks;
    }
    if (deepest >= 0) {
      // Only judge the defence while enemies are on the road.
      this.danger = this.danger * 0.85 + deepest * 0.15;
      if (this.danger > this.P.comfort) this.margin *= 1.01;
      else if (this.danger < this.P.comfort * 0.6) this.margin *= 0.995;
    }
    this.margin = Math.min(5, Math.max(this.P.safety, this.margin));
  }

  think(tick) {
    if (tick < this.nextThink) return;
    this.nextThink = tick + Math.max(1, Math.round((this.P.think / this.match.pace) * TICK_HZ * (0.75 + 0.5 * this.rng())));
    this.remember(tick);
    this.adapt();

    const lane = this.lane;
    this.hpMul = waveHpMul(this.match.battleTime());
    const groups = this.groupsAhead(tick);
    const have = this.capacity(groups);
    // Load: the share of tower time needed to kill everything coming, all kinds together.
    // Above 1 means the defence would fall behind.
    const need = zero();
    for (const k of ENEMY_ORDER) need[k] = groups[k].hp * this.margin;
    const load = loadOf(need, have);
    const urgent = this.isUrgent(tick);

    if (load > 1 || urgent) {
      const cands = this.defenseOptions(need, have, groups);
      if (!cands.length) return;
      const pick = this.choose(cands);
      if (lane.gold >= pick.cost) this.apply(pick);
      else if (urgent && this.rng() < this.P.react) {
        const affordable = cands.find((c) => c.cost <= lane.gold);
        if (affordable) this.apply(affordable);
      }
      return;
    }

    this.trySends();

    // Gold piling up with defence already fine: invest it anyway.
    const reserveForGiant = this.isSavingForGiant() ? SEND_BY_ID.giant.cost : 0;
    const spare = lane.gold - this.P.reserve - reserveForGiant;
    if (spare > 160) {
      const cands = this.defenseOptions(need, have, groups);
      const pick = cands.length ? this.choose(cands) : null;
      if (pick && pick.cost <= spare) this.apply(pick);
    }
  }

  remember(tick) {
    for (const q of this.lane.queue) {
      if (q.sentBy != null && !q.seen) {
        q.seen = true;
        this.sentMemory.push({ tick, kind: q.kind, hp: ENEMIES[q.kind].hp * q.hpMul });
      }
    }
    const cutoff = tick - 90 * TICK_HZ;
    while (this.sentMemory.length && this.sentMemory[0].tick < cutoff) this.sentMemory.shift();
  }

  /**
   * What the lane must be able to kill soon, per enemy kind: the bigger of the next two
   * wave groups, plus what opponents have queued and have been sending lately.
   * hp is the group's total hit points; dur is how long the group takes to stream past.
   */
  groupsAhead(tick) {
    const m = this.match;
    const g = {};
    for (const k of ENEMY_ORDER) g[k] = { hp: 0, dur: 0 };
    const nw = m.nextWave();
    for (let j = 0; j < 2; j++) {
      const at = nw.tick + j * m.waveEvery;
      const comp = m.waveComposition(nw.n + j, at);
      const mul = waveHpMul(m.battleTime(at));
      for (const { kind, count } of comp) {
        const hp = ENEMIES[kind].hp * count * mul;
        if (hp > g[kind].hp) { g[kind].hp = hp; g[kind].dur = count * SPAWN_GAP[kind]; }
      }
    }
    for (const q of this.lane.queue) {
      if (q.sentBy == null) continue;
      g[q.kind].hp += ENEMIES[q.kind].hp * q.hpMul;
      g[q.kind].dur += SPAWN_GAP[q.kind] * 0.5;
    }
    for (const s of this.sentMemory) {
      const age = (tick - s.tick) / TICK_HZ;
      if (age > 2) g[s.kind].hp += s.hp * 0.6 * Math.exp(-age / 45);
    }
    return g;
  }

  /** Damage the current towers can deal to each group as it streams past (hit points). */
  capacity(groups) {
    const cap = zero();
    const slows = [];
    for (const t of this.lane.towerList) {
      const L = TOWERS[t.type].levels[t.level];
      const cv = cov(t.c, t.r, L.range);
      const d = dpsByKind(t.type, t.level, this.hpMul);
      for (const k of ENEMY_ORDER) cap[k] += d[k] * (cv / ENEMIES[k].speed + groups[k].dur);
      if (L.slow) slows.push(L.slow);
    }
    slows.sort((a, b) => b - a);
    let slow = 0;
    slows.forEach((v, i) => { slow += (v * 0.5) / (1 + i); });
    slow = Math.min(slow, 0.6);
    for (const k of ENEMY_ORDER) cap[k] *= 1 + slow * (1 - (ENEMIES[k].slowResist || 0));
    return cap;
  }

  isUrgent(tick) {
    for (const e of this.lane.enemies) {
      if (e.alive && e.d > PATH_LEN * 0.62 && e.hp > e.maxHp * 0.35) return true;
    }
    return this.lane.recentLeaks.some((t) => tick - t < 6 * TICK_HZ);
  }

  pickSpot(type) {
    const free = [];
    for (const s of SPOT_RANK[type]) {
      if (this.lane.canBuild(s.c, s.r)) {
        free.push(s);
        if (free.length >= this.P.spotTop) break;
      }
    }
    if (!free.length) return null;
    return free[Math.floor(this.rng() * this.rng() * free.length)];
  }

  /** Options ranked by how much they lower the load per gold. */
  defenseOptions(need, have, groups) {
    const lane = this.lane;
    const frostCount = lane.towerList.filter((t) => t.type === 'frost').length;
    const before = loadOf(need, have);
    const score = (gain) => {
      const after = {};
      for (const k of ENEMY_ORDER) after[k] = have[k] + Math.max(0, gain[k]);
      return before - loadOf(need, after);
    };
    const gainFor = (type, level, c, r, prev) => {
      const L = TOWERS[type].levels[level];
      const cv = cov(c, r, L.range);
      const d = dpsByKind(type, level, this.hpMul);
      const gain = {};
      for (const k of ENEMY_ORDER) gain[k] = d[k] * (cv / ENEMIES[k].speed + groups[k].dur);
      if (prev != null) {
        const P0 = TOWERS[type].levels[prev];
        const cv0 = cov(c, r, P0.range);
        const d0 = dpsByKind(type, prev, this.hpMul);
        for (const k of ENEMY_ORDER) gain[k] -= d0[k] * (cv0 / ENEMIES[k].speed + groups[k].dur);
      }
      if (L.slow) {
        const before = prev != null ? TOWERS[type].levels[prev].slow : 0;
        const extra = ((L.slow - before) * 0.5) / (1 + frostCount * (prev != null ? 1 : 1.5));
        for (const k of ENEMY_ORDER) gain[k] += have[k] * extra * (1 - (ENEMIES[k].slowResist || 0));
      }
      return gain;
    };
    const cands = [];
    for (const type of TOWER_ORDER) {
      const spot = this.pickSpot(type);
      if (!spot) continue;
      const cost = TOWERS[type].levels[0].cost;
      cands.push({ kind: 'build', type, c: spot.c, r: spot.r, cost, value: score(gainFor(type, 0, spot.c, spot.r, null)) / cost });
    }
    for (const t of lane.towerList) {
      const cost = lane.upgradeCost(t);
      if (cost == null) continue;
      const value = (score(gainFor(t.type, t.level + 1, t.c, t.r, t.level)) / cost) * this.P.upgradeBias;
      cands.push({ kind: 'upgrade', c: t.c, r: t.r, cost, value });
    }
    cands.sort((a, b) => b.value - a.value);
    return cands;
  }

  choose(cands) {
    if (this.P.mistake && this.rng() < this.P.mistake) return cands[Math.floor(this.rng() * Math.min(4, cands.length))];
    return cands[0];
  }

  apply(c) {
    if (c.kind === 'build') return this.lane.build(c.type, c.c, c.r);
    return this.lane.upgrade(c.c, c.r);
  }

  isSavingForGiant() {
    if (!this.P.saveForGiant) return false;
    const st = this.match.sendStatus(this.player.id, 'giant');
    return st.reason !== 'locked' && st.reason !== 'cooldown';
  }

  trySends() {
    const m = this.match;
    const id = this.player.id;
    const lane = this.lane;
    const bt = m.battleTime();

    if (this.isSavingForGiant()) {
      const st = m.sendStatus(id, 'giant');
      if (st.ok && lane.gold - SEND_BY_ID.giant.cost >= this.P.reserve) { m.send(id, 'giant'); return; }
      if (lane.gold > SEND_BY_ID.giant.cost * 0.5) return; // saving up
    }

    for (let i = 0; i < this.P.maxSends; i++) {
      const budget = (lane.gold - this.P.reserve) * this.P.sendShare;
      if (budget <= 0) return;
      const hpMul = sentHpMul(bt);
      let best = null;
      for (const s of SENDS) {
        if (s.id === 'giant') continue;
        if (s.cost > budget || !m.sendStatus(id, s.id).ok) continue;
        const E = ENEMIES[s.unit];
        const eco = s.income / s.cost;
        const pressure = (E.hp * s.count * hpMul * (1 + (E.armor || 0) * 0.08)) / s.cost / 10;
        const early = bt < 200 ? 1 : 0.4;
        const score = (eco * 20 * this.P.eco * early + pressure) * (0.6 + 0.8 * this.rng());
        if (!best || score > best.score) best = { s, score };
      }
      if (!best) return;
      m.send(id, best.s.id);
    }
  }
}
