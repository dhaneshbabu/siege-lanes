// Small synthesised sound set. Only the moments that matter get a sound, so a busy lane stays calm.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.on = true;
    this.last = {};
    this.noise = null;
  }

  /** Must run inside a tap: browsers only start audio from a gesture. */
  prime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.55;
        this.out.connect(this.ctx.destination);
        const len = Math.round(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* no audio */ }
  }

  ready() { return this.on && this.ctx && this.ctx.state === 'running'; }

  throttle(name, ms) {
    const now = performance.now();
    if (now - (this.last[name] || 0) < ms) return false;
    this.last[name] = now;
    return true;
  }

  tone(freq, { type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005, slideTo = null, at = 0 } = {}) {
    const c = this.ctx;
    const t0 = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  burst({ dur = 0.15, vol = 0.3, freq = 400, q = 1, type = 'lowpass', at = 0 } = {}) {
    const c = this.ctx;
    const t0 = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }

  bell(base = 587, vol = 0.22) {
    [[0.5, 0.35, 2.0], [1, 1, 1.6], [1.2, 0.45, 1.2], [1.5, 0.3, 0.9], [2, 0.5, 0.7]].forEach(([r, a, d]) => {
      this.tone(base * r, { dur: d, vol: vol * a, attack: 0.008 });
    });
  }

  play(name) {
    if (!this.ready()) return;
    try {
      switch (name) {
        case 'build':
          this.burst({ dur: 0.12, vol: 0.35, freq: 500 });
          this.tone(150, { dur: 0.16, vol: 0.3, slideTo: 90 });
          break;
        case 'upgrade':
          this.tone(523, { dur: 0.12, vol: 0.18, type: 'triangle' });
          this.tone(784, { dur: 0.22, vol: 0.18, type: 'triangle', at: 0.08 });
          break;
        case 'sell':
          this.tone(1318, { dur: 0.08, vol: 0.12, type: 'square' });
          this.tone(1760, { dur: 0.14, vol: 0.12, type: 'square', at: 0.06 });
          break;
        case 'send':
          if (!this.throttle('send', 90)) return;
          this.tone(196, { dur: 0.32, vol: 0.2, type: 'sawtooth', slideTo: 262 });
          break;
        case 'incoming':
          if (!this.throttle('incoming', 600)) return;
          this.tone(147, { dur: 0.5, vol: 0.22, type: 'sawtooth', slideTo: 131 });
          this.burst({ dur: 0.2, vol: 0.25, freq: 160, at: 0.05 });
          break;
        case 'leak':
          if (!this.throttle('leak', 140)) return;
          this.burst({ dur: 0.25, vol: 0.45, freq: 220 });
          this.tone(110, { dur: 0.35, vol: 0.28, type: 'square', slideTo: 70 });
          break;
        case 'wave':
          this.burst({ dur: 0.18, vol: 0.28, freq: 140 });
          this.burst({ dur: 0.18, vol: 0.22, freq: 140, at: 0.16 });
          break;
        case 'boom':
          if (!this.throttle('boom', 120)) return;
          this.burst({ dur: 0.09, vol: 0.12, freq: 300 });
          break;
        case 'bell':
          this.bell();
          break;
        case 'denied':
          this.tone(196, { dur: 0.1, vol: 0.12, type: 'square' });
          break;
        case 'win':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, { dur: 0.4, vol: 0.2, type: 'triangle', at: i * 0.13 }));
          break;
        case 'lose':
          [392, 349, 311, 262].forEach((f, i) => this.tone(f, { dur: 0.45, vol: 0.2, type: 'triangle', at: i * 0.16 }));
          break;
        default: break;
      }
    } catch { /* ignore audio errors */ }
  }
}
