// The lobby for Play with friends: the game code and invite, who's in which seat, and the match
// settings. It only draws what it's given and reports taps; main.js does the networking.
/* global qrcode */
import { SIDES, FORMATS } from './config.js';

const $ = (id) => document.getElementById(id);
export const PLAIN = { azure: 'blue', gules: 'red', vert: 'green', purpure: 'purple' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class LobbyView {
  /** handlers: { onSeat(i), onSetting(key, value), onStart(), onLeave(), onShare() } */
  constructor(handlers) {
    this.h = handlers;
    this.qrFor = '';
    for (const key of ['format', 'difficulty', 'target']) {
      for (const el of document.querySelectorAll(`input[name="l${key}"]`)) {
        el.addEventListener('change', () => {
          if (el.checked) this.h.onSetting(key, key === 'target' ? Number(el.value) : el.value);
        });
      }
    }
    $('btn-lobby-start').addEventListener('click', () => this.h.onStart());
    $('btn-lobby-leave').addEventListener('click', () => this.h.onLeave());
    $('btn-share').addEventListener('click', () => this.h.onShare());
    $('seats').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-seat]');
      if (b) this.h.onSeat(Number(b.dataset.seat));
    });
  }

  /**
   * vm: { role, code, status, statusCls, inviteUrl, siteUrl, format, difficulty, target, editable,
   *       seats: [{ i, kind, name, me, online, ping, outside }], selected, hint, startEnabled,
   *       startNote, waitText, error }
   */
  render(vm) {
    $('lobby-code').textContent = vm.code || '····';
    const st = $('lobby-status');
    st.textContent = vm.status || '';
    st.className = `lobby-status ${vm.statusCls || ''}`.trim();

    const host = vm.role === 'host';
    $('invite-card').hidden = !host || !vm.code;
    if (host && vm.code) {
      $('invite-url').textContent = vm.siteUrl;
      if (this.qrFor !== vm.inviteUrl) this.drawQR(vm.inviteUrl);
    }

    this.renderSeats(vm);
    $('seats-hint').textContent = vm.hint || '';
    $('seats-hint').hidden = !vm.hint;

    // Settings: the host picks; everyone else sees the host's choice.
    for (const key of ['format', 'difficulty', 'target']) {
      for (const el of document.querySelectorAll(`input[name="l${key}"]`)) {
        el.checked = String(vm[key]) === el.value;
        el.disabled = !vm.editable;
      }
    }
    $('lobby-settings').classList.toggle('readonly', !vm.editable);
    const bots = vm.seats.some((s) => s.kind === 'bot' && !s.outside);
    $('lseg-difficulty').hidden = !bots && !vm.editable;

    const start = $('btn-lobby-start');
    start.hidden = !host;
    start.disabled = !vm.startEnabled;
    $('lobby-note').textContent = vm.startNote || '';
    $('lobby-note').hidden = !vm.startNote;
    $('lobby-wait').textContent = vm.waitText || '';
    $('lobby-wait').hidden = !vm.waitText;
    $('btn-lobby-leave').textContent = host ? 'Close the game' : 'Leave';
    const err = $('lobby-error');
    err.textContent = vm.error || vm.note || '';
    err.classList.toggle('info', !vm.error && !!vm.note);
    err.hidden = !vm.error && !vm.note;
  }

  renderSeats(vm) {
    const ul = $('seats');
    ul.textContent = '';
    const teams = vm.format === 'teams';
    const P = FORMATS[vm.format].players;
    for (const s of vm.seats) {
      if (teams && !s.outside && (s.i === 0 || s.i === 2)) {
        const g = document.createElement('li');
        g.className = 'seat-group';
        g.textContent = s.i === 0 ? 'Blue and red side' : 'Green and purple side';
        ul.appendChild(g);
      }
      if (s.outside && s === vm.seats.find((q) => q.outside)) {
        const g = document.createElement('li');
        g.className = 'seat-group warn';
        g.textContent = `No room in a ${P}-knight match`;
        ul.appendChild(g);
      }
      const li = document.createElement('li');
      li.className = 'seat';
      const side = SIDES[s.i];
      const el = document.createElement(vm.editable ? 'button' : 'div');
      el.className = 'seat-row';
      if (vm.editable) {
        el.type = 'button';
        el.dataset.seat = String(s.i);
        el.setAttribute('aria-pressed', String(vm.selected === s.i));
      }
      el.classList.toggle('sel', vm.selected === s.i);
      el.classList.toggle('me', !!s.me);
      el.classList.toggle('bot', s.kind === 'bot');
      el.classList.toggle('off', s.kind === 'guest' && !s.online);
      el.innerHTML = '<svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><use href="#i-shield"/></svg>'
        + '<span class="seat-txt"><span class="seat-name"></span><span class="seat-sub"></span></span><span class="seat-tags"></span>';
      el.querySelector('.shield').style.fill = side.color;
      el.querySelector('.seat-name').textContent = s.name;
      let sub = `${cap(PLAIN[side.key])} knight`;
      if (s.kind === 'guest') sub += s.online ? (s.ping != null ? ` · ${Math.round(s.ping)} ms` : '') : ' · reconnecting…';
      el.querySelector('.seat-sub').textContent = sub;
      const tags = el.querySelector('.seat-tags');
      const tag = (text, cls = '') => {
        const t = document.createElement('span');
        t.className = `tag ${cls}`.trim();
        t.textContent = text;
        tags.appendChild(t);
      };
      if (s.kind === 'host') tag('Host');
      if (s.me) tag('You', 'me');
      if (s.kind === 'bot') tag('Bot', 'bot');
      li.appendChild(el);
      ul.appendChild(li);
    }
  }

  drawQR(url) {
    const box = $('lobby-qr');
    box.textContent = '';
    this.qrFor = url;
    if (typeof qrcode !== 'function' || !url) return;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const m = 3; // quiet zone, in modules
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const size = n + 2 * m;
    box.innerHTML = `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}"/><path d="${d}"/></svg>`;
  }
}
