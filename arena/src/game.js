// A match: rounds in fresh courtyards until a side reaches the target number of round wins.
// Shared by the page and the balance tool.
import { FORMATS, THEME_IDS } from './config.js';
import { generateArena } from './map.js';
import { Arena } from './sim.js';
import { Bot } from './bot.js';
import { mulberry32, randomSeed } from './rng.js';

const BOT_NAMES = ['Sir Gules', 'Lady Vert', 'Duke Purpure'];

/**
 * format: key of FORMATS. sides: per seat { kind: 'human'|'bot', name, difficulty }.
 * Defaults to you plus bots of one difficulty.
 */
export function createMatch({ format = 'duel', difficulty = 'normal', seed = randomSeed(), target = 3, sides = null }) {
  const f = FORMATS[format];
  const players = [];
  for (let i = 0; i < f.players; i++) {
    const given = sides && sides[i];
    if (given) players.push({ ...given, team: f.teams[i] });
    else if (i === 0) players.push({ name: 'You', kind: 'human', team: f.teams[i] });
    else {
      const ally = f.teams[i] === f.teams[0];
      players.push({ name: ally ? 'Ally' : BOT_NAMES[(i - 1) % BOT_NAMES.length], kind: 'bot', difficulty, team: f.teams[i] });
    }
  }
  const teams = [...new Set(f.teams)];
  const totals = players.map(() => ({ kegs: 0, crates: 0, powers: 0, kills: 0, selfKills: 0, deaths: 0, rounds: 0 }));

  const match = {
    format: f,
    seed,
    target,
    players,
    wins: new Map(teams.map((t) => [t, 0])),
    roundNo: 0,
    arena: null,
    bots: [],
    history: [], // winning team per round, null for a draw
    over: false,
    winner: null,
    totals,

    newRound() {
      this.roundNo++;
      const rseed = (seed + Math.imul(this.roundNo, 2654435761)) >>> 0;
      const layout = generateArena(f, rseed);
      this.arena = new Arena({ layout, players });
      this.arena.theme = THEME_IDS[(this.roundNo - 1) % THEME_IDS.length];
      this.bots = [];
      this.arena.players.forEach((p, i) => {
        if (p.kind === 'bot') this.bots.push(new Bot(this.arena, i, p.difficulty, mulberry32((rseed ^ Math.imul(i + 1, 40503)) >>> 0)));
      });
      return this.arena;
    },

    step() {
      for (const b of this.bots) b.update();
      this.arena.step();
    },

    /** Book the finished round. Returns the winning team (or null for a draw). */
    endRound() {
      const r = this.arena.result;
      const team = r ? r.team : null;
      this.history.push(team);
      if (team != null) this.wins.set(team, this.wins.get(team) + 1);
      this.arena.players.forEach((p, i) => {
        const t = totals[i];
        for (const k of ['kegs', 'crates', 'powers', 'kills', 'selfKills']) t[k] += p.stats[k];
        if (!p.alive) t.deaths++;
        if (team != null && p.team === team) t.rounds++;
      });
      if (team != null && this.wins.get(team) >= target) {
        this.over = true;
        this.winner = team;
      }
      return team;
    },
  };
  return match;
}
