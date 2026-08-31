// ============================================================================
// BROADSIDE — combat HUD (DOM). Rebuilds structure only when the roster or
// selection changes; per-frame updates only touch bars/charge fills.
// ============================================================================

import { DEVICE_LABELS } from './ship.js';

const $ = (id) => document.getElementById(id);

const BEHAVIOR_CYCLE = ['focused', 'aggressive', 'defensive'];
const BEHAVIOR_LABEL = { focused: 'FOCUSED', aggressive: 'AGGRESSIVE', defensive: 'DEFENSIVE' };

export class HUD {
  /**
   * @param {object} cb {
   *   getWorld, getSelection, getPrimary, getTarget,
   *   onSelectShip, onFocusDevice, onBehavior, onStop, onPause, onToggleFollow
   * }
   */
  constructor(cb) {
    this.cb = cb;
    this.root = $('hud');
    this._shipCards = new Map();
    this._weaponBtns = [];
    this._weaponsOf = null;      // ship the weapon bar is built for
    this._targetOf = null;
    this._energyOf = null;
    this._toastTimer = null;

    $('btn-pause').addEventListener('click', () => cb.onPause());
    $('btn-speed').addEventListener('click', () => {
      $('btn-speed').textContent = cb.onSpeed();
    });
    $('btn-stop').addEventListener('click', () => cb.onStop());
    $('btn-behavior').addEventListener('click', () => {
      const prim = cb.getPrimary();
      if (!prim) return;
      const i = BEHAVIOR_CYCLE.indexOf(prim.behavior);
      const next = BEHAVIOR_CYCLE[(i + 1) % BEHAVIOR_CYCLE.length];
      cb.onBehavior(next);
      this.refreshBehavior();
    });
    $('btn-cam').addEventListener('click', () => {
      const on = cb.onToggleFollow();
      $('btn-cam').classList.toggle('active', on);
    });
    $('btn-energy').addEventListener('click', () => {
      $('energypanel').classList.toggle('hidden');
      this._energyOf = null;   // force resync
    });

    for (const k of ['wep', 'shd', 'eng', 'sen']) {
      $('es-' + k).addEventListener('input', (e) => {
        const prim = cb.getPrimary();
        if (!prim) return;
        prim.sliders[k] = e.target.value / 100;
        $('eo-' + k).textContent = (e.target.value / 100).toFixed(1);
      });
    }
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  setObjective(text) {
    $('obj-text').innerHTML = `<b>OBJECTIVE</b> — ${text}`;
  }

  setPaused(p) {
    $('btn-pause').textContent = p ? '▶' : '❚❚';
    $('btn-pause').classList.toggle('active', p);
  }

  setSpeed(label) { $('btn-speed').textContent = label; }

  // ---------------------------------------------------------- ship cards ----

  buildShipBar() {
    const bar = $('shipbar');
    bar.innerHTML = '';
    this._shipCards.clear();
    const world = this.cb.getWorld();
    for (const s of world.ships) {
      if (!s.isPlayer) continue;
      const card = document.createElement('button');
      card.className = 'ship-card';
      card.innerHTML = `
        <div class="nm">${s.name}</div>
        <div class="cls">${s.def.className}</div>
        <div class="beh">F</div>
        <div class="bar shield"><i></i></div>
        <div class="bar hull"><i></i></div>`;
      card.addEventListener('click', () => this.cb.onSelectShip(s));
      bar.appendChild(card);
      this._shipCards.set(s.id, {
        card,
        shield: card.querySelector('.bar.shield i'),
        hull: card.querySelector('.bar.hull i'),
        beh: card.querySelector('.beh')
      });
    }
    const all = document.createElement('button');
    all.id = 'btn-selall';
    all.textContent = 'SELECT ALL';
    all.addEventListener('click', () => this.cb.onSelectShip(null));
    bar.appendChild(all);
  }

  refreshBehavior() {
    const prim = this.cb.getPrimary();
    $('btn-behavior').textContent = prim ? BEHAVIOR_LABEL[prim.behavior] : '—';
  }

  // ---------------------------------------------------------- weapon bar ----

  buildWeaponBar(ship) {
    const row = $('weapon-row');
    row.innerHTML = '';
    this._weaponBtns = [];
    this._weaponsOf = ship;
    if (!ship) return;
    for (const w of ship.weapons) {
      const b = document.createElement('button');
      b.className = `wpn-btn ${w.def.type}`;
      const sq = w.def.craft ? ship.squadrons.find(q => q.wpn === w) : null;
      b.innerHTML = `
        <div class="charge" style="height:0%"></div>
        <span class="typ">${w.def.craft ? 'WING' : w.def.type.toUpperCase()}</span>
        <span class="ammo"></span>
        <span class="nm">${w.def.short}</span>
        <span class="sub">${w.def.craft ? 'DOCKED' : w.def.role.toUpperCase()}</span>
        <span class="bind"></span>`;
      if (sq) {
        // hangar wing: tap launches or recalls, no hold-fire toggle
        b.addEventListener('click', () => {
          if (sq.launched) { sq.recall(); this.cb.onWing(sq, 'recall'); }
          else this.cb.onWing(sq, 'launch');
        });
        row.appendChild(b);
        this._weaponBtns.push({
          w, sq, btn: b,
          charge: b.querySelector('.charge'),
          ammo: b.querySelector('.ammo'),
          sub: b.querySelector('.sub'),
          bind: b.querySelector('.bind')
        });
        continue;
      }
      // tap: toggle hold-fire. long-press: bind weapon to the current target.
      let pressTimer = null, longFired = false;
      b.addEventListener('pointerdown', () => {
        longFired = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          longFired = true;
          this.cb.onBindWeapon(w);
        }, 450);
      });
      const cancelPress = () => clearTimeout(pressTimer);
      b.addEventListener('pointerup', cancelPress);
      b.addEventListener('pointerleave', cancelPress);
      b.addEventListener('pointercancel', cancelPress);
      b.addEventListener('click', () => {
        if (longFired) { longFired = false; return; }
        if (w.hp <= 0) return;
        w.enabled = !w.enabled;
        b.classList.toggle('off', !w.enabled);
      });
      row.appendChild(b);
      this._weaponBtns.push({
        w, btn: b,
        charge: b.querySelector('.charge'),
        ammo: b.querySelector('.ammo'),
        bind: b.querySelector('.bind')
      });
    }
  }

  // --------------------------------------------------------- target panel ----

  buildTargetPanel(target) {
    this._targetOf = target;
    const panel = $('targetpanel');
    if (!target) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    $('tp-name').textContent = target.name;
    $('tp-class').textContent = `${target.def.className} — ${target.def.role}`;
    const subs = $('tp-subs');
    subs.innerHTML = '';
    const prim = this.cb.getPrimary();

    const addChip = (key, label) => {
      const chip = document.createElement('button');
      chip.className = 'sub-chip';
      chip.textContent = label;
      chip.dataset.key = key;
      chip.addEventListener('click', () => {
        this.cb.onFocusDevice(prim && prim.focusDevice === key ? null : key);
        this.buildTargetPanel(target);     // refresh focus highlight
      });
      subs.appendChild(chip);
      return chip;
    };

    this._subChips = [];
    for (const key of ['engines', 'shieldGen', 'sensors']) {
      this._subChips.push({ key, dev: target.devices[key], chip: addChip(key, DEVICE_LABELS[key]) });
    }
    target.weapons.forEach((w) => {
      this._subChips.push({ key: 'w:' + w.index, wpn: w, chip: addChip('w:' + w.index, w.def.short) });
    });
    this.refreshSubChips();
  }

  refreshSubChips() {
    if (!this._subChips) return;
    const prim = this.cb.getPrimary();
    const focus = prim ? prim.focusDevice : null;
    for (const c of this._subChips) {
      const hp = c.dev ? c.dev.hp : c.wpn.hp;
      const max = c.dev ? c.dev.max : c.wpn.max;
      c.chip.classList.toggle('destroyed', hp <= 0);
      c.chip.classList.toggle('dmg', hp > 0 && hp < max * 0.6);
      c.chip.classList.toggle('focused', focus === c.key);
    }
  }

  // -------------------------------------------------------------- update ----

  /** call ~10×/s */
  update() {
    const world = this.cb.getWorld();
    if (!world) return;
    const sel = this.cb.getSelection();
    const selIds = new Set(sel.map(s => s.id));

    // ship cards
    for (const [id, els] of this._shipCards) {
      const s = world.ships.find(x => x.id === id);
      if (!s) continue;
      els.card.classList.toggle('selected', selIds.has(id));
      els.card.classList.toggle('dead', !s.alive);
      els.shield.style.transform = `scaleX(${(s.shield / s.shieldMax).toFixed(3)})`;
      els.hull.style.transform = `scaleX(${Math.max(0, s.hull / s.hullMax).toFixed(3)})`;
      els.beh.textContent = BEHAVIOR_LABEL[s.behavior][0];
    }

    // weapon bar
    const prim = this.cb.getPrimary();
    if (prim !== this._weaponsOf) {
      this.buildWeaponBar(prim);
      this.refreshBehavior();
      this._energyOf = null;
    }
    for (const wb of this._weaponBtns) {
      const w = wb.w;
      if (wb.sq) {
        const sq = wb.sq;
        const n = sq.aliveCount;
        wb.charge.style.height = `${Math.round((n / sq.def.count) * 100)}%`;
        wb.btn.classList.toggle('ready', sq.launched);
        wb.btn.classList.toggle('destroyed', !sq.operable);
        wb.ammo.textContent = `×${n}`;
        const st = !sq.operable ? 'LOST'
          : (sq.state === 'launched' ? 'RECALL' : (sq.state === 'returning' ? 'INBOUND' : 'LAUNCH'));
        if (wb.sub.textContent !== st) wb.sub.textContent = st;
        continue;
      }
      wb.charge.style.height = `${Math.round(w.charge * 100)}%`;
      wb.btn.classList.toggle('ready', w.charge >= 1 && w.enabled && w.hp > 0);
      wb.btn.classList.toggle('destroyed', w.hp <= 0);
      wb.btn.classList.toggle('off', w.hp > 0 && !w.enabled);
      wb.ammo.textContent = w.ammo === Infinity ? '' : `×${w.ammo}`;
      const bt = w.boundTarget && w.boundTarget.alive ? w.boundTarget : null;
      wb.btn.classList.toggle('bound', !!bt);
      const bindText = bt ? '»' + bt.name.slice(0, 7) : '';
      if (wb.bind.textContent !== bindText) wb.bind.textContent = bindText;
    }

    // target panel
    const target = this.cb.getTarget();
    if (target !== this._targetOf) this.buildTargetPanel(target);
    if (target) {
      if (!target.alive) { this.buildTargetPanel(null); }
      else {
        $('tp-shield').style.transform = `scaleX(${(target.shield / target.shieldMax).toFixed(3)})`;
        $('tp-hull').style.transform = `scaleX(${Math.max(0, target.hull / target.hullMax).toFixed(3)})`;
        $('tp-shield-v').textContent = `${Math.round(target.shield)}/${target.shieldMax}`;
        $('tp-hull-v').textContent = `${Math.round(Math.max(0, target.hull))}/${target.hullMax}`;
        this.refreshSubChips();
      }
    }

    // energy panel
    const ep = $('energypanel');
    if (!ep.classList.contains('hidden') && prim) {
      if (this._energyOf !== prim) {
        this._energyOf = prim;
        $('ep-title').textContent = `POWER — ${prim.name}`;
        for (const k of ['wep', 'shd', 'eng', 'sen']) {
          $('es-' + k).value = Math.round(prim.sliders[k] * 100);
          $('eo-' + k).textContent = prim.sliders[k].toFixed(1);
        }
      }
      const resFrac = prim.reserve / prim.def.reserve;
      $('ep-reserve').querySelector('i').style.transform = `scaleX(${resFrac.toFixed(3)})`;
      $('ep-reserve-v').textContent = `${Math.round(prim.reserve)} / ${prim.def.reserve}`;
      $('ep-load').textContent =
        `REACTOR ${prim.def.reactor}/s — WPN ${prim.shares.wep.toFixed(1)} · SHD ${prim.shares.shd.toFixed(1)} · ENG ${prim.shares.eng.toFixed(1)} · SEN ${prim.shares.sen.toFixed(1)}`;
    }
  }
}
