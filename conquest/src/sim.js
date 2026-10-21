// Castle Conquest simulation: holdings train soldiers, columns march between holdings,
// and arrivals reinforce or attack. Fixed 20 Hz tick, no DOM, deterministic for a given map.
import { DT, TICK_HZ, KINDS, MARCH_SPEED, MATCH_SECONDS, LAND } from './config.js';

export class World {
  /**
   * nodes: from generateMap. players: [{ name, team, kind: 'human'|'bot', difficulty }].
   */
  constructor({ nodes, players }) {
    this.nodes = nodes.map((n) => ({ ...n }));
    this.players = players.map((p, i) => ({
      index: i,
      name: p.name,
      team: p.team,
      kind: p.kind,
      difficulty: p.difficulty || null,
      alive: true,
      outAt: null,
      stats: { sent: 0, captured: 0, lost: 0, upgrades: 0, peakHoldings: 0 },
    }));
    this.fleets = [];
    this.nextFleetId = 1;
    this.tick = 0;
    this.over = false;
    this.result = null;
    this.events = [];
    this.endTick = MATCH_SECONDS * TICK_HZ;
  }

  get time() { return this.tick * DT; }
  ev(e) { this.events.push(e); }
  team(owner) { return owner >= 0 ? this.players[owner].team : -1; }
  friendly(a, b) { return a >= 0 && b >= 0 && this.team(a) === this.team(b); }
  eta(from, to) { return Math.hypot(to.x - from.x, to.y - from.y) / MARCH_SPEED; }

  // ---------- orders ----------
  /** Send a share of the garrison from each source to a target. Returns soldiers sent. */
  send(owner, fromIds, toId, share) {
    let total = 0;
    for (const id of fromIds) {
      const n = this.nodes[id];
      if (!n || n.owner !== owner) continue;
      const count = Math.floor(n.troops * share);
      total += this.sendCount(owner, id, toId, count);
    }
    return total;
  }

  /** Send an exact number of soldiers (used by bots). */
  sendCount(owner, fromId, toId, count) {
    const from = this.nodes[fromId];
    const to = this.nodes[toId];
    if (this.over || !from || !to || from === to || from.owner !== owner) return 0;
    count = Math.min(Math.floor(count), Math.floor(from.troops));
    if (count < 1) return 0;
    from.troops -= count;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    this.fleets.push({
      id: this.nextFleetId++, owner, from: fromId, to: toId, count,
      x0: from.x, y0: from.y, x1: to.x, y1: to.y, len: d, done: 0, alive: true,
    });
    this.players[owner].stats.sent += count;
    this.ev({ t: 'send', owner, from: fromId, to: toId, count });
    return count;
  }

  canUpgrade(owner, id) {
    const n = this.nodes[id];
    if (!n || n.owner !== owner) return { ok: false, reason: 'not-yours' };
    const k = KINDS[n.kind];
    if (!k.upgradeTo) return { ok: false, reason: 'max' };
    if (n.troops < k.upgradeCost) return { ok: false, reason: 'troops', cost: k.upgradeCost };
    return { ok: true, cost: k.upgradeCost, to: k.upgradeTo };
  }

  upgrade(owner, id) {
    const st = this.canUpgrade(owner, id);
    if (!st.ok || this.over) return st;
    const n = this.nodes[id];
    n.troops -= st.cost;
    n.kind = st.to;
    this.players[owner].stats.upgrades++;
    this.ev({ t: 'upgrade', owner, node: id, kind: n.kind });
    return st;
  }

  // ---------- simulation ----------
  step() {
    if (this.over) return;
    this.tick++;

    for (const n of this.nodes) {
      if (n.owner < 0) continue;
      const k = KINDS[n.kind];
      if (n.troops < k.cap) n.troops = Math.min(k.cap, n.troops + k.rate * DT);
    }

    const stepLen = MARCH_SPEED * DT;
    for (const f of this.fleets) {
      if (!f.alive) continue;
      f.done += stepLen;
      const target = this.nodes[f.to];
      if (f.done >= f.len - KINDS[target.kind].r * 0.6) {
        f.alive = false;
        this.arrive(f, target);
      }
    }
    if (this.tick % 20 === 0) this.fleets = this.fleets.filter((f) => f.alive);

    this.checkPlayers();
    if (!this.over && this.tick >= this.endTick) this.finishOnTime();
  }

  arrive(f, n) {
    if (n.owner === f.owner || this.friendly(n.owner, f.owner)) {
      n.troops += f.count;
      this.ev({ t: 'reinforce', owner: f.owner, node: n.id, count: f.count });
      return;
    }
    const def = KINDS[n.kind].def;
    const defence = n.troops * def;
    if (f.count > defence) {
      const prev = n.owner;
      n.owner = f.owner;
      n.troops = f.count - defence;
      this.players[f.owner].stats.captured++;
      if (prev >= 0) this.players[prev].stats.lost++;
      this.ev({ t: 'capture', owner: f.owner, prev, node: n.id });
    } else {
      n.troops = Math.max(0, n.troops - f.count / def);
      this.ev({ t: 'repelled', owner: f.owner, defender: n.owner, node: n.id, count: f.count });
    }
  }

  holdings(owner) {
    let n = 0;
    for (const node of this.nodes) if (node.owner === owner) n++;
    return n;
  }

  strength(owner) {
    let s = 0;
    for (const n of this.nodes) if (n.owner === owner) s += n.troops;
    for (const f of this.fleets) if (f.alive && f.owner === owner) s += f.count;
    return s;
  }

  checkPlayers() {
    let changed = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      const h = this.holdings(p.index);
      p.stats.peakHoldings = Math.max(p.stats.peakHoldings, h);
      if (h === 0 && !this.fleets.some((f) => f.alive && f.owner === p.index)) {
        p.alive = false;
        p.outAt = this.tick;
        changed = true;
        this.ev({ t: 'eliminated', player: p.index });
      }
    }
    if (!changed) return;
    const teams = new Set(this.players.filter((p) => p.alive).map((p) => p.team));
    if (teams.size <= 1) this.finish(teams.size ? [...teams][0] : null, 'conquest');
  }

  /** Land held: village 1, town 2, castle 3. Decides the match when time runs out. */
  land(owner) {
    let s = 0;
    for (const n of this.nodes) if (n.owner === owner) s += LAND[n.kind];
    return s;
  }

  finishOnTime() {
    // Most land wins; soldiers break a tie. Sitting on soldiers doesn't win the clock.
    const byTeam = new Map();
    for (const p of this.players) {
      if (!p.alive) continue;
      const cur = byTeam.get(p.team) || { land: 0, soldiers: 0 };
      cur.land += this.land(p.index);
      cur.soldiers += this.strength(p.index);
      byTeam.set(p.team, cur);
    }
    const ranked = [...byTeam.entries()].sort((a, b) => b[1].land - a[1].land || b[1].soldiers - a[1].soldiers);
    const tie = ranked.length > 1 && ranked[0][1].land === ranked[1][1].land && Math.abs(ranked[0][1].soldiers - ranked[1][1].soldiers) < 1;
    this.finish(tie ? null : ranked[0][0], 'time');
  }

  finish(team, how) {
    this.over = true;
    this.result = { team, how, tick: this.tick };
    this.ev({ t: 'over', result: this.result });
  }

  /** Soldiers of other teams marching on a holding. */
  hostileIncoming(nodeId, forOwner) {
    let s = 0;
    for (const f of this.fleets) if (f.alive && f.to === nodeId && !this.friendly(f.owner, forOwner) && f.owner !== forOwner) s += f.count;
    return s;
  }

  friendlyIncoming(nodeId, forOwner) {
    let s = 0;
    for (const f of this.fleets) if (f.alive && f.to === nodeId && (f.owner === forOwner || this.friendly(f.owner, forOwner))) s += f.count;
    return s;
  }
}
