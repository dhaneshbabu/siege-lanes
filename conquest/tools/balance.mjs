// Headless bot-vs-bot matches. Run: node conquest/tools/balance.mjs [games]
import { createMatch } from '../src/game.js';
import { TICK_HZ } from '../src/config.js';

const N = Number(process.argv[2]) || 20;

function series(format, diffs) {
  const wins = new Array(diffs.length).fill(0);
  let draws = 0;
  let onTime = 0;
  const mins = [];
  for (let g = 0; g < N; g++) {
    const sides = diffs.map((d, i) => ({ name: `${d}${i}`, kind: 'bot', difficulty: d }));
    const m = createMatch({ format, seed: 1000 + g * 7919, sides });
    while (!m.world.over) { m.step(); m.world.events.length = 0; }
    const r = m.world.result;
    mins.push(m.world.tick / TICK_HZ / 60);
    if (r.how === 'time') onTime++;
    if (r.team == null) draws++;
    else m.world.players.forEach((p, i) => { if (p.team === r.team) wins[i]++; });
  }
  mins.sort((a, b) => a - b);
  console.log(`${format.padEnd(6)} ${diffs.join(' v ').padEnd(30)} wins ${wins.join('/')}  draws ${draws}  by time ${onTime}  | min ${mins[0].toFixed(1)} med ${mins[N >> 1].toFixed(1)} max ${mins[N - 1].toFixed(1)}`);
}

const t0 = Date.now();
series('duel', ['normal', 'normal']);
series('duel', ['hard', 'normal']);
series('duel', ['normal', 'easy']);
series('duel', ['hard', 'easy']);
series('four', ['normal', 'normal', 'normal', 'normal']);
series('four', ['hard', 'easy', 'normal', 'normal']);
series('teams', ['normal', 'normal', 'normal', 'normal']);
series('three', ['normal', 'normal', 'normal']);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
