// ============================================================================
// BROADSIDE — support craft: fighter, bomber and gunboat wings
//
// Wings live in hangar mounts. A launched wing flies INSIDE the target's
// deflector envelope, so its strikes hit hull and subsystems directly — that
// is the whole point of carrying them. The price is fragility: point-defence
// and interceptors shred craft in the open.
//
//   Interceptors — escort screen: kill incoming missiles and enemy craft.
//   Bombers      — strike subsystems (shield generator / engines first).
//   Gunboats     — hunt weapon mounts, point-defence grids first.
// ============================================================================

import * as THREE from 'three';
import { buildCraftMesh } from './meshes.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();

const STRIKE_RANGE = 130;   // craft must get this close to shoot
const DOCK_RANGE = 70;

export class Squadron {
  /**
   * @param {Ship} carrier
   * @param {object} wpn  the carrier's weapon entry whose def has `.craft`
   */
  constructor(carrier, wpn) {
    this.carrier = carrier;
    this.wpn = wpn;
    this.def = wpn.def;
    this.state = 'docked';        // docked | launched | returning
    this.craft = [];
    for (let i = 0; i < this.def.count; i++) {
      this.craft.push({
        alive: true,
        hp: this.def.craft.hp,
        maxHp: this.def.craft.hp,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        fireCd: Math.random() * this.def.craft.fireCycle,
        mesh: null,
        index: i
      });
    }
  }

  get aliveCount() { return this.craft.filter(c => c.alive).length; }
  get launched() { return this.state === 'launched' || this.state === 'returning'; }

  /** wings can only fly if the hangar mount survives and someone is left */
  get operable() { return this.wpn.hp > 0 && this.aliveCount > 0; }

  launch(world) {
    if (!this.operable || this.launched) return false;
    this.state = 'launched';
    const from = this.carrier.weaponWorldPos(this.wpn, new THREE.Vector3());
    for (const c of this.craft) {
      if (!c.alive) continue;
      c.pos.copy(from);
      _v1.randomDirection().multiplyScalar(18);
      c.pos.add(_v1);
      c.vel.copy(this.carrier.vel).addScaledVector(_v1.normalize(), 30);
      if (!c.mesh) {
        c.mesh = buildCraftMesh(this.def, this.carrier.faction);
        c.mesh.userData.craft = c;
      }
      c.mesh.position.copy(c.pos);
      c.mesh.visible = true;
      world.scene.add(c.mesh);
    }
    return true;
  }

  recall() {
    if (this.state === 'launched') this.state = 'returning';
  }

  /** send everyone home and hide them (mission end / carrier lost) */
  dock(world) {
    for (const c of this.craft) {
      if (c.mesh) { world.scene.remove(c.mesh); c.mesh.visible = false; }
    }
    this.state = 'docked';
  }

  killCraft(c, world) {
    if (!c.alive) return;
    c.alive = false;
    world.spawnExplosion(c.pos, 26, 0xffc879);
    if (c.mesh) { world.scene.remove(c.mesh); }
    if (this.aliveCount === 0) {
      this.state = 'docked';
      if (world.onMessage && this.carrier.isPlayer) {
        world.onMessage(`${this.carrier.name}: ${this.def.short} WING LOST`);
      }
    }
  }

  // ------------------------------------------------------------- targeting ----

  /** what this wing should be shooting at right now */
  pickWingTarget(world) {
    const carrier = this.carrier;
    const hostile = (s) => s && s.alive && !s.disabled && s.faction !== carrier.faction &&
      (!carrier.isPlayer || s.detected);
    if (hostile(carrier.target)) return carrier.target;
    let best = null, bd = Infinity;
    for (const s of world.ships) {
      if (!hostile(s)) continue;
      const d = carrier.pos.distanceTo(s.pos);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** interceptors: nearest threat (missile or enemy craft) near the carrier */
  pickInterceptTarget(world) {
    const carrier = this.carrier;
    const R = this.def.escortRadius || 400;
    let best = null, bd = Infinity;
    for (const m of world.missiles) {
      if (m.shooter.faction === carrier.faction) continue;
      const d = carrier.pos.distanceTo(m.pos);
      if (d < R * 1.6 && d < bd) { bd = d; best = { kind: 'missile', obj: m, pos: m.pos }; }
    }
    for (const sq of world.squadrons) {
      if (sq.carrier.faction === carrier.faction || !sq.launched) continue;
      for (const c of sq.craft) {
        if (!c.alive) continue;
        const d = carrier.pos.distanceTo(c.pos);
        if (d < R * 1.6 && d < bd) { bd = d; best = { kind: 'craft', obj: c, sq, pos: c.pos }; }
      }
    }
    return best;
  }

  /** which subsystem this craft type goes for */
  pickSubsystem(target) {
    const okDev = (k) => target.devices[k] && target.devices[k].hp > 0;
    if (this.def.craft.targetMounts) {
      // gunboats: point-defence mounts first, then any live mount
      const live = target.weapons.filter(w => w.hp > 0);
      const pd = live.filter(w => w.def.pd);
      const pool = pd.length ? pd : live;
      if (pool.length) return 'w:' + pool[0].index;
    }
    if (okDev('shieldGen')) return 'shieldGen';
    if (okDev('engines')) return 'engines';
    const live = target.weapons.filter(w => w.hp > 0);
    if (live.length) return 'w:' + live[(Math.random() * live.length) | 0].index;
    if (okDev('sensors')) return 'sensors';
    return null;
  }

  // ---------------------------------------------------------------- update ----

  update(dt, world) {
    if (!this.launched) return;
    const carrier = this.carrier;

    // carrier lost or hangar wrecked: the wing is stranded, then lost
    if (!carrier.alive) { for (const c of this.craft) this.killCraft(c, world); return; }

    const isEscort = this.def.role === 'pd';
    const shipTarget = this.pickWingTarget(world);
    const intercept = isEscort ? this.pickInterceptTarget(world) : null;
    const returning = this.state === 'returning';

    for (const c of this.craft) {
      if (!c.alive) continue;

      // ---- decide a goal point ----
      let goal = null, attack = null;
      if (returning) {
        goal = carrier.pos;
      } else if (intercept) {
        goal = intercept.pos;
        attack = intercept;
      } else if (shipTarget) {
        // offset per craft so a wing spreads around the hull instead of stacking
        const ang = (c.index / this.def.count) * Math.PI * 2 + world.time * 0.5;
        const r = shipTarget.def.size * 1.4 + 40;
        goal = _v1.copy(shipTarget.pos);
        goal = new THREE.Vector3(
          shipTarget.pos.x + Math.sin(ang) * r,
          shipTarget.pos.y + Math.sin(ang * 1.7) * r * 0.35,
          shipTarget.pos.z + Math.cos(ang) * r
        );
        attack = { kind: 'ship', obj: shipTarget, pos: shipTarget.pos };
      } else {
        // nothing to do — hold station off the carrier's flank
        const ang = (c.index / this.def.count) * Math.PI * 2 + world.time * 0.35;
        goal = new THREE.Vector3(
          carrier.pos.x + Math.sin(ang) * 120,
          carrier.pos.y + 30,
          carrier.pos.z + Math.cos(ang) * 120
        );
      }

      // ---- steer ----
      const speed = this.def.craft.speed;
      _v2.copy(goal).sub(c.pos);
      const dist = _v2.length();
      if (dist > 1) {
        _v2.normalize().multiplyScalar(Math.min(speed, dist * 2));
        _v2.sub(c.vel).multiplyScalar(Math.min(1, dt * 2.5));
        c.vel.add(_v2);
        if (c.vel.length() > speed) c.vel.setLength(speed);
      }
      c.pos.addScaledVector(c.vel, dt);
      if (c.mesh) {
        c.mesh.position.copy(c.pos);
        if (c.vel.lengthSq() > 1) {
          _m1.lookAt(_v1.copy(c.vel).normalize(), _v2.set(0, 0, 0), THREE.Object3D.DEFAULT_UP);
          _q1.setFromRotationMatrix(_m1);
          c.quat.rotateTowards(_q1, dt * 4);
          c.mesh.quaternion.copy(c.quat);
        }
      }

      // ---- dock ----
      if (returning && c.pos.distanceTo(carrier.pos) < DOCK_RANGE + carrier.def.size) {
        if (c.mesh) world.scene.remove(c.mesh);
        c._docked = true;
      }

      // ---- shoot ----
      c.fireCd -= dt;
      if (attack && c.fireCd <= 0) {
        const d = c.pos.distanceTo(attack.pos);
        const reach = attack.kind === 'ship' ? attack.obj.def.size * 1.6 + STRIKE_RANGE : STRIKE_RANGE;
        if (d < reach) {
          c.fireCd = this.def.craft.fireCycle;
          world.craftAttack(this, c, attack);
        }
      }
    }

    // whole wing home?
    if (returning && this.craft.every(c => !c.alive || c._docked)) {
      for (const c of this.craft) { c._docked = false; }
      this.state = 'docked';
      if (world.onMessage && carrier.isPlayer) {
        world.onMessage(`${carrier.name}: ${this.def.short} WING RECOVERED`);
      }
    }
  }
}
