// Sets up a match: map, sides and bots. Shared by the page and the balance tool.
import { FORMATS } from './config.js';
import { generateMap } from './map.js';
import { World } from './sim.js';
import { Bot } from './bot.js';
import { mulberry32, randomSeed } from './rng.js';

const BOT_NAMES = ['Sir Gules', 'Lady Vert', 'Duke Purpure'];

/**
 * format: key of FORMATS. sides: per side { kind: 'human'|'bot', name, difficulty }.
 * Defaults to you plus bots of one difficulty.
 */
export function createMatch({ format = 'duel', difficulty = 'normal', seed = randomSeed(), sides = null, allyDifficulty = null }) {
  const f = FORMATS[format];
  const nodes = generateMap(f, seed);
  const players = [];
  for (let i = 0; i < f.players; i++) {
    const given = sides && sides[i];
    if (given) players.push({ ...given, team: f.teams[i] });
    else if (i === 0) players.push({ name: 'You', kind: 'human', team: f.teams[i] });
    else {
      const ally = f.teams[i] === f.teams[0];
      players.push({
        name: ally ? 'Ally' : BOT_NAMES[(i - 1) % BOT_NAMES.length],
        kind: 'bot',
        difficulty: ally && allyDifficulty ? allyDifficulty : difficulty,
        team: f.teams[i],
      });
    }
  }
  const world = new World({ nodes, players });
  const bots = [];
  world.players.forEach((p, i) => {
    if (p.kind === 'bot') bots.push(new Bot(world, i, p.difficulty, mulberry32((seed ^ Math.imul(i + 1, 2654435761)) >>> 0)));
  });
  return {
    world,
    bots,
    seed,
    format: f,
    step() {
      for (const b of bots) b.think();
      world.step();
    },
  };
}
