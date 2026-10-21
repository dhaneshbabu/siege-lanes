// Phone-to-phone links for Play with friends. A free public matchmaker (PeerJS) introduces the
// phones to each other; after that every game message goes straight between them over a WebRTC
// data channel (or through a relay when two networks won't allow a direct route).
//
// HostRoom: the phone that runs the game. It registers a short code on the matchmaker and accepts
// links from the other phones. GuestLink: a phone joining by code. Both keep retrying quietly
// when a link drops, so a phone that locks for a moment or switches networks gets back in.
/* global Peer */

export const PROTO = 1;
const PREFIX = 'pk1-'; // keeps our codes apart from other apps on the shared matchmaker
const ALPHA = 'BCDFGHJKLMNPQRSTVWXZ'; // consonants only: easy to read out and never spells a word
const CONNECT_TIMEOUT_MS = 15000;
const PING_MS = 2000;
const SILENT_MS = 9000; // a guest gives up on a host it hasn't heard from in this long and relinks

const params = new URLSearchParams(location.search);

/** Matchmaker settings. ?server=host:port&insecure=1 points at a local PeerJS server for testing. */
function peerOptions() {
  const o = { debug: 1 };
  const sv = params.get('server');
  if (sv) {
    const [host, port] = sv.split(':');
    o.host = host;
    o.port = Number(port) || 9000;
    o.path = '/';
    o.secure = !params.has('insecure');
  }
  return o;
}

export function randomCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => ALPHA[n % ALPHA.length]).join('');
}
export function randomId(len = 12) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => 'abcdefghijkmnpqrstuvwxyz23456789'[n % 32]).join('');
}
export const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
export function cleanName(v) {
  if (typeof v !== 'string') return '';
  // No control or invisible formatting characters; short enough for the score chips.
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}
const validCid = (v) => (typeof v === 'string' && /^[a-z0-9]{6,24}$/.test(v) ? v : '');
export const peerAvailable = () => typeof Peer === 'function';

function safeSend(conn, msg) {
  try {
    if (conn && conn.open) {
      conn.send(msg);
      return true;
    }
  } catch { /* channel closing */ }
  return false;
}
function safeClose(conn) {
  try { if (conn) conn.close(); } catch { /* already closed */ }
}

const BROKER_TROUBLE = ['network', 'server-error', 'socket-error', 'socket-closed', 'ssl-unavailable'];

// ---------- host ----------
export class HostRoom {
  /**
   * handlers: {
   *   onStatus(state)            matchmaker state: connecting | online | offline | failed
   *   onCode(code)               the code changed (the first choice was taken)
   *   accept({ cid, name, known }) -> { ok, why }   admit a phone or turn it away
   *   onJoin(guest, again)       a phone is linked (again: it was here before)
   *   onLeave(guest)             a phone's link closed
   *   onMessage(guest, msg)
   * }
   */
  constructor(handlers) {
    this.h = handlers;
    this.code = '';
    this.peer = null;
    this.guests = new Map(); // cid -> { cid, name, conn, open, rtt, lastHeard }
    this.state = 'idle';
    this.failWhy = ''; // nopeer: the networking code didn't load; webrtc: the browser can't
    this.closed = false;
    this.resumed = false;
    this.idRetries = 0;
    this.timer = 0;
    this.pinger = 0;
  }

  /** Register a code (a new random one, or the one from before a reload). */
  open(code) {
    this.code = code || randomCode();
    this.resumed = !!code;
    this.makePeer();
    this.pinger = setInterval(() => this.ping(), PING_MS);
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (this.h.onStatus) this.h.onStatus(s);
  }

  later(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      if (!this.closed) fn();
    }, ms);
  }

  makePeer() {
    if (!peerAvailable()) {
      this.failWhy = 'nopeer';
      this.setState('failed');
      return;
    }
    this.setState('connecting');
    const p = new Peer(PREFIX + this.code, peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      this.idRetries = 0;
      this.setState('online');
    });
    p.on('connection', (conn) => {
      if (this.peer === p && !this.closed) this.acceptConn(conn);
      else safeClose(conn);
    });
    p.on('disconnected', () => {
      // Only the matchmaker is gone; links already made keep working. Reconnect so new phones can join.
      if (this.peer !== p || this.closed) return;
      this.setState('offline');
      this.later(1500, () => this.kick());
    });
    p.on('error', (err) => this.onError(p, err));
  }

  kick() {
    if (this.closed || document.hidden) {
      if (!this.closed) this.later(1000, () => this.kick());
      return;
    }
    let p = this.peer;
    if (p && p.destroyed) {
      this.peer = null;
      p = null;
    }
    if (!p) {
      this.makePeer();
      return;
    }
    if (p.disconnected) {
      this.setState('connecting');
      try { p.reconnect(); } catch {
        this.peer = null;
        try { p.destroy(); } catch { /* ignore */ }
        this.makePeer();
      }
    }
  }

  onError(p, err) {
    if (this.peer !== p || this.closed) return;
    const type = (err && err.type) || 'unknown';
    if (type === 'unavailable-id') {
      // The code is still held: by another game, or by this phone from just before a reload.
      this.idRetries++;
      this.peer = null;
      try { p.destroy(); } catch { /* ignore */ }
      if (!this.resumed || this.idRetries > 12) {
        this.resumed = false;
        this.idRetries = 0;
        this.code = randomCode();
        if (this.h.onCode) this.h.onCode(this.code);
        this.later(100, () => this.makePeer());
      } else {
        this.later(2500, () => this.makePeer());
      }
      return;
    }
    if (type === 'browser-incompatible') {
      this.failWhy = 'webrtc';
      this.setState('failed');
      return;
    }
    if (BROKER_TROUBLE.includes(type)) {
      this.setState('offline');
      this.later(3000, () => this.kick());
    }
    // PeerJS destroys the peer itself after some errors; start a fresh one when that happens.
    queueMicrotask(() => {
      if (this.peer === p && p.destroyed && !this.closed) {
        this.peer = null;
        this.later(2500, () => this.kick());
      }
    });
  }

  byConn(conn) {
    for (const g of this.guests.values()) if (g.conn === conn) return g;
    return null;
  }

  acceptConn(conn) {
    let greeted = false;
    const watchdog = setTimeout(() => { if (!greeted) safeClose(conn); }, CONNECT_TIMEOUT_MS);
    conn.on('data', (msg) => {
      if (this.closed || !msg || typeof msg !== 'object') return;
      if (!greeted) {
        if (msg.t !== 'hello') return;
        greeted = true;
        clearTimeout(watchdog);
        this.hello(conn, msg);
        return;
      }
      const g = this.byConn(conn);
      if (!g) return;
      g.lastHeard = performance.now();
      if (msg.t === 'ping') {
        safeSend(conn, { t: 'pong', ts: msg.ts });
        return;
      }
      if (msg.t === 'pong') {
        const rtt = performance.now() - msg.ts;
        if (rtt >= 0 && rtt < 60000) g.rtt = g.rtt == null ? rtt : g.rtt * 0.7 + rtt * 0.3;
        return;
      }
      this.h.onMessage(g, msg);
    });
    conn.on('close', () => {
      clearTimeout(watchdog);
      const g = this.byConn(conn);
      if (!g) return;
      g.conn = null;
      g.open = false;
      if (!this.closed) this.h.onLeave(g);
    });
    conn.on('error', () => { /* a close follows */ });
  }

  hello(conn, msg) {
    const reject = (why) => {
      safeSend(conn, { t: 'reject', why });
      setTimeout(() => safeClose(conn), 600);
    };
    if (msg.v !== PROTO) {
      reject('version');
      return;
    }
    const cid = validCid(msg.cid);
    if (!cid) {
      reject('bad');
      return;
    }
    const name = cleanName(msg.name) || 'Friend';
    const known = this.guests.get(cid);
    const verdict = this.h.accept({ cid, name, known: !!known });
    if (!verdict || !verdict.ok) {
      reject((verdict && verdict.why) || 'full');
      return;
    }
    let g = known;
    if (!g) {
      g = { cid, name, conn: null, open: false, rtt: null, lastHeard: 0 };
      this.guests.set(cid, g);
    }
    const old = g.conn;
    g.conn = conn;
    if (old && old !== conn) safeClose(old);
    g.name = name;
    g.open = true;
    g.lastHeard = performance.now();
    safeSend(conn, { t: 'welcome', v: PROTO, code: this.code });
    this.h.onJoin(g, !!known);
  }

  send(cid, msg) {
    const g = this.guests.get(cid);
    return !!g && safeSend(g.conn, msg);
  }

  broadcast(msg) {
    for (const g of this.guests.values()) safeSend(g.conn, msg);
  }

  /** Forget a phone (it left). */
  drop(cid) {
    const g = this.guests.get(cid);
    if (!g) return;
    this.guests.delete(cid);
    const c = g.conn;
    g.conn = null;
    g.open = false;
    safeClose(c);
  }

  ping() {
    if (this.closed || document.hidden) return;
    const ts = performance.now();
    for (const g of this.guests.values()) safeSend(g.conn, { t: 'ping', ts });
  }

  /** Back in front after the screen was off: check the matchmaker straight away. */
  wake() {
    if (this.closed) return;
    const p = this.peer;
    if (!p || p.destroyed || p.disconnected) this.later(200, () => this.kick());
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    for (const g of this.guests.values()) safeClose(g.conn);
    this.guests.clear();
    const p = this.peer;
    this.peer = null;
    // Give the goodbye messages a moment to leave before tearing the links down.
    setTimeout(() => { try { if (p) p.destroy(); } catch { /* ignore */ } }, 300);
  }
}

// ---------- guest ----------
export class GuestLink {
  /**
   * handlers: {
   *   onState(state, why)  connecting | open | lost | failed (why: nohost | version | full | started | webrtc | ...)
   *   onMessage(msg)       everything from the host after the welcome (the welcome included)
   * }
   */
  constructor(handlers) {
    this.h = handlers;
    this.state = 'idle';
    this.closed = false;
    this.peer = null;
    this.conn = null;
    this.welcomed = false;
    this.everOpen = false;
    this.attempts = 0;
    this.missing = 0; // times the matchmaker said no phone has the code
    this.lastHeard = 0;
    this.visibleAt = 0;
    this.rtt = null;
    this.timer = 0;
    this.pinger = 0;
  }

  open(code, name, cid) {
    this.code = code;
    this.name = name;
    this.cid = cid;
    this.setState('connecting');
    this.makePeer();
    this.pinger = setInterval(() => this.tick(), PING_MS);
  }

  setState(s, why = '') {
    if (this.state === s && !why) return;
    this.state = s;
    if (this.h.onState) this.h.onState(s, why);
  }

  later(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      if (!this.closed) fn();
    }, ms);
  }

  fail(why) {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    const c = this.conn;
    this.conn = null;
    safeClose(c);
    const p = this.peer;
    this.peer = null;
    try { if (p) p.destroy(); } catch { /* ignore */ }
    this.state = 'failed';
    if (this.h.onState) this.h.onState('failed', why);
  }

  makePeer() {
    if (!peerAvailable()) {
      this.fail('nopeer');
      return;
    }
    const p = new Peer(peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer === p) this.connect();
    });
    p.on('connection', (conn) => safeClose(conn));
    p.on('disconnected', () => {
      // The matchmaker is only needed to make a link; reconnect in the background for next time.
      if (this.peer === p && !this.closed) this.later(2000, () => this.kick());
    });
    p.on('error', (err) => this.onError(p, err));
  }

  kick() {
    if (this.closed) return;
    if (document.hidden) {
      this.later(1000, () => this.kick());
      return;
    }
    let p = this.peer;
    if (p && p.destroyed) {
      this.peer = null;
      p = null;
    }
    if (!p) {
      this.makePeer();
      return;
    }
    if (p.disconnected) {
      try { p.reconnect(); } catch {
        this.peer = null;
        try { p.destroy(); } catch { /* ignore */ }
        this.makePeer();
      }
      return;
    }
    if (p.open && !this.conn) this.connect();
  }

  onError(p, err) {
    if (this.peer !== p || this.closed) return;
    const type = (err && err.type) || 'unknown';
    if (type === 'peer-unavailable') {
      // Nobody holds that code right now. Before the first link that's a wrong code (or the host
      // left); after it, the host is probably reloading, so keep looking for a while.
      this.missing++;
      const c = this.conn;
      this.conn = null;
      safeClose(c);
      if (!this.everOpen && this.missing >= 3) {
        this.fail('nohost');
        return;
      }
      if (this.everOpen && this.missing > 40) {
        this.fail('gone');
        return;
      }
      this.setState(this.everOpen ? 'lost' : 'connecting', this.everOpen ? '' : 'searching');
      this.later(this.everOpen ? 3000 : 2000, () => this.kick());
      return;
    }
    if (type === 'browser-incompatible') {
      this.fail('webrtc');
      return;
    }
    if (BROKER_TROUBLE.includes(type)) this.later(3000, () => this.kick());
    queueMicrotask(() => {
      if (this.peer === p && p.destroyed && !this.closed) {
        this.peer = null;
        this.later(2500, () => this.kick());
      }
    });
  }

  connect() {
    if (this.closed || this.conn) return;
    const p = this.peer;
    if (!p || p.destroyed || p.disconnected || !p.open) {
      this.later(800, () => this.kick());
      return;
    }
    this.attempts++;
    let conn;
    try {
      conn = p.connect(PREFIX + this.code, { reliable: true, serialization: 'json', metadata: { cid: this.cid } });
    } catch { conn = null; }
    if (!conn) {
      this.later(2000, () => this.kick());
      return;
    }
    this.conn = conn;
    this.welcomed = false;
    const watchdog = setTimeout(() => {
      if (this.conn === conn && !this.welcomed) this.lost(conn);
    }, CONNECT_TIMEOUT_MS);
    conn.on('open', () => {
      if (this.conn === conn) safeSend(conn, { t: 'hello', v: PROTO, cid: this.cid, name: this.name });
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn || !msg || typeof msg !== 'object') return;
      this.lastHeard = performance.now();
      switch (msg.t) {
        case 'ping':
          safeSend(conn, { t: 'pong', ts: msg.ts });
          return;
        case 'pong': {
          const rtt = performance.now() - msg.ts;
          if (rtt >= 0 && rtt < 60000) this.rtt = this.rtt == null ? rtt : this.rtt * 0.7 + rtt * 0.3;
          return;
        }
        case 'reject':
          clearTimeout(watchdog);
          this.fail(typeof msg.why === 'string' ? msg.why : 'full');
          return;
        case 'welcome':
          clearTimeout(watchdog);
          this.welcomed = true;
          this.everOpen = true;
          this.attempts = 0;
          this.missing = 0;
          this.setState('open');
          break;
        default:
          if (!this.welcomed) return;
      }
      this.h.onMessage(msg);
    });
    conn.on('close', () => {
      clearTimeout(watchdog);
      if (this.conn === conn) this.lost(conn);
    });
    conn.on('error', () => { /* a close follows */ });
  }

  lost(conn) {
    if (this.conn !== conn) return;
    this.conn = null;
    this.welcomed = false;
    safeClose(conn);
    if (this.closed) return;
    this.setState(this.everOpen ? 'lost' : 'connecting');
    this.later(1500, () => this.kick());
  }

  /** Linked and welcomed: messages get through. */
  get ready() { return !!(this.conn && this.welcomed && this.conn.open); }

  send(msg) {
    return this.welcomed && safeSend(this.conn, msg);
  }

  tick() {
    if (this.closed || document.hidden) return;
    if (this.ready) safeSend(this.conn, { t: 'ping', ts: performance.now() });
    // A host that has gone quiet (its phone switched networks, say): drop the link and make a new one.
    const settling = performance.now() - this.visibleAt < 3000;
    if (this.welcomed && !settling && performance.now() - this.lastHeard > SILENT_MS) this.lost(this.conn);
  }

  /** Back in front after the screen was off. */
  wake() {
    if (this.closed) return;
    this.visibleAt = performance.now();
    const p = this.peer;
    if (!p || p.destroyed || p.disconnected || !this.conn) this.later(300, () => this.kick());
  }

  close(goodbye) {
    if (goodbye) this.send(goodbye);
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    const c = this.conn;
    const p = this.peer;
    this.conn = null;
    this.peer = null;
    setTimeout(() => {
      safeClose(c);
      try { if (p) p.destroy(); } catch { /* ignore */ }
    }, 300);
  }
}
