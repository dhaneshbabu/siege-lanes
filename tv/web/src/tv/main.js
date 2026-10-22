// Powder Keg on the TV: the courtyard on the big screen, phones as controllers.
// The TV runs the whole game. Each phone sends its stick and Keg presses through the app's
// built-in server; bots take the empty seats. With no phones, the remote plays a practice match.
// The rules, bots, drawing and sound are the web version's own (../arena/src).
import { DT, TICK_HZ, FORMATS, DIFFICULTIES, WIN_TARGETS, MAX_KEGS, MAX_RANGE, MAX_SPEED_LV, SIZE, SIDES, TEAM_SIDES, sidesFor } from '../../../../arena/src/config.js';
import { createMatch, botName } from '../../../../arena/src/game.js';
import { Bot } from '../../../../arena/src/bot.js';
import { mulberry32, randomSeed } from '../../../../arena/src/rng.js';
import { ArenaRenderer, SpriteKit, drawMenuScene, THEMES } from '../../../../arena/src/render.js';
import { Sfx } from '../../../../arena/src/audio.js';
import qrcode from 'qrcode-generator';
import { connectHost } from './net.js';

const $ = (s) => document.querySelector(s);
const MAX_PHONES = 4;
const FORMAT_ORDER = ['duel', 'teams', 'three', 'four'];
const DIFF_ORDER = ['easy', 'normal', 'hard'];
// Directions as the phones send them: 0 none, 1 left, 2 right, 3 up, 4 down.
const DIRS = [null, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

// ---------- settings ----------
// Graphics levels: the courtyard's render height. Auto picks the sharpest that holds 60 fps.
const QUALITY = {
  auto: { label: 'Auto', dynamic: true, desc: 'Renders between 540p and 1080p and adjusts every second to stay smooth.' },
  low: { label: 'Low', h: 540, desc: '540p. The smoothest on a slow TV.' },
  medium: { label: 'Medium', h: 720, desc: '720p.' },
  high: { label: 'High', h: 1080, desc: 'Full 1080p, if the TV keeps up.' },
};
const QUALITY_ORDER = ['auto', 'low', 'medium', 'high'];
const LEVELS = [540, 630, 720, 810, 900, 1080];

function loadSettings() { try { return JSON.parse(localStorage.getItem('powderkeg.settings') || '{}'); } catch { return {}; } }
function saveSettings() { try { localStorage.setItem('powderkeg.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ } }
const settings = Object.assign({ format: 'duel', difficulty: 'normal', target: 3, quality: 'auto', sound: true, fps: true }, loadSettings());
if (!FORMATS[settings.format]) settings.format = 'duel';
if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = 'normal';
if (!WIN_TARGETS.includes(settings.target)) settings.target = 3;
if (!QUALITY[settings.quality]) settings.quality = 'auto';
const params = new URLSearchParams(location.search);
if (QUALITY[params.get('quality')]) settings.quality = params.get('quality');

// ---------- stage, renderer, sound ----------
const stage = $('#stage');
const court = $('#court');
// Pictures of knights, kegs and labels are drawn once at 1080p sharpness and stamped from then on:
// a TV's graphics chip copies pictures quickly but is slow at drawing curves and outlines.
const kit = new SpriteKit(2);
const renderer = new ArenaRenderer(court, { kit });
const sfx = new Sfx();
sfx.on = settings.sound;
sfx.prime();

function fitStage() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  layoutCourt();
}
addEventListener('resize', fitStage);

const dyn = { level: 2, frames: 0, lastEval: performance.now(), holdUntil: 0, good: 0 };
const renderHeight = () => (QUALITY[settings.quality].dynamic ? LEVELS[dyn.level] : QUALITY[settings.quality].h);
function layoutCourt() {
  if (!arena) return;
  const rect = court.getBoundingClientRect();
  if (rect.height < 2) return;
  // The court spans the stage's full height, so its backing store is the render height tall.
  renderer.pixelRatio = renderHeight() / rect.height;
  renderer.textScale = rect.height / 320;
  renderer.layout(arena);
}
function holdDyn(ms = 2000) { dyn.holdUntil = performance.now() + ms; dyn.frames = 0; dyn.lastEval = performance.now(); dyn.good = 0; }
/** Auto: a step down when the frame rate sags, a step up after a few good seconds. */
function dynTick(now) {
  dyn.frames++;
  if (!QUALITY[settings.quality].dynamic || now < dyn.holdUntil || now - dyn.lastEval < 1000) return;
  const fps = (dyn.frames * 1000) / (now - dyn.lastEval);
  dyn.frames = 0;
  dyn.lastEval = now;
  if (!running()) return;
  if (fps < 52 && dyn.level > 0) {
    dyn.level--;
    dyn.good = 0;
    layoutCourt();
    holdDyn(1500);
  } else if (fps >= 58.5) {
    if (++dyn.good >= 3 && dyn.level < LEVELS.length - 1) {
      dyn.level++;
      dyn.good = 0;
      layoutCourt();
      holdDyn(1500);
    }
  } else dyn.good = 0;
}
function applyQuality() { layoutCourt(); holdDyn(); }

// ---------- state ----------
let phase = 'lobby'; // lobby | countdown | play | between | results
let paused = false;
let mode = 'phones'; // phones | remote (practice with the TV remote)
let match = null;
let arena = null;
let speed = 1;
let acc = 0;
let lastFrame = performance.now();
let you = null; // name tags over the knights as a round starts
let lastCount = null;
let betweenLeft = 0;
let autoStart = null; // seconds left before the match starts by itself (every phone is ready)
let lastMode = 'phones';
const players = []; // phones: { id, seat, name, ready, connected, closedAt, input, k, kegQueued, lastIn, bot }
const pending = new Map(); // phones that arrived mid-match: id -> hello
const keys = { list: [], keg: false }; // the TV remote in practice
const running = () => phase === 'countdown' || phase === 'play' || phase === 'between';
const fmt = () => FORMATS[settings.format];
const seatsOf = (f) => f.players;

// ---------- phones ----------
const net = connectHost({
  onMessage: (from, msg) => onMessage(from, msg),
  onStatus: (ok) => { $('#conn').hidden = ok; if (ok) broadcastStates(); },
});
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
const byId = (id) => players.find((p) => p.id === id);
const atSeat = (i) => players.find((p) => p.seat === i);

function onMessage(from, msg) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(from)) return;
  switch (msg.t) {
    case 'hello': handleHello(from, msg); break;
    case 'set': handleSet(from, msg); break;
    case 'in': handleInput(from, msg); break;
    case 'again': handleAgain(from); break;
    case 'close': handleClose(from); break;
    default: break;
  }
}

function freeSeat() {
  const P = seatsOf(fmt());
  for (let i = 0; i < P; i++) if (!atSeat(i)) return i;
  for (let i = P; i < 4; i++) if (!atSeat(i)) return i;
  return -1;
}

/** More phones than the match has seats: move up to a bigger match, and pack everyone in. */
function fitFormat() {
  const n = players.length;
  if (seatsOf(fmt()) < n) {
    settings.format = n <= 3 && settings.format === 'duel' ? 'three' : 'four';
    if (settings.format === 'three' && n > 3) settings.format = 'four';
    saveSettings();
  }
  const P = seatsOf(fmt());
  for (const p of players) {
    if (p.seat < P) continue;
    for (let i = 0; i < P; i++) if (!atSeat(i)) { p.seat = i; break; }
  }
}

function handleHello(id, msg) {
  const name = cleanName(msg.name);
  const k = Number.isInteger(msg.k) ? msg.k : 0;
  let p = byId(id);
  if (p) {
    p.connected = true;
    p.closedAt = 0;
    p.lastIn = performance.now();
    p.k = k;
    p.kegQueued = false;
    if (name) p.name = name;
    dropTakeover(p);
    sendState(p);
    refreshLobby();
    return;
  }
  if (phase === 'lobby' || phase === 'results') {
    if (players.length >= MAX_PHONES) { net.send(id, { t: 'state', phase, full: true }); return; }
    p = { id, seat: -1, name: name || `Knight ${players.length + 1}`, ready: false, connected: true, closedAt: 0, input: { d: 0, a: 0 }, k, kegQueued: false, lastIn: performance.now(), bot: null };
    players.push(p);
    p.seat = freeSeat();
    fitFormat();
    autoStart = null;
    sfx.play('tick');
    broadcastStates();
    refreshLobby();
  } else {
    pending.set(id, { name, k });
    net.send(id, { t: 'state', phase: paused ? 'paused' : phase, waiting: true });
  }
}

function handleSet(id, msg) {
  const p = byId(id);
  if (!p) return;
  if (typeof msg.name === 'string' && cleanName(msg.name)) p.name = cleanName(msg.name);
  if (phase === 'lobby') {
    if (typeof msg.ready === 'boolean') p.ready = msg.ready;
    if ((msg.side === 0 || msg.side === 1) && settings.format === 'teams') {
      // 2 v 2: seats 0 and 1 are the blue side, 2 and 3 the red side.
      const want = msg.side === 0 ? [0, 1] : [2, 3];
      if (!want.includes(p.seat)) {
        const free = want.find((s) => !atSeat(s));
        if (free != null) p.seat = free;
      }
    }
    checkAutoStart();
  }
  broadcastStates();
  refreshLobby();
}

function handleInput(id, msg) {
  const p = byId(id);
  if (!p) return;
  p.lastIn = performance.now();
  p.input.d = Number.isInteger(msg.d) && msg.d >= 0 && msg.d <= 4 ? msg.d : 0;
  p.input.a = Number.isInteger(msg.a) && msg.a >= 0 && msg.a <= 4 ? msg.a : 0;
  if (Number.isInteger(msg.k) && msg.k !== p.k) {
    p.k = msg.k;
    p.kegQueued = true;
  }
  if (p.bot && p.connected) dropTakeover(p); // the phone is back in hand
}

function handleAgain(id) {
  const p = byId(id);
  if (!p || phase !== 'results') return;
  p.ready = true;
  const active = players.filter((q) => q.connected);
  if (active.length && active.every((q) => q.ready)) startMatch(false);
  else { broadcastStates(); refreshResultsStatus(); }
}

function handleClose(id) {
  pending.delete(id);
  const p = byId(id);
  if (!p) return;
  p.connected = false;
  p.closedAt = performance.now();
  p.ready = false;
  if (running() && match && p.seat < match.players.length) takeover(p);
  checkAutoStart();
  refreshLobby();
}

function promotePending() {
  for (const [id, info] of [...pending]) {
    pending.delete(id);
    handleHello(id, info);
  }
}

/** A bot plays for a phone that's gone (or gone quiet) until it's back. */
function takeover(p) {
  if (!arena || p.bot || !match || match.players[p.seat].kind !== 'human') return;
  if (!arena.players[p.seat].alive) return;
  p.bot = new Bot(arena, p.seat, settings.difficulty, mulberry32(randomSeed()));
  match.bots.push(p.bot);
  refreshCards(true);
}
function dropTakeover(p) {
  if (!p.bot) return;
  if (match) match.bots = match.bots.filter((b) => b !== p.bot);
  p.bot = null;
  if (arena && arena.players[p.seat]) {
    const k = arena.players[p.seat].input;
    k.dir = null;
    k.alt = null;
    k.bomb = false;
  }
  refreshCards(true);
}

function seatColor(seat) {
  const list = sidesFor(match ? match.format : fmt());
  return list[Math.max(0, Math.min(3, seat))];
}

function phoneMsg(p) {
  // What the phone shows over its controls.
  if (paused) return 'Paused on the TV';
  if (phase === 'countdown') return lastCount ? String(lastCount) : 'Get ready';
  if (phase === 'between') return $('#banner-main').textContent || 'Round over';
  if (phase === 'play' && arena && !arena.players[p.seat].alive) return "You're out. Watch the TV";
  return '';
}

function sendState(p) {
  if (!p.connected) return;
  const f = match ? match.format : fmt();
  const side = seatColor(p.seat);
  const st = {
    t: 'state',
    phase: paused ? 'paused' : phase,
    you: { seat: p.seat, name: p.name, ready: p.ready, color: side.color, colorName: side.plain, side: f.teams[p.seat] != null ? f.teams[p.seat] : p.seat },
    format: f.label,
    teams: f.id === 'teams',
    msg: phoneMsg(p),
  };
  if (f.id === 'teams' && phase === 'lobby') st.sideFree = [[0, 1].some((s) => !atSeat(s) || s === p.seat), [2, 3].some((s) => !atSeat(s) || s === p.seat)];
  if (phase === 'lobby') st.outside = p.seat >= seatsOf(f);
  if (phase === 'results' && match) {
    const won = match.players[p.seat] && match.players[p.seat].team === match.winner;
    const t = match.totals[p.seat] || {};
    st.result = { won, rounds: match.wins.get(match.players[p.seat].team), target: match.target, kills: t.kills | 0, title: $('#results-title').textContent };
  }
  net.send(p.id, st);
}
function broadcastStates() { for (const p of players) sendState(p); }

let hudAt = 0;
/** A few times a second: each phone's kegs, blast reach and speed for its own display. */
function sendHuds(now) {
  if (now - hudAt < 250 || !arena || phase !== 'play') return;
  hudAt = now;
  for (const p of players) {
    if (!p.connected || p.seat >= arena.players.length) continue;
    const k = arena.players[p.seat];
    const hud = { t: 'hud', alive: k.alive, ready: k.alive ? k.kegs - k.active : 0, kegs: k.kegs, range: k.range, speed: k.speedLv, auto: !!p.bot };
    const key = JSON.stringify(hud);
    if (key === p.hudKey && now - (p.hudAt || 0) < 2000) continue;
    p.hudKey = key;
    p.hudAt = now;
    net.send(p.id, hud);
  }
}
function buzz(seat, ms) {
  const p = atSeat(seat);
  if (p && p.connected && mode === 'phones') net.send(p.id, { t: 'buzz', ms });
}

function checkAutoStart() {
  const active = players.filter((p) => p.connected);
  const ok = active.length > 0 && active.every((p) => p.ready) && active.length <= seatsOf(fmt());
  if (phase === 'lobby' && ok) { if (autoStart == null) autoStart = 3; }
  else autoStart = null;
  refreshLobbyStatus();
}

// ---------- matches and rounds ----------
function startMatch(remote) {
  const f = fmt();
  if (!remote && !players.some((p) => p.connected)) remote = true;
  if (!remote && players.filter((p) => p.connected).length > f.players) return;
  mode = remote ? 'remote' : 'phones';
  lastMode = mode;
  const sides = [];
  for (let i = 0; i < f.players; i++) {
    const p = remote ? null : atSeat(i);
    if (remote && i === 0) sides.push({ kind: 'human', name: 'You' });
    else if (p) sides.push({ kind: 'human', name: p.name });
    else sides.push({ kind: 'bot', name: botName(f, i), difficulty: settings.difficulty });
  }
  match = createMatch({ format: f.id, difficulty: settings.difficulty, target: settings.target, sides });
  renderer.setSides(sidesFor(f));
  for (const p of players) { p.ready = false; p.bot = null; p.kegQueued = false; }
  keys.list = [];
  keys.keg = false;
  autoStart = null;
  paused = false;
  showScreen(null);
  $('#match').hidden = false;
  buildCards();
  $('#info-main').textContent = f.label;
  $('#info-sub').textContent = `First to ${match.target} round wins`;
  startRound();
}

function startRound() {
  for (const p of players) p.bot = null; // the new round's bots are made fresh
  arena = match.newRound();
  phase = 'countdown';
  speed = 1;
  acc = 0;
  you = null;
  lastCount = null;
  renderer.reset();
  layoutCourt();
  const warm = renderer.prewarm(arena);
  if (warm > 30) console.log(`pk-prewarm ${Math.round(warm)} ms, ${kit.map.size} pictures`);
  holdDyn(2500);
  placeCards();
  refreshCards(true);
  for (const p of players) if (!p.connected && mode === 'phones' && p.seat < match.players.length) takeover(p);
  const th = THEMES[arena.theme];
  setBanner(`Round ${match.roundNo}${th ? ' · ' + th.name : ''}`, '', scoreLine(), true);
  $('#banner-tip').textContent = mode === 'remote' && match.roundNo === 1
    ? 'You are the blue knight, bottom left. ◀ ▶ ▲ ▼ to run, OK to drop a keg.'
    : TIPS[(match.roundNo - 1) % TIPS.length];
  broadcastStates();
}

const TIPS = [
  'Crates hide power-ups: glowing coins. Walk over one to grab it.',
  'Cells glowing red are about to be blasted. Get out of the red!',
  '+1 Keg lets you have more kegs down at once. Bigger blast makes your red cross longer.',
  'Drop a keg, then duck round a corner: blasts only travel in straight lines.',
  'A blast that reaches another keg sets it off at once. Chain them!',
  'Speed up makes you run faster. Handy for getting clear of your own kegs.',
];

function nameOf(i) { return match.players[i].name; }
function sideName(team) { return team === 0 ? 'Blue side' : 'Red side'; }
function scoreLine() {
  if (!match.history.length) return `First to ${match.target} round wins`;
  if (match.format.id === 'teams') return `Blue side ${match.wins.get(0)} · Red side ${match.wins.get(1)}`;
  return match.players.map((p, i) => `${nameOf(i)} ${match.wins.get(p.team)}`).join(' · ');
}

function tick(now) {
  const remote = mode === 'remote';
  for (let i = 0; i < arena.players.length; i++) {
    if (match.players[i].kind !== 'human') continue;
    const k = arena.players[i];
    if (remote) {
      if (i !== 0) continue;
      if (phase === 'play' && k.alive) {
        const l = keys.list;
        k.input.dir = l.length ? DIRS[l[l.length - 1]] : null;
        let alt = null;
        for (let j = l.length - 2; j >= 0; j--) if ((l[j] <= 2) !== (l[l.length - 1] <= 2)) { alt = DIRS[l[j]]; break; }
        k.input.alt = alt;
        if (keys.keg) k.input.bomb = true;
      }
      keys.keg = false;
      continue;
    }
    const p = atSeat(i);
    if (!p || p.bot) continue;
    if (phase === 'play' && k.alive) {
      k.input.dir = DIRS[p.input.d];
      k.input.alt = DIRS[p.input.a];
      if (p.kegQueued) k.input.bomb = true;
      // A phone that's connected but has gone quiet (its screen locked, say): a bot plays for now.
      if (now - p.lastIn > 1500) takeover(p);
    }
    p.kegQueued = false;
  }
  for (const b of match.bots) b.update();
  arena.step();
  if (phase === 'countdown') countdown();
  handleEvents(arena.events, now);
  arena.events.length = 0;
  if (arena.over && phase === 'play') roundOver();
}

function countdown() {
  const left = (arena.startTick - arena.tick) / TICK_HZ;
  const n = Math.ceil(left / 0.8);
  if (n > 0 && n <= 3 && n !== lastCount) {
    lastCount = n;
    const th = THEMES[arena.theme];
    setBanner(`Round ${match.roundNo}${th ? ' · ' + th.name : ''}`, String(n), scoreLine(), true);
    sfx.play('tick');
    broadcastStates();
  }
}

const humanSeats = () => match.players.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);

function handleEvents(evs, now) {
  if (!evs.length) return;
  renderer.addEvents(evs, arena, now);
  for (const e of evs) {
    switch (e.t) {
      case 'go':
        phase = 'play';
        for (const p of players) p.lastIn = Math.max(p.lastIn, performance.now()); // silence counts from now
        $('#banner-tip').textContent = '';
        setBanner('', 'Go!', '', false);
        setTimeout(() => { if (phase === 'play') hideBanner(); }, 700);
        sfx.play('go');
        you = { until: now + 2800 };
        broadcastStates();
        break;
      case 'keg':
        sfx.play('keg');
        break;
      case 'blast': {
        sfx.play('blast');
        const x = e.cell % arena.n;
        const y = Math.floor(e.cell / arena.n);
        for (const i of humanSeats()) {
          const k = arena.players[i];
          if (k.alive && Math.abs(k.x - x) + Math.abs(k.y - y) <= 3) buzz(i, 30);
        }
        break;
      }
      case 'crate':
        sfx.play('crate');
        break;
      case 'power':
        sfx.play('power');
        buzz(e.player, 40);
        flashCard(e.player, 'up');
        break;
      case 'death': onDeath(e); break;
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
  const v = nameOf(e.player);
  const text = e.by === e.player ? `${v} got caught in their own blast` : e.by === -1 ? `${v} was crushed by falling stone` : `${nameOf(e.by)} blew up ${v}`;
  const human = match.players[e.player].kind === 'human';
  toast(text, human ? 'bad' : '', 2600);
  sfx.play(human ? 'death' : 'rivalDown');
  buzz(e.player, 300);
  refreshCards(true);
  const p = atSeat(e.player);
  if (p && mode === 'phones') sendState(p);
  // Every human out but the bots still fighting: let them finish quickly.
  const alive = arena.players.filter((k) => k.alive);
  const teams = new Set(alive.map((k) => k.team));
  if (teams.size > 1 && !alive.some((k) => match.players[k.index].kind === 'human') && speed === 1) {
    speed = 3;
    toast('Only bots are left: finishing the round at 3× speed.', '', 3000);
  }
}

function roundOver() {
  const team = match.endRound();
  phase = 'between';
  betweenLeft = 2.8;
  let main;
  let cls = '';
  if (team == null) main = 'Draw';
  else if (match.format.id === 'teams') main = `${sideName(team)} wins`;
  else main = `${nameOf(match.players.findIndex((p) => p.team === team))} wins`;
  if (team != null && match.players.some((p) => p.team === team && p.kind === 'human')) cls = 'win';
  const th = THEMES[arena.theme];
  setBanner(`Round ${match.roundNo}${th ? ' · ' + th.name : ''}`, main, scoreLine(), true, cls);
  $('#banner-tip').textContent = '';
  sfx.play(cls ? 'roundWin' : 'roundLose');
  match.players.forEach((p, i) => { if (team != null && p.team === team) flashCard(i, 'won'); });
  refreshCards(true);
  broadcastStates();
}

function afterRound() {
  if (match.over) showResults();
  else startRound();
}

function showResults() {
  phase = 'results';
  paused = false;
  hideBanner();
  const f = match.format;
  const wIdx = match.players.findIndex((p) => p.team === match.winner);
  const title = f.id === 'teams' ? `${sideName(match.winner)} wins` : `${nameOf(wIdx)} wins`;
  const humanWin = match.players.some((p) => p.team === match.winner && p.kind === 'human');
  $('#results-kicker').textContent = `${f.label} · first to ${match.target}`;
  const t = $('#results-title');
  t.textContent = title;
  t.className = humanWin ? 'win' : '';
  const rows = match.players.map((p, i) => ({ i, p, wins: match.wins.get(p.team), tt: match.totals[i] }));
  rows.sort((a, b) => b.wins - a.wins || b.tt.kills - a.tt.kills);
  const tbl = $('#results-table');
  tbl.innerHTML = '<div class="tr head"><span>Knight</span><span class="r">Rounds</span><span class="r">Knocked out</span><span class="r">Kegs</span></div>';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = `tr${r.p.team === match.winner ? ' won' : ''}`;
    row.innerHTML = `<span class="who"><svg class="shield" viewBox="0 0 24 28"><use href="#i-shield"/></svg><span class="n"></span>${r.p.kind === 'bot' ? '<span class="bot">Bot</span>' : ''}</span><span class="r"></span><span class="r"></span><span class="r"></span>`;
    row.querySelector('.shield').style.fill = seatColor(r.i).color;
    row.querySelector('.n').textContent = r.p.name;
    const cells = row.querySelectorAll('.r');
    cells[0].textContent = String(r.wins);
    cells[1].textContent = String(r.tt.kills);
    cells[2].textContent = String(r.tt.kegs);
    tbl.appendChild(row);
  }
  sfx.play(humanWin ? 'win' : 'lose');
  menus.results.index = 0;
  for (const p of players) p.ready = false;
  showScreen('results');
  refreshResultsStatus();
  promotePending();
  broadcastStates();
}

function refreshResultsStatus() {
  const active = players.filter((p) => p.connected);
  const ready = active.filter((p) => p.ready).length;
  $('#results-status').textContent = lastMode === 'remote' || !active.length ? '' : ready ? `${ready} of ${active.length} phones want to play again` : 'Phones can also tap Play again.';
}

function toLobby() {
  phase = 'lobby';
  paused = false;
  match = null;
  arena = null;
  autoStart = null;
  $('#match').hidden = true;
  hideBanner();
  $('#toasts').textContent = '';
  for (const p of players) { p.ready = false; p.bot = null; }
  // Phones that left during the match give up their seats now.
  for (let i = players.length - 1; i >= 0; i--) if (!players[i].connected) players.splice(i, 1);
  promotePending();
  fitFormat();
  menus.lobby.index = 0;
  showScreen('lobby');
  broadcastStates();
  refreshLobby();
}

function setPaused(on) {
  if (!running()) return;
  paused = on;
  if (on) {
    menus.pause.index = 0;
    keys.list = [];
  }
  showScreen(on ? 'pause' : null);
  broadcastStates();
}

// ---------- match screen: cards, clock, banner, toasts ----------
function buildCards() {
  for (let i = 0; i < 4; i++) {
    const el = $(`#card${i}`);
    el.hidden = i >= match.players.length;
    if (el.hidden) continue;
    const meter = (cls, n) => `<span class="meter ${cls}">${'<i></i>'.repeat(n)}</span>`;
    el.innerHTML = `<div class="head"><svg class="shield" viewBox="0 0 24 28"><use href="#i-shield"/></svg><span class="nm"></span><span class="tag" hidden></span></div>`
      + `<div class="pips">${'<i class="pip"></i>'.repeat(match.target)}</div>`
      + `<div class="meters"><span>Kegs</span>${meter('kegs', MAX_KEGS)}<span>Reach</span>${meter('reach', MAX_RANGE)}<span>Speed</span>${meter('speed', MAX_SPEED_LV + 1)}</div>`
      + '<div class="status"></div>';
    const side = seatColor(i);
    el.style.borderColor = side.color;
    el.querySelector('.shield').style.fill = side.color;
    el.querySelector('.nm').textContent = nameOf(i);
    el.dataset.key = '';
  }
}

/** Each card goes in the corner its knight starts from (three-player rounds move them about). */
function placeCards() {
  arena.spawns.forEach((s, i) => {
    const el = $(`#card${i}`);
    if (!el) return;
    el.classList.remove('at-tl', 'at-tr', 'at-bl', 'at-br');
    el.classList.add(`at-${s.y === 0 ? 't' : 'b'}${s.x === 0 ? 'l' : 'r'}`);
  });
}

function refreshCards(force) {
  if (!arena || !match) return;
  for (let i = 0; i < match.players.length; i++) {
    const el = $(`#card${i}`);
    const k = arena.players[i];
    const mp = match.players[i];
    const p = mode === 'phones' ? atSeat(i) : null;
    const away = mp.kind === 'human' && p && (!p.connected || p.bot);
    const tag = mp.kind === 'bot' ? 'Bot' : away ? 'Bot for now' : mode === 'remote' && i === 0 ? 'Remote' : '';
    const status = !k.alive ? 'Out' : away ? (p.connected ? 'Phone gone quiet' : 'Phone disconnected') : '';
    const key = `${k.alive}|${k.kegs}|${k.active}|${k.range}|${k.speedLv}|${match.wins.get(mp.team)}|${tag}|${status}`;
    if (!force && el.dataset.key === key) continue;
    el.dataset.key = key;
    const t = el.querySelector('.tag');
    t.hidden = !tag;
    t.textContent = tag;
    const wins = match.wins.get(mp.team);
    el.querySelectorAll('.pip').forEach((pip, j) => pip.classList.toggle('on', j < wins));
    const ready = k.alive ? k.kegs - k.active : 0;
    el.querySelectorAll('.meter.kegs i').forEach((m, j) => { m.hidden = j >= k.kegs; m.classList.toggle('out', j >= ready); });
    el.querySelectorAll('.meter.reach i').forEach((m, j) => m.classList.toggle('on', j < k.range));
    el.querySelectorAll('.meter.speed i').forEach((m, j) => m.classList.toggle('on', j <= k.speedLv));
    el.querySelector('.status').textContent = status;
    el.classList.toggle('out', !k.alive);
    el.classList.toggle('away', !!status && k.alive);
  }
}

function flashCard(i, cls) {
  const el = $(`#card${i}`);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const textCache = {};
function setText(sel, v) {
  if (textCache[sel] === v) return;
  textCache[sel] = v;
  $(sel).textContent = v;
}
function updateClock() {
  if (!arena) return;
  let big;
  let note;
  let hurry = false;
  if (arena.final) { big = '!'; note = 'Last stand'; hurry = true; }
  else if (arena.tick >= arena.hurryTick) { big = '!'; note = 'Closing in'; hurry = true; }
  else {
    const s = Math.max(0, Math.ceil((arena.hurryTick - Math.max(arena.tick, arena.startTick)) / TICK_HZ));
    big = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    note = `Round ${match.roundNo}${speed > 1 ? ` · ${speed}× speed` : ''}`;
  }
  setText('#clock', big);
  setText('#clock-note', note);
  $('#clockbox').classList.toggle('hurry', hurry);
}

function setBanner(kicker, main, sub, dim = false, cls = '') {
  const b = $('#banner');
  b.hidden = false;
  b.classList.toggle('dim', dim);
  $('#banner-kicker').textContent = kicker;
  const m = $('#banner-main');
  m.textContent = main;
  m.className = `banner-main ${cls}`.trim();
  $('#banner-sub').textContent = sub;
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
}
function hideBanner() {
  $('#banner').hidden = true;
  $('#banner-tip').textContent = '';
}

const recentToasts = new Map();
function toast(text, cls = '', ms = 2600) {
  const now = performance.now();
  if (now - (recentToasts.get(text) || 0) < 1500) return;
  recentToasts.set(text, now);
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${cls}`.trim();
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

// ---------- screens and menus ----------
function showScreen(name) {
  for (const id of ['lobby', 'pause', 'results']) $('#' + id).hidden = id !== name;
  if (name && menus[name]) renderMenu(menus[name]);
}
function makeMenu(el, items) { return { el, items, index: 0 }; }
function renderMenu(m) {
  m.el.innerHTML = '';
  m.items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'row' + (it.action ? ' action' : '') + (i === m.index ? ' focus' : '');
    if (it.value) {
      row.innerHTML = '<span class="lbl"></span><span class="val"></span>';
      row.querySelector('.lbl').textContent = it.label();
      row.querySelector('.val').textContent = it.value();
    } else row.textContent = it.label();
    m.el.appendChild(row);
  });
  if (m === menus.lobby) {
    const it = m.items[m.index];
    $('#lobby-desc').textContent = it.desc ? it.desc() : '';
  }
}
function menuKey(m, k) {
  if (k === 'up' || (k === 'left' && m.horizontal)) m.index = (m.index - 1 + m.items.length) % m.items.length;
  else if (k === 'down' || (k === 'right' && m.horizontal)) m.index = (m.index + 1) % m.items.length;
  else if ((k === 'left' || k === 'right') && m.items[m.index].change) m.items[m.index].change(k === 'left' ? -1 : 1);
  else if (k === 'ok') { const it = m.items[m.index]; if (it.ok) it.ok(); else if (it.change) it.change(1); }
  if (menus[currentScreen()] === m) renderMenu(m);
}
function currentScreen() {
  for (const id of ['lobby', 'pause', 'results']) if (!$('#' + id).hidden) return id;
  return null;
}
const cycle = (v, d, n) => (v + d + n) % n;
function changeFormat(d) {
  // Only matches with room for every phone.
  const n = players.length;
  let i = FORMAT_ORDER.indexOf(settings.format);
  for (let tries = 0; tries < FORMAT_ORDER.length; tries++) {
    i = cycle(i, d, FORMAT_ORDER.length);
    if (FORMATS[FORMAT_ORDER[i]].players >= n) break;
  }
  settings.format = FORMAT_ORDER[i];
  saveSettings();
  fitFormat();
  checkAutoStart();
  broadcastStates();
  refreshLobby();
}
const FORMAT_DESC = {
  duel: 'Two knights. Bots take any seat without a phone.',
  teams: 'Blue and light blue against red and orange. Phones pick a side on their screen.',
  three: 'Three knights, every one for themselves.',
  four: 'Four knights, every one for themselves.',
};
const menus = {
  lobby: makeMenu($('#lobby-menu'), [
    { action: true, label: () => (players.some((p) => p.connected) ? 'Start the match' : 'Practise with the remote'), ok: () => startMatch(!players.some((p) => p.connected)), desc: () => (players.some((p) => p.connected) ? 'Starts now. It also starts by itself once every phone taps I\'m ready.' : 'A match against bots, played with the TV remote: ◀ ▶ ▲ ▼ to run, OK to drop a keg.') },
    { label: () => 'Match', value: () => fmt().label, change: (d) => changeFormat(d), desc: () => FORMAT_DESC[settings.format] },
    { label: () => 'Bots', value: () => DIFFICULTIES[settings.difficulty].label, change: (d) => { settings.difficulty = DIFF_ORDER[cycle(DIFF_ORDER.indexOf(settings.difficulty), d, 3)]; saveSettings(); refreshLobby(); }, desc: () => 'How well the bots play, in empty seats and for a phone that drops out.' },
    { label: () => 'Round wins', value: () => String(settings.target), change: () => { settings.target = settings.target === 3 ? 2 : 3; saveSettings(); }, desc: () => 'Round wins it takes to take the match.' },
    {
      label: () => 'Graphics', value: () => QUALITY[settings.quality].label, desc: () => QUALITY[settings.quality].desc,
      change: (d) => { settings.quality = QUALITY_ORDER[cycle(QUALITY_ORDER.indexOf(settings.quality), d, QUALITY_ORDER.length)]; saveSettings(); applyQuality(); },
    },
    { label: () => 'Sound', value: () => (settings.sound ? 'On' : 'Off'), change: () => { settings.sound = !settings.sound; sfx.on = settings.sound; if (settings.sound) sfx.prime(); saveSettings(); } },
    { label: () => 'Frame rate counter', value: () => (settings.fps ? 'On' : 'Off'), change: () => { settings.fps = !settings.fps; saveSettings(); }, desc: () => 'Frames per second, the slowest recent frame, the render size and the time the game takes.' },
  ]),
  pause: makeMenu($('#pause-menu'), [
    { label: () => 'Resume', ok: () => setPaused(false) },
    { label: () => 'Restart the match', ok: () => startMatch(lastMode === 'remote') },
    { label: () => 'Quit to the lobby', ok: () => toLobby() },
  ]),
  results: makeMenu($('#results-menu'), [
    { label: () => 'Play again', ok: () => startMatch(lastMode === 'remote' && !players.some((p) => p.connected)) },
    { label: () => 'Back to the lobby', ok: () => toLobby() },
  ]),
};
menus.results.horizontal = true;

function refreshLobby() {
  const f = fmt();
  const list = sidesFor(f);
  for (let s = 0; s < 4; s++) {
    const el = $('#slot' + s);
    const p = atSeat(s);
    const used = s < f.players;
    const side = list[s];
    el.className = 'slot' + (p ? '' : ' empty') + (used ? '' : ' off');
    el.style.borderColor = p && used ? side.color : '';
    let pill;
    let name;
    if (!used) { name = p ? p.name : '–'; pill = `<span class="pill warn">No seat in ${f.label}</span>`; }
    else if (!p) { name = `${DIFFICULTIES[settings.difficulty].label} bot`; pill = '<span class="pill">Scan the code to join</span>'; }
    else {
      name = p.name;
      pill = !p.connected ? '<span class="pill warn">Reconnecting…</span>' : p.ready ? '<span class="pill ok">Ready</span>' : '<span class="pill">Not ready yet</span>';
    }
    el.innerHTML = `<svg class="shield" viewBox="0 0 24 28"><use href="#i-shield"/></svg><div class="name"></div>${pill}`;
    el.querySelector('.shield').style.fill = side.color;
    el.querySelector('.name').textContent = name;
  }
  $('#knight-count').textContent = `${players.length} of ${MAX_PHONES} phones · ${f.label}`;
  if (currentScreen() === 'lobby') renderMenu(menus.lobby);
  refreshLobbyStatus();
}

let lastStatus = '';
function refreshLobbyStatus() {
  const el = $('#lobby-status');
  const active = players.filter((p) => p.connected);
  let text;
  let go = false;
  if (autoStart != null) { text = `Starting in ${Math.max(1, Math.ceil(autoStart))}…`; go = true; }
  else if (!active.length) text = 'No phones yet. Scan the code to join, or practise with the remote.';
  else if (active.some((p) => !p.ready)) text = "The match starts when every phone taps I'm ready, or choose Start the match.";
  else text = '';
  if (text === lastStatus) return;
  lastStatus = text;
  el.textContent = text;
  el.classList.toggle('go', go);
}

// ---------- the remote ----------
function keyName(e) {
  switch (e.key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': case ' ': case 'Select': return 'ok';
    case 'Escape': case 'Backspace': case 'GoBack': case 'BrowserBack': return 'back';
    default: break;
  }
  if (e.keyCode === 13 || e.keyCode === 23) return 'ok';
  return null;
}
const KEY_DIR = { left: 1, right: 2, up: 3, down: 4 };

addEventListener('keydown', (e) => {
  const k = keyName(e);
  if (!k) return;
  e.preventDefault();
  sfx.prime();
  if (k === 'back') { window.tvBack(); return; }
  if (running()) {
    if (paused) { menuKey(menus.pause, k); return; }
    if (mode === 'remote') {
      if (KEY_DIR[k]) { if (!keys.list.includes(KEY_DIR[k])) keys.list.push(KEY_DIR[k]); return; }
      if (k === 'ok' && !e.repeat) keys.keg = true;
      return;
    }
    if (k === 'ok' && !e.repeat) setPaused(true);
    return;
  }
  if (phase === 'lobby') menuKey(menus.lobby, k);
  else if (phase === 'results') menuKey(menus.results, k);
});
addEventListener('keyup', (e) => {
  const k = keyName(e);
  if (KEY_DIR[k]) keys.list = keys.list.filter((d) => d !== KEY_DIR[k]);
});
addEventListener('blur', () => { keys.list = []; });

// Called by the Android app when the remote's Back button is pressed. Returns true if handled.
window.tvBack = () => {
  if (running()) { setPaused(!paused); return true; }
  if (phase === 'results') { toLobby(); return true; }
  return false;
};

// ---------- join code ----------
function drawQr(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const c = $('#qr');
  const x = c.getContext('2d');
  const quiet = 3;
  const cell = Math.floor(c.width / (n + quiet * 2));
  const off = Math.floor((c.width - cell * n) / 2);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#151a22';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) x.fillRect(off + col * cell, off + r * cell, cell, cell);
}
async function loadJoinInfo() {
  let url = null;
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    url = (await res.json()).url;
  } catch { /* not served by the game server */ }
  $('#join-sub').hidden = !url;
  $('#join-none').hidden = !!url;
  $('#qr').style.visibility = url ? 'visible' : 'hidden';
  if (url) {
    $('#join-url').textContent = url.replace(/^http:\/\//, '').replace(/\/$/, '');
    drawQr(url);
  } else setTimeout(loadJoinInfo, 4000);
}

// ---------- frame loop ----------
let debugNoScene = false;
const fpsState = { frames: 0, since: performance.now(), worst: 0, value: 0, logic: 0, draw: 0, reports: 0 };
let slowAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsState.frames++;
  fpsState.worst = Math.max(fpsState.worst, dt);
  const t0 = performance.now();
  if (running() && !paused) {
    if (phase === 'between') {
      betweenLeft -= dt;
      if (betweenLeft <= 0) afterRound();
    } else {
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
  }
  if (phase === 'lobby' && autoStart != null) {
    autoStart -= dt;
    if (autoStart <= 0) { autoStart = null; startMatch(false); } else refreshLobbyStatus();
  }
  const t1 = performance.now();
  if (arena && !$('#match').hidden) {
    const live = (phase === 'countdown' || phase === 'play') && !paused;
    const labels = you && mode === 'phones' ? humanSeats().map((i) => ({ i, text: nameOf(i).toUpperCase() })) : you ? [{ i: 0, text: 'YOU' }] : null;
    renderer.draw(arena, { me: -1, alpha: live ? Math.min(1, acc / DT) : 1, you, labels }, now);
  } else if (phase === 'lobby' && !debugNoScene) {
    drawMenuScene($('#scene'), now, renderer.kit);
  }
  const t2 = performance.now();
  fpsState.logic += t1 - t0;
  fpsState.draw += t2 - t1;
  if (now - slowAt > 100) {
    slowAt = now;
    if (arena && running()) { updateClock(); refreshCards(false); }
  }
  sendHuds(now);
  dynTick(now);
  // Pictures still to draw ahead of time: a little each frame, less while a round is on.
  if (renderer.warmQueue && renderer.warmQueue.length) renderer.warmStep(phase === 'play' && !paused ? 1 : 4);
  if (now - fpsState.since > 500) {
    fpsState.value = Math.round((fpsState.frames * 1000) / (now - fpsState.since));
    const el = $('#fps');
    el.hidden = !settings.fps;
    const q = QUALITY[settings.quality];
    const n = Math.max(1, fpsState.frames);
    const text = `${fpsState.value} fps · slowest ${Math.round(fpsState.worst * 1000)} ms · ${q.label} ${renderHeight()}p · logic ${(fpsState.logic / n).toFixed(1)} ms · draw ${(fpsState.draw / n).toFixed(1)} ms`;
    if (settings.fps) {
      el.textContent = text;
      el.classList.toggle('bad', fpsState.value < 45);
    }
    // Every 5 s into the app's log too (adb logcat -s PowderKeg), for checking a TV from a computer.
    if (++fpsState.reports % 10 === 0) {
      console.log(`pk-fps ${phase}${paused ? ' paused' : ''} · ${text} · ${kit.map.size} pictures`);
      const pr = renderer.profAcc;
      if (pr && pr.frames) {
        const parts = Object.keys(pr).filter((k) => k !== 'frames' && k !== 'boards').map((k) => `${k} ${(pr[k] / pr.frames).toFixed(2)}`);
        console.log(`pk-prof ${parts.join(' · ')} · boards ${pr.boards || 0}`);
        renderer.profAcc = null;
      }
    }
    fpsState.frames = 0;
    fpsState.since = now;
    fpsState.worst = 0;
    fpsState.logic = 0;
    fpsState.draw = 0;
  }
}

// Phones that dropped out of the lobby give their seat back after a minute.
setInterval(() => {
  if (phase !== 'lobby') return;
  const before = players.length;
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    if (!p.connected && performance.now() - p.closedAt > 60000) players.splice(i, 1);
  }
  if (players.length !== before) { checkAutoStart(); refreshLobby(); broadcastStates(); }
}, 5000);

// Development: a debug.json pushed next to the page switches parts of the drawing off, to find
// what costs the most on a TV. There's no such file in the app itself.
fetch('/debug.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((cfg) => {
  if (!cfg) return;
  Object.assign(renderer.debug, cfg.render || {});
  if (cfg.noKit) renderer.kit = null;
  if (cfg.noBitmaps) kit.bitmaps = false;
  if (cfg.noScene) { debugNoScene = true; $('#scene').style.visibility = 'hidden'; }
  if (cfg.hideDom) for (const el of document.querySelectorAll('.card, .side-mid')) el.style.visibility = 'hidden';
  if (QUALITY[cfg.quality]) { settings.quality = cfg.quality; applyQuality(); }
  console.log('pk-debug ' + JSON.stringify(cfg));
}).catch(() => {});

/**
 * While the lobby waits for phones, draw the courtyard's pictures ahead of time (a little each
 * frame): every knight colour, keg, power-up and shape of blast, so the first round runs smoothly.
 */
function warmUp() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  const side = 1080 * s; // the court's size on screen
  renderer.pixelRatio = renderHeight() / side;
  renderer.textScale = side / 320;
  renderer.layout({ n: SIZE.duel, theme: 'castle' }, { width: side, height: side });
  renderer.queueWarm([...new Set([...SIDES, ...TEAM_SIDES])]);
}

// ---------- boot ----------
fitStage();
warmUp();
showScreen('lobby');
refreshLobby();
loadJoinInfo();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refreshLobby());
requestAnimationFrame(frame);

// Hooks for automated tests.
window.__pk = {
  get phase() { return phase; }, get paused() { return paused; }, get match() { return match; }, get arena() { return arena; },
  get players() { return players; }, get fps() { return fpsState.value; }, get mode() { return mode; }, get speed() { return speed; },
  settings, dyn, renderer, startMatch, toLobby, setPaused,
  setQuality(q) { settings.quality = q; applyQuality(); },
};
