// App shell for Powder Keg: menu, lobby, rounds, the frame loop, controls, HUD and sound.
// Three ways to play: practice (you against bots on this phone), host (this phone runs the game and
// friends' phones join it) and guest (this phone plays in a game another phone runs).
import { DT, TICK_HZ, sidesFor, FORMATS, DIFFICULTIES, WIN_TARGETS, POWERS, MAX_KEGS, MAX_RANGE, MAX_SPEED_LV, THEME_IDS } from './config.js';
import { createMatch, botName } from './game.js';
import { generateArena } from './map.js';
import { Arena } from './sim.js';
import { Bot } from './bot.js';
import { mulberry32, randomSeed } from './rng.js';
import { ArenaRenderer, powerThumb, pieceThumb, kegIcon, drawMenuScene, THEMES } from './render.js';
import { Controls } from './input.js';
import { Sfx } from './audio.js';
import { HostRoom, GuestLink, normCode, cleanName, randomId } from './net.js';
import { encodeInput, applyInput, validCode, snapshotArena, restoreArena, hashArena, forecastFrom, stepForecast } from './sync.js';
import { LobbyView } from './lobby.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
  },
};
// Per tab, and kept across a reload: so a phone that reloads gets back into its game.
const tabStore = {
  get(key) {
    try {
      const v = sessionStorage.getItem(key);
      return v == null ? null : JSON.parse(v);
    } catch { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
  },
  del(key) {
    try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
  },
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const MAX_AHEAD = 30; // ticks a guest may run ahead of the host's courtyard before it waits
const Q_TARGET = 1.2; // orders a guest keeps waiting at the host, to ride out network jitter
const TAKEOVER_TICKS = 2 * TICK_HZ; // a friend's phone silent this long: a bot plays for it
const OFFLINE_SEAT_MS = 45000; // a phone gone this long from the lobby gives up its seat
const SESSION_MAX_MS = 3 * 3600 * 1000;

const valid = (v, ok, fallback) => (ok(v) ? v : fallback);
const settings = {
  format: valid(store.get('pk.format', 'duel'), (v) => !!FORMATS[v], 'duel'),
  difficulty: valid(store.get('pk.difficulty', 'normal'), (v) => !!DIFFICULTIES[v], 'normal'),
  target: valid(store.get('pk.target', 3), (v) => WIN_TARGETS.includes(v), 3),
  sound: store.get('pk.sound', true) !== false,
};
// The host's picks for games with friends, kept apart from practice.
const mp = {
  format: valid(store.get('pk.mp.format', 'duel'), (v) => !!FORMATS[v], 'duel'),
  difficulty: valid(store.get('pk.mp.difficulty', 'normal'), (v) => !!DIFFICULTIES[v], 'normal'),
  target: valid(store.get('pk.mp.target', 3), (v) => WIN_TARGETS.includes(v), 3),
};
const record = store.get('pk.record', {});
const coached = Object.assign({ moved: false, kegged: false, reveal: false, powers: {} }, store.get('pk.coached', {}));
const saveCoach = () => store.set('pk.coached', coached);

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC';
  return 'Player';
}
let myName = cleanName(store.get('pk.name', '')) || deviceName();
let cid = tabStore.get('pk.cid');
if (typeof cid !== 'string' || !/^[a-z0-9]{6,24}$/.test(cid)) {
  cid = randomId(12);
  tabStore.set('pk.cid', cid);
}
const params = new URLSearchParams(location.search);
const invitedCode = normCode(params.get('join'));

const sfx = new Sfx();
sfx.on = settings.sound;
const canvas = $('court');
const renderer = new ArenaRenderer(canvas);
const sideMQ = matchMedia('(orientation: landscape)');

let mode = 'practice'; // practice | host | guest
let me = 0; // your seat
let match = null; // practice and host: the real match; guest: a mirror of the host's
let arena = null; // the courtyard (on a guest: the host's, as far as it has arrived)
let fore = null; // guest only: the forecast that runs ahead with your own moves
let phase = 'menu'; // menu | lobby | waiting | countdown | play | between | ended
let running = false;
let paused = false;
let speed = 1;
let acc = 0;
let lastFrame = 0;
let raf = 0;
let side = false;
let wakeLock = null;
let you = null;
let chipEls = [];
let lastCount = null;
let betweenTimer = 0;
let H = null; // hosting: room, seats, friends' order queues
let G = null; // joined: link, lobby, forecast bookkeeping

const controls = new Controls({
  zone: $('stick-zone'),
  base: $('stick-base'),
  knob: $('stick-knob'),
  kegBtn: $('keg-btn'),
  onKeg: () => sfx.prime(),
});

const lobby = new LobbyView({
  onSeat: (i) => hostSeatTap(i),
  onSetting: (k, v) => hostSetting(k, v),
  onStart: () => { sfx.prime(); hostStartMatch(); },
  onLeave: () => leaveOnline(),
  onShare: () => shareInvite(),
});

// ---------- names and formatting ----------
const online = () => mode !== 'practice';
const myTeam = () => match.players[me].team;
const isAlly = (i) => i !== me && match.players[i].team === myTeam();
const isTeams = () => match.format.id === 'teams';
const nameOf = (i) => match.players[i].name;
/** The label over your teammate at the start of a round: their name if they're a friend. */
function allyTag() {
  if (!match || !isTeams()) return '';
  const i = match.players.findIndex((p, j) => j !== me && p.team === myTeam());
  return online() && i >= 0 && match.players[i].kind === 'human' ? nameOf(i).toUpperCase() : 'ALLY';
}
/** The colours seat i wears in this match (2 v 2 has team colours). */
const sideOf = (i) => sidesFor(match.format)[i];
function shortName(i) {
  if (i === me) return 'You';
  if (!online()) return isAlly(i) ? 'Ally' : sideOf(i).name;
  return nameOf(i);
}
function fullName(i) {
  if (i === me) return 'You';
  if (!online()) return isAlly(i) ? 'Your ally' : nameOf(i);
  return isAlly(i) ? `your ally ${nameOf(i)}` : nameOf(i);
}
const fmtTime = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function cornerOf(a, i) {
  const s = a.spawns[i];
  const n = a.n - 1;
  return `${s.y === 0 ? 'top' : s.y === n ? 'bottom' : 'middle'} ${s.x === 0 ? 'left' : s.x === n ? 'right' : 'middle'}`;
}

// Shown under the countdown, one per round.
const TIPS = [
  'Crates hide power-ups: glowing coins. Walk over one to grab it.',
  'Cells glowing red are about to be blasted. Get out of the red!',
  '+1 Keg lets you have more kegs down at once. Bigger blast makes your red cross longer.',
  'Drop a keg, then duck round a corner: blasts only travel in straight lines.',
  'A blast that reaches another keg sets it off at once. Chain them!',
  'Speed up makes you run faster. Handy for getting clear of your own kegs.',
];
function roundTip() {
  const tip = TIPS[(match.roundNo - 1) % TIPS.length];
  if (!online() || !arena) return tip;
  // With friends, colours depend on the seat: say which knight is yours.
  return `You're the ${sideOf(me).plain} knight, ${cornerOf(arena, me)}. ${match.roundNo === 1 ? '' : tip}`.trim();
}

// ---------- toasts ----------
const recentToasts = new Map();
function toast(text, cls = '', ms = 2600) {
  const now = performance.now();
  if (now - (recentToasts.get(text) || 0) < 1500) return;
  recentToasts.set(text, now);
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${cls}`.trim();
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ }
}

// ---------- menu ----------
const recKey = () => `${settings.format}.${settings.difficulty}`;
function initMenu() {
  $(`fmt-${settings.format}`).checked = true;
  $(`diff-${settings.difficulty}`).checked = true;
  $(`target-${settings.target}`).checked = true;
  for (const el of document.querySelectorAll('input[name="format"]')) {
    el.addEventListener('change', () => { settings.format = el.value; store.set('pk.format', el.value); renderRecord(); });
  }
  for (const el of document.querySelectorAll('input[name="difficulty"]')) {
    el.addEventListener('change', () => { settings.difficulty = el.value; store.set('pk.difficulty', el.value); renderRecord(); });
  }
  for (const el of document.querySelectorAll('input[name="target"]')) {
    el.addEventListener('change', () => { settings.target = Number(el.value); store.set('pk.target', settings.target); });
  }
  $('btn-start').addEventListener('click', () => { sfx.prime(); goFullscreen(); startPractice(); });
  $('btn-howto').addEventListener('click', () => openHowto(false));
  renderRecord();
  initFriends();
}
function matchLabel() {
  const d = DIFFICULTIES[settings.difficulty].label;
  return settings.format === 'duel' ? `1 v 1 against a ${d} bot` : `${FORMATS[settings.format].label} against ${d} bots`;
}
function renderRecord() {
  const r = record[recKey()];
  $('record').textContent = r && (r.w || r.l)
    ? `Your record in ${matchLabel()}: ${r.w} won, ${r.l} lost`
    : `No matches in ${matchLabel()} yet.`;
}

function initFriends() {
  const nm = $('mp-name');
  nm.value = myName;
  nm.addEventListener('change', saveName);
  const code = $('mp-code');
  code.addEventListener('input', () => {
    const v = normCode(code.value);
    if (code.value !== v) code.value = v;
    menuNote('');
  });
  $('btn-host').addEventListener('click', () => {
    saveName();
    sfx.prime();
    goFullscreen();
    hostOpen(null);
  });
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normCode(code.value);
    if (c.length !== 4) {
      menuNote("Enter the 4-letter code from the host's phone.");
      code.focus();
      return;
    }
    saveName();
    sfx.prime();
    goFullscreen();
    guestOpen(c);
  });
  if (invitedCode.length === 4) {
    code.value = invitedCode;
    // Opened from an invite: joining comes first.
    $('friends').classList.add('invited');
    $('invited').hidden = false;
    $('invited-code').textContent = invitedCode;
    $('btn-join').classList.add('primary');
    $('btn-host').classList.remove('primary');
    $('or-host').textContent = 'or host your own';
  }
}
function saveName() {
  myName = cleanName($('mp-name').value) || deviceName();
  $('mp-name').value = myName;
  store.set('pk.name', myName);
}
function menuNote(text, cls = '') {
  const el = $('mp-error');
  el.textContent = text;
  el.className = `form-error ${cls}`.trim();
  el.hidden = !text;
  // Make sure it's seen: the menu opens at the top.
  if (text && !$('menu').hidden) requestAnimationFrame(() => $('friends').scrollIntoView({ block: 'center' }));
}

function show(id) {
  for (const s of ['menu', 'lobby', 'game']) $(s).hidden = id !== s;
  document.body.style.overflow = id === 'game' ? 'hidden' : '';
  if (id === 'menu') startMenuScene();
  if (id !== 'game') window.scrollTo(0, 0);
}

// The animated picture at the top of the menu; it only runs while the menu is showing.
let sceneRaf = 0;
function startMenuScene() {
  cancelAnimationFrame(sceneRaf);
  const c = $('menu-scene');
  const loop = (now) => {
    if ($('menu').hidden) return;
    drawMenuScene(c, now);
    sceneRaf = requestAnimationFrame(loop);
  };
  sceneRaf = requestAnimationFrame(loop);
}

// ---------- how to play ----------
function fillLegend() {
  const pieces = [
    ['knight', 'Your knight', 'The one with the ring at its feet. In practice you wear blue.'],
    ['keg', 'Powder keg', 'Bursts about two seconds after you drop it.'],
    ['crate', 'Crate', 'Breaks in a blast. Some hide a power-up.'],
    ['stone', 'Stone', 'Never breaks. Blasts stop here.'],
  ];
  const ul = $('legend-pieces');
  ul.textContent = '';
  for (const [k, name, tip] of pieces) {
    const li = document.createElement('li');
    li.innerHTML = '<img alt=""><span><b></b> · <span class="c"></span></span>';
    li.querySelector('img').src = pieceThumb(k, 40);
    li.querySelector('b').textContent = name;
    li.querySelector('.c').textContent = tip;
    ul.appendChild(li);
  }
  const pl = $('legend-powers');
  pl.textContent = '';
  for (const k of Object.keys(POWERS)) {
    const li = document.createElement('li');
    li.innerHTML = '<img alt=""><span><b></b> · <span class="c"></span></span>';
    li.querySelector('img').src = powerThumb(k, 40);
    li.querySelector('b').textContent = POWERS[k].name;
    li.querySelector('.c').textContent = POWERS[k].tip;
    pl.appendChild(li);
  }
  for (const k of Object.keys(POWERS)) $(`pw-${k}`).querySelector('img').src = powerThumb(k, 44);
  $('keg-icon').src = kegIcon(64);
}
let howtoResume = false;
function openHowto(fromPause) {
  howtoResume = fromPause;
  $('howto').hidden = false;
  $('howto').querySelector('.howto').scrollTop = 0;
  $('btn-howto-close').focus({ preventScroll: true });
}
$('btn-howto-close').addEventListener('click', () => {
  $('howto').hidden = true;
  if (howtoResume) $('pause').hidden = false;
});

// ---------- matches and rounds ----------
function startPractice() {
  beginMatch(createMatch({ format: settings.format, difficulty: settings.difficulty, target: settings.target }), 'practice', 0);
}

/** Show the game screen and run the frame loop. A guest then waits for the host's first round. */
function beginMatch(m, md, seat) {
  sfx.prime();
  clearTimeout(betweenTimer);
  mode = md;
  me = seat;
  match = m;
  renderer.setSides(sidesFor(m.format));
  arena = null;
  fore = null;
  paused = false;
  $('end').hidden = true;
  $('pause').hidden = true;
  $('net-note').hidden = true;
  $('btn-skip').hidden = true;
  $('toasts').textContent = '';
  updateSoundButton();
  applyModeText();
  show('game');
  buildChips();
  if (md === 'guest') {
    renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    renderer.ctx.clearRect(0, 0, canvas.width, canvas.height);
    phase = 'waiting';
    controls.enabled = false;
    controls.reset();
    setBanner('Get ready', '', `First to ${match.target} round wins`, true);
  } else {
    startRound();
  }
  requestWakeLock();
  running = true;
  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function startRound() {
  clearTimeout(betweenTimer);
  arena = match.newRound();
  if (mode === 'host') hostRoundStarted();
  beginRoundView();
}

/** The countdown screen for a fresh courtyard (every mode). */
function beginRoundView() {
  $('btn-skip').hidden = true;
  phase = 'countdown';
  speed = 1;
  acc = 0;
  you = null;
  lastCount = null;
  renderer.reset();
  controls.reset();
  controls.enabled = false;
  for (const el of chipEls) el.classList.remove('out');
  applyLayoutMode();
  setBanner(roundKicker(), '', scoreLine(), true);
  $('banner-tip').textContent = roundTip();
  if (!coached.moved && match.roundNo === 1) {
    setTimeout(() => { if (phase === 'play' && !coached.moved) toast('Drag in the lower left to run. Tap Keg to drop a powder keg.', '', 6000); }, 2200);
  }
}

/** Stop the game screen's loop (going to the menu or back to the lobby). */
function stopGame() {
  running = false;
  clearTimeout(betweenTimer);
  cancelAnimationFrame(raf);
  controls.enabled = false;
  controls.reset();
  match = null;
  arena = null;
  fore = null;
  paused = false;
  $('pause').hidden = true;
  $('end').hidden = true;
  $('howto').hidden = true;
  $('net-note').hidden = true;
  $('btn-skip').hidden = true;
}

function goMenu() {
  stopGame();
  phase = 'menu';
  mode = 'practice';
  me = 0;
  show('menu');
  releaseWakeLock();
  renderRecord();
}

function pauseGame() {
  if (online()) {
    openMatchMenu();
    return;
  }
  if (!running || paused || phase === 'ended' || phase === 'menu') return;
  paused = true;
  controls.reset();
  $('pause').hidden = false;
  $('btn-resume').focus();
}
function resumeGame() {
  $('pause').hidden = true;
  requestWakeLock();
  if (online()) return;
  paused = false;
  lastFrame = performance.now();
  acc = 0;
}
/** With friends nothing pauses: the menu opens over the running game. */
function openMatchMenu() {
  if (!running || phase === 'ended') return;
  $('pause').hidden = false;
  $('btn-resume').focus();
}

/** "You 2 · Gules 1": round wins so far. */
function scoreLine() {
  if (!match.history.length) return `First to ${match.target} round wins`;
  const parts = [];
  if (isTeams()) {
    parts.push(`Your side ${match.wins.get(myTeam())}`, `Theirs ${match.wins.get(1 - myTeam())}`);
  } else {
    match.players.forEach((p, i) => parts.push(`${shortName(i)} ${match.wins.get(p.team)}`));
  }
  return parts.join(' · ');
}

function roundKicker() {
  const th = arena && THEMES[arena.theme];
  return th ? `Round ${match.roundNo} · ${th.name}` : `Round ${match.roundNo}`;
}

function setBanner(kicker, main, sub, dim = false, cls = '') {
  const b = $('banner');
  b.hidden = false;
  b.classList.toggle('dim', dim);
  $('banner-kicker').textContent = kicker;
  const m = $('banner-main');
  m.textContent = main;
  m.className = `banner-main ${cls}`.trim();
  $('banner-sub').textContent = sub;
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
}
function hideBanner() {
  $('banner').hidden = true;
  $('banner-tip').textContent = '';
}

/** Play the rest of the round instantly (practice: you're out; hosting: only bots are left). */
function skipRound() {
  if (phase !== 'play' || !arena || mode === 'guest') return;
  $('btn-skip').hidden = true;
  for (let guard = 0; guard < 600 * TICK_HZ && !arena.over; guard++) {
    match.step();
    for (const e of arena.events) if (e.t === 'death' && chipEls[e.player]) chipEls[e.player].classList.add('out');
    arena.events.length = 0;
  }
  renderer.fx.length = 0;
  if (arena.over) roundOver();
}
$('btn-skip').addEventListener('click', () => { sfx.prime(); skipRound(); });

/** Practice and host: book the finished round, then show it. */
function roundOver() {
  const team = match.endRound();
  if (mode === 'host') {
    H.lastTeam = team;
    H.room.broadcast({ t: 'roundOver', team, wins: [...match.wins], history: match.history });
  }
  showRoundResult(team);
  betweenTimer = setTimeout(() => {
    if (!running) return;
    if (match.over) {
      if (mode === 'host') H.room.broadcast(hostMatchOverMsg());
      showEnd();
    } else startRound();
  }, 2800);
}

function showRoundResult(team) {
  $('btn-skip').hidden = true;
  phase = 'between';
  controls.enabled = false;
  controls.reset();
  let main;
  let cls = '';
  if (team == null) {
    main = 'Draw';
  } else if (team === myTeam()) {
    main = isTeams() ? 'Your side wins' : 'You win';
    cls = 'win';
  } else {
    const winner = match.players.findIndex((p) => p.team === team);
    main = isTeams() ? 'They win' : `${online() ? nameOf(winner) : sideOf(winner).name} wins`;
  }
  setBanner(roundKicker(), main, scoreLine(), true, cls);
  $('banner-tip').textContent = '';
  updateChips(true, team);
  sfx.play(team != null && team === myTeam() ? 'roundWin' : 'roundLose');
}

// ---------- layout ----------
function applyLayoutMode() {
  side = sideMQ.matches;
  $('game').classList.toggle('side', side);
  layout();
}
function layout() {
  if (!arena) return;
  const game = $('game');
  const cs = getComputedStyle(game);
  const W = game.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H2 = game.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let court;
  if (side) {
    court = Math.min(H2, W - 2 * 150);
  } else {
    const used = $('game').querySelector('.hud').offsetHeight + $('powers').offsetHeight;
    court = Math.min(W - 4, H2 - used - 190);
  }
  court = Math.max(200, Math.floor(court));
  game.style.setProperty('--court', `${court}px`);
  renderer.layout(arena);
}
const onOrientation = () => { if (arena) applyLayoutMode(); };
if (sideMQ.addEventListener) sideMQ.addEventListener('change', onOrientation);
else if (sideMQ.addListener) sideMQ.addListener(onOrientation);
window.addEventListener('resize', () => { if (running) layout(); });
if (window.ResizeObserver) new ResizeObserver(() => { if (running && arena) renderer.layout(arena); }).observe($('court-wrap'));

// ---------- frame loop ----------
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode === 'guest') {
    guestLoop(now, dt);
    updateHud();
    return;
  }
  if (!paused && (phase === 'countdown' || phase === 'play')) {
    acc += dt * speed;
    let steps = 0;
    while (acc >= DT && steps < 12) {
      tick(now);
      acc -= DT;
      steps++;
      if (phase !== 'countdown' && phase !== 'play') break;
    }
    if (steps >= 12) acc = 0;
  }
  if (arena) {
    const live = !paused && (phase === 'countdown' || phase === 'play');
    renderer.draw(arena, { me, alpha: live ? Math.min(1, acc / DT) : 1, you, allyTag: allyTag() }, now);
  }
  updateHud();
}

/** Practice and host: one tick of the real game. */
function tick(now) {
  const mine = arena.players[me];
  if (mine.alive && phase === 'play') {
    const r = controls.read();
    mine.input.dir = r.dir;
    mine.input.alt = r.alt;
    if (controls.takeKeg()) mine.input.bomb = true;
    if (r.dir && !coached.moved) { coached.moved = true; saveCoach(); }
  }
  if (mode === 'host') hostApplyRemote();
  for (const b of match.bots) b.update();
  // Hosting: the orders actually applied this tick are what every other phone replays.
  let codes = null;
  if (mode === 'host') {
    codes = arena.players.map((p) => encodeInput(p.input));
    // Step with exactly the orders that go out, so the host and every phone run the same tick.
    arena.players.forEach((p, i) => applyInput(p, codes[i]));
  }
  arena.step();
  if (codes) hostSendFrame(codes);
  if (phase === 'countdown') countdown(arena);
  handleEvents(arena.events, arena, now, 'local');
  arena.events.length = 0;
  if (arena.over && phase === 'play') roundOver();
}

function countdown(a) {
  const left = (a.startTick - a.tick) / TICK_HZ;
  const n = Math.ceil(left / 0.8);
  if (n > 0 && n <= 3 && n !== lastCount) {
    lastCount = n;
    setBanner(roundKicker(), String(n), scoreLine(), true);
    sfx.play('tick');
  }
}

// On a guest the same thing can be seen twice: first in the forecast, then when the host's
// courtyard catches up. Effects play once. Deaths and the end only ever come from the host.
function eventKey(e) {
  switch (e.t) {
    case 'blast': return `b${e.cell}.${e.owner}`;
    case 'keg': return `k${e.cell}.${e.owner}`;
    case 'crate': return `c${e.cell}`;
    case 'reveal': return `r${e.cell}`;
    case 'burnItem': return `i${e.cell}`;
    case 'power': return `p${e.cell}`;
    case 'drop': return `d${e.cells[0]}`;
    default: return e.t;
  }
}
function admit(e, origin, now) {
  if (origin === 'local') return true;
  if (e.t === 'death' || e.t === 'over') return origin === 'conf';
  const key = eventKey(e);
  const at = G.seen.get(key);
  const windowMs = e.t === 'blast' || e.t === 'keg' ? 1500 : Infinity; // the same cell can blow again later
  if (at != null && now - at < windowMs) return false;
  G.seen.set(key, now);
  return true;
}
/** Where your knight is right now (on a guest: in the forecast). */
const myView = () => ((mode === 'guest' && fore) ? fore : arena).players[me];

function handleEvents(evs, src, now, origin) {
  if (!evs.length) return;
  const list = origin === 'local' ? evs : evs.filter((e) => admit(e, origin, now));
  if (!list.length) return;
  renderer.addEvents(list, src, now);
  const mine = myView();
  for (const e of list) {
    switch (e.t) {
      case 'go':
        phase = 'play';
        controls.enabled = arena.players[me].alive;
        $('banner-tip').textContent = '';
        setBanner('', 'Go!', '', false);
        setTimeout(() => { if (phase === 'play') hideBanner(); }, 600);
        sfx.play('go');
        you = { until: now + 2400 };
        break;
      case 'keg':
        if (e.owner === me) {
          sfx.play('keg');
          if (!coached.kegged) { coached.kegged = true; saveCoach(); }
        }
        break;
      case 'blast': {
        const x = e.cell % src.n;
        const y = Math.floor(e.cell / src.n);
        const near = Math.abs(x - mine.x) + Math.abs(y - mine.y) <= 5;
        sfx.play(near ? 'blast' : 'blastFar');
        if (near && mine.alive) buzz(25);
        break;
      }
      case 'crate':
        if (e.owner === me) sfx.play('crate');
        break;
      case 'power':
        if (e.player === me) {
          sfx.play('power');
          const el = $(`pw-${e.kind}`);
          el.classList.remove('up');
          void el.offsetWidth;
          el.classList.add('up');
          if (!coached.powers[e.kind]) {
            coached.powers[e.kind] = true;
            saveCoach();
            toast(`${POWERS[e.kind].name}: ${POWERS[e.kind].tip}`, 'good', 3200);
          }
        }
        break;
      case 'reveal': {
        const x = e.cell % src.n;
        const y = Math.floor(e.cell / src.n);
        if (!coached.reveal && mine.alive && Math.abs(x - mine.x) + Math.abs(y - mine.y) <= 5) {
          coached.reveal = true;
          saveCoach();
          toast(`A power-up popped out: ${POWERS[e.kind].name}. Walk over the glowing coin to grab it.`, 'good', 4200);
        }
        break;
      }
      case 'death':
        onDeath(e);
        break;
      case 'hurry':
        toast('Stone is falling from the edges. Head for the middle!', 'warn', 3600);
        sfx.play('bell');
        break;
      case 'final':
        toast('Last stand: kegs burn faster and every blast reaches all the way across!', 'warn', 4000);
        sfx.play('bell');
        break;
      case 'drop':
        sfx.play('drop');
        break;
      default: break;
    }
  }
}

function onDeath(e) {
  const i = e.player;
  if (chipEls[i]) chipEls[i].classList.add('out');
  if (i === me) {
    sfx.play('death');
    buzz(160);
    controls.enabled = false;
    controls.reset();
    const how = e.by === me ? 'Caught in your own blast.' : e.by === -1 ? 'Crushed by falling stone.' : `Blown up by ${fullName(e.by)}.`;
    const others = arena.players.filter((p) => p.alive);
    const teams = new Set(others.map((p) => p.team));
    if (mode === 'practice' && teams.size > 1) {
      speed = match.players.length > 2 ? 3 : 2;
      toast(`${how} Watching the rest at ${speed}× speed.`, 'bad', 3200);
      $('btn-skip').hidden = false;
    } else if (online() && teams.size > 1) {
      toast(`${how} You're out for this round.`, 'bad', 3200);
    } else {
      toast(how, 'bad', 2400);
    }
  } else if (e.by === me) {
    sfx.play('rivalDown');
    toast(isAlly(i) ? 'You got your own ally!' : `You got ${fullName(i)}!`, isAlly(i) ? 'warn' : 'good', 2200);
  } else if (isAlly(i)) {
    toast(online() ? `Your ally ${nameOf(i)} is out.` : 'Your ally is out.', 'warn', 2200);
  }
  if (mode === 'host') hostOfferSkip();
}

// ---------- HUD ----------
const cache = {};
function setText(id, v) {
  if (cache[id] === v) return;
  cache[id] = v;
  $(id).textContent = v;
}

function buildChips() {
  const box = $('chips');
  box.textContent = '';
  chipEls = [];
  box.classList.toggle('compact', match.players.length > 2);
  box.classList.toggle('names', online());
  match.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.innerHTML = '<svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><use href="#i-shield"/></svg><span class="nm"></span><span class="pips"></span>';
    el.querySelector('.shield').style.fill = sideOf(i).color;
    const pips = el.querySelector('.pips');
    for (let k = 0; k < match.target; k++) pips.appendChild(Object.assign(document.createElement('i'), { className: 'pip' }));
    chipEls.push(el);
    box.appendChild(el);
  });
  labelChips();
  updateChips(false, null);
}
function labelChips() {
  match.players.forEach((p, i) => {
    const el = chipEls[i];
    if (!el) return;
    const named = i === me || (online() ? p.kind === 'human' : isAlly(i));
    el.classList.toggle('chip', true);
    el.classList.toggle('me', i === me);
    el.classList.toggle('named', named);
    el.classList.toggle('bot', online() && p.kind === 'bot');
    el.querySelector('.nm').textContent = shortName(i);
    el.setAttribute('aria-label', online() && p.kind === 'bot' ? `${fullName(i)} (bot)` : fullName(i));
  });
}

function updateChips(flash, team) {
  match.players.forEach((p, i) => {
    const wins = match.wins.get(p.team);
    const pips = chipEls[i].querySelectorAll('.pip');
    pips.forEach((pip, k) => pip.classList.toggle('on', k < wins));
    if (flash && team != null && p.team === team) {
      chipEls[i].classList.remove('won');
      void chipEls[i].offsetWidth;
      chipEls[i].classList.add('won');
    }
  });
}

function updateHud() {
  const a = mode === 'guest' ? fore : arena;
  if (!a || !match) return;
  // The clock counts down to the next stage of the round.
  let big;
  let note;
  let hurry = false;
  if (a.final) {
    big = '!';
    note = 'Last stand';
    hurry = true;
  } else if (a.tick >= a.hurryTick) {
    big = '!';
    note = 'Closing in';
    hurry = true;
  } else {
    big = fmtTime((a.hurryTick - Math.max(a.tick, a.startTick)) / TICK_HZ);
    note = `Round ${match.roundNo}`;
  }
  setText('clock', big);
  setText('clock-note', note);
  if (cache.hurry !== hurry) {
    cache.hurry = hurry;
    $('clock-box').classList.toggle('hurry', hurry);
  }
  const mine = a.players[me];
  updateMeters(mine);
  const ready = mine.alive ? mine.kegs - mine.active : 0;
  setText('keg-count', String(ready));
  const empty = ready <= 0 || !mine.alive;
  if (cache.empty !== empty) {
    cache.empty = empty;
    $('keg-btn').classList.toggle('empty', empty);
  }
}

/** The power-up panel: barrels for kegs, segments for blast reach and speed. */
function buildMeters() {
  const fill = (id, count) => {
    const box = $(id);
    box.textContent = '';
    for (let i = 0; i < count; i++) box.appendChild(document.createElement('i'));
  };
  fill('pw-keg-m', MAX_KEGS);
  fill('pw-fire-m', MAX_RANGE);
  fill('pw-boots-m', MAX_SPEED_LV + 1);
}
function updateMeters(mine) {
  const key = `${mine.kegs}|${mine.active}|${mine.range}|${mine.speedLv}|${mine.alive}`;
  if (cache.meters === key) return;
  cache.meters = key;
  const ready = mine.alive ? mine.kegs - mine.active : 0;
  [...$('pw-keg-m').children].forEach((el, i) => {
    el.hidden = i >= mine.kegs;
    el.classList.toggle('out', i >= ready);
  });
  [...$('pw-fire-m').children].forEach((el, i) => el.classList.toggle('on', i < mine.range));
  [...$('pw-boots-m').children].forEach((el, i) => el.classList.toggle('on', i <= mine.speedLv));
  $('pw-keg').setAttribute('aria-label', `Kegs: ${ready} of ${mine.kegs} ready`);
  $('pw-fire').setAttribute('aria-label', `Blast reach: ${mine.range} cells`);
  $('pw-boots').setAttribute('aria-label', `Speed: level ${mine.speedLv + 1} of ${MAX_SPEED_LV + 1}`);
}

// ---------- pause / match menu / end ----------
function applyModeText() {
  const on = online();
  $('pause-title').textContent = on ? 'Match menu' : 'Paused';
  $('pause-note').hidden = !on;
  $('btn-resume').textContent = on ? 'Back to the game' : 'Resume';
  $('btn-pause').setAttribute('aria-label', on ? 'Match menu' : 'Pause');
  $('btn-to-lobby').hidden = mode !== 'host';
  $('btn-quit').textContent = mode === 'host' ? 'End the game for everyone' : mode === 'guest' ? 'Leave the game' : 'Leave match';
  $('btn-skip').textContent = mode === 'host' ? 'Only bots are left: skip to the end' : 'Skip to the next round';
}
$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
function updateSoundButton() {
  $('btn-sound').textContent = settings.sound ? 'Sound on' : 'Sound off';
  $('btn-sound').setAttribute('aria-pressed', String(settings.sound));
}
$('btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  sfx.on = settings.sound;
  store.set('pk.sound', settings.sound);
  if (settings.sound) sfx.prime();
  updateSoundButton();
});
$('btn-howto2').addEventListener('click', () => {
  $('pause').hidden = true;
  openHowto(true);
});
$('btn-quit').addEventListener('click', () => {
  if (online()) leaveOnline();
  else goMenu();
});
$('btn-to-lobby').addEventListener('click', () => { if (mode === 'host') hostToLobby(); });
$('btn-again').addEventListener('click', () => {
  sfx.prime();
  if (mode === 'host') hostStartMatch(true);
  else startPractice();
});
$('btn-menu').addEventListener('click', () => {
  if (mode === 'host') hostToLobby();
  else if (mode === 'guest') leaveOnline();
  else goMenu();
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !running) return;
  if (!$('pause').hidden) resumeGame();
  else pauseGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!online()) pauseGame();
    return;
  }
  if (running || phase === 'lobby') requestWakeLock();
  if (H) H.room.wake();
  if (G) G.link.wake();
});
// Any tap re-arms sound (a phone that rejoined after a reload hasn't been tapped yet).
document.addEventListener('pointerdown', () => { if (online()) sfx.prime(); }, { passive: true });

function showEnd() {
  phase = 'ended';
  hideBanner();
  $('btn-skip').hidden = true;
  $('pause').hidden = true;
  controls.enabled = false;
  controls.reset();
  const won = match.winner === myTeam();
  const mine = match.wins.get(myTeam());
  let best = 0;
  for (const [t, w] of match.wins) if (t !== myTeam()) best = Math.max(best, w);
  const winnerIdx = match.players.findIndex((p) => p.team === match.winner);
  const title = $('end-title');
  title.textContent = won ? 'Victory' : 'Defeat';
  title.className = `end-title ${won ? 'win' : 'loss'}`;
  const theirName = isTeams() ? 'The other side' : winnerIdx >= 0 ? (online() ? nameOf(winnerIdx) : match.players[winnerIdx].name) : 'Nobody';
  $('end-sub').textContent = won
    ? `${isTeams() ? 'Your side' : 'You'} took the match ${mine}–${best}.`
    : `${theirName} took the match ${match.target}–${mine}.`;
  const t = match.totals ? match.totals[me] : null;
  const rows = [['Rounds won', `${mine} of ${match.roundNo}`]];
  if (t) {
    rows.push(['Rivals blown up', t.kills], ['Kegs dropped', t.kegs], ['Crates broken', t.crates], ['Power-ups picked up', t.powers], ['Caught in your own blast', t.selfKills]);
  }
  if (mode === 'practice') {
    const key = recKey();
    const r = Object.assign({ w: 0, l: 0 }, record[key]);
    if (won) r.w++;
    else r.l++;
    record[key] = r;
    store.set('pk.record', record);
    rows.push(['Your record in this mode', `${r.w}–${r.l}`]);
    $('end-eyebrow').textContent = `Practice · ${match.format.label} · ${DIFFICULTIES[settings.difficulty].label} bots`;
  } else {
    $('end-eyebrow').textContent = `With friends · ${match.format.label}`;
  }
  const dl = $('end-stats');
  dl.textContent = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
  renderStandings();
  $('btn-again').hidden = mode === 'guest';
  $('btn-menu').textContent = mode === 'host' ? 'Back to the lobby' : mode === 'guest' ? 'Leave the game' : 'Back to menu';
  $('end-wait').hidden = mode !== 'guest';
  if (mode === 'guest') $('end-wait').textContent = `Waiting for ${G.hostName} to start another match…`;
  $('end').hidden = false;
  sfx.play(won ? 'win' : 'lose');
  if (mode !== 'guest') $('btn-again').focus({ preventScroll: true });
}

/** With friends: everyone's rounds and knock-outs. */
function renderStandings() {
  const ol = $('end-standings');
  ol.textContent = '';
  ol.hidden = !online() || !match.totals;
  if (ol.hidden) return;
  match.players.forEach((p, i) => {
    const tt = match.totals[i] || {};
    const li = document.createElement('li');
    li.innerHTML = '<svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><use href="#i-shield"/></svg><span class="st-name"></span><span class="st-fig"></span>';
    li.querySelector('.shield').style.fill = sideOf(i).color;
    li.querySelector('.st-name').textContent = i === me ? `${p.name} (you)` : p.kind === 'bot' ? `${p.name} (bot)` : p.name;
    li.querySelector('.st-fig').textContent = `${match.wins.get(p.team)} won · ${tt.kills | 0} KO`;
    if (p.team === match.winner) li.classList.add('won');
    ol.appendChild(li);
  });
}

// ---------- device helpers ----------
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released) || document.hidden) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* ignore */ }
  wakeLock = null;
}
function goFullscreen() {
  // Phones only: more room for the courtyard. Ignored where unsupported (iPhone Safari).
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (running) setTimeout(layout, 50); });

// =====================================================================================
// Playing with friends
// =====================================================================================
function inviteUrl() {
  const u = new URL(location.href);
  const keep = new URLSearchParams();
  for (const k of ['server', 'insecure']) if (params.has(k)) keep.set(k, params.get(k) || '1');
  keep.set('join', H.room.code);
  u.search = keep.toString();
  u.hash = '';
  return u.toString();
}
const siteUrl = () => (location.host + location.pathname).replace(/index\.html$/, '');

/** Close any game with friends and forget it (this tab won't rejoin after a reload). */
function endOnline(goodbye) {
  tabStore.del('pk.session');
  if (H) {
    if (goodbye) H.room.broadcast({ t: 'end' });
    H.room.close();
    H = null;
  }
  if (G) {
    G.link.close(goodbye ? { t: 'bye' } : null);
    G = null;
  }
  clearInterval(lobbyTimer);
  lobbyTimer = 0;
  if (params.has('join')) {
    params.delete('join');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
  }
}
/** The Leave / Close / End buttons. */
function leaveOnline() {
  const wasHost = mode === 'host';
  endOnline(true);
  goMenu();
  menuNote(wasHost ? 'You closed the game.' : 'You left the game.', 'info');
}

let lobbyTimer = 0;
function showLobby() {
  phase = 'lobby';
  show('lobby');
  renderLobby();
  requestWakeLock();
  clearInterval(lobbyTimer);
  // Refresh ping times, and let go of seats whose phones never came back.
  lobbyTimer = setInterval(() => {
    if (H && !H.inMatch) hostExpireSeats();
    if (phase === 'lobby') renderLobby();
  }, 2000);
}

function renderLobby() {
  if (phase !== 'lobby') return;
  if (mode === 'host' && H) lobby.render(hostLobbyView());
  else if (mode === 'guest' && G) lobby.render(guestLobbyView());
}

async function shareInvite() {
  if (!H) return;
  const url = inviteUrl();
  const note = (t) => { $('share-note').textContent = t; };
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Powder Keg', text: `Join my Powder Keg game. Code: ${H.room.code}`, url });
      note('');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    note('Invite link copied. Paste it in a message to your friends.');
  } catch {
    note(url);
  }
}

// ---------- hosting ----------
function newRemote(cidOf) {
  return { cid: cidOf, queue: [], lastS: 0, ack: 0, starve: 0, q: 0, takeover: null, left: false, snapAt: 0 };
}
const hostSeatOf = (c) => (H ? H.seats.findIndex((s) => s && s.cid === c) : -1);
const humanCount = () => H.seats.filter(Boolean).length;
function hostOnline(c) {
  const g = H.room.guests.get(c);
  return !!(g && g.open);
}

function hostOpen(resumeCode) {
  endOnline(false);
  mode = 'host';
  me = 0;
  H = {
    room: null,
    seats: [{ kind: 'host', cid: 'host', name: myName }, null, null, null],
    remote: new Map(), // seat -> a friend's order queue, during a match
    sel: -1,
    state: 'connecting',
    inMatch: false,
    lastTeam: null,
  };
  H.room = new HostRoom({
    onStatus: (s) => { if (H) { H.state = s; renderLobby(); } },
    onCode: (c) => { tabStore.set('pk.session', { role: 'host', code: c, at: Date.now() }); renderLobby(); },
    accept: (h) => hostAccept(h),
    onJoin: (g, again) => hostJoin(g, again),
    onLeave: (g) => hostLeave(g),
    onMessage: (g, m) => hostMessage(g, m),
  });
  H.room.open(resumeCode);
  tabStore.set('pk.session', { role: 'host', code: H.room.code, at: Date.now() });
  showLobby();
}

function hostAccept({ cid: c, name, known }) {
  if (H.inMatch) {
    if (known && hostSeatOf(c) >= 0) return { ok: true };
    // A friend back from a new tab: same name as a knight whose phone dropped out.
    const lower = name.toLowerCase();
    const seat = H.seats.findIndex((s) => s && s.kind === 'guest' && s.name.toLowerCase() === lower && !hostOnline(s.cid));
    if (seat >= 0) {
      const old = H.seats[seat].cid;
      H.seats[seat].cid = c;
      const R = H.remote.get(seat);
      if (R) R.cid = c;
      H.room.drop(old);
      return { ok: true };
    }
    return { ok: false, why: 'started' };
  }
  if (hostSeatOf(c) >= 0) return { ok: true };
  if (humanCount() >= 4) return { ok: false, why: 'full' };
  return { ok: true };
}

function hostJoin(g, again) {
  let seat = hostSeatOf(g.cid);
  if (H.inMatch) {
    if (seat < 0) return;
    H.seats[seat].name = g.name;
    H.seats[seat].offAt = 0;
    const R = H.remote.get(seat);
    if (R) {
      R.queue.length = 0;
      R.lastS = 0;
      R.ack = 0;
      R.starve = 0;
      if (R.left || match.players[seat].kind !== 'human') {
        R.left = false;
        match.players[seat].kind = 'human';
        H.room.broadcast({ t: 'seat', i: seat, kind: 'human' });
        labelChips();
      }
    }
    hostCatchUp(g.cid, seat);
    if (again || R) {
      toast(`${g.name} is back.`, 'good');
      H.room.broadcast({ t: 'toast', text: `${g.name} is back.`, cls: 'good' });
    }
    return;
  }
  if (seat < 0) {
    seat = hostFreeSeat();
    if (seat < 0) {
      H.room.send(g.cid, { t: 'reject', why: 'full' });
      H.room.drop(g.cid);
      return;
    }
    H.seats[seat] = { kind: 'guest', cid: g.cid, name: g.name, offAt: 0 };
    sfx.play('tick');
  } else {
    H.seats[seat].name = g.name;
    H.seats[seat].offAt = 0;
  }
  hostBroadcastLobby();
  renderLobby();
}

function hostFreeSeat() {
  const P = FORMATS[mp.format].players;
  for (let i = 0; i < P; i++) if (!H.seats[i]) return i;
  for (let i = P; i < 4; i++) if (!H.seats[i]) return i;
  return -1;
}

/** Friends sitting beyond the match's seats move into empty ones, if there are any. */
function compactSeats() {
  const P = FORMATS[mp.format].players;
  for (let i = P; i < 4; i++) {
    if (!H.seats[i]) continue;
    const free = H.seats.findIndex((s, j) => j < P && !s);
    if (free < 0) break;
    H.seats[free] = H.seats[i];
    H.seats[i] = null;
  }
}

function hostLeave(g) {
  const seat = hostSeatOf(g.cid);
  if (seat < 0) {
    H.room.drop(g.cid);
    return;
  }
  H.seats[seat].offAt = Date.now();
  if (H.inMatch) {
    const text = `${g.name}'s phone dropped out. A bot plays for them until they're back.`;
    toast(text, 'warn', 3400);
    H.room.broadcast({ t: 'toast', text, cls: 'warn' });
  } else {
    hostBroadcastLobby();
    renderLobby();
  }
}

/** In the lobby, a phone that left without saying goodbye gives its seat back after a while. */
function hostExpireSeats() {
  let changed = false;
  H.seats.forEach((s, i) => {
    if (!s || s.kind !== 'guest' || hostOnline(s.cid) || !s.offAt) return;
    if (Date.now() - s.offAt > OFFLINE_SEAT_MS) {
      H.room.drop(s.cid);
      H.seats[i] = null;
      changed = true;
    }
  });
  if (changed) hostBroadcastLobby();
}

function hostMessage(g, m) {
  switch (m.t) {
    case 'in': hostInput(g, m); break;
    case 'resync': {
      const seat = hostSeatOf(g.cid);
      const R = H.remote.get(seat);
      if (!R || !(phase === 'countdown' || phase === 'play')) break;
      const now = performance.now();
      if (now - R.snapAt < 1000) break;
      R.snapAt = now;
      hostSendSnap(g.cid, seat, false);
      break;
    }
    case 'bye': hostBye(g); break;
    default: break;
  }
}

function hostBye(g) {
  const seat = hostSeatOf(g.cid);
  H.room.drop(g.cid);
  if (seat < 0) return;
  H.seats[seat] = null;
  if (!H.inMatch) {
    hostBroadcastLobby();
    renderLobby();
    return;
  }
  const R = H.remote.get(seat);
  if (R && match) {
    R.left = true;
    R.queue.length = 0;
    match.players[seat].kind = 'bot';
    match.players[seat].difficulty = mp.difficulty;
    if (arena && arena.players[seat].alive && (phase === 'countdown' || phase === 'play')) addTakeover(seat);
    H.room.broadcast({ t: 'seat', i: seat, kind: 'bot' });
    labelChips();
  }
  const text = `${g.name} left. A bot takes their place.`;
  toast(text, 'warn', 3000);
  H.room.broadcast({ t: 'toast', text, cls: 'warn' });
}

function hostInput(g, m) {
  if (!H.inMatch || !(phase === 'countdown' || phase === 'play')) return;
  const R = H.remote.get(hostSeatOf(g.cid));
  if (!R || R.left) return;
  if (!Number.isInteger(m.s) || m.s <= R.lastS || !validCode(m.c)) return;
  R.lastS = m.s;
  R.queue.push({ s: m.s, c: m.c });
  if (R.queue.length > 90) R.queue.splice(0, R.queue.length - 90);
}

function hostSeatTap(i) {
  if (!H || H.inMatch) return;
  if (H.sel < 0) H.sel = i;
  else if (H.sel === i) H.sel = -1;
  else {
    const a = H.sel;
    [H.seats[a], H.seats[i]] = [H.seats[i], H.seats[a]];
    H.sel = -1;
    hostBroadcastLobby();
  }
  renderLobby();
}

function hostSetting(k, v) {
  if (!H || H.inMatch) return;
  if (k === 'format' && FORMATS[v]) {
    mp.format = v;
    store.set('pk.mp.format', v);
    compactSeats();
  } else if (k === 'difficulty' && DIFFICULTIES[v]) {
    mp.difficulty = v;
    store.set('pk.mp.difficulty', v);
  } else if (k === 'target' && WIN_TARGETS.includes(v)) {
    mp.target = v;
    store.set('pk.mp.target', v);
  }
  H.sel = -1;
  hostBroadcastLobby();
  renderLobby();
}

function hostBroadcastLobby() {
  if (!H) return;
  H.room.broadcast({
    t: 'lobby',
    code: H.room.code,
    host: myName,
    format: mp.format,
    difficulty: mp.difficulty,
    target: mp.target,
    seats: H.seats.map((s) => (s ? { k: s.kind, n: s.name, c: s.kind === 'guest' ? s.cid : '', on: s.kind === 'host' || hostOnline(s.cid) } : null)),
  });
}

function hostLobbyView() {
  const f = FORMATS[mp.format];
  const P = f.players;
  const seats = [];
  const seatView = (s, i) => {
    if (s.kind === 'host') return { i, kind: 'host', name: s.name, me: true, online: true };
    const g = H.room.guests.get(s.cid);
    return { i, kind: 'guest', name: s.name, me: false, online: !!(g && g.open), ping: g ? g.rtt : null };
  };
  for (let i = 0; i < P; i++) {
    const s = H.seats[i];
    seats.push(s ? seatView(s, i) : { i, kind: 'bot', name: `${DIFFICULTIES[mp.difficulty].label} bot` });
  }
  for (let i = P; i < 4; i++) if (H.seats[i]) seats.push({ ...seatView(H.seats[i], i), outside: true });
  const humans = humanCount();
  const status = {
    connecting: ['Getting a game code…', ''],
    online: [humans > 1 ? `${humans} knights are in. Start when everyone's ready.` : 'Ready. Friends join with this code.', 'ok'],
    offline: ['The matchmaker is out of reach. Retrying… Phones already in stay linked.', 'warn'],
    failed: [H.room.failWhy === 'nopeer' ? "The networking code didn't load. Check the connection and reload the page." : "This browser can't link phones. Try Safari on iPhone or Chrome on Android.", 'bad'],
    idle: ['', ''],
  }[H.state] || ['', ''];
  let hint = '';
  if (humans > 1 || f.id === 'teams') hint = H.sel >= 0 ? 'Now tap the seat to swap with.' : 'Tap two knights to swap their places (and colours).';
  let startNote = '';
  if (humans > P) startNote = `${humans} knights are here, but ${f.label} has room for ${P}. Pick a bigger match.`;
  else if (humans === 1) startNote = 'Nobody has joined yet. You can start against bots, or wait for friends.';
  return {
    role: 'host',
    code: H.room.code,
    status: status[0],
    statusCls: status[1],
    inviteUrl: inviteUrl(),
    siteUrl: siteUrl(),
    format: mp.format,
    difficulty: mp.difficulty,
    target: mp.target,
    editable: true,
    seats,
    selected: H.sel,
    hint,
    startEnabled: humans <= P && H.state !== 'failed',
    startNote,
    waitText: '',
    error: '',
  };
}

function hostStartMsg(m, seat) {
  return {
    t: 'start',
    host: myName,
    format: m.format.id,
    target: m.target,
    seat,
    players: m.players.map((p) => ({ n: p.name, k: p.kind })),
    wins: [...m.wins],
    history: m.history,
    roundNo: m.roundNo,
  };
}
function hostMatchOverMsg() {
  return { t: 'matchOver', winner: match.winner, wins: [...match.wins], totals: match.totals, roundNo: match.roundNo };
}

function hostStartMatch(rematch = false) {
  if (!H) return;
  if (rematch) H.inMatch = false;
  if (H.inMatch) return;
  const f = FORMATS[mp.format];
  compactSeats();
  if (humanCount() > f.players) return;
  const sides = [];
  for (let i = 0; i < f.players; i++) {
    const s = H.seats[i];
    sides.push(s ? { kind: 'human', name: s.name, cid: s.cid } : { kind: 'bot', name: botName(f, i), difficulty: mp.difficulty });
  }
  const hostSeat = H.seats.findIndex((s) => s && s.kind === 'host');
  H.remote = new Map();
  sides.forEach((s, i) => { if (s.kind === 'human' && s.cid !== 'host') H.remote.set(i, newRemote(s.cid)); });
  H.inMatch = true;
  H.sel = -1;
  H.lastTeam = null;
  clearInterval(lobbyTimer);
  lobbyTimer = 0;
  const m = createMatch({ format: f.id, difficulty: mp.difficulty, target: mp.target, sides });
  for (const [seat, R] of H.remote) H.room.send(R.cid, hostStartMsg(m, seat));
  beginMatch(m, 'host', hostSeat);
}

function hostToLobby() {
  if (!H) return;
  stopGame();
  H.inMatch = false;
  H.remote.clear();
  H.room.broadcast({ t: 'toLobby' });
  showLobby();
  hostBroadcastLobby();
}

/** A friend who dropped out mid-match: everything needed to pick up where the host is. */
function hostCatchUp(c, seat) {
  H.room.send(c, hostStartMsg(match, seat));
  if (phase === 'countdown' || phase === 'play') hostSendSnap(c, seat, true);
  else if (phase === 'between') H.room.send(c, { t: 'roundOver', team: H.lastTeam, wins: [...match.wins], history: match.history });
  else if (phase === 'ended') H.room.send(c, hostMatchOverMsg());
}

function hostSendSnap(c, seat, fresh) {
  const R = H.remote.get(seat);
  H.room.send(c, { t: 'snap', round: { no: match.roundNo, rseed: match.rseed, theme: arena.theme }, s: snapshotArena(arena), a: R ? R.ack : 0, fresh: !!fresh });
}

function hostRoundStarted() {
  for (const R of H.remote.values()) {
    R.queue.length = 0;
    R.starve = 0;
    R.q = 0;
    R.takeover = null; // the new round's bots were made fresh
  }
  H.room.broadcast({ t: 'round', no: match.roundNo, rseed: match.rseed, theme: arena.theme });
}

/** Each friend's next order goes onto their knight; a silent phone gets a stand-in bot. */
function hostApplyRemote() {
  for (const [seat, R] of H.remote) {
    if (R.left) continue;
    const p = arena.players[seat];
    if (R.queue.length > 6) {
      // Orders piled up behind a hiccup: skip ahead, keeping any keg drop.
      let bomb = false;
      while (R.queue.length > 3) {
        const x = R.queue.shift();
        if (x.c >= 25) bomb = true;
        R.ack = x.s;
      }
      if (bomb && R.queue[0].c < 25) R.queue[0].c += 25;
    }
    if (R.queue.length) {
      if (R.takeover) removeTakeover(seat);
      const x = R.queue.shift();
      applyInput(p, x.c);
      R.ack = x.s;
      R.starve = 0;
    } else {
      R.starve++;
      if (!R.takeover) {
        // A late order: keep going the same way for a moment, then stop.
        p.input.bomb = false;
        if (R.starve > 3) {
          p.input.dir = null;
          p.input.alt = null;
        }
        if (R.starve > TAKEOVER_TICKS && phase === 'play' && p.alive) addTakeover(seat);
      }
    }
    R.q = R.queue.length;
  }
}

function addTakeover(seat) {
  const R = H.remote.get(seat);
  if (!R || R.takeover || !arena) return;
  const b = new Bot(arena, seat, mp.difficulty, mulberry32(randomSeed()));
  R.takeover = b;
  match.bots.push(b);
}
function removeTakeover(seat) {
  const R = H.remote.get(seat);
  if (R) R.takeover = null;
  match.bots = match.bots.filter((b) => b.me !== seat);
}

function hostSendFrame(codes) {
  const k = arena.tick;
  const h = k % TICK_HZ === 0 ? hashArena(arena) : null;
  for (const R of H.remote.values()) {
    if (R.left) continue;
    const msg = { t: 'f', k, i: codes, a: R.ack, q: R.q };
    if (h != null) msg.h = h;
    H.room.send(R.cid, msg);
  }
}

function hostOfferSkip() {
  if (phase !== 'play' || !arena) return;
  const alive = arena.players.filter((p) => p.alive);
  const humans = alive.some((p) => match.players[p.index].kind === 'human');
  const teams = new Set(alive.map((p) => p.team));
  $('btn-skip').hidden = humans || teams.size < 2;
}

// ---------- joining ----------
function guestOpen(code) {
  endOnline(false);
  mode = 'guest';
  me = 0;
  G = {
    link: null,
    code,
    lobby: null,
    hostName: 'the host',
    state: 'connecting',
    why: '',
    pending: [], // orders sent but not yet applied by the host: { s, c }
    seq: 0,
    acc: 0,
    rate: 1,
    qEma: Q_TARGET,
    dirty: false,
    lastFrameAt: 0,
    hist: [], // the host's knight positions by tick, for smooth drawing
    playK: 0,
    off: { x: 0, y: 0 }, // eases your knight over small corrections
    seen: new Map(),
    resyncAt: 0,
    resyncs: 0,
    resyncWhy: {},
    ackAt: 0,
    note: '', // why you're back in the lobby, if you didn't choose to be
    stalled: false,
  };
  G.link = new GuestLink({
    onState: (s, why) => guestLinkState(s, why),
    onMessage: (m) => guestMessage(m),
  });
  G.link.open(code, myName, cid);
  tabStore.set('pk.session', { role: 'guest', code, at: Date.now() });
  showLobby();
}

const FAIL_TEXT = {
  nohost: (c) => `No game with code ${c} is open right now. Check the code on the host's phone.`,
  started: () => "That game has already started. Ask the host to go back to the lobby, then join again.",
  full: () => 'That game is full: 4 knights at most.',
  version: () => "The host's phone has a different version of the game. Reload the page on both phones.",
  webrtc: () => "This browser can't link phones. Try Safari on iPhone or Chrome on Android.",
  gone: () => 'The host has been gone too long. The game is over.',
  nopeer: () => "The networking code didn't load. Check your connection and reload the page.",
};

function guestLinkState(s, why) {
  if (!G) return;
  G.state = s;
  if (s === 'failed') {
    const text = (FAIL_TEXT[why] || (() => 'Could not join that game.'))(G.code);
    endOnline(false);
    goMenu();
    menuNote(text);
    return;
  }
  G.why = why;
  renderLobby();
}

function guestMessage(m) {
  if (!G) return;
  switch (m.t) {
    case 'welcome':
      if (typeof m.code === 'string') G.code = normCode(m.code) || G.code;
      break;
    case 'lobby':
      G.lobby = m;
      G.hostName = cleanName(m.host) || 'the host';
      if (phase !== 'lobby') {
        // Still in a match here, but the host isn't: its page restarted.
        if (running) G.note = "The host's phone restarted the game, so you're back in the lobby.";
        stopGame();
        showLobby();
      } else renderLobby();
      break;
    case 'start': guestStartMatch(m); break;
    case 'round': guestRound(m); break;
    case 'f': guestFrame(m); break;
    case 'snap': guestSnap(m); break;
    case 'roundOver': guestRoundOver(m); break;
    case 'matchOver': guestMatchOver(m); break;
    case 'seat':
      if (match && match.players[m.i]) {
        match.players[m.i].kind = m.kind === 'bot' ? 'bot' : 'human';
        labelChips();
      }
      break;
    case 'toLobby':
      if (phase !== 'lobby') {
        G.note = `${G.hostName === 'the host' ? 'The host' : G.hostName} went back to the lobby.`;
        stopGame();
        showLobby();
      }
      break;
    case 'end': {
      const host = G.hostName;
      endOnline(false);
      goMenu();
      menuNote(`${host === 'the host' ? 'The host' : host} closed the game.`, 'info');
      break;
    }
    case 'toast':
      if (running && typeof m.text === 'string') toast(m.text.slice(0, 160), m.cls === 'good' || m.cls === 'warn' ? m.cls : '', 3000);
      break;
    default: break;
  }
}

function guestLobbyView() {
  const L = G.lobby;
  const fmt = L && FORMATS[L.format] ? L.format : 'duel';
  const diff = L && DIFFICULTIES[L.difficulty] ? L.difficulty : 'normal';
  const P = FORMATS[fmt].players;
  const seats = [];
  if (L && Array.isArray(L.seats)) {
    const view = (s, i) => ({ i, kind: s.k === 'host' ? 'host' : 'guest', name: cleanName(s.n) || 'Friend', me: s.k === 'guest' && s.c === cid, online: !!s.on });
    for (let i = 0; i < P; i++) {
      const s = L.seats[i];
      seats.push(s ? view(s, i) : { i, kind: 'bot', name: `${DIFFICULTIES[diff].label} bot` });
    }
    for (let i = P; i < 4; i++) if (L.seats[i]) seats.push({ ...view(L.seats[i], i), outside: true });
  }
  const ping = G.link.rtt != null ? ` · ${Math.round(G.link.rtt)} ms` : '';
  const status = {
    connecting: [G.why === 'searching' ? `Looking for game ${G.code}…` : `Linking to game ${G.code}…`, ''],
    open: [L ? `Linked to ${G.hostName}'s phone${ping}` : 'Linked. Getting the lobby…', 'ok'],
    lost: ['Lost the link to the host. Reconnecting…', 'warn'],
  }[G.state] || ['', ''];
  return {
    role: 'guest',
    code: G.code,
    status: status[0],
    statusCls: status[1],
    format: fmt,
    difficulty: diff,
    target: L && WIN_TARGETS.includes(L.target) ? L.target : 3,
    editable: false,
    seats,
    selected: -1,
    hint: '',
    startEnabled: false,
    startNote: '',
    waitText: L ? `Waiting for ${G.hostName} to start the match…` : '',
    error: '',
    note: G.note || '',
  };
}

function guestStartMatch(m) {
  const f = FORMATS[m.format];
  if (!f || !Array.isArray(m.players) || m.players.length !== f.players) return;
  if (!Number.isInteger(m.seat) || m.seat < 0 || m.seat >= f.players) return;
  const players = m.players.map((p, i) => ({ name: cleanName(p && p.n) || botName(f, i), kind: p && p.k === 'bot' ? 'bot' : 'human', team: f.teams[i] }));
  const teams = [...new Set(f.teams)];
  const wins = new Map(teams.map((t) => [t, 0]));
  if (Array.isArray(m.wins)) for (const w of m.wins) if (Array.isArray(w) && wins.has(w[0])) wins.set(w[0], w[1] | 0);
  const mirror = {
    format: f,
    target: WIN_TARGETS.includes(m.target) ? m.target : 3,
    players,
    wins,
    roundNo: m.roundNo | 0,
    history: Array.isArray(m.history) ? m.history.slice(0, 20) : [],
    over: false,
    winner: null,
    totals: null,
  };
  clearInterval(lobbyTimer);
  lobbyTimer = 0;
  if (typeof m.host === 'string') G.hostName = cleanName(m.host) || G.hostName;
  G.note = '';
  G.pending = [];
  G.seen.clear();
  beginMatch(mirror, 'guest', m.seat);
}

function guestRound(m) {
  if (!match || mode !== 'guest' || !m) return;
  match.roundNo = m.no | 0;
  const layout = generateArena(match.format, m.rseed >>> 0);
  arena = new Arena({ layout, players: match.players });
  arena.theme = THEME_IDS.includes(m.theme) ? m.theme : 'castle';
  G.pending = [];
  G.acc = 0;
  G.hist = [];
  G.playK = 0;
  G.seen.clear();
  G.off = { x: 0, y: 0 };
  G.lastFrameAt = performance.now();
  G.ackAt = G.lastFrameAt;
  G.stalled = false;
  recordHist();
  fore = forecastFrom(arena, me);
  G.dirty = false;
  $('end').hidden = true;
  beginRoundView();
}

/** One tick of the host's courtyard: replay everyone's orders, exactly as the host applied them. */
function guestFrame(m) {
  if (!match || !Number.isInteger(m.k)) return;
  if (!arena) {
    // The round's start never arrived (it can't on a working link, but recover anyway).
    requestResync('noround');
    return;
  }
  if (m.k !== arena.tick + 1) {
    if (m.k > arena.tick + 1) requestResync('gap');
    return;
  }
  const codes = Array.isArray(m.i) ? m.i : [];
  for (let i = 0; i < arena.players.length; i++) applyInput(arena.players[i], codes[i]);
  arena.step();
  recordHist();
  const now = performance.now();
  handleEvents(arena.events, arena, now, 'conf');
  arena.events.length = 0;
  const a = m.a | 0;
  if (G.pending.length && G.pending[0].s <= a) G.ackAt = now;
  while (G.pending.length && G.pending[0].s <= a) G.pending.shift();
  if (typeof m.q === 'number') {
    // Keep about one order waiting at the host: send a little faster or slower to hold it there.
    G.qEma += (m.q - G.qEma) * 0.05;
    G.rate = 1 - clamp((G.qEma - Q_TARGET) * 0.025, -0.05, 0.05);
  }
  if (m.h != null && hashArena(arena) !== m.h) requestResync('hash');
  G.dirty = true;
  G.lastFrameAt = now;
}

function requestResync(why) {
  const now = performance.now();
  if (now - G.resyncAt < 1500) return;
  G.resyncAt = now;
  G.resyncs++;
  G.resyncWhy[why] = (G.resyncWhy[why] || 0) + 1;
  G.link.send({ t: 'resync' });
}

function guestSnap(m) {
  if (!match || !m || !m.round) return;
  if (!arena || match.roundNo !== (m.round.no | 0)) guestRound(m.round);
  if (!restoreArena(arena, m.s)) return;
  if (m.fresh) G.pending = [];
  else {
    const a = m.a | 0;
    G.pending = G.pending.filter((x) => x.s > a);
  }
  G.hist = [];
  recordHist();
  G.playK = arena.tick;
  G.dirty = true;
  G.lastFrameAt = performance.now();
  G.ackAt = G.lastFrameAt;
  for (const p of arena.players) if (chipEls[p.index]) chipEls[p.index].classList.toggle('out', !p.alive);
  if (arena.tick >= arena.startTick && !arena.over) {
    if (phase !== 'play') {
      phase = 'play';
      hideBanner();
      G.seen.set('go', performance.now());
      you = { until: performance.now() + 2400 };
    }
    controls.enabled = arena.players[me].alive;
  }
}

function guestApplyWins(m) {
  if (Array.isArray(m.wins)) for (const w of m.wins) if (Array.isArray(w) && match.wins.has(w[0])) match.wins.set(w[0], w[1] | 0);
  if (Array.isArray(m.history)) match.history = m.history.slice(0, 20);
}

function guestRoundOver(m) {
  if (!match) return;
  guestApplyWins(m);
  const team = Number.isInteger(m.team) ? m.team : null;
  showRoundResult(team);
}

function guestMatchOver(m) {
  if (!match) return;
  guestApplyWins(m);
  match.over = true;
  match.winner = Number.isInteger(m.winner) ? m.winner : null;
  match.totals = Array.isArray(m.totals) && m.totals.length === match.players.length ? m.totals : null;
  if (Number.isInteger(m.roundNo) && m.roundNo > 0) match.roundNo = m.roundNo;
  showEnd();
}

function recordHist() {
  G.hist.push({ k: arena.tick, p: arena.players.map((p) => [p.x, p.y, p.face.x, p.face.y, p.moving ? 1 : 0, p.walk]) });
  if (G.hist.length > 30) G.hist.shift();
}

/** The host's courtyard moved on: rebuild the forecast from it plus your orders still on the way. */
function rebuildForecast() {
  G.dirty = false;
  if (!arena) return;
  const old = fore ? fore.players[me] : null;
  const ox = old ? old.x : 0;
  const oy = old ? old.y : 0;
  fore = forecastFrom(arena, me);
  for (const x of G.pending) stepForecast(fore, x.c);
  fore.events.length = 0; // already seen when they were first forecast
  const now = fore.players[me];
  if (old && now.alive) {
    const dx = ox - now.x;
    const dy = oy - now.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > 1e-6 && d < 1.5) {
      G.off.x += dx;
      G.off.y += dy;
    }
  }
}

/** One tick of your own: read the stick, send the order, move the forecast on. */
function guestTick(now) {
  if (!fore || arena.over) return;
  if (G.pending.length >= MAX_AHEAD || !G.link.ready) {
    G.stalled = true;
    // The host is running but has applied none of these for a while: they're lost, start afresh.
    if (G.pending.length && now - G.ackAt > 2500 && now - G.lastFrameAt < 500) {
      G.pending = [];
      G.dirty = true;
    }
    return;
  }
  G.stalled = false;
  const mine = fore.players[me];
  let code = 0;
  if (phase === 'play' && mine.alive && !fore.meHit) {
    const r = controls.read();
    code = encodeInput({ dir: r.dir, alt: r.alt, bomb: controls.takeKeg() });
    if (r.dir && !coached.moved) { coached.moved = true; saveCoach(); }
  } else {
    controls.takeKeg();
  }
  G.seq++;
  G.pending.push({ s: G.seq, c: code });
  G.link.send({ t: 'in', s: G.seq, c: code });
  stepForecast(fore, code);
  if (phase === 'countdown') countdown(fore);
  handleEvents(fore.events, fore, now, 'fore');
  fore.events.length = 0;
}

function guestLoop(now, dt) {
  if (!arena || !fore) return;
  if (G.dirty) rebuildForecast();
  if (phase === 'countdown' || phase === 'play') {
    G.acc += dt * G.rate;
    let steps = 0;
    while (G.acc >= DT && steps < 8) {
      guestTick(now);
      G.acc -= DT;
      steps++;
    }
    if (steps >= 8) G.acc = 0;
  }
  // Other knights are drawn a tick behind the host's latest, so they glide between updates.
  const latest = arena.tick;
  const target = latest - 1;
  if (G.playK < target - 6 || G.playK > latest) G.playK = Math.max(0, target);
  else G.playK = Math.min(latest, G.playK + dt * TICK_HZ * (1 + clamp((target - G.playK) * 0.12, -0.25, 0.5)));
  const ease = Math.exp(-dt / 0.1);
  G.off.x *= ease;
  G.off.y *= ease;
  if (Math.abs(G.off.x) + Math.abs(G.off.y) < 1e-3) G.off.x = G.off.y = 0;
  const live = phase === 'countdown' || phase === 'play';
  renderer.draw(guestView(live ? Math.min(1, G.acc / DT) : 1), { me, alpha: 1, you, allyTag: allyTag() }, now);
  guestNetNote(now);
}

function knightAt(i) {
  const hist = G.hist;
  if (!hist.length) return null;
  const k = G.playK;
  let a = hist[0];
  let b = null;
  for (let j = hist.length - 1; j >= 0; j--) {
    if (hist[j].k <= k) {
      a = hist[j];
      b = hist[j + 1] || null;
      break;
    }
  }
  const pa = a.p[i];
  if (!b) return { x: pa[0], y: pa[1], fx: pa[2], fy: pa[3], moving: !!pa[4], walk: pa[5] };
  const pb = b.p[i];
  const t = clamp((k - a.k) / (b.k - a.k), 0, 1);
  return { x: pa[0] + (pb[0] - pa[0]) * t, y: pa[1] + (pb[1] - pa[1]) * t, fx: pb[2], fy: pb[3], moving: !!pb[4], walk: pa[5] + (pb[5] - pa[5]) * t };
}

/** What a guest draws: the forecast courtyard, your knight from it, everyone else from the host. */
function guestView(alpha) {
  const v = Object.create(fore);
  v.players = fore.players.map((p) => {
    const d = { ...p };
    const conf = arena.players[p.index];
    d.alive = conf.alive;
    if (p.index === me) {
      d.x = p.px + (p.x - p.px) * alpha + G.off.x;
      d.y = p.py + (p.y - p.py) * alpha + G.off.y;
    } else {
      const h = knightAt(p.index);
      d.x = h ? h.x : conf.x;
      d.y = h ? h.y : conf.y;
      d.face = h ? { x: h.fx, y: h.fy } : conf.face;
      d.moving = h ? h.moving : conf.moving;
      d.walk = h ? h.walk : conf.walk;
    }
    d.px = d.x;
    d.py = d.y;
    return d;
  });
  return v;
}

function guestNetNote(now) {
  let text = '';
  if (G.link.state === 'lost' || G.link.state === 'connecting') text = 'Lost the link to the host. Reconnecting…';
  else if ((phase === 'countdown' || phase === 'play') && now - G.lastFrameAt > 1500) text = `Waiting for ${G.hostName}'s phone…`;
  const el = $('net-note');
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !text;
}

// ---------- boot ----------
buildMeters();
fillLegend();
initMenu();
let saved = tabStore.get('pk.session');
// A new invite opened in this tab wins over the game the tab was in before.
if (saved && invitedCode.length === 4 && saved.code !== invitedCode) saved = null;
if (saved && typeof saved.code === 'string' && /^[A-Z]{4}$/.test(saved.code) && Date.now() - (saved.at || 0) < SESSION_MAX_MS) {
  // This tab was in a game with friends before a reload: go straight back to it.
  if (saved.role === 'host') hostOpen(saved.code);
  else if (saved.role === 'guest') guestOpen(saved.code);
  else show('menu');
} else {
  show('menu');
}

// Handle for automated checks in a browser; does nothing on its own.
window.__pk = {
  get match() { return match; },
  get arena() { return arena; },
  get fore() { return fore; },
  get phase() { return phase; },
  get mode() { return mode; },
  get me() { return me; },
  get side() { return side; },
  get host() { return H; },
  get guest() { return G; },
  /** Where a guest draws each knight right now. */
  drawn: () => (mode === 'guest' && fore ? guestView(1).players.map((p) => [p.x, p.y, p.alive]) : null),
  renderer,
  controls,
};
