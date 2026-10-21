// App shell for Powder Keg: menu, rounds, the frame loop, controls, HUD and sound.
// Practice mode: you (seat 0) against bots.
import { DT, TICK_HZ, SIDES, FORMATS, DIFFICULTIES, WIN_TARGETS, POWERS, MAX_KEGS, MAX_RANGE, MAX_SPEED_LV } from './config.js';
import { createMatch } from './game.js';
import { ArenaRenderer, powerThumb, pieceThumb, kegIcon, drawMenuScene, THEMES } from './render.js';
import { Controls } from './input.js';
import { Sfx } from './audio.js';

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

const ME = 0;
const valid = (v, ok, fallback) => (ok(v) ? v : fallback);
const settings = {
  format: valid(store.get('pk.format', 'duel'), (v) => !!FORMATS[v], 'duel'),
  difficulty: valid(store.get('pk.difficulty', 'normal'), (v) => !!DIFFICULTIES[v], 'normal'),
  target: valid(store.get('pk.target', 3), (v) => WIN_TARGETS.includes(v), 3),
  sound: store.get('pk.sound', true) !== false,
};
const record = store.get('pk.record', {});
const coached = Object.assign({ moved: false, kegged: false, reveal: false, powers: {} }, store.get('pk.coached', {}));
const saveCoach = () => store.set('pk.coached', coached);

const sfx = new Sfx();
sfx.on = settings.sound;
const canvas = $('court');
const renderer = new ArenaRenderer(canvas);
const sideMQ = matchMedia('(orientation: landscape)');

let match = null;
let arena = null;
let phase = 'menu'; // countdown | play | between | ended
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

const controls = new Controls({
  zone: $('stick-zone'),
  base: $('stick-base'),
  knob: $('stick-knob'),
  kegBtn: $('keg-btn'),
  onKeg: () => sfx.prime(),
});

// ---------- names and formatting ----------
const myTeam = () => match.players[ME].team;
const isAlly = (i) => i !== ME && match.players[i].team === myTeam();
const shortName = (i) => (i === ME ? 'You' : isAlly(i) ? 'Ally' : SIDES[i].name);
const fullName = (i) => (i === ME ? 'You' : isAlly(i) ? 'Your ally' : match.players[i].name);
const fmtTime = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Shown under the countdown, one per round.
const TIPS = [
  'Crates hide power-ups: glowing coins. Walk over one to grab it.',
  'Cells glowing red are about to be blasted. Get out of the red!',
  '+1 Keg lets you have more kegs down at once. Bigger blast makes your red cross longer.',
  'Drop a keg, then duck round a corner: blasts only travel in straight lines.',
  'A blast that reaches another keg sets it off at once. Chain them!',
  'Speed up makes you run faster. Handy for getting clear of your own kegs.',
];

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
  $('btn-start').addEventListener('click', () => { sfx.prime(); goFullscreen(); startMatch(); });
  $('btn-howto').addEventListener('click', () => openHowto(false));
  renderRecord();
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
function show(id) {
  $('menu').hidden = id !== 'menu';
  $('game').hidden = id !== 'game';
  document.body.style.overflow = id === 'game' ? 'hidden' : '';
  if (id === 'menu') startMenuScene();
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
    ['knight', 'You', 'Your knight wears blue. Rivals wear red, green and purple.'],
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

// ---------- match and rounds ----------
function startMatch() {
  sfx.prime();
  match = createMatch({ format: settings.format, difficulty: settings.difficulty, target: settings.target });
  paused = false;
  $('end').hidden = true;
  $('pause').hidden = true;
  $('toasts').textContent = '';
  updateSoundButton();
  show('game');
  buildChips();
  startRound();
  requestWakeLock();
  running = true;
  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function startRound() {
  clearTimeout(betweenTimer);
  $('btn-skip').hidden = true;
  arena = match.newRound();
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
  $('banner-tip').textContent = TIPS[(match.roundNo - 1) % TIPS.length];
  if (!coached.moved && match.roundNo === 1) {
    setTimeout(() => { if (phase === 'play' && !coached.moved) toast('Drag in the lower left to run. Tap Keg to drop a powder keg.', '', 6000); }, 2200);
  }
}

function goMenu() {
  running = false;
  phase = 'menu';
  clearTimeout(betweenTimer);
  cancelAnimationFrame(raf);
  controls.enabled = false;
  controls.reset();
  match = null;
  arena = null;
  $('pause').hidden = true;
  $('end').hidden = true;
  show('menu');
  releaseWakeLock();
  renderRecord();
}

function pauseGame() {
  if (!running || paused || phase === 'ended' || phase === 'menu') return;
  paused = true;
  controls.reset();
  $('pause').hidden = false;
  $('btn-resume').focus();
}
function resumeGame() {
  paused = false;
  lastFrame = performance.now();
  acc = 0;
  $('pause').hidden = true;
  requestWakeLock();
}

/** "You 2 · Gules 1" — round wins so far. */
function scoreLine() {
  if (!match.history.length) return `First to ${match.target} round wins`;
  const parts = [];
  if (settings.format === 'teams') {
    parts.push(`Your side ${match.wins.get(myTeam())}`, `Theirs ${match.wins.get(1 - myTeam())}`);
  } else {
    for (const p of match.players) parts.push(`${shortName(match.players.indexOf(p))} ${match.wins.get(p.team)}`);
  }
  return parts.join(' · ');
}

function roundKicker() {
  const th = THEMES[arena.theme];
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

/** You're out: play the rest of the round instantly. */
function skipRound() {
  if (phase !== 'play' || !arena) return;
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

function roundOver() {
  $('btn-skip').hidden = true;
  phase = 'between';
  controls.enabled = false;
  controls.reset();
  const team = match.endRound();
  let main;
  let cls = '';
  if (team == null) {
    main = 'Draw';
  } else if (team === myTeam()) {
    main = settings.format === 'teams' ? 'Your side wins' : 'You win';
    cls = 'win';
  } else {
    const winner = match.players.findIndex((p) => p.team === team);
    main = settings.format === 'teams' ? 'They win' : `${SIDES[winner].name} wins`;
  }
  const sub = scoreLine();
  setBanner(roundKicker(), main, sub, true, cls);
  $('banner-tip').textContent = '';
  updateChips(true, team);
  sfx.play(team != null && team === myTeam() ? 'roundWin' : 'roundLose');
  betweenTimer = setTimeout(() => {
    if (!running) return;
    if (match.over) showEnd();
    else startRound();
  }, 2800);
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
  const H = game.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let court;
  if (side) {
    court = Math.min(H, W - 2 * 150);
  } else {
    const used = $('game').querySelector('.hud').offsetHeight + $('powers').offsetHeight;
    court = Math.min(W - 4, H - used - 190);
  }
  court = Math.max(200, Math.floor(court));
  game.style.setProperty('--court', `${court}px`);
  renderer.layout(arena);
}
const onOrientation = () => { if (arena) applyLayoutMode(); };
if (sideMQ.addEventListener) sideMQ.addEventListener('change', onOrientation);
else if (sideMQ.addListener) sideMQ.addListener(onOrientation);
window.addEventListener('resize', () => { if (running) layout(); });
if (window.ResizeObserver) new ResizeObserver(() => { if (running) renderer.layout(arena); }).observe($('court-wrap'));

// ---------- frame loop ----------
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
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
  const live = !paused && (phase === 'countdown' || phase === 'play');
  renderer.draw(arena, { me: ME, alpha: live ? Math.min(1, acc / DT) : 1, you }, now);
  updateHud();
}

function tick(now) {
  const me = arena.players[ME];
  if (me.alive && phase === 'play') {
    const r = controls.read();
    me.input.dir = r.dir;
    me.input.alt = r.alt;
    if (controls.takeKeg()) me.input.bomb = true;
    if (r.dir && !coached.moved) { coached.moved = true; saveCoach(); }
  }
  match.step();
  if (phase === 'countdown') countdown();
  handleEvents(now);
  if (arena.over && phase === 'play') roundOver();
}

function countdown() {
  const left = (arena.startTick - arena.tick) / TICK_HZ;
  const n = Math.ceil(left / 0.8);
  if (n > 0 && n <= 3 && n !== lastCount) {
    lastCount = n;
    setBanner(roundKicker(), String(n), scoreLine(), true);
    sfx.play('tick');
  }
}

function handleEvents(now) {
  const evs = arena.events;
  if (!evs.length) return;
  renderer.addEvents(evs, arena, now);
  const me = arena.players[ME];
  for (const e of evs) {
    switch (e.t) {
      case 'go':
        phase = 'play';
        controls.enabled = true;
        $('banner-tip').textContent = '';
        setBanner('', 'Go!', '', false);
        setTimeout(() => { if (phase === 'play') hideBanner(); }, 600);
        sfx.play('go');
        you = { until: now + 2400 };
        break;
      case 'keg':
        if (e.owner === ME) {
          sfx.play('keg');
          if (!coached.kegged) { coached.kegged = true; saveCoach(); }
        }
        break;
      case 'blast': {
        const x = e.cell % arena.n;
        const y = Math.floor(e.cell / arena.n);
        const near = Math.abs(x - me.x) + Math.abs(y - me.y) <= 5;
        sfx.play(near ? 'blast' : 'blastFar');
        if (near && me.alive) buzz(25);
        break;
      }
      case 'crate':
        if (e.owner === ME) sfx.play('crate');
        break;
      case 'power':
        if (e.player === ME) {
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
        const x = e.cell % arena.n;
        const y = Math.floor(e.cell / arena.n);
        if (!coached.reveal && me.alive && Math.abs(x - me.x) + Math.abs(y - me.y) <= 5) {
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
  evs.length = 0;
}

function onDeath(e) {
  const i = e.player;
  if (chipEls[i]) chipEls[i].classList.add('out');
  if (i === ME) {
    sfx.play('death');
    buzz(160);
    controls.enabled = false;
    controls.reset();
    const how = e.by === ME ? 'Caught in your own blast.' : e.by === -1 ? 'Crushed by falling stone.' : `Blown up by ${fullName(e.by)}.`;
    const others = arena.players.filter((p) => p.alive);
    const teams = new Set(others.map((p) => p.team));
    if (teams.size > 1) {
      speed = match.players.length > 2 ? 3 : 2;
      toast(`${how} Watching the rest at ${speed}× speed.`, 'bad', 3200);
      $('btn-skip').hidden = false;
    } else {
      toast(how, 'bad', 2400);
    }
    return;
  }
  if (e.by === ME) {
    sfx.play('rivalDown');
    toast(isAlly(i) ? 'You got your own ally!' : `You got ${fullName(i)}!`, isAlly(i) ? 'warn' : 'good', 2200);
  } else if (isAlly(i)) {
    toast('Your ally is out.', 'warn', 2200);
  }
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
  match.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `chip${i === ME ? ' me' : ''}${i === ME || isAlly(i) ? ' named' : ''}`;
    el.innerHTML = '<svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><use href="#i-shield"/></svg><span class="nm"></span><span class="pips"></span>';
    el.querySelector('.shield').style.fill = SIDES[i].color;
    el.querySelector('.nm').textContent = shortName(i);
    el.setAttribute('aria-label', fullName(i));
    const pips = el.querySelector('.pips');
    for (let k = 0; k < match.target; k++) pips.appendChild(Object.assign(document.createElement('i'), { className: 'pip' }));
    chipEls.push(el);
    box.appendChild(el);
  });
  updateChips(false, null);
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
  if (!arena) return;
  // The clock counts down to the next stage of the round.
  let big;
  let note;
  let hurry = false;
  if (arena.final) {
    big = '!';
    note = 'Last stand';
    hurry = true;
  } else if (arena.tick >= arena.hurryTick) {
    big = '!';
    note = 'Closing in';
    hurry = true;
  } else {
    big = fmtTime((arena.hurryTick - Math.max(arena.tick, arena.startTick)) / TICK_HZ);
    note = `Round ${match.roundNo}`;
  }
  setText('clock', big);
  setText('clock-note', note);
  if (cache.hurry !== hurry) {
    cache.hurry = hurry;
    $('clock-box').classList.toggle('hurry', hurry);
  }
  const me = arena.players[ME];
  updateMeters(me);
  const ready = me.alive ? me.kegs - me.active : 0;
  setText('keg-count', String(ready));
  const empty = ready <= 0 || !me.alive;
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
function updateMeters(me) {
  const key = `${me.kegs}|${me.active}|${me.range}|${me.speedLv}|${me.alive}`;
  if (cache.meters === key) return;
  cache.meters = key;
  const ready = me.alive ? me.kegs - me.active : 0;
  [...$('pw-keg-m').children].forEach((el, i) => {
    el.hidden = i >= me.kegs;
    el.classList.toggle('out', i >= ready);
  });
  [...$('pw-fire-m').children].forEach((el, i) => el.classList.toggle('on', i < me.range));
  [...$('pw-boots-m').children].forEach((el, i) => el.classList.toggle('on', i <= me.speedLv));
  $('pw-keg').setAttribute('aria-label', `Kegs: ${ready} of ${me.kegs} ready`);
  $('pw-fire').setAttribute('aria-label', `Blast reach: ${me.range} cells`);
  $('pw-boots').setAttribute('aria-label', `Speed: level ${me.speedLv + 1} of ${MAX_SPEED_LV + 1}`);
}

// ---------- pause / end ----------
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
$('btn-quit').addEventListener('click', goMenu);
$('btn-again').addEventListener('click', () => { sfx.prime(); startMatch(); });
$('btn-menu').addEventListener('click', goMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && phase !== 'menu') {
    if (paused) resumeGame();
    else pauseGame();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
  else if (running) requestWakeLock();
});

function showEnd() {
  phase = 'ended';
  hideBanner();
  const won = match.winner === myTeam();
  const key = recKey();
  const r = Object.assign({ w: 0, l: 0 }, record[key]);
  if (won) r.w++;
  else r.l++;
  record[key] = r;
  store.set('pk.record', record);
  const mine = match.wins.get(myTeam());
  let best = 0;
  for (const [t, w] of match.wins) if (t !== myTeam()) best = Math.max(best, w);
  const winnerIdx = match.players.findIndex((p) => p.team === match.winner);
  $('end-eyebrow').textContent = `Practice · ${FORMATS[settings.format].label} · ${DIFFICULTIES[settings.difficulty].label} bots`;
  const title = $('end-title');
  title.textContent = won ? 'Victory' : 'Defeat';
  title.className = `end-title ${won ? 'win' : 'loss'}`;
  $('end-sub').textContent = won
    ? `${settings.format === 'teams' ? 'Your side' : 'You'} took the match ${mine}–${best}.`
    : `${settings.format === 'teams' ? 'The other side' : match.players[winnerIdx].name} took the match ${match.target}–${mine}.`;
  const t = match.totals[ME];
  const rows = [
    ['Rounds won', `${mine} of ${match.roundNo}`],
    ['Rivals blown up', t.kills],
    ['Kegs dropped', t.kegs],
    ['Crates broken', t.crates],
    ['Power-ups picked up', t.powers],
    ['Caught in your own blast', t.selfKills],
    ['Your record in this mode', `${r.w}–${r.l}`],
  ];
  const dl = $('end-stats');
  dl.textContent = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
  $('end').hidden = false;
  sfx.play(won ? 'win' : 'lose');
  $('btn-again').focus({ preventScroll: true });
}

// ---------- device helpers ----------
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
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

// ---------- boot ----------
buildMeters();
fillLegend();
initMenu();
show('menu');

// Handle for automated checks in a browser; does nothing on its own.
window.__pk = {
  get match() { return match; },
  get arena() { return arena; },
  get phase() { return phase; },
  get side() { return side; },
  renderer,
  controls,
};
