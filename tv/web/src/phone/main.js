// Phone controller for Powder Keg on the TV: join and get ready, then a stick and a Keg button.
// It sends stick changes at once and repeats the current state every 250 ms, so nothing sticks
// if a message goes missing. Keg presses are counted, so the TV never misses or doubles one.
import { Controls } from '../../../../arena/src/input.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('powderkeg.' + key); return v == null ? fallback : v; } catch { return fallback; } },
  set(key, v) { try { localStorage.setItem('powderkeg.' + key, v); } catch { /* private mode */ } },
};
let id = store.get('id', '');
if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
  id = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
  store.set('id', id);
}

let ws = null;
let retry = 0;
let state = null;
let pingTimer = null;
let kegs = 0; // presses so far
let last = { d: -1, a: -1 };
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ } };

const controls = new Controls({
  zone: $('#stick-zone'),
  base: $('#stick-base'),
  knob: $('#stick-knob'),
  kegBtn: $('#keg-btn'),
  onKeg: () => {
    kegs++;
    sendInput();
    vibrate(15);
  },
});

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?role=player&id=${id}`);
  ws.onopen = () => {
    retry = 0;
    sendHello();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 3000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    onMessage(msg);
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    state = null;
    show('s-connect');
    $('#connect-text').textContent = retry > 2 ? "Can't reach the TV. Is Powder Keg open on it, and is this phone on the same Wi-Fi?" : 'Connecting to the TV…';
    setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
  };
  ws.onerror = () => { try { ws.close(); } catch { /* closing */ } };
}

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendHello() { send({ t: 'hello', name: store.get('name', ''), k: kegs }); }

function onMessage(msg) {
  switch (msg.t) {
    case 'state': state = msg; render(); break;
    case 'hud': renderHud(msg); break;
    case 'buzz': vibrate(Math.max(10, Math.min(400, msg.ms | 0))); break;
    case 'hostgone':
      show('s-connect');
      $('#connect-text').textContent = 'The TV game closed. Waiting for it to come back…';
      break;
    case 'hostback': sendHello(); break;
    default: break;
  }
}

function show(screen) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screen;
  const pad = screen === 's-pad';
  if (!pad) {
    controls.enabled = false;
    controls.reset();
  }
}

function render() {
  const st = state;
  if (st.full) { show('s-full'); return; }
  if (st.waiting) { show('s-wait'); return; }
  if (!st.you) return;
  document.documentElement.style.setProperty('--knight', st.you.color);
  if (st.phase === 'lobby') renderJoin(st);
  else if (st.phase === 'results') renderResult(st);
  else renderPad(st);
}

function renderJoin(st) {
  show('s-join');
  const you = st.you;
  const name = $('#name');
  if (document.activeElement !== name) name.value = you.name;
  $('#knight-name').textContent = `You're the ${you.colorName} knight`;
  $('#knight-sub').textContent = st.outside ? `No seat for you in ${st.format} yet.` : `${st.format}${st.teams ? (you.side === 0 ? ' · blue side' : ' · red side') : ''}`;
  $('#sides').hidden = !st.teams;
  if (st.teams) {
    for (const s of [0, 1]) {
      const b = $(`#side${s}`);
      b.classList.toggle('on', you.side === s);
      b.disabled = you.side !== s && st.sideFree && !st.sideFree[s];
    }
  }
  const ready = $('#ready');
  ready.classList.toggle('on', you.ready);
  ready.textContent = you.ready ? 'Ready · tap to cancel' : "I'm ready";
  $('#join-hint').textContent = you.ready
    ? 'Waiting for the others, or for Start on the TV.'
    : 'In the match: drag on the left to run, tap Keg to drop a powder keg.';
}

function renderPad(st) {
  show('s-pad');
  $('#pad-name').textContent = st.you.name;
  const ov = $('#pad-overlay');
  const msg = st.msg || '';
  ov.hidden = !msg;
  ov.textContent = msg;
  ov.className = `pad-overlay${/^\d$/.test(msg) ? ' count' : ''}`;
  const live = st.phase === 'play' && !msg;
  controls.enabled = live;
  if (!live) controls.reset();
  if (st.phase !== 'play') $('#pad-info').textContent = st.format;
}

function renderHud(h) {
  if (!state || state.phase !== 'play') return;
  $('#keg-count').textContent = String(h.ready);
  $('#keg-btn').classList.toggle('empty', !h.alive || h.ready <= 0);
  $('#pad-info').textContent = !h.alive ? 'Out this round' : h.auto ? 'A bot is playing for you · move to take over' : `${h.ready} of ${h.kegs} kegs ready`;
}

function renderResult(st) {
  show('s-result');
  const r = st.result;
  const title = $('#r-title');
  title.textContent = r ? (r.won ? 'Victory' : 'Defeat') : '–';
  title.className = `result${r && r.won ? ' win' : ''}`;
  $('#r-kicker').textContent = r ? r.title : 'The match is over';
  $('#r-detail').textContent = r ? `${r.rounds} of ${r.target} round wins · ${r.kills} knocked out` : '';
  const again = $('#again');
  again.classList.toggle('on', st.you.ready);
  again.textContent = st.you.ready ? 'Waiting for the others…' : 'Play again';
}

// ---------- sending the controls ----------
function dirCode(d) {
  if (!d) return 0;
  if (d.x) return d.x < 0 ? 1 : 2;
  return d.y < 0 ? 3 : 4;
}
function sendInput() {
  const r = controls.read();
  last = { d: dirCode(r.dir), a: dirCode(r.alt) };
  send({ t: 'in', d: last.d, a: last.a, k: kegs });
}
function poll() {
  requestAnimationFrame(poll);
  if (!controls.enabled) {
    if (last.d !== 0 || last.a !== 0) sendInput();
    return;
  }
  const r = controls.read();
  const d = dirCode(r.dir);
  const a = dirCode(r.alt);
  if (d !== last.d || a !== last.a) sendInput();
}
setInterval(() => { if (state && (state.phase === 'play' || state.phase === 'countdown')) sendInput(); }, 250);

// ---------- join screen ----------
let nameTimer = null;
$('#name').addEventListener('input', () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => {
    const v = $('#name').value.trim().slice(0, 12);
    if (!v) return;
    store.set('name', v);
    send({ t: 'set', name: v });
  }, 400);
});
$('#ready').addEventListener('click', () => {
  const v = $('#name').value.trim().slice(0, 12);
  if (v) store.set('name', v);
  send({ t: 'set', name: v || undefined, ready: !(state && state.you && state.you.ready) });
  goFullscreen();
});
for (const s of [0, 1]) $(`#side${s}`).addEventListener('click', () => send({ t: 'set', side: s }));
$('#again').addEventListener('click', () => send({ t: 'again' }));
document.addEventListener('contextmenu', (e) => e.preventDefault());

function goFullscreen() {
  // Android phones: hide the browser bars for more room. iPhones ignore it.
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

connect();
requestAnimationFrame(poll);
