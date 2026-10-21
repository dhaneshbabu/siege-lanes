// Game rules and balance data. Everything tunable lives here.
//
// Time comes in two flavours:
//  - real seconds: what the players' clocks show; enemy speed and tower fire rates use these.
//  - battle seconds: the match's pacing clock. Battle seconds = real seconds x mode pace.
//    Short mode runs the battle clock 1.5x faster, so waves, income, unlocks and
//    sudden death all arrive sooner while combat itself moves at the same speed.

export const COLS = 9;
export const ROWS = 12;
export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

// Road through the lane, as cell-centre waypoints. Enemies enter above row 0
// and leave below the last row, at the castle gate.
export const PATH = [
  [1.5, -0.7], [1.5, 1.5], [7.5, 1.5], [7.5, 4.5], [1.5, 4.5],
  [1.5, 7.5], [7.5, 7.5], [7.5, 10.5], [4.5, 10.5], [4.5, 12.7],
];

export const START_LIVES = 20;

export const ECON = {
  startGold: 140,
  baseIncome: 20,        // gold per payout before any sends
  incomeEvery: 10,       // battle seconds between payouts
  sellRefund: 0.7,       // share of spent gold returned on sell
  undoSeconds: 4,        // full refund if an unupgraded tower is sold this soon after building
  sentBountyShare: 0.5,  // bounty for killing enemies an opponent sent, as a share of normal
};

// dtype resistances are damage multipliers; armour is subtracted per hit (ballista ignores it).
export const ENEMIES = {
  goblin: { name: 'Goblin', plural: 'Goblins', hp: 22, speed: 1.35, armor: 0, lives: 1, bounty: 1, radius: 0.15 },
  scout: { name: 'Scout', plural: 'Scouts', hp: 38, speed: 2.0, armor: 0, lives: 1, bounty: 2, radius: 0.19 },
  shield: { name: 'Shieldbearer', plural: 'Shieldbearers', hp: 85, speed: 0.95, armor: 1, resist: { arrow: 0.5 }, lives: 1, bounty: 3, radius: 0.22 },
  ogre: { name: 'Ogre', plural: 'Ogres', hp: 260, speed: 0.75, armor: 4, lives: 2, bounty: 7, radius: 0.29 },
  giant: { name: 'Siege Giant', plural: 'Siege Giants', hp: 1500, speed: 0.5, armor: 8, slowResist: 0.5, lives: 5, bounty: 30, radius: 0.38 },
};
export const ENEMY_ORDER = ['goblin', 'scout', 'shield', 'ogre', 'giant'];

// Real seconds between units of one group entering the lane.
// From sudden death on, leaks cost double and wave toughness compounds a little more each minute.
export const SUDDEN_DEATH = { livesMul: 2, hpGrowthPerMin: 0.12 };

export const SPAWN_GAP = { goblin: 0.42, scout: 0.5, shield: 0.7, ogre: 1.2, giant: 2.5 };

export const TOWERS = {
  archer: {
    name: 'Archer Tower', short: 'Archer', dtype: 'arrow', projSpeed: 13,
    role: 'Fast shots at one target. Weak against shields and armour.',
    levels: [
      { cost: 50, dmg: 7, rate: 1.8, range: 2.5 },
      { cost: 60, dmg: 13, rate: 2.0, range: 2.7 },
      { cost: 110, dmg: 24, rate: 2.3, range: 3.0 },
    ],
  },
  cannon: {
    name: 'Cannon', short: 'Cannon', dtype: 'blast', projSpeed: 7,
    role: 'Slow shots that hit everything near the impact.',
    levels: [
      { cost: 85, dmg: 16, rate: 0.65, range: 2.3, splash: 0.85 },
      { cost: 100, dmg: 32, rate: 0.7, range: 2.4, splash: 0.95 },
      { cost: 170, dmg: 60, rate: 0.75, range: 2.6, splash: 1.1 },
    ],
  },
  frost: {
    name: 'Frost Mage', short: 'Frost', dtype: 'frost', projSpeed: 9,
    role: 'Slows enemies so other towers get more shots.',
    levels: [
      { cost: 70, dmg: 4, rate: 1.0, range: 2.3, slow: 0.35, slowDur: 1.6, splash: 0 },
      { cost: 80, dmg: 9, rate: 1.1, range: 2.5, slow: 0.45, slowDur: 1.8, splash: 0.7 },
      { cost: 130, dmg: 16, rate: 1.2, range: 2.7, slow: 0.55, slowDur: 2.0, splash: 1.0 },
    ],
  },
  ballista: {
    name: 'Ballista', short: 'Ballista', dtype: 'bolt', projSpeed: 16, pierceArmor: true, targeting: 'strong',
    role: 'Long range, heavy bolts at the toughest enemy. Ignores armour.',
    levels: [
      { cost: 110, dmg: 55, rate: 0.45, range: 3.8 },
      { cost: 130, dmg: 110, rate: 0.5, range: 4.1 },
      { cost: 200, dmg: 200, rate: 0.55, range: 4.4 },
    ],
  },
};
export const TOWER_ORDER = ['archer', 'cannon', 'frost', 'ballista'];

// What you can send at an opponent. Every send also raises your income for the rest of the match.
// unlock is in battle seconds; cooldown in real seconds.
export const SENDS = [
  { id: 'goblin', unit: 'goblin', count: 5, cost: 30, income: 1, cooldown: 2, unlock: 0 },
  { id: 'scout', unit: 'scout', count: 3, cost: 35, income: 1, cooldown: 3, unlock: 0 },
  { id: 'shield', unit: 'shield', count: 3, cost: 55, income: 2, cooldown: 4, unlock: 0 },
  { id: 'ogre', unit: 'ogre', count: 1, cost: 75, income: 3, cooldown: 5, unlock: 90 },
  { id: 'giant', unit: 'giant', count: 1, cost: 300, income: 10, cooldown: 30, unlock: 360 },
];
export const SEND_BY_ID = Object.fromEntries(SENDS.map((s) => [s.id, s]));
export const SEND_DELAY = 1.0; // real seconds before sent units enter the target lane

export const MODES = {
  short: { id: 'short', label: 'Short', about: 'About 7 minutes', pace: 1.5 },
  standard: { id: 'standard', label: 'Standard', about: 'About 12 minutes', pace: 1.0 },
};

// Battle-clock milestones.
export const CLOCK = {
  firstWave: 8,
  waveEvery: 15,
  suddenDeath: 540, // leaks cost double from here, and waves toughen faster
};

// Background waves every player faces at the same moment. The pattern repeats, growing each lap.
export const WAVE_PATTERN = [
  [['goblin', 6]],
  [['scout', 4]],
  [['goblin', 8]],
  [['scout', 4], ['goblin', 4]],
  [['shield', 3], ['goblin', 3]],
  [['ogre', 1], ['goblin', 6]],
  [['shield', 4], ['scout', 3]],
  [['goblin', 12]],
  [['ogre', 2], ['shield', 3]],
  [['scout', 6], ['goblin', 6], ['ogre', 1]],
];

/** Hit-point multiplier for background waves at a battle time (seconds). */
export function waveHpMul(bt) {
  const m = bt / 60;
  let mul = 1 + 0.12 * m + 0.025 * m * m;
  const sdMin = (bt - CLOCK.suddenDeath) / 60;
  if (sdMin > 0) mul *= Math.pow(1 + SUDDEN_DEATH.hpGrowthPerMin, sdMin);
  return mul;
}
/** Unit-count multiplier for wave number n (1-based): grows each lap of the pattern. */
export function waveCountMul(n) {
  return 1 + 0.15 * Math.floor((n - 1) / WAVE_PATTERN.length);
}
/** Sent units grow tougher over the match too, but more slowly than the waves. */
export function sentHpMul(bt) {
  return 1 + 0.5 * (waveHpMul(bt) - 1);
}

export const DIFFICULTIES = {
  easy: { id: 'easy', label: 'Easy' },
  normal: { id: 'normal', label: 'Normal' },
  hard: { id: 'hard', label: 'Hard' },
};

// Heraldic tinctures used for player banners.
export const TINCTURES = [
  { key: 'gules', name: 'Gules', color: '#c8443c' },
  { key: 'azure', name: 'Azure', color: '#3e74c8' },
  { key: 'vert', name: 'Vert', color: '#3a9a5c' },
  { key: 'purpure', name: 'Purpure', color: '#9160bd' },
];
