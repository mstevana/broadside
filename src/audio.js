// ============================================================================
// BROADSIDE — audio engine (Web Audio, zero assets — everything synthesized)
//
// - SFX: per-weapon fire sounds, impacts, shields, explosions, alarms, UI.
//   Distance-attenuated and stereo-panned relative to the camera.
// - Shared generated reverb (noise impulse) — space is big and empty, the
//   mix is not.
// - The AudioContext is created on the first user gesture (iOS requirement);
//   callers can queue work with onReady().
// ============================================================================

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// minimum ms between repeats of the same sound — keeps big battles from clipping
const RATE_LIMIT = {
  laser_light: 70, laser_heavy: 120, laser_precision: 110, arc: 120,
  pd: 45, railgun: 120, flak: 55, eshell: 140, missile: 150,
  explosion_small: 90, explosion_big: 200, shield_hit: 80,
  shield_down: 900, device_destroyed: 350, disabled: 800,
  ui: 60, alert: 800
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('broadside_muted') === '1'; } catch (e) { /* ignore */ }
    this._last = {};
    this._cam = { x: 0, y: 0, z: 300, rx: 1, ry: 0, rz: 0 };
    this._pending = [];
    this._amb = null;
    this.vol = { music: 0.34, sfx: 0.8 };
    try {
      const v = JSON.parse(localStorage.getItem('broadside_vol'));
      if (v && typeof v.music === 'number' && typeof v.sfx === 'number') this.vol = v;
    } catch (e) { /* ignore */ }
  }

  get ready() { return !!this.ctx; }

  /** set a bus volume ('music' | 'sfx'), 0..1, and persist it */
  setVolume(bus, value) {
    this.vol[bus] = Math.max(0, Math.min(1, value));
    try { localStorage.setItem('broadside_vol', JSON.stringify(this.vol)); } catch (e) { /* ignore */ }
    if (!this.ctx) return;
    const node = bus === 'music' ? this.musicBus : this.sfxBus;
    node.gain.setTargetAtTime(this.vol[bus], this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------ lifecycle ----

  /** create the context — must be called from a user gesture at least once */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.rev = ctx.createConvolver();
    this.rev.buffer = this._impulse(2.8, 2.4);
    this.rev.connect(this.master);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.16;
    this.sfxBus.connect(this.sfxSend); this.sfxSend.connect(this.rev);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music;
    this.musicBus.connect(this.master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.5;
    this.musicBus.connect(this.musicSend); this.musicSend.connect(this.rev);

    this.noiseBuf = this._noiseBuffer(2);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    });

    for (const f of this._pending) f();
    this._pending.length = 0;
  }

  onReady(f) { this.ctx ? f() : this._pending.push(f); }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('broadside_muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** per-frame: camera position + right vector for attenuation/panning */
  setListener(camera) {
    const e = camera.matrixWorld.elements;
    const c = this._cam;
    c.x = e[12]; c.y = e[13]; c.z = e[14];
    c.rx = e[0]; c.ry = e[1]; c.rz = e[2];
  }

  // ------------------------------------------------------------- buffers ----

  _noiseBuffer(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(sec, decay) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * sec);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  // ------------------------------------------------------------- spatial ----

  _spatial(pos) {
    if (!pos) return { amp: 1, pan: 0 };
    const c = this._cam;
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let amp = clamp(1 - d / 4800, 0.04, 1);
    amp *= amp;
    const pan = d > 1 ? clamp((dx * c.rx + dy * c.ry + dz * c.rz) / d, -0.75, 0.75) : 0;
    return { amp, pan };
  }

  /** output chain for one sfx voice: gain -> panner -> sfx bus */
  _dest(pan) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.sfxBus);
      return p;
    }
    return this.sfxBus;
  }

  // --------------------------------------------------- synthesis helpers ----

  _osc(dest, t, { type = 'sine', f0 = 440, f1 = null, dur = 0.2, g = 0.3, a = 0.005 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(g, t + a);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => { e.disconnect(); };
    return o;
  }

  _noise(dest, t, { dur = 0.2, g = 0.3, a = 0.003, type = 'lowpass', f0 = 1000, f1 = null, Q = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const flt = ctx.createBiquadFilter();
    flt.type = type; flt.Q.value = Q;
    flt.frequency.setValueAtTime(Math.max(30, f0), t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(g, t + a);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(e); e.connect(dest);
    src.start(t); src.stop(t + dur + 0.05);
    src.onended = () => { e.disconnect(); };
  }

  // ------------------------------------------------------------------ SFX ----

  play(name, pos = null) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const lim = RATE_LIMIT[name] || 80;
    if (this._last[name] && now - this._last[name] < lim) return;
    this._last[name] = now;

    const { amp, pan } = this._spatial(pos);
    if (amp < 0.05) return;
    const dest = this._dest(pan);
    const t = this.ctx.currentTime;
    const A = amp;

    switch (name) {
      case 'laser_light':
        this._osc(dest, t, { type: 'square', f0: 950, f1: 240, dur: 0.13, g: 0.32 * A });
        this._noise(dest, t, { dur: 0.06, g: 0.1 * A, type: 'highpass', f0: 3000 });
        break;
      case 'laser_heavy':
        this._osc(dest, t, { type: 'sawtooth', f0: 300, f1: 85, dur: 0.5, g: 0.4 * A, a: 0.02 });
        this._osc(dest, t, { type: 'sine', f0: 130, f1: 55, dur: 0.35, g: 0.45 * A });
        this._noise(dest, t, { dur: 0.3, g: 0.12 * A, type: 'bandpass', f0: 1500, f1: 400, Q: 2 });
        break;
      case 'laser_precision':
        this._osc(dest, t, { type: 'triangle', f0: 1350, f1: 750, dur: 0.28, g: 0.26 * A, a: 0.02 });
        this._osc(dest, t + 0.03, { type: 'triangle', f0: 1800, f1: 1000, dur: 0.22, g: 0.12 * A });
        break;
      case 'arc':
        this._osc(dest, t, { type: 'sawtooth', f0: 180, f1: 320, dur: 0.45, g: 0.28 * A, a: 0.05 });
        this._noise(dest, t, { dur: 0.45, g: 0.2 * A, a: 0.05, type: 'bandpass', f0: 500, f1: 900, Q: 4 });
        break;
      case 'pd':
        this._osc(dest, t, { type: 'square', f0: 1900, f1: 1300, dur: 0.045, g: 0.09 * A });
        break;
      case 'railgun':
        this._noise(dest, t, { dur: 0.2, g: 0.5 * A, type: 'bandpass', f0: 2600, f1: 350, Q: 1.2 });
        this._osc(dest, t, { type: 'sine', f0: 140, f1: 48, dur: 0.3, g: 0.6 * A });
        break;
      case 'flak':
        this._noise(dest, t, { dur: 0.08, g: 0.28 * A, type: 'bandpass', f0: 1700, Q: 2 });
        this._osc(dest, t, { type: 'sine', f0: 230, f1: 110, dur: 0.09, g: 0.22 * A });
        break;
      case 'eshell':
        this._osc(dest, t, { type: 'sine', f0: 160, f1: 430, dur: 0.55, g: 0.3 * A, a: 0.06 });
        this._noise(dest, t, { dur: 0.5, g: 0.14 * A, a: 0.08, type: 'lowpass', f0: 900, f1: 2200 });
        break;
      case 'missile':
        this._noise(dest, t, { dur: 0.85, g: 0.34 * A, a: 0.04, type: 'bandpass', f0: 320, f1: 1700, Q: 1.5 });
        this._osc(dest, t, { type: 'sawtooth', f0: 90, f1: 250, dur: 0.6, g: 0.12 * A, a: 0.05 });
        break;
      case 'explosion_small':
        this._noise(dest, t, { dur: 0.5, g: 0.5 * A, type: 'lowpass', f0: 1300, f1: 160 });
        this._osc(dest, t, { type: 'sine', f0: 105, f1: 44, dur: 0.4, g: 0.5 * A });
        break;
      case 'explosion_big':
        this._noise(dest, t, { dur: 1.6, g: 0.7 * A, type: 'lowpass', f0: 950, f1: 70 });
        this._osc(dest, t, { type: 'sine', f0: 82, f1: 30, dur: 1.3, g: 0.8 * A });
        this._noise(dest, t + 0.12, { dur: 0.35, g: 0.22 * A, type: 'bandpass', f0: 2100, f1: 600, Q: 1.5 });
        break;
      case 'shield_hit':
        this._osc(dest, t, { type: 'sine', f0: 620 + Math.random() * 90, dur: 0.22, g: 0.2 * A });
        this._osc(dest, t, { type: 'sine', f0: 930 + Math.random() * 120, dur: 0.16, g: 0.12 * A });
        this._noise(dest, t, { dur: 0.05, g: 0.1 * A, type: 'highpass', f0: 4000 });
        break;
      case 'shield_down':
        this._osc(dest, t, { type: 'square', f0: 660, dur: 0.16, g: 0.16 });
        this._osc(dest, t + 0.2, { type: 'square', f0: 440, dur: 0.16, g: 0.16 });
        this._osc(dest, t + 0.4, { type: 'square', f0: 330, dur: 0.28, g: 0.16 });
        break;
      case 'device_destroyed':
        this._osc(dest, t, { type: 'triangle', f0: 840, f1: 700, dur: 0.09, g: 0.2 });
        this._osc(dest, t + 0.1, { type: 'triangle', f0: 620, f1: 520, dur: 0.09, g: 0.2 });
        this._osc(dest, t + 0.2, { type: 'triangle', f0: 430, f1: 320, dur: 0.16, g: 0.2 });
        this._noise(dest, t, { dur: 0.25, g: 0.18 * A, type: 'lowpass', f0: 900, f1: 200 });
        break;
      case 'disabled':
        this._osc(dest, t, { type: 'sine', f0: 520, dur: 0.3, g: 0.18 });
        this._osc(dest, t + 0.18, { type: 'sine', f0: 780, dur: 0.5, g: 0.18 });
        break;
      case 'alert':
        this._osc(dest, t, { type: 'square', f0: 880, dur: 0.12, g: 0.1 });
        this._osc(dest, t + 0.16, { type: 'square', f0: 660, dur: 0.18, g: 0.1 });
        break;
      case 'ui':
        this._osc(dest, t, { type: 'square', f0: 740, f1: 980, dur: 0.04, g: 0.07 });
        break;
    }
  }

  /** pick the right fire sound for a weapon definition */
  weaponSound(wdef, pos) {
    let name;
    if (wdef.missile) name = 'missile';
    else if (wdef.projSpeed) {
      name = wdef.role === 'shield' ? 'eshell' : (wdef.pd ? 'flak' : 'railgun');
    } else if (wdef.pd) name = 'pd';
    else if (wdef.role === 'shield') name = 'arc';
    else if (wdef.role === 'device') name = 'laser_precision';
    else if (wdef.dmg.hull >= 30) name = 'laser_heavy';
    else name = 'laser_light';
    this.play(name, pos);
  }

  // ------------------------------------------------------------- ambience ----

  startAmbience() {
    this.onReady(() => {
      if (this._amb) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setTargetAtTime(0.05, t, 2);
      g.connect(this.sfxBus);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 130;
      src.connect(flt); flt.connect(g);
      src.start(t);
      const hum = ctx.createOscillator();
      hum.type = 'sine'; hum.frequency.value = 52;
      const hg = ctx.createGain(); hg.gain.value = 0.35;
      hum.connect(hg); hg.connect(g);
      hum.start(t);
      this._amb = { g, src, hum };
    });
  }

  stopAmbience() {
    if (!this._amb || !this.ctx) { this._amb = null; return; }
    const { g, src, hum } = this._amb;
    this._amb = null;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.6);
    try { src.stop(t + 3); hum.stop(t + 3); } catch (e) { /* already stopped */ }
    setTimeout(() => g.disconnect(), 3500);
  }
}

export const audio = new AudioEngine();
