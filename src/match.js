// A match: the shared clock, background waves, sends between players, and who is still standing.
// Stage 1 runs every lane on this device (you plus a bot). Stage 2 will keep this rule set and
// move the other lanes to other phones.
import {
  TICK_HZ, DT, MODES, CLOCK, SENDS, SEND_BY_ID, SEND_DELAY, SPAWN_GAP, ENEMIES,
  WAVE_PATTERN, SUDDEN_DEATH, waveHpMul, waveCountMul, sentHpMul,
} from './config.js';
import { Lane } from './sim.js';
import { Bot } from './bot.js';
import { mulberry32, hashString, randomSeed } from './rng.js';

export class Match {
  constructor({ mode = 'standard', seed = randomSeed(), players }) {
    this.mode = MODES[mode] || MODES.standard;
    this.pace = this.mode.pace;
    this.seed = seed >>> 0;
    this.tick = 0;
    this.over = false;
    this.result = null;
    this.events = [];
    this.waveN = 0;
    this.nextWaveTick = this.toTicks(CLOCK.firstWave);
    this.waveEvery = this.toTicks(CLOCK.waveEvery);
    this.sdTick = this.toTicks(CLOCK.suddenDeath);
    this.suddenDeath = false;
    this.unlocks = SENDS.filter((s) => s.unlock > 0).map((s) => ({ id: s.id, tick: this.toTicks(s.unlock), done: false }));
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      kind: p.kind, // 'human' | 'bot'
      difficulty: p.difficulty || null,
      team: p.team ?? i,
      alive: true,
      outAt: null,
      cooldowns: {},
      lane: new Lane({ id: p.id, pace: this.pace, emit: p.kind === 'human' }),
    }));
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    this.bots = this.players
      .filter((p) => p.kind === 'bot')
      .map((p) => new Bot(this, p, p.difficulty || 'normal', mulberry32((this.seed ^ hashString(p.id)) >>> 0)));
  }

  /** Real ticks for a span of battle seconds. */
  toTicks(battleSeconds) { return Math.round((battleSeconds / this.pace) * TICK_HZ); }
  battleTime(tick = this.tick) { return tick * DT * this.pace; }
  realTime(tick = this.tick) { return tick * DT; }
  ev(e) { this.events.push(e); }

  step() {
    if (this.over) return;
    const t = ++this.tick;

    if (!this.suddenDeath && t >= this.sdTick) {
      this.suddenDeath = true;
      for (const p of this.players) p.lane.livesMul = SUDDEN_DEATH.livesMul;
      this.ev({ t: 'suddenDeath' });
    }
    for (const u of this.unlocks) {
      if (!u.done && t >= u.tick) { u.done = true; this.ev({ t: 'unlock', id: u.id }); }
    }
    if (t >= this.nextWaveTick) {
      this.spawnWave();
      this.nextWaveTick += this.waveEvery;
    }
    for (const b of this.bots) if (b.player.alive) b.think(t);
    for (const p of this.players) if (p.alive) p.lane.step();

    let changed = false;
    for (const p of this.players) {
      if (p.alive && p.lane.lives <= 0) {
        p.alive = false;
        p.outAt = t;
        changed = true;
        this.ev({ t: 'eliminated', id: p.id });
      }
    }
    if (changed) this.checkOver();
  }

  checkOver() {
    const teams = new Set(this.players.filter((p) => p.alive).map((p) => p.team));
    if (teams.size <= 1) {
      this.over = true;
      this.result = { winnerTeam: teams.size ? [...teams][0] : null, tick: this.tick };
      this.ev({ t: 'over', result: this.result });
    }
  }

  /** Units in background wave n. */
  waveComposition(n) {
    const base = WAVE_PATTERN[(n - 1) % WAVE_PATTERN.length];
    const mul = waveCountMul(n);
    return base.map(([kind, count]) => ({ kind, count: Math.max(1, Math.round(count * mul)) }));
  }

  spawnWave() {
    const n = ++this.waveN;
    const comp = this.waveComposition(n);
    const hpMul = waveHpMul(this.battleTime());
    for (const p of this.players) if (p.alive) this.enqueueGroup(p.lane, comp, hpMul, null, p.lane.tick + 1);
    this.ev({ t: 'wave', n, comp });
  }

  enqueueGroup(lane, comp, hpMul, sentBy, startTick) {
    let at = startTick;
    for (const { kind, count } of comp) {
      const gap = Math.max(1, Math.round(SPAWN_GAP[kind] * TICK_HZ));
      for (let i = 0; i < count; i++) {
        lane.enqueue(kind, at, hpMul, sentBy);
        at += gap;
      }
    }
    return at;
  }

  /** Whether a player can send something right now, and if not, why. */
  sendStatus(playerId, sendId) {
    const p = this.byId.get(playerId);
    const s = SEND_BY_ID[sendId];
    if (!p || !s) return { ok: false, reason: 'unknown' };
    const unlockTick = this.toTicks(s.unlock);
    if (this.tick < unlockTick) return { ok: false, reason: 'locked', left: (unlockTick - this.tick) * DT };
    const cdUntil = p.cooldowns[sendId] || 0;
    if (this.tick < cdUntil) {
      const total = Math.max(1, Math.round(s.cooldown * TICK_HZ));
      return { ok: false, reason: 'cooldown', left: (cdUntil - this.tick) * DT, frac: (cdUntil - this.tick) / total };
    }
    if (p.lane.gold < s.cost) return { ok: false, reason: 'gold' };
    return { ok: true };
  }

  send(fromId, sendId, toId = null) {
    if (this.over) return { ok: false, reason: 'over' };
    const from = this.byId.get(fromId);
    if (!from || !from.alive) return { ok: false, reason: 'out' };
    const status = this.sendStatus(fromId, sendId);
    if (!status.ok) return status;
    const target = toId ? this.byId.get(toId) : this.defaultTarget(from);
    if (!target || !target.alive || target.team === from.team) return { ok: false, reason: 'target' };
    const s = SEND_BY_ID[sendId];
    const lane = from.lane;
    lane.gold -= s.cost;
    lane.income += s.income;
    lane.stats.sends++;
    lane.stats.unitsSent += s.count;
    lane.stats.sendGold += s.cost;
    lane.stats.peakIncome = Math.max(lane.stats.peakIncome, lane.income);
    from.cooldowns[sendId] = this.tick + Math.round(s.cooldown * TICK_HZ);
    const hpMul = sentHpMul(this.battleTime());
    this.enqueueGroup(target.lane, [{ kind: s.unit, count: s.count }], hpMul, from.id, target.lane.tick + Math.round(SEND_DELAY * TICK_HZ));
    this.ev({ t: 'send', from: from.id, to: target.id, sendId });
    return { ok: true, to: target.id };
  }

  defaultTarget(from) {
    return this.players.find((p) => p.alive && p.team !== from.team) || null;
  }

  opponentsOf(id) {
    const me = this.byId.get(id);
    return this.players.filter((p) => p.team !== me.team);
  }

  nextWave() {
    const n = this.waveN + 1;
    const sudden = this.suddenDeath || this.nextWaveTick >= this.sdTick;
    return { n, inSec: Math.max(0, (this.nextWaveTick - this.tick) * DT), comp: this.waveComposition(n), sudden };
  }

  /** Hit points of a wave composition at a given battle time. */
  static compHp(comp, hpMul) {
    let hp = 0;
    for (const { kind, count } of comp) hp += ENEMIES[kind].hp * count * hpMul;
    return hp;
  }
}
