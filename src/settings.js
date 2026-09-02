// ============================================================================
// BROADSIDE — persisted player settings + adaptive quality.
//
// Two separate concerns share this file because they both answer "how should
// the game present itself to this player on this device":
//
//   Settings  — explicit choices (colourblind palette, larger text, reduced
//               motion, difficulty, bloom on/off).
//   Quality   — an automatic governor that watches frame time and sheds work
//               (bloom, then pixel ratio, then effect budget) so an older iPad
//               degrades smoothly instead of stuttering.
// ============================================================================

const KEY = 'broadside_settings_v1';

const DEFAULTS = {
  colorMode: 'default',   // default | deuter | trit  — target/selection cue palette
  largeText: false,
  reducedMotion: false,
  difficulty: 'officer',  // recruit | officer | veteran
  quality: 'auto',        // auto | high | low
  hudMargin: 'safe'       // safe | edge — how far the HUD sits from the bezel
};

export const DIFFICULTY = {
  recruit: { name: 'RECRUIT',  desc: 'Enemies deal 70% damage and repair slower. For learning the systems.',
             enemyDmg: 0.7, enemyRegen: 0.8, points: 1.15 },
  officer: { name: 'OFFICER',  desc: 'The intended balance.',
             enemyDmg: 1.0, enemyRegen: 1.0, points: 1.0 },
  veteran: { name: 'VETERAN',  desc: 'Enemies deal 135% damage, shields recover faster, and pay better.',
             enemyDmg: 1.35, enemyRegen: 1.25, points: 1.25 }
};

// Selection/target/ally cue palettes. The default relies on cyan vs red, which
// is the pairing most protan/deutan viewers lose first; the alternates move the
// hostile cue to a hue that survives.
export const CUE_PALETTES = {
  default: { own: 0x35c8ff, target: 0xff5252, ally: 0x4dd47a, waypoint: 0x4dd47a, objective: 0xffb545 },
  deuter:  { own: 0x35c8ff, target: 0xffb020, ally: 0xffffff, waypoint: 0x9ad8ff, objective: 0xffffff },
  trit:    { own: 0x00d0a0, target: 0xff4fa0, ally: 0xffd24d, waypoint: 0x00d0a0, objective: 0xffd24d }
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw ? { ...DEFAULTS, ...raw } : { ...DEFAULTS };
  } catch (e) { return { ...DEFAULTS }; }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  applyDocumentSettings();
}

export function cues() { return CUE_PALETTES[settings.colorMode] || CUE_PALETTES.default; }
export function difficulty() { return DIFFICULTY[settings.difficulty] || DIFFICULTY.officer; }

/** CSS-level settings (text size, motion) live on the root element */
export function applyDocumentSettings() {
  const r = document.documentElement;
  r.classList.toggle('large-text', !!settings.largeText);
  r.classList.toggle('reduced-motion', !!settings.reducedMotion);
  r.classList.toggle('hud-edge', settings.hudMargin === 'edge');
  r.dataset.cues = settings.colorMode;
}

// ====================================================== adaptive quality ====

/** lowest rung of the quality ladder (see QualityGovernor.level) */
const MAX_LEVEL = 4;

export class QualityGovernor {
  /**
   * @param {object} hooks
   *   { setMsaa(n), setBloom(on), setPixelRatio(r), setEffectBudget(n), setHeavyFx(on) }
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.samples = [];
    // 0 = everything, 1 = no MSAA, 2 = + no bloom, 3 = + lower resolution,
    // 4 = + fewer effects. Multisampling sheds first because it is the one
    // rung that costs nothing in legibility.
    this.level = 0;
    this.cooldown = 3;
    this.enabled = settings.quality === 'auto';
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  }

  /** apply an explicit quality choice, bypassing the governor */
  applyManual() {
    this.enabled = settings.quality === 'auto';
    if (settings.quality === 'high') this._apply(0);
    else if (settings.quality === 'low') this._apply(MAX_LEVEL);
  }

  _apply(level) {
    this.level = level;
    this.hooks.setMsaa(level < 1 ? 4 : 0);
    this.hooks.setBloom(level < 2);
    this.hooks.setPixelRatio(level < 3 ? this.basePixelRatio : Math.min(1, this.basePixelRatio));
    this.hooks.setEffectBudget(level < 4 ? 160 : 60);
    this.hooks.setHeavyFx(level < 4);   // muzzle lights + exhaust wakes
  }

  /** call once per frame with the frame's duration in seconds */
  sample(dt) {
    if (!this.enabled) return;
    this.samples.push(dt);
    if (this.samples.length < 60) return;

    // median is robust against the odd GC spike
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const med = sorted[30];
    this.samples.length = 0;
    this.cooldown -= 1;
    if (this.cooldown > 0) return;

    // 22ms ≈ below 45fps: shed work. 13ms ≈ comfortably above 75fps: take it back.
    if (med > 0.022 && this.level < MAX_LEVEL) {
      this._apply(this.level + 1);
      this.cooldown = 4;
    } else if (med < 0.013 && this.level > 0) {
      this._apply(this.level - 1);
      this.cooldown = 8;       // climb back slowly to avoid oscillating
    }
  }
}
