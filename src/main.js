// App shell: menus, the match loop, input, HUD and sound. Practice mode: you against a bot.
import { DT, ROWS, TOWERS, TOWER_ORDER, ENEMIES, ENEMY_ORDER, SENDS, SEND_BY_ID, MODES, DIFFICULTIES, TINCTURES } from './config.js';
import { Match } from './match.js';
import { Renderer, TrackView, thumbnail } from './render.js';
import { nearestPlot, PATH_LEN } from './geom.js';
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

const ME = 'you';
const BOT = 'bot';
const MY_COLOR = 1; // azure
const BOT_COLOR = 0; // gules
const settings = {
  difficulty: DIFFICULTIES[store.get('sl.difficulty', 'normal')] ? store.get('sl.difficulty', 'normal') : 'normal',
  length: MODES[store.get('sl.length', 'standard')] ? store.get('sl.length', 'standard') : 'standard',
  sound: store.get('sl.sound', true) !== false,
};
const record = store.get('sl.record', {});
const coached = Object.assign({ built: false, sent: false, watch: false }, store.get('sl.coached', {}));

const sfx = new Sfx();
sfx.on = settings.sound;

let match = null;
let me = null;
let opp = null;
let running = false;
let paused = false;
let speed = 1;
let acc = 0;
let lastFrame = 0;
let raf = 0;
let sel = null; // { c, r, kind: 'build' | 'tower' }
let endShown = false;
let wakeLock = null;
let firstBuildAt = null;
let watching = false; // true: the board shows the opponent's lane
let dangerUntil = 0;
let plotHintShown = false;
const throughBuffer = { lives: 0, units: {}, timer: 0 };

const canvas = $('board');
const renderer = new Renderer(canvas, {
  colorOf: (id) => {
    const p = match && match.byId.get(id);
    return p ? TINCTURES[p.color].color : TINCTURES[0].color;
  },
});
const track = new TrackView($('track'));
const colorOfPlayer = (id) => {
  const p = match && match.byId.get(id);
  return p ? TINCTURES[p.color].color : '#888';
};

// ---------- formatting ----------
const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const unitName = (kind, count) => (count === 1 ? ENEMIES[kind].name : ENEMIES[kind].plural);
const compText = (comp) => comp.map(({ kind, count }) => `${count} ${unitName(kind, count)}`).join(', ');
const LEVEL_NAMES = ['Wooden post', 'Stone tower', 'Keep'];

// ---------- thumbnails ----------
const thumbs = { tower: {}, enemy: {} };
for (const t of TOWER_ORDER) thumbs.tower[t] = [0, 1, 2].map((lv) => thumbnail(t, 'tower', 48, lv, TINCTURES[MY_COLOR].color));
for (const k of ENEMY_ORDER) thumbs.enemy[k] = thumbnail(k, 'enemy', 48);

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
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ }
}

function flashStat(id, cls) {
  const el = $(id);
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---------- menu ----------
function initMenu() {
  $(`diff-${settings.difficulty}`).checked = true;
  $(`len-${settings.length}`).checked = true;
  $('len-short-about').textContent = MODES.short.about;
  $('len-standard-about').textContent = MODES.standard.about;
  for (const el of document.querySelectorAll('input[name="difficulty"]')) {
    el.addEventListener('change', () => {
      settings.difficulty = el.value;
      store.set('sl.difficulty', el.value);
      renderRecord();
    });
  }
  for (const el of document.querySelectorAll('input[name="length"]')) {
    el.addEventListener('change', () => {
      settings.length = el.value;
      store.set('sl.length', el.value);
    });
  }
  $('btn-start').addEventListener('click', () => { sfx.prime(); goFullscreen(); startMatch(); });
  $('btn-howto').addEventListener('click', () => openHowto());
  renderRecord();
}

function renderRecord() {
  const r = record[settings.difficulty];
  const label = DIFFICULTIES[settings.difficulty].label;
  $('record').textContent = r && (r.w || r.l)
    ? `Your record against ${label}: ${r.w} won, ${r.l} lost`
    : `No games against ${label} yet.`;
}

function show(id) {
  $('menu').hidden = id !== 'menu';
  $('game').hidden = id !== 'game';
  document.body.style.overflow = id === 'game' ? 'hidden' : '';
}

// ---------- how to play ----------
const TOWER_TIPS = {
  archer: 'Cheap and quick. Struggles against shields and armour.',
  cannon: 'Splash damage. Best against packs of Goblins.',
  frost: 'Slows everything it hits so other towers get more shots.',
  ballista: 'Long range, picks the toughest target, ignores armour.',
};
const ENEMY_TIPS = {
  goblin: 'Weak, but come in packs. Cannons shine.',
  scout: 'Fast. Frost slows them down.',
  shield: 'Arrows glance off their shields. Use cannons or ballistae.',
  ogre: 'Tough and armoured; a leak costs 2 lives. Ballistae ignore armour.',
  giant: 'Huge, armoured, half-immune to slows; a leak costs 5 lives.',
};
function fillLegend() {
  const tl = $('legend-towers');
  const el = $('legend-enemies');
  const lv = $('legend-levels');
  tl.textContent = '';
  el.textContent = '';
  lv.textContent = '';
  for (const t of TOWER_ORDER) {
    const li = document.createElement('li');
    li.innerHTML = '<img alt=""><span><b></b> · <span class="c"></span></span>';
    li.querySelector('img').src = thumbs.tower[t][0];
    li.querySelector('b').textContent = `${TOWERS[t].name} (${TOWERS[t].levels[0].cost} gold)`;
    li.querySelector('.c').textContent = TOWER_TIPS[t];
    tl.appendChild(li);
  }
  for (const k of ENEMY_ORDER) {
    const li = document.createElement('li');
    li.innerHTML = '<img alt=""><span><b></b> · <span class="c"></span></span>';
    li.querySelector('img').src = thumbs.enemy[k];
    li.querySelector('b').textContent = ENEMIES[k].plural;
    li.querySelector('.c').textContent = ENEMY_TIPS[k];
    el.appendChild(li);
  }
  for (let i = 0; i < 3; i++) {
    const fig = document.createElement('figure');
    fig.innerHTML = '<img alt=""><figcaption><b></b><span></span></figcaption>';
    fig.querySelector('img').src = thumbs.tower.archer[i];
    fig.querySelector('b').textContent = `Level ${i + 1}`;
    fig.querySelector('span').textContent = LEVEL_NAMES[i];
    lv.appendChild(fig);
  }
}
let howtoResume = false;
function openHowto() {
  howtoResume = false;
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
  const diff = DIFFICULTIES[settings.difficulty];
  match = new Match({
    mode: settings.length,
    emitAll: true,
    players: [
      { id: ME, name: 'You', kind: 'human', color: MY_COLOR, team: 0 },
      { id: BOT, name: `${diff.label} bot`, kind: 'bot', difficulty: settings.difficulty, color: BOT_COLOR, team: 1 },
    ],
  });
  me = match.byId.get(ME);
  opp = match.byId.get(BOT);
  renderer.fx.length = 0;
  renderer.selection = null;
  paused = false;
  speed = 1;
  acc = 0;
  endShown = false;
  firstBuildAt = null;
  plotHintShown = false;
  dangerUntil = 0;
  sel = null;
  closePops();
  setWatching(false, true);
  $('toasts').textContent = '';
  $('opp-note').textContent = '';
  $('end').hidden = true;
  $('pause').hidden = true;
  $('btn-speed').textContent = 'Speed 1×';
  $('btn-speed').setAttribute('aria-pressed', 'false');
  updateSoundButton();
  show('game');
  buildSendBar();
  buildBuildGrid();
  layout();
  requestWakeLock();
  running = true;
  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  if (!coached.built) setTimeout(() => { if (running && !firstBuildAt) toast('Tap a glowing stone plot to build your first tower.', '', 5000); }, 600);
}

function goMenu() {
  running = false;
  cancelAnimationFrame(raf);
  match = null;
  closePops();
  $('pause').hidden = true;
  $('end').hidden = true;
  show('menu');
  releaseWakeLock();
  renderRecord();
}

function pauseGame() {
  if (!running || paused || !match || match.over) return;
  paused = true;
  closePops();
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

// ---------- watching the opponent's lane ----------
function setWatching(on, quiet = false) {
  watching = on;
  closePops();
  renderer.fx.length = 0;
  renderer.bannerColor = TINCTURES[(on ? opp : me).color].color;
  $('game').classList.toggle('is-watching', on);
  $('watching').hidden = !on;
  if (on) {
    $('watching-name').textContent = `${opp.name}'s lane`;
    $('watching-shield').style.fill = TINCTURES[opp.color].color;
  }
  const strip = $('opp');
  strip.setAttribute('aria-label', on ? 'Back to your lane' : `Watch ${opp.name}'s lane`);
  $('opp-watch').textContent = on ? 'Back' : 'Watch';
  $('opp-name').textContent = on ? 'Your road' : opp.name;
  $('opp-shield').style.fill = TINCTURES[(on ? me : opp).color].color;
  $('opp-note').textContent = '';
  strip.classList.remove('danger', 'alert');
  for (const k of ['opp-lives', 'opp-income']) delete cache[k];
  if (!quiet) sfx.play('page');
}
$('opp').addEventListener('click', () => {
  sfx.prime();
  if (!match || match.over) return;
  setWatching(!watching);
  if (watching && !coached.watch) { coached.watch = true; store.set('sl.coached', coached); }
});
$('btn-back').addEventListener('click', () => setWatching(false));

/** True when something on the player's own road is getting close to their gate. */
function gateThreatened() {
  for (const e of me.lane.enemies) {
    if (e.alive && e.d > PATH_LEN * 0.62 && e.hp > e.maxHp * 0.3) return true;
  }
  return false;
}

// ---------- frame loop ----------
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!paused && !match.over) {
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
  const alpha = paused || match.over ? 1 : Math.min(1, acc / DT);
  if (watching) renderer.draw(opp.lane, alpha, now, {});
  else renderer.draw(me.lane, alpha, now, { gold: me.lane.gold, pulse: !firstBuildAt });
  const shown = watching ? me : opp;
  track.draw(shown.lane, { castleColor: TINCTURES[shown.color].color, colorOf: colorOfPlayer, highlight: ME }, alpha, now);
  updateHud(now);
}

function handleEvents(now) {
  const mine = me.lane;
  const theirs = opp.lane;
  renderer.addEvents((watching ? theirs : mine).events, now);
  for (const e of mine.events) {
    if (e.t === 'leak') {
      sfx.play('leak');
      buzz(70);
      flashStat('hud-lives-box', 'hurt');
      if (watching) {
        track.hit(e.lost, now);
        dangerUntil = now + 3000;
      }
    } else if (!watching && e.t === 'fire' && e.kind === 'cannon') {
      sfx.play('boom');
    } else if (e.t === 'income') {
      flashStat('hud-gold-box', 'flash');
    }
  }
  for (const e of theirs.events) {
    if (e.t !== 'leak') continue;
    if (!watching) track.hit(e.lost, now);
    if (e.sentBy === ME) {
      throughBuffer.lives += e.lost;
      throughBuffer.units[e.kind] = (throughBuffer.units[e.kind] || 0) + 1;
      clearTimeout(throughBuffer.timer);
      throughBuffer.timer = setTimeout(flushThrough, 700);
    }
  }
  mine.events.length = 0;
  theirs.events.length = 0;

  for (const e of match.events) {
    switch (e.t) {
      case 'wave':
        sfx.play('wave');
        break;
      case 'send': {
        if (e.to !== ME) break;
        const s = SEND_BY_ID[e.sendId];
        if (!watching) {
          $('opp-note').textContent = `Sent ${s.count} ${unitName(s.unit, s.count)}`;
          const box = $('opp');
          box.classList.add('alert');
          clearTimeout(box._t);
          box._t = setTimeout(() => box.classList.remove('alert'), 1600);
        }
        sfx.play('incoming');
        if (s.id === 'giant' || s.id === 'ogre') toast(`${opp.name} sent ${s.count === 1 ? 'a' : s.count} ${unitName(s.unit, s.count)} your way`, 'warn');
        break;
      }
      case 'unlock': {
        const s = SEND_BY_ID[e.id];
        toast(`You can now send ${ENEMIES[s.unit].plural}.`, 'good', 3200);
        sfx.play('bell');
        break;
      }
      case 'suddenDeath':
        toast('Sudden death: every leak now costs double.', 'bad big', 4000);
        sfx.play('bell');
        buzz(200);
        break;
      case 'over':
        setTimeout(showEnd, 900);
        break;
      default: break;
    }
  }
  match.events.length = 0;

  // Nudge towards sending once the player has a tower or two.
  if (!coached.sent && firstBuildAt != null && match.realTime() - firstBuildAt > 15 && !me.lane.stats.sends) {
    coached.sent = true;
    store.set('sl.coached', coached);
    toast('Tap a creature in the bar below to send it down the bot\'s road. Each send raises your income.', '', 6500);
  }
}

/** One toast for a burst of your units getting into the opponent's castle. */
function flushThrough() {
  if (!match || !throughBuffer.lives) return;
  const kinds = Object.entries(throughBuffer.units);
  const what = kinds.length === 1 && kinds[0][1] === 1
    ? `Your ${ENEMIES[kinds[0][0]].name}`
    : `${kinds.reduce((n, [, c]) => n + c, 0)} of your units`;
  toast(`${what} got through: ${opp.name} −${throughBuffer.lives}`, 'good');
  sfx.play('hit');
  throughBuffer.lives = 0;
  throughBuffer.units = {};
}

// ---------- HUD ----------
const cache = {};
function setText(id, v) {
  if (cache[id] === v) return;
  cache[id] = v;
  $(id).textContent = v;
}
function setHtml(id, v) {
  if (cache[id] === v) return;
  cache[id] = v;
  $(id).innerHTML = v;
}

function nextMilestone() {
  const list = [];
  for (const u of match.unlocks) if (!u.done) list.push({ tick: u.tick, text: `${ENEMIES[SEND_BY_ID[u.id].unit].plural} in` });
  if (!match.suddenDeath) list.push({ tick: match.sdTick, text: 'Sudden death in' });
  list.sort((a, b) => a.tick - b.tick);
  return list[0] || null;
}

function updateHud(now) {
  const lane = me.lane;
  setText('hud-lives', String(lane.lives));
  setText('hud-gold', String(Math.floor(lane.gold)));
  setText('hud-income', `+${lane.payout()}`);
  const prog = 1 - Math.max(0, lane.nextIncome - lane.tick) / lane.incomeEvery;
  const off = (47.12 * (1 - prog)).toFixed(1);
  if (cache.ring !== off) { cache.ring = off; $('hud-ring').style.strokeDashoffset = off; }
  setText('hud-clock', fmtTime(match.realTime()));
  const phase = $('hud-phase');
  if (match.suddenDeath) {
    setText('hud-phase', 'Sudden death');
    phase.classList.add('sd');
  } else {
    phase.classList.remove('sd');
    const m = nextMilestone();
    setText('hud-phase', m ? `${m.text} ${fmtTime((m.tick - match.tick) * DT)}` : '');
  }

  // The strip shows the lane that isn't on the board.
  const shown = watching ? me : opp;
  setText('opp-lives', String(shown.lane.lives));
  setText('opp-income', String(shown.lane.payout()));
  const strip = $('opp');
  if (watching) {
    const danger = now < dangerUntil || gateThreatened();
    strip.classList.toggle('danger', danger);
    setText('opp-note', danger ? 'Enemies near your gate' : '');
  } else {
    let units = 0;
    for (const e of opp.lane.enemies) if (e.alive && e.sentBy === ME) units++;
    for (const q of opp.lane.queue) if (q.sentBy === ME) units++;
    if (!strip.classList.contains('alert')) setText('opp-note', units ? `Yours: ${units}` : '');
  }

  const nw = match.nextWave();
  const sec = Math.ceil(nw.inSec);
  const lead = match.suddenDeath ? '<span class="sd">Leaks cost double.</span> ' : '';
  setHtml('nextwave', `${lead}Wave ${nw.n} in <b>${sec}s</b>: ${escapeHtml(compText(nw.comp))}`);

  updateSendBar();
  const g = Math.floor(lane.gold);
  if (cache.popGold !== g) {
    cache.popGold = g;
    refreshPops();
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- send bar ----------
function buildSendBar() {
  const bar = $('sendbar');
  bar.textContent = '';
  for (const s of SENDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'send';
    b.id = `send-${s.id}`;
    b.setAttribute('aria-label', `Send ${s.count} ${unitName(s.unit, s.count)} for ${s.cost} gold. Income plus ${s.income}.`);
    b.innerHTML = `<span class="count">×${s.count}</span><img alt="" src="${thumbs.enemy[s.unit]}">` +
      `<span class="cost"><svg class="i" aria-hidden="true"><use href="#i-coin"/></svg>${s.cost}</span>` +
      `<span class="inc">+${s.income} inc</span><span class="lock" hidden><svg class="i" aria-hidden="true"><use href="#i-lock"/></svg><span></span></span>`;
    b.addEventListener('click', () => doSend(s.id, b));
    bar.appendChild(b);
  }
}

function updateSendBar() {
  const gold = me.lane.gold;
  for (const s of SENDS) {
    const b = $(`send-${s.id}`);
    const st = match.sendStatus(ME, s.id);
    const locked = st.reason === 'locked';
    const cool = st.reason === 'cooldown';
    const poor = gold < s.cost;
    const key = `${locked}|${cool ? st.frac.toFixed(2) : ''}|${poor}|${locked ? Math.ceil(st.left) : ''}`;
    if (b._key === key) continue;
    b._key = key;
    b.classList.toggle('locked', locked);
    b.classList.toggle('cool', cool);
    b.classList.toggle('poor', poor && !locked);
    b.style.setProperty('--cd', cool ? st.frac.toFixed(3) : '0');
    b.querySelector('.inc').hidden = locked;
    const lock = b.querySelector('.lock');
    lock.hidden = !locked;
    if (locked) lock.lastElementChild.textContent = fmtTime(st.left);
    b.setAttribute('aria-disabled', String(locked || cool || poor));
  }
}

function doSend(id, btn) {
  sfx.prime();
  if (!match || match.over || paused) return;
  const r = match.send(ME, id);
  const s = SEND_BY_ID[id];
  if (r.ok) {
    sfx.play('send');
    btn.classList.remove('sent');
    void btn.offsetWidth;
    btn.classList.add('sent');
    if (!coached.sent) { coached.sent = true; store.set('sl.coached', coached); }
    if (!coached.watch && !watching) {
      coached.watch = true;
      store.set('sl.coached', coached);
      toast(`Your ${unitName(s.unit, s.count)} are marching down the bot's road. Follow them in the strip at the top, or tap it to watch the bot's lane.`, '', 7000);
    }
    return;
  }
  btn.classList.remove('nope');
  void btn.offsetWidth;
  btn.classList.add('nope');
  sfx.play('denied');
  if (r.reason === 'gold') toast(`${unitName(s.unit, s.count)} cost ${s.cost} gold. You need ${Math.ceil(s.cost - me.lane.gold)} more.`);
  else if (r.reason === 'locked') toast(`${ENEMIES[s.unit].plural} can be sent in ${fmtTime(r.left)}.`);
}

// ---------- board input ----------
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  sfx.prime();
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 16 || !match || match.over) return;
  if (watching) { setWatching(false); return; }
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.boardAt(e.clientX - rect.left, e.clientY - rect.top);
  onTap(x, y);
});
canvas.addEventListener('pointercancel', () => { down = null; });

document.addEventListener('pointerdown', (e) => {
  if (!sel) return;
  if (e.target === canvas || e.target.closest('.pop')) return;
  closePops();
}, { capture: true });

function onTap(x, y) {
  const lane = me.lane;
  const plot = nearestPlot(x, y, 0.72);
  if (!plot) {
    closePops();
    if (!plotHintShown) {
      plotHintShown = true;
      toast('Towers can only go on the stone plots.');
    }
    return;
  }
  const { c, r } = plot;
  if (sel && sel.c === c && sel.r === r) { closePops(); return; }
  if (lane.towerAt(c, r)) openTowerPop(c, r);
  else openBuildPop(c, r);
}

function closePops() {
  sel = null;
  renderer.selection = null;
  $('build-pop').hidden = true;
  $('tower-pop').hidden = true;
}

function placePop(pop, c, r) {
  const wrap = $('board-wrap');
  const cs = renderer.cs;
  const cx = canvas.offsetLeft + renderer.sx(c + 0.5);
  const cy = canvas.offsetTop + renderer.sy(r + 0.5);
  pop.style.left = '0px';
  pop.style.top = '0px';
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const left = Math.max(6, Math.min(W - w - 6, cx - w / 2));
  const below = r < ROWS / 2;
  let top = below ? cy + cs * 0.65 : cy - cs * 0.65 - h;
  top = Math.max(4, Math.min(H - h - 4, top));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function buildBuildGrid() {
  const grid = $('build-grid');
  grid.textContent = '';
  for (const t of TOWER_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'build-opt';
    b.id = `build-${t}`;
    b.innerHTML = `<img alt=""><span class="bo-text"><b></b><span class="bo-cost"><svg class="i" aria-hidden="true"><use href="#i-coin"/></svg>${TOWERS[t].levels[0].cost}</span></span>`;
    b.querySelector('img').src = thumbs.tower[t][0];
    b.querySelector('b').textContent = TOWERS[t].short;
    b.setAttribute('aria-label', `Build ${TOWERS[t].name} for ${TOWERS[t].levels[0].cost} gold`);
    b.addEventListener('click', () => doBuild(t));
    grid.appendChild(b);
  }
}

function openBuildPop(c, r) {
  sel = { c, r, kind: 'build' };
  renderer.selection = { c, r, range: null };
  $('tower-pop').hidden = true;
  const pop = $('build-pop');
  pop.hidden = false;
  refreshPops();
  placePop(pop, c, r);
}

function doBuild(type) {
  if (!sel || sel.kind !== 'build' || !match || match.over) return;
  const { c, r } = sel;
  const res = me.lane.build(type, c, r);
  if (res.ok) {
    sfx.play('build');
    closePops();
    renderer.fx.push({ k: 'range', x: c + 0.5, y: r + 0.5, range: TOWERS[type].levels[0].range, t0: performance.now(), dur: 1100 });
    if (firstBuildAt == null) firstBuildAt = match.realTime();
    if (!coached.built) { coached.built = true; store.set('sl.coached', coached); }
  } else if (res.reason === 'gold') {
    sfx.play('denied');
    toast(`${TOWERS[type].name} costs ${TOWERS[type].levels[0].cost} gold. You need ${Math.ceil(TOWERS[type].levels[0].cost - me.lane.gold)} more.`);
  }
}

function towerStats(type, level) {
  const L = TOWERS[type].levels[level];
  const parts = [`Damage ${L.dmg}`, `${L.rate.toFixed(1)}/s`, `Range ${L.range}`];
  if (type === 'cannon') parts.push(`Splash ${L.splash}`);
  if (type === 'frost') parts.push(`Slow ${Math.round(L.slow * 100)}%`);
  return parts.join(' · ');
}

function openTowerPop(c, r) {
  const t = me.lane.towerAt(c, r);
  if (!t) return;
  sel = { c, r, kind: 'tower' };
  renderer.selection = { c, r, range: TOWERS[t.type].levels[t.level].range };
  $('build-pop').hidden = true;
  const pop = $('tower-pop');
  pop.hidden = false;
  refreshPops();
  placePop(pop, c, r);
}

function refreshPops() {
  if (!sel || !match) return;
  const lane = me.lane;
  if (sel.kind === 'build') {
    for (const t of TOWER_ORDER) {
      const b = $(`build-${t}`);
      b.classList.toggle('poor', lane.gold < TOWERS[t].levels[0].cost);
    }
    return;
  }
  const t = lane.towerAt(sel.c, sel.r);
  if (!t) { closePops(); return; }
  const def = TOWERS[t.type];
  $('tp-icon').src = thumbs.tower[t.type][t.level];
  $('tp-name').textContent = def.name;
  $('tp-level').textContent = `Level ${t.level + 1} of ${def.levels.length}: ${LEVEL_NAMES[t.level]} · ${t.kills} kills`;
  $('tp-stats').textContent = towerStats(t.type, t.level);
  const cost = lane.upgradeCost(t);
  const up = $('tp-upgrade');
  up.textContent = '';
  if (cost == null) {
    up.textContent = 'Fully upgraded';
    up.disabled = true;
    up.classList.remove('poor');
    $('tp-role').textContent = def.role;
  } else {
    up.disabled = false;
    const wrap = document.createElement('span');
    wrap.className = 'up-preview';
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbs.tower[t.type][t.level + 1];
    wrap.append(img, `Upgrade ${cost}`);
    up.append(wrap);
    up.setAttribute('aria-label', `Upgrade to level ${t.level + 2} for ${cost} gold`);
    up.classList.toggle('poor', lane.gold < cost);
    const N = def.levels[t.level + 1];
    $('tp-role').textContent = `Level ${t.level + 2} (${LEVEL_NAMES[t.level + 1]}): damage ${N.dmg}, ${N.rate.toFixed(1)}/s, range ${N.range}${N.slow ? `, slow ${Math.round(N.slow * 100)}%` : ''}${N.splash ? `, splash ${N.splash}` : ''}.`;
  }
  const value = lane.sellValue(t);
  $('tp-sell').textContent = lane.canUndo(t) ? `Undo · +${value}` : `Sell · +${value}`;
  renderer.selection = { c: sel.c, r: sel.r, range: def.levels[t.level].range };
}

$('tp-upgrade').addEventListener('click', () => {
  if (!sel || sel.kind !== 'tower' || !match || match.over) return;
  const t = me.lane.towerAt(sel.c, sel.r);
  if (!t) return;
  const cost = me.lane.upgradeCost(t);
  const res = me.lane.upgrade(sel.c, sel.r);
  if (res.ok) {
    sfx.play('upgrade');
    cache.popGold = null;
    refreshPops();
  } else if (res.reason === 'gold') {
    sfx.play('denied');
    toast(`The upgrade costs ${cost} gold. You need ${Math.ceil(cost - me.lane.gold)} more.`);
  }
});
$('tp-sell').addEventListener('click', () => {
  if (!sel || sel.kind !== 'tower' || !match || match.over) return;
  const res = me.lane.sell(sel.c, sel.r);
  if (res.ok) {
    sfx.play('sell');
    closePops();
  }
});

// ---------- layout ----------
function layout() {
  const wrap = $('board-wrap');
  const cs = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  renderer.layout(w, h);
  track.resize();
  if (sel) placePop(sel.kind === 'build' ? $('build-pop') : $('tower-pop'), sel.c, sel.r);
}
window.addEventListener('resize', () => { if (running) layout(); });

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
  store.set('sl.sound', settings.sound);
  if (settings.sound) sfx.prime();
  updateSoundButton();
});
$('btn-howto2').addEventListener('click', () => {
  $('pause').hidden = true;
  openHowto();
  howtoResume = true;
});
$('btn-quit').addEventListener('click', goMenu);
$('btn-again').addEventListener('click', () => { sfx.prime(); startMatch(); });
$('btn-menu').addEventListener('click', goMenu);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
  else if (running) requestWakeLock();
});

function showEnd() {
  if (endShown || !match) return;
  endShown = true;
  closePops();
  const res = match.result;
  const won = res && res.winnerTeam === me.team;
  const draw = !res || res.winnerTeam == null;
  const diff = settings.difficulty;
  const r = record[diff] || { w: 0, l: 0 };
  if (won) r.w++;
  else if (!draw) r.l++;
  record[diff] = r;
  store.set('sl.record', record);

  const t = fmtTime(match.realTime());
  $('end-eyebrow').textContent = `Practice · ${DIFFICULTIES[diff].label} bot · ${MODES[settings.length].label}`;
  const title = $('end-title');
  title.textContent = won ? 'Victory' : draw ? 'Stalemate' : 'Defeat';
  title.className = `end-title ${won ? 'win' : 'loss'}`;
  $('end-sub').textContent = won
    ? `The bot's castle fell at ${t}. You had ${me.lane.lives} ${me.lane.lives === 1 ? 'life' : 'lives'} left.`
    : draw
      ? `Both castles fell at ${t}.`
      : `Your castle fell at ${t}. The bot had ${opp.lane.lives} ${opp.lane.lives === 1 ? 'life' : 'lives'} left.`;
  const s = me.lane.stats;
  const through = opp.lane.stats.livesLostTo[ME] || 0;
  const rows = [
    ['Enemies slain', s.kills],
    ['Leaked', s.leaks],
    ['Towers built', `${s.built}${s.upgrades ? ` (+${s.upgrades} upgrades)` : ''}`],
    ['Enemies sent', s.unitsSent],
    ['Lives you took', through],
    ['Final income', `+${me.lane.payout()}`],
    [`Record vs ${DIFFICULTIES[diff].label}`, `${r.w}–${r.l}`],
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
  $('btn-again').focus();
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
  // Phones only: more room for the board. Ignored where unsupported (iPhone Safari).
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => { try { screen.orientation.lock('portrait').catch(() => {}); } catch { /* no lock */ } })
    .catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (running) setTimeout(layout, 50); });

// ---------- boot ----------
fillLegend();
initMenu();
show('menu');

// Handle for automated checks in a browser; does nothing on its own.
window.__sl = { get match() { return match; }, renderer, get watching() { return watching; } };
