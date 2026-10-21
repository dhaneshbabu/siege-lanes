// App shell for Castle Conquest: menu, match loop, touch controls, HUD and sound.
// Practice mode: you (side 0) against bots.
import { DT, KINDS, KIND_ORDER, SIDES, NEUTRAL, FORMATS, DIFFICULTIES, MATCH_SECONDS, LAND, SHARES } from './config.js';
import { createMatch } from './game.js';
import { MapRenderer, holdingThumb } from './render.js';
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
  format: valid(store.get('cc.format', 'duel'), (v) => !!FORMATS[v], 'duel'),
  difficulty: valid(store.get('cc.difficulty', 'normal'), (v) => !!DIFFICULTIES[v], 'normal'),
  share: valid(store.get('cc.share', 0.5), (v) => SHARES.includes(v), 0.5),
  sound: store.get('cc.sound', true) !== false,
};
const record = store.get('cc.record', {});
const coached = Object.assign({ sent: false, multi: false, upgrade: false }, store.get('cc.coached', {}));
const saveCoach = () => store.set('cc.coached', coached);

const sfx = new Sfx();
sfx.on = settings.sound;

const canvas = $('map');
const renderer = new MapRenderer(canvas);
const sideMQ = matchMedia('(orientation: landscape)');

let match = null;
let world = null;
let running = false;
let paused = false;
let stopped = false; // the simulation is halted: you were knocked out of a free-for-all, or the end screen is up
let speed = 1;
let acc = 0;
let lastFrame = 0;
let raf = 0;
let endShown = false;
let side = false;
let wakeLock = null;
let you = null; // { id, until }: the "YOU" marker at the start
let outPlace = null; // your place when knocked out of a free-for-all
let warned = {};
let firstSendAt = null;
let tips = {};
const selected = new Set();
const threat = new Set();
let drag = null; // { id, x0, y0, moved, start, mode: 'send' | 'aim' | 'none' }
let pointer = null;
let hover = null;
let chipEls = [];

// ---------- names and formatting ----------
const isAlly = (i) => i !== ME && world.friendly(i, ME);
const shortName = (i) => (i === ME ? 'You' : isAlly(i) ? 'Ally' : SIDES[i].name);
const fullName = (i) => (i === ME ? 'You' : isAlly(i) ? 'Your ally' : world.players[i].name);
const kindName = (k) => KINDS[k].name.toLowerCase();
const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------- toasts ----------
const recentToasts = new Map();
function toast(text, cls = '', ms = 2800) {
  const now = performance.now();
  if (now - (recentToasts.get(text) || 0) < 1500) return;
  recentToasts.set(text, now);
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${cls}`.trim();
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > (side ? 2 : 3)) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ }
}
function nope(el) {
  el.classList.remove('nope');
  void el.offsetWidth;
  el.classList.add('nope');
  sfx.play('denied');
}

// ---------- menu ----------
const recKey = () => `${settings.format}.${settings.difficulty}`;
function initMenu() {
  $(`fmt-${settings.format}`).checked = true;
  $(`diff-${settings.difficulty}`).checked = true;
  for (const el of document.querySelectorAll('input[name="format"]')) {
    el.addEventListener('change', () => {
      settings.format = el.value;
      store.set('cc.format', el.value);
      renderRecord();
    });
  }
  for (const el of document.querySelectorAll('input[name="difficulty"]')) {
    el.addEventListener('change', () => {
      settings.difficulty = el.value;
      store.set('cc.difficulty', el.value);
      renderRecord();
    });
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
  $('record').textContent = r && (r.w || r.l || r.d)
    ? `Your record in ${matchLabel()}: ${r.w} won, ${r.l} lost${r.d ? `, ${r.d} drawn` : ''}`
    : `No games in ${matchLabel()} yet.`;
}

function show(id) {
  $('menu').hidden = id !== 'menu';
  $('game').hidden = id !== 'game';
  document.body.style.overflow = id === 'game' ? 'hidden' : '';
}

// ---------- how to play ----------
function fillLegend() {
  const ul = $('legend-holdings');
  ul.textContent = '';
  for (const k of KIND_ORDER) {
    const K = KINDS[k];
    const li = document.createElement('li');
    li.innerHTML = '<img alt=""><span><b></b> · <span class="c"></span></span>';
    li.querySelector('img').src = holdingThumb(k, SIDES[ME].color, 48);
    li.querySelector('b').textContent = K.name;
    const walls = K.def > 1 ? ` Walls: each defender counts as ${K.def}.` : '';
    li.querySelector('.c').textContent = `Trains a soldier every ${(1 / K.rate).toFixed(1)} s, up to ${K.cap}.${walls} Land ${LAND[k]}.`;
    ul.appendChild(li);
  }
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

// ---------- match lifecycle ----------
function startMatch() {
  sfx.prime();
  match = createMatch({ format: settings.format, difficulty: settings.difficulty });
  world = match.world;
  paused = false;
  stopped = false;
  speed = 1;
  acc = 0;
  endShown = false;
  outPlace = null;
  warned = {};
  tips = {};
  firstSendAt = null;
  selected.clear();
  threat.clear();
  drag = null;
  pointer = null;
  hover = null;
  renderer.fx.length = 0;
  const home = world.nodes.find((n) => n.owner === ME);
  you = { id: home.id, until: performance.now() + 4500 };
  for (const k of Object.keys(cache)) delete cache[k];
  $('toasts').textContent = '';
  $('end').hidden = true;
  $('pause').hidden = true;
  $('btn-speed').textContent = 'Speed 1×';
  $('btn-speed').setAttribute('aria-pressed', 'false');
  updateSoundButton();
  show('game');
  buildChips();
  updateShareButtons();
  applyLayoutMode();
  requestWakeLock();
  running = true;
  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  if (!coached.sent) {
    setTimeout(() => {
      if (running && world && firstSendAt == null) toast('Drag from your castle to a nearby village to send soldiers.', '', 6500);
    }, 800);
  }
}

function goMenu() {
  running = false;
  cancelAnimationFrame(raf);
  match = null;
  world = null;
  $('pause').hidden = true;
  $('end').hidden = true;
  show('menu');
  releaseWakeLock();
  renderRecord();
}

function pauseGame() {
  if (!running || paused || !world || world.over || endShown) return;
  paused = true;
  drag = null;
  pointer = null;
  hover = null;
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

// ---------- layout ----------
function applyLayoutMode() {
  side = sideMQ.matches;
  $('game').classList.toggle('side', side);
  layout();
}
function layout() {
  if (!world) return;
  renderer.layout(world.nodes, match.seed);
}
const onOrientation = () => { if (world) applyLayoutMode(); };
if (sideMQ.addEventListener) sideMQ.addEventListener('change', onOrientation);
else if (sideMQ.addListener) sideMQ.addListener(onOrientation);
window.addEventListener('resize', () => { if (running) layout(); });
if (window.ResizeObserver) new ResizeObserver(() => { if (running) layout(); }).observe($('map-wrap'));

// ---------- frame loop ----------
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const live = !paused && !stopped && !world.over;
  if (live) {
    acc += dt * speed;
    let steps = 0;
    while (acc >= DT && steps < 12) {
      match.step();
      acc -= DT;
      steps++;
    }
    if (steps >= 12) acc = 0;
  }
  handleEvents(now);
  pruneSelection();
  findThreats();
  const aiming = !!(drag && (drag.mode === 'send' || drag.mode === 'aim'));
  renderer.draw(world, {
    me: ME,
    selected,
    pointer: aiming ? pointer : null,
    hover: aiming ? hover : null,
    preview: aiming && hover ? preview(hover) : null,
    alpha: live ? Math.min(1, acc / DT) : 0,
    threat,
    you,
  }, now);
  updateHud();
  coach();
}

function pruneSelection() {
  for (const id of selected) if (world.nodes[id].owner !== ME) selected.delete(id);
}

function findThreats() {
  threat.clear();
  for (const f of world.fleets) {
    if (!f.alive || f.owner === ME || world.friendly(f.owner, ME)) continue;
    if (world.nodes[f.to].owner === ME) threat.add(f.to);
  }
}

/** What a send would do: soldiers going, and soldiers needed to take the target when they get there. */
function preview(t) {
  const sources = [...selected].filter((id) => id !== t.id);
  if (!sources.length) return null;
  let count = 0;
  let eta = 0;
  for (const id of sources) {
    const s = world.nodes[id];
    count += Math.floor(s.troops * settings.share);
    eta = Math.max(eta, world.eta(s, t));
  }
  if (t.owner === ME || world.friendly(t.owner, ME)) return { count, need: null };
  const K = KINDS[t.kind];
  const grow = t.owner >= 0 ? Math.max(0, Math.min(K.cap - t.troops, K.rate * eta)) : 0;
  return { count, need: Math.floor((t.troops + grow) * K.def) + 1 };
}

function handleEvents(now) {
  const evs = world.events;
  if (!evs.length) return;
  renderer.addEvents(evs, world, now);
  for (const e of evs) {
    switch (e.t) {
      case 'send':
        if (e.owner !== ME && !world.friendly(e.owner, ME) && world.nodes[e.to].owner === ME && e.count >= 6) sfx.play('warn');
        break;
      case 'capture': {
        const n = world.nodes[e.node];
        if (e.owner === ME) {
          sfx.play('capture');
        } else if (e.prev === ME) {
          sfx.play('lost');
          buzz(60);
          flashChip(ME);
          toast(`${fullName(e.owner)} took your ${kindName(n.kind)}.`, 'bad');
        }
        break;
      }
      case 'repelled':
        if (e.owner === ME || e.defender === ME) sfx.play('clash');
        break;
      case 'upgrade':
        if (e.owner === ME) sfx.play('upgrade');
        break;
      case 'eliminated':
        onEliminated(e.player);
        break;
      case 'over':
        setTimeout(showEnd, 1100);
        break;
      default: break;
    }
  }
  evs.length = 0;
}

function onEliminated(i) {
  flashChip(i);
  if (i === ME) {
    selected.clear();
    drag = null;
    if (world.over) return; // the result screen follows
    const allyAlive = world.players.some((p) => p.alive && isAlly(p.index));
    if (allyAlive) {
      toast('Your last holding fell. Your ally fights on.', 'bad big', 5000);
      return;
    }
    outPlace = world.players.filter((p) => p.alive).length + 1;
    stopped = true;
    setTimeout(showEnd, 1100);
    return;
  }
  if (world.over) return;
  if (isAlly(i)) toast('Your ally has fallen. It is up to you now.', 'bad');
  else toast(`${world.players[i].name} has been wiped off the map.`, 'good');
}

/** A few tips in the first matches. */
function coach() {
  if (!world || world.over || stopped || paused) return;
  const t = world.time;
  if (!coached.multi && !tips.multi && firstSendAt != null && t > 35 && world.holdings(ME) >= 3) {
    tips.multi = true;
    toast('Tip: drag across several of your holdings on the way to a target to send from all of them at once.', '', 6500);
  }
  if (!coached.upgrade && !tips.upgrade && t > 55) {
    const rich = world.nodes.some((n) => n.owner === ME && KINDS[n.kind].upgradeTo && n.troops >= KINDS[n.kind].upgradeCost + 8);
    if (rich) {
      tips.upgrade = true;
      toast('Tip: tap one of your holdings, then Upgrade. Towns and castles train faster and defend better.', '', 6500);
    }
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
  const compact = world.players.length > 2;
  box.classList.toggle('compact', compact);
  for (const p of world.players) {
    const el = document.createElement('div');
    el.className = `chip${p.index === ME ? ' me' : ''}${p.index === ME || isAlly(p.index) ? ' named' : ''}`;
    el.innerHTML = '<span class="chip-id"><svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><use href="#i-shield"/></svg><span class="nm"></span></span>' +
      '<span class="chip-st"><span class="ct" title="Land"><svg class="i" aria-hidden="true"><use href="#i-flag"/></svg><b class="land">0</b></span>' +
      '<span class="ct" title="Soldiers"><svg class="i" aria-hidden="true"><use href="#i-man"/></svg><b class="sol">0</b></span></span>';
    el.querySelector('.shield').style.fill = SIDES[p.index].color;
    el.querySelector('.nm').textContent = shortName(p.index);
    el.setAttribute('aria-label', fullName(p.index));
    chipEls.push(el);
    box.appendChild(el);
  }
}

function flashChip(i) {
  const el = chipEls[i];
  if (!el) return;
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
}

function updateHud() {
  const left = Math.max(0, MATCH_SECONDS - world.time);
  setText('clock', fmtTime(Math.ceil(left)));
  const low = left <= 30 && !world.over;
  if (cache.low !== low) {
    cache.low = low;
    $('clock-box').classList.toggle('low', low);
  }
  if (!world.over && !stopped) {
    if (!warned.min && left <= 60) {
      warned.min = true;
      toast('One minute left. When time runs out, the most land wins.', 'warn', 4000);
      sfx.play('bell');
    }
    if (!warned.ten && left <= 10) {
      warned.ten = true;
      sfx.play('bell');
    }
  }

  for (const p of world.players) {
    const el = chipEls[p.index];
    const land = world.land(p.index);
    const sol = Math.floor(world.strength(p.index));
    const key = `${land}|${sol}|${p.alive}`;
    if (el._key === key) continue;
    el._key = key;
    el.querySelector('.land').textContent = land;
    el.querySelector('.sol').textContent = sol;
    el.classList.toggle('out', !p.alive);
  }
  updateLandbar();
  updateControls();
}

function updateLandbar() {
  const lands = world.players.map((p) => world.land(p.index));
  let total = 0;
  for (const n of world.nodes) total += LAND[n.kind];
  const neutral = Math.max(0, total - lands.reduce((a, b) => a + b, 0));
  const key = `${lands.join(',')}|${neutral}`;
  if (cache.land === key) return;
  cache.land = key;
  const bar = $('landbar');
  if (!bar.children.length || bar.children.length !== world.players.length + 1) {
    bar.textContent = '';
    // Your side from the left, neutral land in the middle, everyone else from the right.
    const mine = world.players.filter((p) => world.friendly(p.index, ME)).map((p) => p.index);
    const rest = world.players.filter((p) => !world.friendly(p.index, ME)).map((p) => p.index);
    for (const i of [...mine, -1, ...rest]) {
      const s = document.createElement('span');
      s.dataset.owner = String(i);
      s.style.background = i >= 0 ? SIDES[i].color : NEUTRAL.color;
      if (i < 0) s.style.opacity = '0.45';
      bar.appendChild(s);
    }
  }
  for (const s of bar.children) {
    const i = Number(s.dataset.owner);
    s.style.flexGrow = String(i >= 0 ? lands[i] : neutral);
  }
}

// ---------- controls ----------
const shareBtns = [...document.querySelectorAll('.share-btn')];
for (const b of shareBtns) {
  b.addEventListener('click', () => {
    sfx.prime();
    settings.share = Number(b.dataset.share);
    store.set('cc.share', settings.share);
    updateShareButtons();
    sfx.play('select');
  });
}
function updateShareButtons() {
  for (const b of shareBtns) b.setAttribute('aria-checked', String(Number(b.dataset.share) === settings.share));
}

function updateControls() {
  const ids = [...selected];
  for (const b of shareBtns) {
    const s = Number(b.dataset.share);
    let n = 0;
    for (const id of ids) n += Math.floor(world.nodes[id].troops * s);
    const v = ids.length ? String(n) : '';
    const small = b.querySelector('small');
    if (small.textContent !== v) small.textContent = v;
  }
  let main = 'Upgrade';
  let sub = 'Tap one of your holdings';
  let ready = false;
  if (ids.length === 1) {
    const n = world.nodes[ids[0]];
    const K = KINDS[n.kind];
    if (!K.upgradeTo) {
      main = 'Castle';
      sub = 'Already the strongest';
    } else {
      main = `Upgrade to ${kindName(K.upgradeTo)}`;
      ready = n.troops >= K.upgradeCost;
      sub = ready ? `Costs ${K.upgradeCost} soldiers` : `Needs ${K.upgradeCost} soldiers here`;
    }
  } else if (ids.length > 1) {
    sub = 'Select just one holding';
  }
  const key = `${main}|${sub}|${ready}`;
  if (cache.up === key) return;
  cache.up = key;
  const btn = $('btn-upgrade');
  $('up-main').textContent = main;
  $('up-sub').textContent = sub;
  btn.classList.toggle('ready', ready);
  btn.classList.toggle('off', !ready);
  btn.setAttribute('aria-disabled', String(!ready));
}

$('btn-upgrade').addEventListener('click', () => {
  sfx.prime();
  if (!world || world.over || paused || stopped) return;
  const btn = $('btn-upgrade');
  const ids = [...selected];
  if (ids.length !== 1) {
    nope(btn);
    toast(ids.length ? 'Select just one holding to upgrade.' : 'Tap one of your holdings first, then Upgrade.');
    return;
  }
  const r = world.upgrade(ME, ids[0]);
  if (r.ok) {
    if (!coached.upgrade) { coached.upgrade = true; saveCoach(); }
    return;
  }
  nope(btn);
  if (r.reason === 'max') toast('Castles are as strong as holdings get.');
  else if (r.reason === 'troops') toast(`That holding needs ${r.cost} soldiers inside to upgrade.`);
});

// ---------- map input ----------
function local(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
const canAct = () => !!(world && running && !world.over && !paused && !stopped && world.players[ME].alive);

canvas.addEventListener('pointerdown', (e) => {
  sfx.prime();
  if (!canAct() || drag) return;
  const p = local(e);
  drag = { id: e.pointerId, x0: p.x, y0: p.y, moved: false, start: renderer.hit(world.nodes, p.x, p.y), mode: null };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || !canAct()) return;
  const p = local(e);
  if (!drag.moved) {
    if (Math.hypot(p.x - drag.x0, p.y - drag.y0) < 10) return;
    drag.moved = true;
    const s = drag.start;
    if (s && s.owner === ME) {
      drag.mode = 'send';
      if (!selected.has(s.id)) {
        selected.clear();
        selected.add(s.id);
      }
      sfx.play('select');
    } else {
      drag.mode = !s && selected.size ? 'aim' : 'none';
    }
  }
  if (drag.mode !== 'send' && drag.mode !== 'aim') return;
  pointer = p;
  const n = renderer.hit(world.nodes, p.x, p.y, 8);
  // Sweeping across your own holdings adds them to the group.
  if (drag.mode === 'send' && n && n.owner === ME && !selected.has(n.id)) {
    selected.add(n.id);
    sfx.play('select');
  }
  hover = n && !(selected.size === 1 && selected.has(n.id)) ? n : null;
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  pointer = null;
  hover = null;
  if (cancelled || !canAct()) return;
  if (!d.moved) { onTap(d.start); return; }
  if (d.mode !== 'send' && d.mode !== 'aim') return;
  const p = local(e);
  const t = renderer.hit(world.nodes, p.x, p.y, 14);
  if (!t) return; // let go over empty ground: nothing sent, the selection stays
  const sources = [...selected].filter((id) => id !== t.id);
  if (!sources.length) return;
  if (order(sources, t) && d.mode === 'send') selected.clear();
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

function onTap(n) {
  if (!n) {
    if (selected.size) { selected.clear(); sfx.play('select'); }
    return;
  }
  if (n.owner === ME) {
    if (selected.has(n.id)) { selected.delete(n.id); sfx.play('select'); return; }
    if (!selected.size) { selected.add(n.id); sfx.play('select'); return; }
    order([...selected], n); // reinforce one of your own
    return;
  }
  if (!selected.size) {
    if (!tips.tapFirst) {
      tips.tapFirst = true;
      toast('First tap or drag from one of your own holdings.');
    }
    return;
  }
  order([...selected], n);
}

/** Send soldiers. Returns true when any marched. */
function order(sources, t) {
  const sent = world.send(ME, sources, t.id, settings.share);
  if (sent > 0) {
    sfx.play('send');
    if (firstSendAt == null) firstSendAt = world.time;
    if (!coached.sent) { coached.sent = true; saveCoach(); }
    if (sources.length > 1 && !coached.multi) { coached.multi = true; saveCoach(); }
    return true;
  }
  sfx.play('denied');
  toast('Not enough soldiers there to send. Try a bigger share.');
  return false;
}

// ---------- pause / end ----------
$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-speed').addEventListener('click', () => {
  speed = speed === 1 ? 2 : 1;
  $('btn-speed').textContent = `Speed ${speed}×`;
  $('btn-speed').setAttribute('aria-pressed', String(speed === 2));
});
function updateSoundButton() {
  $('btn-sound').textContent = settings.sound ? 'Sound on' : 'Sound off';
  $('btn-sound').setAttribute('aria-pressed', String(settings.sound));
}
$('btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  sfx.on = settings.sound;
  store.set('cc.sound', settings.sound);
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
  else if (running) requestWakeLock();
});

function teamLand() {
  const m = new Map();
  for (const p of world.players) m.set(p.team, (m.get(p.team) || 0) + world.land(p.index));
  return m;
}

function showEnd() {
  if (endShown || !world) return;
  endShown = true;
  stopped = true;
  selected.clear();
  drag = null;
  const res = world.over ? world.result : null;
  const myTeam = world.players[ME].team;
  const teams = settings.format === 'teams';
  const ffa = !teams && world.players.length > 2;
  const outcome = res ? (res.team == null ? 'draw' : res.team === myTeam ? 'win' : 'loss') : 'loss';
  const key = recKey();
  const r = Object.assign({ w: 0, l: 0, d: 0 }, record[key]);
  const field = { win: 'w', loss: 'l', draw: 'd' }[outcome];
  r[field] += 1;
  record[key] = r;
  store.set('cc.record', record);

  const t = fmtTime(world.time);
  const lands = teamLand();
  const myLand = lands.get(myTeam) || 0;
  let bestOther = 0;
  for (const [team, land] of lands) if (team !== myTeam) bestOther = Math.max(bestOther, land);
  let place = null;
  if (ffa) {
    if (outPlace) place = outPlace;
    else if (outcome === 'win') place = 1;
    else {
      // On time: rank by land among those still standing; the knocked out come after.
      const alive = world.players.filter((p) => p.alive).sort((a, b) => world.land(b.index) - world.land(a.index));
      const idx = alive.findIndex((p) => p.index === ME);
      place = idx >= 0 ? idx + 1 : world.players.length;
    }
  }

  let sub;
  if (outcome === 'win') {
    sub = res.how === 'conquest'
      ? `${teams ? 'Your side' : 'You'} conquered the map at ${t}.`
      : `Time ran out with ${teams ? 'your side' : 'you'} holding the most land: ${myLand} to ${bestOther}.`;
  } else if (outcome === 'draw') {
    sub = 'Time ran out with the land split evenly.';
  } else if (outPlace) {
    sub = `Your last holding fell at ${t}. You finished ${ordinal(outPlace)} of ${world.players.length}.`;
  } else if (res.how === 'conquest') {
    sub = teams ? `Your side was wiped off the map at ${t}.` : `Your last holding fell at ${t}.`;
  } else {
    const winner = world.players.find((p) => p.team === res.team);
    const theirLand = lands.get(res.team) || 0;
    sub = teams
      ? `Time ran out. The other side held more land: ${theirLand} to your ${myLand}.`
      : `Time ran out. ${winner.name} held the most land: ${theirLand} to your ${myLand}.`;
  }

  $('end-eyebrow').textContent = `Practice · ${FORMATS[settings.format].label} · ${DIFFICULTIES[settings.difficulty].label} bots`;
  const title = $('end-title');
  title.textContent = outcome === 'win' ? 'Victory' : outcome === 'draw' ? 'Stalemate' : 'Defeat';
  title.className = `end-title ${outcome}`;
  $('end-sub').textContent = sub;

  const s = world.players[ME].stats;
  const rows = [];
  if (place) rows.push(['Place', `${ordinal(place)} of ${world.players.length}`]);
  rows.push(
    ['Holdings taken', s.captured],
    ['Holdings lost', s.lost],
    ['Soldiers sent', s.sent],
    ['Upgrades', s.upgrades],
    ['Most holdings at once', s.peakHoldings],
    [teams ? 'Your side\'s land' : 'Land at the end', myLand],
    ['Your record in this mode', `${r.w}–${r.l}${r.d ? `–${r.d}` : ''}`],
  );
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
  sfx.play(outcome === 'win' ? 'win' : 'lose');
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
  // Phones only: more room for the map. Ignored where unsupported (iPhone Safari).
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (running) setTimeout(layout, 50); });

// ---------- boot ----------
fillLegend();
initMenu();
show('menu');

// Handle for automated checks in a browser; does nothing on its own.
window.__cc = {
  get world() { return world; },
  get match() { return match; },
  get selected() { return selected; },
  get side() { return side; },
  renderer,
  pause: pauseGame,
};
