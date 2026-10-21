// Headless bot-vs-bot matches for tuning. Run: node tools/balance.mjs [games]
import { Match } from '../src/match.js';
import { TICK_HZ } from '../src/config.js';

const GAMES = Number(process.argv[2]) || 20;
const MAX_MIN = 25;

function play(mode, a, b, seed) {
  const players = [
    { id: 'A', name: 'A', kind: a === 'idle' ? 'human' : 'bot', difficulty: a, color: 0 },
    { id: 'B', name: 'B', kind: b === 'idle' ? 'human' : 'bot', difficulty: b, color: 1 },
  ];
  const m = new Match({ mode, seed, players });
  const limit = MAX_MIN * 60 * TICK_HZ;
  let atSd = null;
  while (!m.over && m.tick < limit) {
    m.step();
    m.events.length = 0;
    if (!atSd && m.suddenDeath) atSd = m.players.map((p) => ({ lives: p.lane.lives, income: p.lane.income, spent: p.lane.stats.towerGold }));
  }
  const winner = m.result ? (m.result.winnerTeam === 0 ? 'A' : m.result.winnerTeam === 1 ? 'B' : 'draw') : 'timeout';
  const lanes = m.players.map((p) => p.lane);
  return {
    winner,
    minutes: m.tick / TICK_HZ / 60,
    income: lanes.map((l) => l.income),
    towers: lanes.map((l) => l.towerList.length),
    sends: lanes.map((l) => l.stats.sends),
    lives: lanes.map((l) => l.lives),
    atSd,
  };
}

function summary(mode, a, b) {
  const res = [];
  for (let i = 0; i < GAMES; i++) res.push(play(mode, a, b, 1000 + i * 7919));
  const wins = { A: 0, B: 0, draw: 0, timeout: 0 };
  res.forEach((r) => wins[r.winner]++);
  const mins = res.map((r) => r.minutes).sort((x, y) => x - y);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const fmt = (v) => v.toFixed(1);
  console.log(
    `${mode.padEnd(8)} ${a.padEnd(6)} vs ${b.padEnd(6)}  A ${String(wins.A).padStart(2)}  B ${String(wins.B).padStart(2)}  draw ${wins.draw} timeout ${wins.timeout}` +
    `  | min ${fmt(mins[0])}  med ${fmt(mins[Math.floor(mins.length / 2)])}  max ${fmt(mins[mins.length - 1])}` +
    `  | income ${Math.round(avg(res.map((r) => r.income[0])))}/${Math.round(avg(res.map((r) => r.income[1])))}` +
    `  towers ${Math.round(avg(res.map((r) => r.towers[0])))}/${Math.round(avg(res.map((r) => r.towers[1])))}` +
    `  sends ${Math.round(avg(res.map((r) => r.sends[0])))}/${Math.round(avg(res.map((r) => r.sends[1])))}` +
    (res.some((r) => r.atSd) ? `  | at SD lives ${avg(res.filter((r) => r.atSd).map((r) => r.atSd[0].lives)).toFixed(1)}/${avg(res.filter((r) => r.atSd).map((r) => r.atSd[1].lives)).toFixed(1)} spent ${Math.round(avg(res.filter((r) => r.atSd).map((r) => r.atSd[0].spent)))}/${Math.round(avg(res.filter((r) => r.atSd).map((r) => r.atSd[1].spent)))}` : ''),
  );
}

const t0 = Date.now();
const pairs = (process.argv[3] || 'hard:hard,normal:normal,easy:easy,normal:easy,hard:normal,idle:normal').split(',').map((s) => s.split(':'));
for (const mode of ['standard', 'short']) {
  for (const [a, b] of pairs) summary(mode, a, b);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
