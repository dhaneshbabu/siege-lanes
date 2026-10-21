// Touch and keyboard controls. The stick appears wherever your thumb lands in its zone; the keg
// button drops a keg on touch-down. The game reads both once per tick.

const DEAD = 12; // px before the stick counts as pushed
const REACH = 46; // px from the centre to full push

export class Controls {
  constructor({ zone, base, knob, kegBtn, onKeg }) {
    this.zone = zone;
    this.base = base;
    this.knob = knob;
    this.kegBtn = kegBtn;
    this.onKeg = onKeg;
    this.enabled = false;
    this.stick = null; // { id, ox, oy, x, y }
    this.keys = []; // held direction keys, most recent last
    this.kegQueued = false;
    this.bindStick();
    this.bindKeg();
    this.bindKeys();
    this.rest();
  }

  /** Direction and fallback direction for the sim, or nulls. */
  read() {
    if (!this.enabled) return { dir: null, alt: null };
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const m = Math.hypot(dx, dy);
      if (m < DEAD) return { dir: null, alt: null };
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const main = ax >= ay ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      // Pushing diagonally: the other axis is a fallback for turning corners.
      const minor = ax >= ay ? ay : ax;
      const alt = minor > m * 0.38 ? (ax >= ay ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 }) : null;
      return { dir: main, alt };
    }
    if (this.keys.length) {
      const last = KEY_DIRS[this.keys[this.keys.length - 1]];
      let alt = null;
      for (let i = this.keys.length - 2; i >= 0; i--) {
        const d = KEY_DIRS[this.keys[i]];
        if (d.x !== last.x && d.y !== last.y) { alt = d; break; }
      }
      return { dir: last, alt };
    }
    return { dir: null, alt: null };
  }

  /** True once per press. */
  takeKeg() {
    const k = this.kegQueued;
    this.kegQueued = false;
    return k && this.enabled;
  }

  reset() {
    this.stick = null;
    this.keys = [];
    this.kegQueued = false;
    this.rest();
  }

  // ---------- stick ----------
  rest() {
    // Parked in the middle of its zone, dimmed.
    this.base.classList.remove('live');
    this.base.style.left = '50%';
    this.base.style.top = '50%';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  bindStick() {
    const z = this.zone;
    const local = (e) => {
      const r = z.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    z.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      e.preventDefault();
      const p = local(e);
      // Keep the whole stick on screen.
      const ox = Math.max(REACH, Math.min(p.w - REACH, p.x));
      const oy = Math.max(REACH, Math.min(p.h - REACH, p.y));
      this.stick = { id: e.pointerId, ox, oy, x: p.x, y: p.y };
      try { z.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.base.classList.add('live');
      this.base.style.left = `${ox}px`;
      this.base.style.top = `${oy}px`;
      this.moveKnob();
    });
    z.addEventListener('pointermove', (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      const p = local(e);
      this.stick.x = p.x;
      this.stick.y = p.y;
      this.moveKnob();
    });
    const end = (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      this.rest();
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  moveKnob() {
    const s = this.stick;
    let dx = s.x - s.ox;
    let dy = s.y - s.oy;
    const m = Math.hypot(dx, dy);
    if (m > REACH) {
      dx = (dx / m) * REACH;
      dy = (dy / m) * REACH;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // ---------- keg button ----------
  bindKeg() {
    const b = this.kegBtn;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.press();
    });
    // Keyboard activation of the button (Enter/Space while focused) comes through click with detail 0.
    b.addEventListener('click', (e) => { if (e.detail === 0) this.press(); });
  }

  press() {
    if (!this.enabled) return;
    this.kegQueued = true;
    this.kegBtn.classList.remove('hit');
    void this.kegBtn.offsetWidth;
    this.kegBtn.classList.add('hit');
    if (this.onKeg) this.onKeg();
  }

  // ---------- keyboard ----------
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.altKey || e.metaKey || e.ctrlKey) return;
      const k = KEY_MAP[e.key];
      if (k) {
        e.preventDefault();
        if (!this.keys.includes(k)) this.keys.push(k);
      } else if (e.key === ' ' || e.key === 'x' || e.key === 'X' || e.key === 'Enter') {
        if (e.target === this.kegBtn) return; // handled as a click
        e.preventDefault();
        if (!e.repeat) this.press();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = KEY_MAP[e.key];
      if (k) this.keys = this.keys.filter((q) => q !== k);
    });
    window.addEventListener('blur', () => { this.keys = []; });
  }
}

const KEY_MAP = {
  ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd',
  a: 'l', d: 'r', w: 'u', s: 'd', A: 'l', D: 'r', W: 'u', S: 'd',
};
const KEY_DIRS = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, u: { x: 0, y: -1 }, d: { x: 0, y: 1 } };
