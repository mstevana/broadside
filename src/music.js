// ============================================================================
// BROADSIDE — generative music engine, in the spirit of Paul Ruskay's
// Homeworld score: low drones, sparse duduk-like leads over modal scales,
// slow pad swells (a formant-filtered "choir" for the finale), distant taikos,
// and a great deal of reverb. Eight tracks, all synthesized live — no assets.
//
// Each track is data: a mode, a tempo, and a set of layers. A TrackPlayer
// schedules 16th-note steps ahead of the clock; melodies are random walks on
// the mode so a track never loops exactly, but always keeps its character.
// ============================================================================

import { audio } from './audio.js';

const SCALES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11]
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = Math.random;
const pick = (arr) => arr[(rnd() * arr.length) | 0];

// ============================================================== tracks ====
// root: MIDI note of the drone. Chords are scale degrees (pads add +12 st).

export const TRACKS = {
  adrift: {   // main menu — empty space, slow breath
    name: 'Adrift', bpm: 46, root: 38, scale: 'aeolian',
    drone: 0.4,
    pads: { level: 0.34, bars: 2, chords: [[0, 2, 4], [-2, 0, 2], [3, 5, 7], [1, 3, 5]] },
    chimes: { prob: 0.035, level: 0.14 }
  },
  anchorage: { // spaceport / refit — warm, patient
    name: 'Cold Anchorage', bpm: 60, root: 43, scale: 'dorian',
    drone: 0.26,
    pads: { level: 0.3, bars: 2, chords: [[0, 2, 4], [4, 6, 8], [3, 5, 7], [1, 3, 5]] },
    bass: { level: 0.3, pat: [0, null, null, null, null, null, null, null, 0, null, null, null, 4, null, null, null] },
    lead: { prob: 0.1, level: 0.16, oct: 2, walk: [-1, 0, 1, 1, 2, -2] },
    chimes: { prob: 0.06, level: 0.12 }
  },
  verge: {    // briefing — something is out there
    name: 'The Verge', bpm: 52, root: 40, scale: 'phrygian',
    drone: 0.42,
    pads: { level: 0.24, bars: 4, chords: [[0, 2, 4], [1, 3, 5]] },
    lead: { prob: 0.16, level: 0.26, oct: 2, walk: [-2, -1, -1, 0, 1, 1, 2] },
    perc: { level: 0.2, taiko: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
  },
  signal: {   // combat — the line holds
    name: 'Signal Fires', bpm: 92, root: 45, scale: 'aeolian',
    drone: 0.3,
    pads: { level: 0.18, bars: 2, chords: [[0, 2, 4], [-2, 0, 2], [3, 5, 7], [4, 6, 8]] },
    bass: { level: 0.4, pat: [0, null, 0, null, null, null, 0, null, 0, null, 0, null, -2, null, null, 0] },
    lead: { prob: 0.14, level: 0.24, oct: 2, walk: [-2, -1, 0, 1, 1, 2, 3] },
    perc: {
      level: 0.5,
      taiko: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]
    }
  },
  broadside: { // combat, heavier — guns run hot
    name: 'Broadsides', bpm: 104, root: 38, scale: 'harmMinor',
    drone: 0.26,
    pads: { level: 0.16, bars: 2, chords: [[0, 2, 4], [1, 3, 5], [-3, -1, 1], [4, 6, 8]] },
    bass: { level: 0.44, pat: [0, null, 0, 0, null, null, 0, null, 0, null, 0, 0, -2, null, -2, null] },
    lead: { prob: 0.18, level: 0.26, oct: 2, walk: [-3, -2, -1, 1, 1, 2, 2, 4] },
    perc: {
      level: 0.55,
      taiko: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
      hat: [0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1],
      fills: true
    }
  },
  leviathan: { // the Hierophant — a cathedral of chitin
    name: 'Leviathan Choir', bpm: 60, root: 36, scale: 'phrygian',
    drone: 0.5,
    pads: { level: 0.4, bars: 2, choir: true, chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [-2, 0, 2]] },
    bass: { level: 0.34, pat: [0, null, null, null, null, null, null, null, 1, null, null, null, null, null, null, null] },
    lead: { prob: 0.07, level: 0.2, oct: 2, walk: [-2, -1, 0, 1, 1] },
    perc: { level: 0.6, taiko: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0] },
    bell: { every: 2, level: 0.2 }
  },
  homecoming: { // debrief, victorious — the fleet comes about
    name: 'Homecoming', bpm: 66, root: 48, scale: 'lydian',
    drone: 0.22,
    pads: { level: 0.34, bars: 2, chords: [[0, 2, 4], [3, 5, 7], [4, 6, 8], [1, 3, 5]] },
    bass: { level: 0.28, pat: [0, null, null, null, null, null, null, null, 4, null, null, null, 3, null, null, null] },
    lead: { prob: 0.12, level: 0.2, oct: 1, walk: [-1, 0, 1, 1, 2, 2] },
    chimes: { prob: 0.09, level: 0.16 }
  },
  dirge: {    // debrief, defeated — struck from the registry
    name: 'Dirge for the Fleet', bpm: 40, root: 33, scale: 'aeolian',
    drone: 0.5,
    pads: { level: 0.2, bars: 4, chords: [[0, 2, 4], [-4, -2, 0]] },
    bell: { every: 1, level: 0.26 }
  }
};

// ========================================================== track player ====

class TrackPlayer {
  constructor(def) {
    const ctx = audio.ctx;
    this.def = def;
    this.scale = SCALES[def.scale];
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 1.4);
    this.out.connect(audio.musicBus);
    this.stepDur = 60 / def.bpm / 4;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.15;
    this.leadDeg = 4;
    this.stopped = false;
    this._startDrone();
    this.timer = setInterval(() => this._tick(), 90);
  }

  // degree on the track's mode -> frequency
  f(deg, octShift = 0) {
    const n = this.scale.length;
    const oct = Math.floor(deg / n);
    const idx = ((deg % n) + n) % n;
    return midiHz(this.def.root + octShift * 12 + oct * 12 + this.scale[idx]);
  }

  _tick() {
    if (this.stopped) return;
    const ctx = audio.ctx;
    while (this.nextT < ctx.currentTime + 0.45) {
      this._scheduleStep(this.step, this.nextT);
      this.step++;
      this.nextT += this.stepDur;
    }
  }

  stop(fade = 1.8) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const ctx = audio.ctx;
    this.out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
    if (this.droneOscs) {
      for (const o of this.droneOscs) { try { o.stop(ctx.currentTime + fade + 2); } catch (e) { /* ok */ } }
    }
    setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* ok */ } }, (fade + 2.5) * 1000);
  }

  // ---------------------------------------------------------------- drone ----

  _startDrone() {
    const d = this.def;
    if (!d.drone) return;
    const ctx = audio.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = d.drone;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 150; flt.Q.value = 0.8;
    flt.connect(g); g.connect(this.out);
    const root = midiHz(this.def.root);
    this.droneOscs = [];
    for (const [type, freq, lvl] of [
      ['sawtooth', root, 0.35], ['sawtooth', root * 1.005, 0.35],
      ['sine', root / 2, 0.8], ['triangle', root * 1.498, 0.12]
    ]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const og = ctx.createGain(); og.gain.value = lvl;
      o.connect(og); og.connect(flt);
      o.start(t);
      this.droneOscs.push(o);
    }
    // slow filter breath
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lg = ctx.createGain(); lg.gain.value = 55;
    lfo.connect(lg); lg.connect(flt.frequency);
    lfo.start(t);
    this.droneOscs.push(lfo);
  }

  // ---------------------------------------------------------------- steps ----

  _scheduleStep(step, t) {
    const d = this.def;
    const pos = step % 16;
    const bar = (step / 16) | 0;

    if (d.pads && step % (16 * d.pads.bars) === 0) {
      const chord = d.pads.chords[((bar / d.pads.bars) | 0) % d.pads.chords.length];
      const dur = 16 * d.pads.bars * this.stepDur + 2.5;
      for (const deg of chord) this._pad(this.f(deg, 1), t, dur, d.pads.level, d.pads.choir);
    }

    if (d.perc) {
      const p = d.perc;
      if (p.taiko && p.taiko[pos] && rnd() > 0.06) this._taiko(t, p.level * (pos === 0 ? 1 : 0.75));
      if (p.hat && p.hat[pos] && rnd() > 0.2) this._hat(t, p.level * 0.22);
      if (p.fills && bar % 4 === 3 && pos >= 12 && rnd() < 0.5) this._tom(t, p.level * 0.5);
    }

    if (d.bass && d.bass.pat[pos] != null && rnd() > 0.05) {
      this._bass(this.f(d.bass.pat[pos], -1), t, d.bass.level);
    }

    if (d.lead && pos % 2 === 0 && rnd() < d.lead.prob) {
      this.leadDeg = Math.max(-3, Math.min(10, this.leadDeg + pick(d.lead.walk)));
      const dur = (1 + ((rnd() * 3) | 0)) * this.stepDur * 2;
      this._duduk(this.f(this.leadDeg, d.lead.oct), t, dur, d.lead.level);
    }

    if (d.chimes && rnd() < d.chimes.prob) {
      this._chime(this.f(pick([0, 2, 4, 7, 9]), 3), t, d.chimes.level);
    }

    if (d.bell && pos === 0 && bar % d.bell.every === 0) {
      this._bell(this.f(0, 1), t, d.bell.level);
    }
  }

  // ----------------------------------------------------------- instruments ----

  _pad(freq, t, dur, level, choir) {
    const ctx = audio.ctx;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(level, t + dur * 0.35);
    e.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.12);
    e.connect(this.out);

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = choir ? 3000 : 850;

    if (choir) {
      // parallel formant bank between filter and envelope: an "ah" vowel
      for (const [ff, q, lvl] of [[640, 9, 1.5], [1180, 10, 0.8], [2500, 12, 0.18]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
        const bg = ctx.createGain(); bg.gain.value = lvl;
        flt.connect(bp); bp.connect(bg); bg.connect(e);
      }
    } else {
      flt.connect(e);
    }

    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = choir ? 'sawtooth' : 'triangle';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(flt);
      o.start(t); o.stop(t + dur + 0.2);
      o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
    }
  }

  _duduk(freq, t, dur, level) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const from = this._lastLead || freq * 0.94;
    this._lastLead = freq;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
    // delayed vibrato
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(freq * 0.013, t + Math.min(0.5, dur * 0.6));
    vib.connect(vg); vg.connect(o.frequency);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 1150; flt.Q.value = 2.5;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(level, t + 0.1);
    e.gain.setValueAtTime(level, t + Math.max(0.1, dur - 0.25));
    e.gain.linearRampToValueAtTime(0.0001, t + dur + 0.15);
    o.connect(flt); flt.connect(e); e.connect(this.out);
    // breath
    const br = ctx.createBufferSource();
    br.buffer = audio.noiseBuf; br.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass'; bf.frequency.value = 1600; bf.Q.value = 1;
    const bg = ctx.createGain(); bg.gain.value = level * 0.12;
    br.connect(bf); bf.connect(bg); bg.connect(e);
    o.start(t); o.stop(t + dur + 0.3);
    vib.start(t); vib.stop(t + dur + 0.3);
    br.start(t); br.stop(t + dur + 0.3);
    o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
  }

  _bass(freq, t, level) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = freq;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 320;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(level, t + 0.015);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(flt); flt.connect(e); e.connect(this.out);
    o.start(t); o.stop(t + 0.6);
    o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
  }

  _taiko(t, level) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(level, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(e); e.connect(this.out);
    o.start(t); o.stop(t + 0.45);
    o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
    const n = ctx.createBufferSource();
    n.buffer = audio.noiseBuf; n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(level * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(nf); nf.connect(ng); ng.connect(this.out);
    n.start(t); n.stop(t + 0.2);
  }

  _tom(t, level) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(75, t + 0.18);
    const e = ctx.createGain();
    e.gain.setValueAtTime(level, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(e); e.connect(this.out);
    o.start(t); o.stop(t + 0.3);
    o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
  }

  _hat(t, level) {
    const ctx = audio.ctx;
    const n = ctx.createBufferSource();
    n.buffer = audio.noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 6500;
    const e = ctx.createGain();
    e.gain.setValueAtTime(level, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f); f.connect(e); e.connect(this.out);
    n.start(t); n.stop(t + 0.08);
    n.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
  }

  _chime(freq, t, level) {
    const ctx = audio.ctx;
    for (const [mult, lvl, dur] of [[1, 1, 2.2], [2.76, 0.4, 1.4]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq * mult;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.linearRampToValueAtTime(level * lvl, t + 0.01);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(e); e.connect(this.out);
      o.start(t); o.stop(t + dur + 0.1);
      o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
    }
  }

  _bell(freq, t, level) {
    const ctx = audio.ctx;
    for (const [mult, lvl] of [[0.5, 1], [1, 0.6], [1.34, 0.35], [2.1, 0.2]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq * mult * (1 + (rnd() - 0.5) * 0.004);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.linearRampToValueAtTime(level * lvl, t + 0.015);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(e); e.connect(this.out);
      o.start(t); o.stop(t + 3.4);
      o.onended = () => { try { e.disconnect(); } catch (err) { /* ok */ } };
    }
  }
}

// ============================================================= director ====

class MusicDirector {
  constructor() {
    this.currentId = null;
    this.player = null;
  }

  /** switch tracks with a crossfade; null stops music */
  setTrack(id) {
    if (this.currentId === id) return;
    this.currentId = id;
    audio.onReady(() => {
      if (this.currentId !== id) return;   // superseded while waiting for gesture
      if (this.player) { this.player.stop(); this.player = null; }
      if (id && TRACKS[id]) this.player = new TrackPlayer(TRACKS[id]);
    });
  }
}

export const music = new MusicDirector();
