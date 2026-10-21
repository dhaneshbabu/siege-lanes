// Headless bot-vs-bot rounds. Run: node arena/tools/balance.mjs [rounds]
import { createMatch } from '../src/game.js';
import { TICK_HZ } from '../src/config.js';

const N = Number(process.argv[2]) || 40;

function series(format, diffs) {
  const wins = new Array(diffs.length).fill(0);
  let draws = 0;
  let hurried = 0;
  const secs = [];
  const deaths = { blast: 0, self: 0, stone: 0 };
  for (let g = 0; g < N; g++) {
    const sides = diffs.map((d, i) => ({ name: `${d}${i}`, kind: 'bot', difficulty: d }));
    const m = createMatch({ format, seed: 1000 + g * 7919, sides, target: 99 });
    const a = m.newRound();
    while (!a.over && a.tick < 400 * TICK_HZ) {
      m.step();
      for (const e of a.events) {
        if (e.t !== 'death') continue;
        if (e.by === -1) deaths.stone++;
        else if (e.by === e.player) deaths.self++;
        else deaths.blast++;
      }
      a.events.length = 0;
    }
    if (a.tick >= a.hurryTick) hurried++;
    secs.push(a.time);
    const team = a.result ? a.result.team : null;
    if (team == null) draws++;
    else a.players.forEach((p, i) => { if (p.team === team) wins[i]++; });
  }
  secs.sort((x, y) => x - y);
  console.log(`${format.padEnd(6)} ${diffs.join(' v ').padEnd(30)} wins ${wins.join('/')}  draws ${draws}  hurry ${hurried}/${N}` +
    `  | s min ${secs[0].toFixed(0)} med ${secs[N >> 1].toFixed(0)} max ${secs[N - 1].toFixed(0)}` +
    `  | deaths: rivals ${deaths.blast} own ${deaths.self} stone ${deaths.stone}`);
}

const t0 = Date.now();
series('duel', ['normal', 'normal']);
series('duel', ['hard', 'normal']);
series('duel', ['normal', 'easy']);
series('duel', ['hard', 'easy']);
series('duel', ['easy', 'easy']);
series('four', ['normal', 'normal', 'normal', 'normal']);
series('four', ['hard', 'easy', 'normal', 'normal']);
series('teams', ['normal', 'normal', 'normal', 'normal']);
series('three', ['normal', 'normal', 'normal']);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
