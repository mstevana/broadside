// ============================================================================
// BROADSIDE — Ship runtime entity
// Owns: hull/shield state, subsystem devices, power distribution, weapon
// mounts and charge cycles, semi-Newtonian movement, auto-facing.
// The world (world.js) resolves actual weapon fire and damage.
// ============================================================================

import * as THREE from 'three';
import { WEAPONS, SHIP_CLASSES, MOUNT_HP } from './data.js';
import { buildShipMesh } from './meshes.js';
import { Squadron } from './craft.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export const DEVICE_LABELS = { engines: 'ENGINES', shieldGen: 'SHIELD GEN', sensors: 'SENSORS' };

let nextShipId = 1;

export class Ship {
  /**
   * @param {object} record  persistent ship record ({cls,name,hull,devices,slots})
   *                         — enemies pass a transient record built from the class.
   * @param {object} opts    { commanderMods } for player ships
   */
  constructor(record, opts = {}) {
    const def = SHIP_CLASSES[record.cls];
    this.id = nextShipId++;
    this.def = def;
    this.record = record;
    this.name = record.name;
    this.faction = def.faction;
    this.isPlayer = def.faction === 'human';
    this.commanderMods = opts.commanderMods || { dmgMult: 1, sensorMult: 1, deviceAcc: 0 };

    this.hull = Math.min(record.hull, def.hull);
    this.hullMax = def.hull;
    this.shield = def.shield;
    this.shieldMax = def.shield;
    this.alive = true;
    this.disabled = false;          // mission-3 style: engines destroyed => drifting prize

    // --- devices (non-weapon subsystems) ---
    this.devices = {};
    for (const key of ['engines', 'shieldGen', 'sensors']) {
      this.devices[key] = {
        key, hp: Math.min(record.devices[key], def.devices[key]),
        max: def.devices[key]
      };
    }

    // --- weapon mounts ---
    this.weapons = [];
    record.slots.forEach((slot, i) => {
      if (!slot.w) return;
      const wdef = WEAPONS[slot.w];
      this.weapons.push({
        index: i, def: wdef, slot: def.slots[i],
        charge: 0,                       // 0..1
        enabled: true,
        ammo: wdef.ammo != null ? wdef.ammo : Infinity,
        hp: Math.min(slot.hp, MOUNT_HP), max: MOUNT_HP,
        boundTarget: null                // per-weapon target override (long-press)
      });
    });

    // --- hangar wings ---
    this.squadrons = this.weapons
      .filter(w => w.def.craft)
      .map(w => new Squadron(this, w));

    // --- power ---
    this.sliders = { wep: 1, shd: 1, eng: 1, sen: 1 };
    this.reserve = def.reserve;
    this.shares = { wep: 0, shd: 0, eng: 0, sen: 0 };
    this.shieldHitCd = 0;               // regen pause after shield damage
    this.shieldCollapseCd = 0;          // long lockout after a full collapse

    // --- movement (semi-Newtonian) ---
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.moveTarget = null;              // THREE.Vector3 | null
    this.behavior = 'focused';           // focused | aggressive | defensive
    this.target = null;                  // assigned enemy Ship
    this.focusDevice = null;             // device key on target | null (=> hull/auto)
    this.fleePoint = null;               // AI: point to run to
    this.detected = this.isPlayer;       // fog of war: enemies start dark

    // --- visuals ---
    const built = buildShipMesh(def);
    this.mesh = built.group;
    this.spinParts = built.spin;
    this.engineGlows = built.engines;
    this.mesh.userData.ship = this;

    // per-ship scratch
    this._repairTick = 0;
  }

  // ------------------------------------------------------------- helpers ----

  get shieldUp() { return this.shield > this.shieldMax * 0.04; }

  deviceOk(key) { const d = this.devices[key]; return d.hp > d.max * 0.25; }
  deviceDestroyed(key) { return this.devices[key].hp <= 0; }

  sensorRange() {
    let r = this.def.sensors * (this.def.traits.sensorMult || 1) * this.commanderMods.sensorMult;
    r *= 0.6 + 0.4 * Math.min(1.5, this._levelOf('sen'));
    if (!this.deviceOk('sensors')) r = Math.min(r, 650);
    return r;
  }

  maxSpeed() {
    let s = this.def.speed * (0.45 + 0.55 * Math.min(1.5, this._levelOf('eng')));
    if (!this.deviceOk('engines')) s *= 0.25;
    if (this.deviceDestroyed('engines')) s = 0;
    return s;
  }

  _levelOf(k) {
    // effective power level of a subsystem given slider shares (1 = nominal quarter)
    const share = this.shares[k];
    const nominal = this.def.reactor / 4;
    return nominal > 0 ? share / nominal : 0;
  }

  // --------------------------------------------------------------- power ----

  updatePower(dt) {
    const s = this.sliders;
    const sum = s.wep + s.shd + s.eng + s.sen;
    const out = this.def.reactor;
    if (sum <= 0) {
      this.shares = { wep: 0, shd: 0, eng: 0, sen: 0 };
    } else {
      this.shares = {
        wep: out * s.wep / sum, shd: out * s.shd / sum,
        eng: out * s.eng / sum, sen: out * s.sen / sum
      };
    }
    // weapons share refills the reserve cell
    this.reserve = Math.min(this.def.reserve, this.reserve + this.shares.wep * dt);

    // shield regen (needs a live generator; pauses after taking shield damage,
    // and locks out entirely for a while after a full collapse)
    this.shieldHitCd = Math.max(0, this.shieldHitCd - dt);
    this.shieldCollapseCd = Math.max(0, this.shieldCollapseCd - dt);
    if (this.deviceOk('shieldGen')) {
      if (this.shieldHitCd <= 0 && this.shieldCollapseCd <= 0) {
        // battle damage degrades the emitters: a crippled hull can't heal-tank
        const integrity = Math.max(0.15, this.hull / this.hullMax);
        const regen = this.def.shieldRegen * this._levelOf('shd') * integrity;
        this.shield = Math.min(this.shieldMax, this.shield + regen * dt);
      }
    } else if (this.shield > 0) {
      // generator down: the field decays
      this.shield = Math.max(0, this.shield - this.shieldMax * 0.06 * dt);
    }
  }

  // ------------------------------------------------------------- weapons ----

  updateWeapons(dt, world) {
    for (const w of this.weapons) {
      if (w.hp <= 0) continue;                       // mount destroyed
      if (w.def.craft) continue;                     // hangar wings fly themselves
      const energyMult = (w.def.type !== 'missile' && this.def.traits.energyChargeMult) || 1;
      const rate = (0.35 + 0.65 * Math.min(1.6, this._levelOf('wep'))) / energyMult;
      if (w.charge < 1) w.charge = Math.min(1, w.charge + dt * rate / w.def.charge);
      if (!w.enabled || w.charge < 1) continue;
      if (w.ammo <= 0) continue;

      // point-defence weapons engage incoming missiles before anything else
      if (w.def.pd) {
        const m = world.findMissileTarget(this, w);
        if (m) {
          if (this.reserve < w.def.energy) continue;
          this.reserve -= w.def.energy;
          w.charge = 0;
          world.firePD(this, w, m);
          continue;
        }
      }

      const tgt = this.pickWeaponTarget(w, world);
      if (!tgt) continue;
      if (this.reserve < w.def.energy) continue;      // cell empty → hold

      // range / arc / sensor checks
      const dist = this.pos.distanceTo(tgt.pos);
      if (dist > Math.min(w.def.range, this.sensorRange())) continue;
      if (!this.inArc(w, tgt.pos)) continue;

      this.reserve -= w.def.energy;
      w.charge = 0;
      if (w.ammo !== Infinity) w.ammo--;
      world.fireWeapon(this, w, tgt);
    }
  }

  pickWeaponTarget(w, world) {
    // player guns can only engage sensor-confirmed contacts
    const valid = (t) => t && t.alive && !t.disabled && t.faction !== this.faction &&
      (!this.isPlayer || t.detected);
    // per-weapon bound target overrides everything
    if (w.boundTarget) {
      if (valid(w.boundTarget)) return w.boundTarget;
      w.boundTarget = null;                       // bound target gone — release
    }
    if (this.behavior === 'defensive' && !w.def.pd) {
      // defensive: only return fire at whoever recently hit us
      return valid(this.lastAttacker) ? this.lastAttacker : null;
    }
    if (valid(this.target)) return this.target;
    if (this.behavior === 'aggressive' || !this.isPlayer) {
      // sticky auto-target: keep concentrating fire until the pick dies or
      // drops off sensors — wounded runners get chased down, not forgotten
      if (valid(this._autoFace) && this.pos.distanceTo(this._autoFace.pos) < this.sensorRange()) {
        return this._autoFace;
      }
      // pick the nearest hostile within sensor range
      let best = null, bd = Infinity;
      for (const s of world.ships) {
        if (!valid(s)) continue;
        const d = this.pos.distanceTo(s.pos);
        if (d < bd && d < this.sensorRange()) { bd = d; best = s; }
      }
      this._autoFace = best;      // so the hull turns its arcs onto the pick
      return best;
    }
    return null; // focused with no assigned target: hold fire
  }

  inArc(w, targetPos) {
    _v1.set(w.slot.dir[0], w.slot.dir[1], w.slot.dir[2]).normalize().applyQuaternion(this.quat);
    _v2.copy(targetPos).sub(this.pos).normalize();
    const half = THREE.MathUtils.degToRad(w.def.arc / 2);
    return _v1.angleTo(_v2) <= half;
  }

  weaponWorldPos(w, out) {
    out.set(w.slot.pos[0], w.slot.pos[1], w.slot.pos[2]).applyQuaternion(this.quat).add(this.pos);
    return out;
  }

  // ------------------------------------------------------------ movement ----

  /** AGGRESSIVE doctrine: with no standing move order, close to weapon range
   *  of the current target on our own initiative (player ships only — the AI
   *  runs its own maneuvering). */
  updatePursuit(dt) {
    if (!this.isPlayer || this.behavior !== 'aggressive') {
      if (this._pursuitOrder) { this.moveTarget = null; this._pursuitOrder = false; }
      return;
    }
    if (this.moveTarget && !this._pursuitOrder) return;   // explicit order stands
    this._pursuitTick = (this._pursuitTick || 0) - dt;
    if (this._pursuitTick > 0) return;
    this._pursuitTick = 2;
    const ok = (t) => t && t.alive && !t.disabled && t.detected;
    const t = ok(this.target) ? this.target : (ok(this._autoFace) ? this._autoFace : null);
    if (!t) {
      if (this._pursuitOrder) { this.moveTarget = null; this._pursuitOrder = false; }
      return;
    }
    let best = 0;
    for (const w of this.weapons) {
      if (w.hp > 0 && w.enabled && !w.def.pd && w.def.range) best = Math.max(best, w.def.range);
    }
    if (!best) best = 800;
    const d = this.pos.distanceTo(t.pos);
    if (d > best * 0.75) {
      _v1.copy(this.pos).sub(t.pos).normalize();
      this.moveTarget = t.pos.clone().addScaledVector(_v1, best * 0.55);
      this._pursuitOrder = true;
    } else if (this._pursuitOrder) {
      this.moveTarget = null;
      this._pursuitOrder = false;
    }
  }

  updateMovement(dt) {
    const accel = this.def.accel * (0.45 + 0.55 * Math.min(1.5, this._levelOf('eng'))) *
      (this.deviceOk('engines') ? 1 : 0.25);
    const vmax = this.maxSpeed();

    let desired = _v1.set(0, 0, 0);
    if (this.moveTarget && vmax > 0.5) {
      _v2.copy(this.moveTarget).sub(this.pos);
      const dist = _v2.length();
      if (dist < Math.max(40, this.def.size * 1.6) && this.vel.length() < 12) {
        this.moveTarget = null;               // arrived
        if (this.onArrive) this.onArrive();
      } else {
        // arrive steering: cap speed by braking distance
        const brake = Math.sqrt(2 * accel * Math.max(0, dist - 30));
        desired = _v2.normalize().multiplyScalar(Math.min(vmax, brake));
      }
    }
    // steering force toward desired velocity
    _v3.copy(desired).sub(this.vel);
    const dvLen = _v3.length();
    if (dvLen > 0.01) {
      // burn efficiency depends on facing (ships arc instead of strafing)
      _v2.set(0, 0, 1).applyQuaternion(this.quat);
      const align = Math.max(0, _v2.dot(_v3.clone().normalize()));
      const eff = 0.35 + 0.65 * align;
      _v3.normalize().multiplyScalar(Math.min(accel * eff * dt, dvLen));
      this.vel.add(_v3);
    }
    // slow drift damping when station-keeping
    if (!this.moveTarget) this.vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt));
    this.pos.addScaledVector(this.vel, dt);

    // --- facing ---
    let faceDir = null;
    const faceShip = (this.target && this.target.alive) ? this.target
      : (this._autoFace && this._autoFace.alive ? this._autoFace : null);
    if (this.moveTarget) {
      faceDir = _v2.copy(this.moveTarget).sub(this.pos).normalize();
    } else if (faceShip) {
      faceDir = _v2.copy(faceShip.pos).sub(this.pos).normalize();
    } else if (this.vel.lengthSq() > 4) {
      faceDir = _v2.copy(this.vel).normalize();
    }
    if (faceDir) {
      _m1.lookAt(faceDir, _v3.set(0, 0, 0), THREE.Object3D.DEFAULT_UP);
      _q1.setFromRotationMatrix(_m1);
      const turn = this.def.turn * (this.deviceOk('engines') ? 1 : 0.4);
      this.quat.rotateTowards(_q1, turn * dt);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    for (const p of this.spinParts) p.rotation.z += dt * 0.8;   // habitat ring
    const thrust = this.vel.length() / Math.max(1, this.def.speed);
    for (const e of this.engineGlows) {
      const s = 0.7 + thrust * 0.9;
      e.scale.set(s, s, s + thrust * 1.5);
    }
  }

  // -------------------------------------------------------------- repair ----

  updateRepair(dt) {
    // crews repair damaged (not destroyed) devices, engines first — up to 3 at once
    this._repairTick += dt;
    if (this._repairTick < 0.5) return;
    const step = this._repairTick; this._repairTick = 0;
    const rate = 1.6;                                          // hp/s per repair team
    const order = ['engines', 'shieldGen', 'sensors'];
    let teams = 3;
    for (const key of order) {
      if (teams <= 0) break;
      const d = this.devices[key];
      if (d.hp > 0 && d.hp < d.max) { d.hp = Math.min(d.max, d.hp + rate * step); teams--; }
    }
    for (const w of this.weapons) {
      if (teams <= 0) break;
      if (w.hp > 0 && w.hp < w.max) { w.hp = Math.min(w.max, w.hp + rate * step); teams--; }
    }
  }

  // -------------------------------------------------------------- update ----

  update(dt, world) {
    if (!this.alive) return;
    this.updatePower(dt);
    if (!this.disabled) {
      this.updateWeapons(dt, world);
      this.updatePursuit(dt);
      this.updateMovement(dt);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - 0.2 * dt));
      this.pos.addScaledVector(this.vel, dt);
      this.mesh.position.copy(this.pos);
    }
    this.updateRepair(dt);
  }

  // ------------------------------------------------------- record syncing ----

  /** write volatile state back into the persistent record after a mission */
  syncRecord() {
    this.record.hull = Math.max(1, Math.round(this.hull));
    for (const key of ['engines', 'shieldGen', 'sensors']) {
      this.record.devices[key] = Math.round(this.devices[key].hp);
    }
    for (const w of this.weapons) this.record.slots[w.index].hp = Math.round(w.hp);
    return this.record;
  }
}
