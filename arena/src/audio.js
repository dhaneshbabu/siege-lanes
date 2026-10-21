// Small synthesised sound set for the arena: kegs, blasts, pick-ups and the round calls.
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
        case 'keg':
          if (!this.throttle('keg', 60)) return;
          this.tone(110, { dur: 0.12, vol: 0.25, slideTo: 70 });
          this.burst({ dur: 0.06, vol: 0.2, freq: 900, type: 'bandpass', q: 1.5 });
          break;
        case 'blast':
          if (!this.throttle('blast', 70)) return;
          this.burst({ dur: 0.45, vol: 0.5, freq: 380 });
          this.burst({ dur: 0.2, vol: 0.25, freq: 1600, type: 'bandpass', q: 0.7 });
          this.tone(70, { dur: 0.4, vol: 0.35, slideTo: 38 });
          break;
        case 'blastFar':
          if (!this.throttle('blast', 70)) return;
          this.burst({ dur: 0.35, vol: 0.22, freq: 260 });
          this.tone(60, { dur: 0.3, vol: 0.16, slideTo: 40 });
          break;
        case 'crate':
          if (!this.throttle('crate', 90)) return;
          this.burst({ dur: 0.12, vol: 0.14, freq: 2400, type: 'bandpass', q: 2 });
          break;
        case 'power':
          [784, 988, 1319].forEach((f, i) => this.tone(f, { dur: 0.14, vol: 0.14, type: 'triangle', at: i * 0.06 }));
          break;
        case 'death':
          this.tone(440, { dur: 0.5, vol: 0.2, type: 'square', slideTo: 110 });
          this.burst({ dur: 0.3, vol: 0.25, freq: 300 });
          break;
        case 'rivalDown':
          this.tone(330, { dur: 0.25, vol: 0.14, type: 'triangle', slideTo: 165 });
          break;
        case 'drop':
          if (!this.throttle('drop', 120)) return;
          this.burst({ dur: 0.16, vol: 0.3, freq: 160 });
          this.tone(90, { dur: 0.16, vol: 0.2, slideTo: 60 });
          break;
        case 'tick':
          this.tone(880, { dur: 0.08, vol: 0.14, type: 'square' });
          break;
        case 'go':
          this.tone(1175, { dur: 0.3, vol: 0.18, type: 'square' });
          break;
        case 'bell':
          this.bell();
          break;
        case 'denied':
          if (!this.throttle('denied', 200)) return;
          this.tone(196, { dur: 0.1, vol: 0.12, type: 'square' });
          break;
        case 'roundWin':
          [659, 784, 1047].forEach((f, i) => this.tone(f, { dur: 0.3, vol: 0.18, type: 'triangle', at: i * 0.11 }));
          break;
        case 'roundLose':
          [392, 330].forEach((f, i) => this.tone(f, { dur: 0.35, vol: 0.16, type: 'triangle', at: i * 0.15 }));
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
