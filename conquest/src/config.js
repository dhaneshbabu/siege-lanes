// Castle Conquest: rules and balance numbers.
// The map is 1 unit wide and 1.5 units tall (portrait). Sideways phones draw it rotated.

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
export const MAP_W = 1;
export const MAP_H = 1.5;

// Holdings. rate: soldiers trained per second; cap: training stops at this garrison;
// def: each defender counts this much in a fight; r: drawn radius in map units.
export const KINDS = {
  village: { name: 'Village', rate: 0.55, cap: 20, def: 1.0, r: 0.043, upgradeTo: 'town', upgradeCost: 12 },
  town: { name: 'Town', rate: 1.0, cap: 35, def: 1.1, r: 0.053, upgradeTo: 'castle', upgradeCost: 25 },
  castle: { name: 'Castle', rate: 1.6, cap: 60, def: 1.3, r: 0.066, upgradeTo: null, upgradeCost: 0 },
};
export const KIND_ORDER = ['village', 'town', 'castle'];
export const LAND = { village: 1, town: 2, castle: 3 }; // decides the match when time runs out

export const MARCH_SPEED = 0.16; // map units per second
export const START_TROOPS = 20;
export const MATCH_SECONDS = 240; // after this, the side holding the most land wins
export const SHARES = [0.25, 0.5, 1];

// Heraldic colours for the sides. Index 0 is always you.
export const SIDES = [
  { key: 'azure', name: 'Azure', color: '#3e74c8', light: '#9dbcf0' },
  { key: 'gules', name: 'Gules', color: '#c8443c', light: '#f0a49d' },
  { key: 'vert', name: 'Vert', color: '#3a9a5c', light: '#9fd8b1' },
  { key: 'purpure', name: 'Purpure', color: '#9160bd', light: '#cfb0ea' },
];
export const NEUTRAL = { color: '#8f8264', light: '#c9bc9b' };

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
