// Powder Keg: rules and balance numbers. A square courtyard of cells; positions are in cells,
// with cell (0, 0) top left and y growing downwards.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

// Tiles
export const FLOOR = 0;
export const PILLAR = 1; // stone, never breaks
export const CRATE = 2; // wood, breaks in a blast
export const BURNING = 3; // a crate on fire: blocks movement until the flames die
export const BLOCK = 4; // fallen stone in the closing-in phase

export const SIZE = { duel: 11, three: 11, four: 11, teams: 11 };

export const FUSE = 2.4; // seconds from dropping a keg to the blast
export const FLAME_TIME = 0.5; // seconds a blast keeps burning
export const BASE_SPEED = 3.2; // cells per second
export const SPEED_STEP = 0.45; // per pair of boots
export const MAX_SPEED_LV = 4;
export const START_KEGS = 1;
export const MAX_KEGS = 6;
export const START_RANGE = 2;
export const MAX_RANGE = 8;

export const CRATE_FILL = 0.58; // share of open cells (away from the corners) that start with a crate
export const POWER_SHARE = 0.4; // share of crates hiding a power-up
export const POWER_MIX = [['keg', 0.38], ['fire', 0.38], ['boots', 0.24]];
export const POWERS = {
  keg: { name: 'Extra keg', short: '+1 Keg', tip: 'You can have one more keg down at a time.' },
  fire: { name: 'Bigger blast', short: 'Bigger blast', tip: 'Your blasts reach one more cell in every direction.' },
  boots: { name: 'Speed boots', short: 'Speed up', tip: 'You run faster.' },
};

export const COUNTDOWN = 2.4; // seconds before a round starts
export const HURRY_AT = { 11: 55, 13: 65 }; // seconds into a round (by courtyard size) when stone starts falling from the edges inwards
export const DROP_EVERY = 0.6; // seconds between falling stones (four at a time, one per side)
export const END_GRACE = 1.2; // seconds after the last rival falls before the round is decided
export const FINAL_SIZE = 5; // stone pauses when the open middle is this many cells across...
export const FINAL_PAUSE = 12; // ...for this many seconds...
export const FINAL_DROP_EVERY = 1.2; // ...then keeps falling, more slowly, until nothing is left
export const FINAL_FUSE = 1.5; // in that last stand kegs burn faster, and every blast reaches all the way across

// Heraldic colours, the same as the other games, by seat. In practice seat 0 is always you.
export const SIDES = [
  { key: 'azure', name: 'Azure', plain: 'blue', bot: 'Sir Azure', color: '#3e74c8', light: '#9dbcf0', dark: '#23467f' },
  { key: 'gules', name: 'Gules', plain: 'red', bot: 'Sir Gules', color: '#c8443c', light: '#f0a49d', dark: '#7e2520' },
  { key: 'vert', name: 'Vert', plain: 'green', bot: 'Lady Vert', color: '#3a9a5c', light: '#9fd8b1', dark: '#1f5c36' },
  { key: 'purpure', name: 'Purpure', plain: 'purple', bot: 'Duke Purpure', color: '#9160bd', light: '#cfb0ea', dark: '#573477' },
];
// In 2 v 2 teammates wear two shades of one colour: blue and light blue against red and orange.
const CELESTE = { key: 'celeste', name: 'Celeste', plain: 'light blue', bot: 'Lady Celeste', color: '#2fa9d8', light: '#a9e2f7', dark: '#16607e' };
const TENNE = { key: 'tenne', name: 'Tenné', plain: 'orange', bot: 'Duke Tenné', color: '#e2832b', light: '#f7c896', dark: '#8a4810' };
export const TEAM_SIDES = [SIDES[0], CELESTE, SIDES[1], TENNE];
/** The colours by seat for a format (its id or the format itself). */
export function sidesFor(format) {
  const id = typeof format === 'string' ? format : format && format.id;
  return id === 'teams' ? TEAM_SIDES : SIDES;
}

export const FORMATS = {
  duel: { id: 'duel', label: '1 v 1', players: 2, teams: [0, 1] },
  three: { id: 'three', label: '3 players', players: 3, teams: [0, 1, 2] },
  four: { id: 'four', label: '4 players', players: 4, teams: [0, 1, 2, 3] },
  teams: { id: 'teams', label: '2 v 2', players: 4, teams: [0, 0, 1, 1] },
};

export const DIFFICULTIES = {
  easy: { id: 'easy', label: 'Easy' },
  normal: { id: 'normal', label: 'Normal' },
  hard: { id: 'hard', label: 'Hard' },
};

export const WIN_TARGETS = [2, 3];

// Each round is fought in the next courtyard in this list (looks only; the rules don't change).
export const THEME_IDS = ['castle', 'winter', 'forest'];
