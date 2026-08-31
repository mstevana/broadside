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
    // Keyboard: space pauses. Swallowed before the browser can scroll the page
    // or re-fire whichever HUD button happens to hold focus.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (this.root.classList.contains('hidden')) return;   // not in a mission
      e.preventDefault();
      if (t && typeof t.blur === 'function' && t !== document.body) t.blur();
      cb.onPause();
    });
    $('btn-speed').addEventListener('click', () => {
      $('btn-speed').textContent = cb.onSpeed();
    });
    $('btn-stop').addEventListener('click', () => cb.onStop());
    $('tut-skip').addEventListener('click', () => cb.onSkipTutorial());
    $('btn-form').addEventListener('click', () => { $('btn-form').textContent = cb.onFormation(); });
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
  setFormation(label) { $('btn-form').textContent = label; }

  /** tutorial banner; pass null to clear */
  tutorial(text) {
    const el = $('tutorial');
    if (!text) { el.classList.add('hidden'); return; }
    $('tut-text').textContent = text;
    el.classList.remove('hidden');
  }

  // ---------------------------------------------------------- ship cards ----

  /** force both rosters to rebuild on the next update */
  invalidateEnemyBar() { this._enemySig = null; this._friendlySig = null; }

  /** signature of the friendly roster — allies join mid-mission when a wave
   *  spawns them, so the left bar cannot be built once and forgotten */
  _friendlySignature(world) {
    return world.ships.filter(s => s.controllable || s.ally)
      .map(s => s.id).join(',');
  }

  buildShipBar() {
    const bar = $('shipbar');
    bar.innerHTML = '';
    this._shipCards.clear();
    const world = this.cb.getWorld();
    // commanded hulls first, then allied convoys and installations — an escort
    // mission is unplayable if you cannot see the thing you are escorting
    const list = world.ships.filter(s => s.controllable)
      .concat(world.ships.filter(s => s.ally));
    for (const s of list) {
      const card = document.createElement('button');
      card.className = 'ship-card' + (s.ally ? ' ally' : '');
      card.innerHTML = `
        <div class="nm">${s.name}</div>
        <div class="cls">${s.def.className}</div>
        <div class="beh">${s.ally ? 'A' : 'F'}</div>
        <div class="bar shield"><i></i></div>
        <div class="bar hull"><i></i></div>`;
      if (!s.ally) card.addEventListener('click', () => this.cb.onSelectShip(s));
      bar.appendChild(card);
      this._shipCards.set(s.id, {
        card, ship: s,
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
    this._inspected = null;
    $('wpn-tip').classList.add('hidden');
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
        this._wireInspect(b, w);
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
      this._wireInspect(b, w);
      row.appendChild(b);
      this._weaponBtns.push({
        w, btn: b,
        charge: b.querySelector('.charge'),
        ammo: b.querySelector('.ammo'),
        bind: b.querySelector('.bind')
      });
    }
  }

  /**
   * Hovering (or holding) a mount lights its range envelope in the viewport and
   * prints the hard numbers, so "how far does this gun reach" has an answer
   * without opening the refit screen. Kept off pointerdown's long-press path:
   * these listeners only read, they never cancel the bind gesture.
   */
  _wireInspect(btn, w) {
    const on = () => this.inspectWeapon(w);
    const off = () => { if (this._inspected === w) this.inspectWeapon(null); };
    btn.addEventListener('pointerenter', on);
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
    // a mouse keeps the readout while the cursor stays on the button; touch has
    // no hover, so lifting the finger is the only sensible end of the gesture
    btn.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') off(); });
    btn.addEventListener('focus', on);
    btn.addEventListener('blur', off);
  }

  /** show one mount's envelope + stat line; null clears both */
  inspectWeapon(w) {
    if (this._inspected === w) return;
    this._inspected = w;
    const tip = $('wpn-tip');
    for (const wb of this._weaponBtns) wb.btn.classList.toggle('inspect', wb.w === w);
    this.cb.onInspectWeapon(w);
    if (!w) { tip.classList.add('hidden'); return; }
    const d = w.def;
    const bit = (k, v) => `<span class="k">${k}</span> ${v}`;
    const parts = [`<b>${d.name.toUpperCase()}</b>`];
    if (d.craft) {
      parts.push(bit('WING', `${d.count} ${d.craft.targetMounts ? 'GUNBOAT' : (d.craft.dmg.device > d.craft.dmg.hull ? 'BOMBER' : 'FIGHTER')}`));
      parts.push(bit('SPD', d.craft.speed));
      parts.push(bit('HP', d.craft.hp));
    } else {
      parts.push(bit('RANGE', `${d.range} u`));
      parts.push(bit('ARC', d.arc >= 360 ? 'ALL-ROUND' : `${d.arc}°`));
      parts.push(bit('CYCLE', `${d.charge.toFixed(1)} s`));
      parts.push(bit('PWR', d.energy));
      if (d.ammo) parts.push(bit('AMMO', `${w.ammo}/${d.ammo}`));
      const dm = d.dmg || {};
      parts.push(bit('DMG', `${dm.shield || 0} shd / ${dm.hull || 0} hull / ${dm.device || 0} dev`));
    }
    tip.innerHTML = parts.join('<span class="sep">|</span>');
    tip.classList.remove('hidden');
  }

  // ------------------------------------------------- hostile order of battle ----
  //
  // Mirrors the fleet list on the left. The designated target expands in place
  // to carry the subsystem chips, rather than duplicating the same ship in a
  // separate panel.

  /** signature of what the list should currently contain */
  _enemySignature(world) {
    const prim = this.cb.getPrimary();
    const tgt = prim && prim.target ? prim.target.id : 0;
    return world.ships
      .filter(s => !s.isPlayer && s.alive && (s.detected || s.blip))
      .map(s => `${s.id}:${s.detected ? 1 : 0}:${s.disabled ? 1 : 0}`)
      .join(',') + '|' + tgt;
  }

  buildEnemyBar() {
    const bar = $('enemybar');
    const world = this.cb.getWorld();
    bar.innerHTML = '';
    this._enemyCards = [];
    if (!world) return;

    const prim = this.cb.getPrimary();
    const target = prim && prim.target && prim.target.alive ? prim.target : null;
    const list = world.ships.filter(s => !s.isPlayer && s.alive && (s.detected || s.blip));

    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    hdr.textContent = list.length ? `HOSTILES · ${list.filter(s => s.detected && !s.disabled).length}` : 'NO CONTACTS';
    bar.appendChild(hdr);

    for (const e of list) {
      const card = document.createElement('button');
      const unconfirmed = !e.detected;
      const neutral = e.disabled;
      card.className = 'enemy-card'
        + (unconfirmed ? ' unconfirmed' : '')
        + (neutral ? ' neutralised' : '')
        + (e === target ? ' targeted' : '');

      if (unconfirmed) {
        card.innerHTML = `<div class="nm">UNKNOWN</div>
          <div class="cls">unconfirmed contact</div>`;
      } else {
        const tag = e.derelictHulk ? 'HULK'
          : (e.surrendered ? 'TAKEN' : (e.disabled ? 'DEAD' : ''));
        card.innerHTML = `
          <div class="nm">${e.name}</div>
          <div class="cls">${e.def.className}</div>
          ${tag ? `<div class="tag2">${tag}</div>` : ''}
          <div class="bar shield"><i></i></div>
          <div class="bar hull"><i></i></div>`;
        card.addEventListener('click', () => this.cb.onTargetShip(e));
      }
      bar.appendChild(card);

      const entry = {
        ship: e, card,
        shield: card.querySelector('.bar.shield i'),
        hull: card.querySelector('.bar.hull i'),
        chips: []
      };

      // the designated target carries the focus-fire chips inline
      if (e === target && !neutral) {
        const subs = document.createElement('div');
        subs.className = 'subs';
        const addChip = (key, label, dev, wpn) => {
          const chip = document.createElement('button');
          chip.className = 'sub-chip';
          chip.textContent = label;
          chip.addEventListener('click', (ev) => {
            ev.stopPropagation();          // don't re-target the card
            const p = this.cb.getPrimary();
            this.cb.onFocusDevice(p && p.focusDevice === key ? null : key);
            this.refreshSubChips();
          });
          subs.appendChild(chip);
          entry.chips.push({ key, dev, wpn, chip });
        };
        for (const key of ['engines', 'shieldGen', 'sensors']) {
          addChip(key, DEVICE_LABELS[key], e.devices[key], null);
        }
        e.weapons.forEach((w) => addChip('w:' + w.index, w.def.short, null, w));
        card.appendChild(subs);
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'TAP SUBSYSTEM TO FOCUS FIRE';
        card.appendChild(hint);
      }
      this._enemyCards.push(entry);
    }
    this.refreshSubChips();
  }

  refreshSubChips() {
    if (!this._enemyCards) return;
    const prim = this.cb.getPrimary();
    const focus = prim ? prim.focusDevice : null;
    for (const e of this._enemyCards) {
      for (const c of e.chips) {
        const hp = c.dev ? c.dev.hp : c.wpn.hp;
        const max = c.dev ? c.dev.max : c.wpn.max;
        c.chip.classList.toggle('destroyed', hp <= 0);
        c.chip.classList.toggle('dmg', hp > 0 && hp < max * 0.6);
        c.chip.classList.toggle('focused', focus === c.key);
      }
    }
  }

  // -------------------------------------------------------------- update ----

  /** call ~10×/s */
  update() {
    const world = this.cb.getWorld();
    if (!world) return;
    const sel = this.cb.getSelection();
    const selIds = new Set(sel.map(s => s.id));

    const fsig = this._friendlySignature(world);
    if (fsig !== this._friendlySig) { this._friendlySig = fsig; this.buildShipBar(); }

    // friendly cards (commanded hulls and allies)
    for (const [id, els] of this._shipCards) {
      const s = els.ship;
      if (!s) continue;
      els.card.classList.toggle('selected', selIds.has(id));
      els.card.classList.toggle('dead', !s.alive);
      els.shield.style.transform = `scaleX(${(s.shield / s.shieldMax).toFixed(3)})`;
      els.hull.style.transform = `scaleX(${Math.max(0, s.hull / s.hullMax).toFixed(3)})`;
      els.beh.textContent = s.ally ? 'A' : BEHAVIOR_LABEL[s.behavior][0];
    }

    // hostile order of battle — rebuilt only when the roster or target changes
    const sig = this._enemySignature(world);
    if (sig !== this._enemySig) { this._enemySig = sig; this.buildEnemyBar(); }
    for (const e of this._enemyCards || []) {
      const s = e.ship;
      if (!e.shield) continue;
      e.shield.style.transform = `scaleX(${(s.shield / s.shieldMax).toFixed(3)})`;
      e.hull.style.transform = `scaleX(${Math.max(0, s.hull / s.hullMax).toFixed(3)})`;
    }
    this.refreshSubChips();

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
