// Practice opponents. Bots give the same orders a person can (send soldiers, upgrade),
// they just decide on a timer. Easy hesitates and wastes soldiers; Hard defends, coordinates
// attacks from several holdings and strikes holdings that have just emptied.
import { TICK_HZ, KINDS, MARCH_SPEED } from './config.js';

// front: share of nearby enemy strength a holding keeps back before it lends soldiers;
// buffer: soldiers meant to be left in a holding after taking it; sync: seconds by which
// soldiers from several holdings may arrive apart and still count as one attack.
export const BOT_PARAMS = {
  easy: { think: 2.6, margin: 1.3, extra: 3, buffer: 0, sources: 1, sync: 0, front: 0, defend: 0.35, upgrade: 0.12, sloppy: 0.4, keep: 4, reach: 0.55 },
  normal: { think: 1.4, margin: 1.12, extra: 2, buffer: 4, sources: 2, sync: 3, front: 0.4, defend: 0.8, upgrade: 0.3, sloppy: 0.12, keep: 5, reach: 0.75 },
  hard: { think: 0.7, margin: 1.08, extra: 2, buffer: 7, sources: 3, sync: 2, front: 0.7, defend: 1, upgrade: 0.35, sloppy: 0, keep: 5, reach: 0.95 },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Bot {
  constructor(world, index, difficulty, rng) {
    this.w = world;
    this.me = index;
    this.P = BOT_PARAMS[difficulty] || BOT_PARAMS.normal;
    this.rng = rng;
    this.next = Math.round(TICK_HZ * (0.6 + rng() * 0.8));
  }

  /** Soldiers a holding should keep at home: more when strong enemies are close. */
  reserve(n) {
    const w = this.w;
    if (!this.P.front) return this.P.keep;
    let near = 0;
    for (const e of w.nodes) {
      if (e.owner < 0 || w.friendly(e.owner, this.me) || e.owner === this.me) continue;
      if (dist(e, n) < 0.45) near += e.troops * 0.5;
    }
    return Math.max(this.P.keep, (near * this.P.front) / KINDS[n.kind].def);
  }

  think() {
    const w = this.w;
    if (w.tick < this.next || w.over || !w.players[this.me].alive) return;
    this.next = w.tick + Math.max(1, Math.round(this.P.think * TICK_HZ * (0.75 + 0.5 * this.rng())));
    const mine = w.nodes.filter((n) => n.owner === this.me);
    if (!mine.length) return;
    const threat = new Map();
    for (const n of mine) threat.set(n.id, w.hostileIncoming(n.id, this.me));

    if (this.rng() < this.P.defend && this.defend(mine, threat)) return;
    if (this.rng() < this.P.upgrade && this.tryUpgrade(mine, threat)) return;
    this.attack(mine, threat);
  }

  /** Reinforce a holding that would fall to soldiers already marching on it. */
  defend(mine, threat) {
    const w = this.w;
    let worst = null;
    let worstGap = 0;
    for (const n of mine) {
      const t = threat.get(n.id);
      if (!t) continue;
      let eta = Infinity;
      for (const f of w.fleets) if (f.alive && f.to === n.id && !w.friendly(f.owner, this.me)) eta = Math.min(eta, (f.len - f.done) / MARCH_SPEED);
      const k = KINDS[n.kind];
      const hold = (n.troops + k.rate * eta + w.friendlyIncoming(n.id, this.me)) * k.def;
      const gap = t * 1.08 - hold;
      if (gap > worstGap) { worstGap = gap; worst = n; }
    }
    if (!worst) return false;
    let need = worstGap / KINDS[worst.kind].def + 2;
    const helpers = mine.filter((s) => s !== worst && !threat.get(s.id)).sort((a, b) => dist(a, worst) - dist(b, worst));
    let sent = 0;
    for (const s of helpers) {
      const spare = Math.floor(s.troops - this.reserve(s) * 0.6);
      if (spare < 2) continue;
      const n = Math.min(spare, Math.ceil(need));
      sent += w.sendCount(this.me, s.id, worst.id, n);
      need -= n;
      if (need <= 0) break;
    }
    return sent > 0;
  }

  tryUpgrade(mine, threat) {
    const w = this.w;
    const enemies = w.nodes.filter((n) => n.owner >= 0 && !w.friendly(n.owner, this.me));
    const options = mine.filter((n) => {
      const k = KINDS[n.kind];
      if (!k.upgradeTo || threat.get(n.id)) return false;
      if (n.troops < k.upgradeCost + this.P.keep + 6) return false;
      // Don't weaken a holding with a strong enemy next door.
      return !enemies.some((e) => dist(e, n) < 0.32 && e.troops > n.troops - k.upgradeCost);
    });
    if (!options.length) return false;
    options.sort((a, b) => b.troops - a.troops);
    return w.upgrade(this.me, options[0].id).ok;
  }

  attack(mine, threat) {
    const w = this.w;
    const P = this.P;
    const cands = [];
    for (const t of w.nodes) {
      if (t.owner === this.me || w.friendly(t.owner, this.me)) continue;
      let sources = mine
        .filter((s) => !threat.get(s.id) && dist(s, t) < P.reach && s.troops > this.reserve(s) + 2)
        .sort((a, b) => dist(a, t) - dist(b, t))
        .slice(0, P.sources);
      if (!sources.length) continue;
      const eta = w.eta(sources[0], t);
      // Soldiers that arrive much later than the first wave would be beaten one group at a time.
      sources = sources.filter((s, i) => i === 0 || w.eta(s, t) - eta <= P.sync);
      const k = KINDS[t.kind];
      const grow = t.owner >= 0 ? Math.min(k.cap - t.troops, k.rate * eta) : 0;
      const reinforcements = t.owner >= 0 ? w.friendlyIncoming(t.id, t.owner) : 0;
      const already = w.friendlyIncoming(t.id, this.me);
      const required = (t.troops + Math.max(0, grow) + reinforcements) * k.def * P.margin + P.extra + P.buffer - already;
      if (required <= 0) continue;
      let available = 0;
      for (const s of sources) available += s.troops - this.reserve(s);
      if (available < required) continue;
      let value = k.rate * (t.owner >= 0 ? 1.7 : 1);
      if (t.owner >= 0 && t.troops < 4) value *= 1.5; // an emptied holding: strike now
      const score = value / (required + eta * 1.5);
      cands.push({ t, sources, required, score });
    }
    if (!cands.length) return false;
    cands.sort((a, b) => b.score - a.score);
    const pick = this.rng() < P.sloppy ? cands[Math.floor(this.rng() * Math.min(4, cands.length))] : cands[0];
    let remaining = Math.ceil(pick.required);
    for (const s of pick.sources) {
      if (remaining <= 0) break;
      const n = Math.min(Math.floor(s.troops - this.reserve(s)), remaining);
      if (n < 1) continue;
      remaining -= w.sendCount(this.me, s.id, pick.t.id, n);
    }
    return true;
  }
}
