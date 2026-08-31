// ============================================================================
// BROADSIDE — combat world: weapon fire, projectiles, missiles, point-defence,
// damage resolution (shield / hull / device kill chain), effects & 3D markers.
// ============================================================================

import * as THREE from 'three';
import { makeGlowTexture } from './meshes.js';
import { audio } from './audio.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _Y_AXIS = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.ships = [];
    this.squadrons = [];
    this.projectiles = [];
    this.missiles = [];
    this.beams = [];
    this.effects = [];
    this.time = 0;

    this.onMessage = null;        // (text) => void  — HUD toast
    this.onShipKilled = null;     // (ship, killer) => void
    this.onShipDisabled = null;   // (ship) => void
    this.onDamage = null;         // (shooter, target, kind, amount, wdef) => void

    this.glowTex = makeGlowTexture();
    this._spriteMats = new Map();

    // ---- shared marker assets ----
    this.markerGroup = new THREE.Group();
    scene.add(this.markerGroup);

    this._ringGeo = new THREE.RingGeometry(1, 1.12, 40);
    this._ringGeo.rotateX(-Math.PI / 2);
    this._tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    this._tracerMats = new Map();
    this._selRings = new Map();   // shipId -> mesh

    this._moveMarkers = new Map(); // shipId -> {ring, line, vline, diamond}
    this._blips = new Map();       // shipId -> sprite (unconfirmed sensor contacts)
    this._targetRing = this._makeRing(0xff5252);
    this._targetRing.visible = false;
    this.markerGroup.add(this._targetRing);

    // ghost marker for the move gesture
    this.ghost = this._makeMoveMarker(0x35c8ff, 0.9);
    this._setMarkerVisible(this.ghost, false);
  }

  // =========================================================== marker kit ====

  _makeRing(color) {
    const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
    }));
    m.renderOrder = 5;
    return m;
  }

  _makeLine(color, opacity = 0.5) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false
    }));
    line.renderOrder = 5;
    line.frustumCulled = false;
    return line;
  }

  _makeSprite(color, size) {
    let mat = this._spriteMats.get(color);
    if (!mat) {
      mat = new THREE.SpriteMaterial({
        map: this.glowTex, color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this._spriteMats.set(color, mat);
    }
    const s = new THREE.Sprite(mat.clone());
    s.scale.set(size, size, 1);
    return s;
  }

  /** velocity-aligned glowing bolt so shot direction reads at a glance */
  _makeTracer(color, width, len) {
    let mat = this._tracerMats.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9, depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this._tracerMats.set(color, mat);
    }
    const m = new THREE.Mesh(this._tracerGeo, mat);
    m.scale.set(width, len, width);
    return m;
  }

  _orientTracer(mesh, vel) {
    _v3.copy(vel).normalize();
    mesh.quaternion.setFromUnitVectors(_Y_AXIS, _v3);
  }

  _makeMoveMarker(color, opacity) {
    const ring = this._makeRing(color);
    const line = this._makeLine(color, 0.35);       // ship -> point
    const vline = this._makeLine(color, 0.6);       // plane point -> altitude point
    const planeRing = this._makeRing(color);
    planeRing.material.opacity = 0.3;
    const diamond = this._makeSprite(color, 26);
    this.markerGroup.add(ring, line, vline, planeRing, diamond);
    return { ring, line, vline, planeRing, diamond, color };
  }

  _setMarkerVisible(mk, v) {
    mk.ring.visible = mk.line.visible = mk.vline.visible = mk.planeRing.visible = mk.diamond.visible = v;
  }

  _setLine(line, a, b) {
    const p = line.geometry.attributes.position;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
  }

  /** move-gesture preview: point on plane + altitude offset */
  showGhost(planePoint, altitude, fromPos) {
    const mk = this.ghost;
    this._setMarkerVisible(mk, true);
    _v1.copy(planePoint); _v1.y += altitude;
    mk.diamond.position.copy(_v1);
    mk.ring.position.copy(_v1);
    mk.ring.scale.setScalar(30);
    mk.planeRing.position.copy(planePoint);
    mk.planeRing.scale.setScalar(18);
    this._setLine(mk.vline, planePoint, _v1);
    if (fromPos) this._setLine(mk.line, fromPos, _v1); else this._setLine(mk.line, _v1, _v1);
  }

  hideGhost() { this._setMarkerVisible(this.ghost, false); }

  // ============================================================== ships ====

  addShip(ship, pos, faceTowards) {
    ship.pos.copy(pos);
    ship.mesh.position.copy(pos);
    if (faceTowards) {
      _v1.copy(faceTowards).sub(pos).normalize();
      const m = new THREE.Matrix4().lookAt(_v1, _v2.set(0, 0, 0), THREE.Object3D.DEFAULT_UP);
      ship.quat.setFromRotationMatrix(m);
      ship.mesh.quaternion.copy(ship.quat);
    }
    this.ships.push(ship);
    for (const sq of ship.squadrons) this.squadrons.push(sq);
    this.scene.add(ship.mesh);
  }

  playerShips() { return this.ships.filter(s => s.isPlayer && s.alive); }
  /** hulls the player actually commands (excludes allied convoys/stations) */
  commandShips() { return this.ships.filter(s => s.controllable && s.alive); }
  enemyShips() { return this.ships.filter(s => !s.isPlayer && s.alive && !s.disabled); }

  // ============================================================= firing ====

  fireWeapon(shooter, w, target) {
    const from = shooter.weaponWorldPos(w, new THREE.Vector3());
    const wdef = w.def;
    audio.weaponSound(wdef, from);
    if (wdef.missile) {
      const n = wdef.salvo || 1;
      for (let i = 0; i < n; i++) this.spawnMissile(shooter, wdef, from, target, i);
    } else if (wdef.projSpeed) {
      this.spawnProjectile(shooter, wdef, from, target);
    } else {
      // beam: instant hit
      this.spawnBeam(from, target.pos, wdef.color, wdef.type === 'laser' ? 2.2 : 1.2);
      this.resolveHit(shooter, wdef, target);
    }
  }

  spawnProjectile(shooter, wdef, from, target) {
    // two-pass intercept lead
    let t = from.distanceTo(target.pos) / wdef.projSpeed;
    _v1.copy(target.pos).addScaledVector(target.vel, t);
    t = from.distanceTo(_v1) / wdef.projSpeed;
    _v1.copy(target.pos).addScaledVector(target.vel, t);
    const dir = _v1.sub(from).normalize();
    const vel = dir.multiplyScalar(wdef.projSpeed);
    const mesh = this._makeTracer(wdef.color, 1.1, wdef.projSpeed > 600 ? 22 : 12);
    mesh.position.copy(from);
    this._orientTracer(mesh, vel);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: from.clone(), vel,
      shooter, wdef, target, sprite: mesh,
      life: (wdef.range * 1.35) / wdef.projSpeed
    });
  }

  spawnMissile(shooter, wdef, from, target, i) {
    const sprite = this._makeSprite(wdef.color, 16);
    sprite.position.copy(from);
    this.scene.add(sprite);
    const tail = this._makeTracer(wdef.color, 0.8, 9);
    tail.position.copy(from);
    this.scene.add(tail);
    // mild lateral scatter (perpendicular to the launch line) so salvos fan
    // out without ever firing away from the target
    _v2.copy(target.pos).sub(from).normalize();
    _v1.randomDirection().addScaledVector(_v2, -_v1.dot(_v2)).setLength(10 + i * 6);
    const vel = _v2.multiplyScalar(wdef.missile.speed * 0.6).add(_v1).clone();
    this.missiles.push({
      pos: from.clone(), vel, shooter, wdef, target, sprite, tail,
      hp: wdef.missile.hp, life: 26, armTime: 0.35
    });
  }

  spawnBeam(from, to, color, width = 2, ttl = 0.13) {
    const len = from.distanceTo(to);
    if (len < 1) return;
    const geo = new THREE.CylinderGeometry(width, width, 1, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.y = len;
    mesh.lookAt(to);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.beams.push({ mesh, ttl, ttlMax: ttl });
  }

  // ====================================================== point defence ====

  /** nearest hostile missile OR strike craft inside this PD weapon's envelope */
  findMissileTarget(ship, w) {
    let best = null, bd = Infinity;
    for (const m of this.missiles) {
      if (m.shooter.faction === ship.faction || m.armTime > 0) continue;
      const d = ship.pos.distanceTo(m.pos);
      if (d < w.def.range && d < bd) { bd = d; best = m; }
    }
    // flak and PD grids swat strike craft too — that is what keeps wings honest
    for (const sq of this.squadrons) {
      if (sq.carrier.faction === ship.faction || !sq.launched) continue;
      for (const c of sq.craft) {
        if (!c.alive) continue;
        const d = ship.pos.distanceTo(c.pos);
        if (d < w.def.range && d < bd) { bd = d; best = { craft: c, sq, pos: c.pos }; }
      }
    }
    return best;
  }

  firePD(ship, w, threat) {
    const from = ship.weaponWorldPos(w, _v3);
    audio.play('pd', from);
    this.spawnBeam(from.clone(), threat.pos, w.def.color, 0.8, 0.08);
    if (Math.random() >= (w.def.pdKill || 0.5)) return;
    if (threat.craft) {
      threat.craft.hp -= 12;
      if (threat.craft.hp <= 0) threat.sq.killCraft(threat.craft, this);
    } else {
      threat.hp = 0;
      this.spawnExplosion(threat.pos, 22, 0xffc879);
    }
  }

  // ------------------------------------------------------- strike craft ----

  /** a single craft's attack run: bypasses the deflector entirely */
  craftAttack(sq, c, attack) {
    const cdef = sq.def.craft;
    this.spawnBeam(c.pos.clone(), attack.pos, sq.def.color, 0.6, 0.1);
    if (attack.kind === 'missile') {
      attack.obj.hp = 0;
      this.spawnExplosion(attack.pos, 20, 0xffc879);
      return;
    }
    if (attack.kind === 'craft') {
      attack.obj.hp -= cdef.dmg.hull * 2;
      if (attack.obj.hp <= 0) attack.sq.killCraft(attack.obj, this);
      return;
    }
    const target = attack.obj;
    if (!target.alive) return;
    const mult = sq.carrier.commanderMods.dmgMult || 1;
    target.lastAttacker = sq.carrier;

    // subsystem strike — inside the shield envelope, so it always lands
    const key = sq.pickSubsystem(target);
    const devDmg = cdef.dmg.device * mult;
    if (key && devDmg > 0) {
      if (key.startsWith('w:')) {
        const w = target.weapons.find(x => x.index === parseInt(key.slice(2), 10));
        if (w && w.hp > 0) {
          w.hp = Math.max(0, w.hp - devDmg);
          if (w.hp <= 0 && this.onMessage) {
            this.onMessage(`${target.name}: ${w.def.short} MOUNT DESTROYED`);
            audio.play('device_destroyed', target.pos);
          }
        }
      } else {
        const d = target.devices[key];
        if (d && d.hp > 0) {
          d.hp = Math.max(0, d.hp - devDmg);
          if (d.hp <= 0) {
            if (this.onMessage) this.onMessage(`${target.name}: ${key === 'shieldGen' ? 'SHIELD GENERATOR' : key.toUpperCase()} DESTROYED`);
            audio.play('device_destroyed', target.pos);
            this.checkDisable(target);
          }
        }
      }
      if (this.onDamage) this.onDamage(sq.carrier, target, 'device', devDmg, sq.def);
      this.spawnDamageText(target, String(Math.round(devDmg)), '#c59bff');
    }
    const hullDmg = cdef.dmg.hull * mult;
    if (hullDmg > 0) {
      target.hull -= hullDmg;
      if (this.onDamage) this.onDamage(sq.carrier, target, 'hull', hullDmg, sq.def);
      this.spawnExplosion(target.pos, 14, 0xffa060, target);
      if (target.hull <= 0) this.killShip(target, sq.carrier);
    }
    this.checkSurrender(target);
  }

  /** objective ships go dead in the water when their drives are gone */
  checkDisable(target) {
    if (target.objectiveDisable && target.devices.engines.hp <= 0 && !target.disabled) {
      target.disabled = true;
      target.shield = 0;
      target.moveTarget = null;
      audio.play('disabled');
      if (this.onShipDisabled) this.onShipDisabled(target);
    }
  }

  /** a Vessari hull with no drives and no guns left strikes its colours */
  checkSurrender(target) {
    if (target.isPlayer || target.disabled || !target.alive) return;
    if (target.devices.engines.hp > 0) return;
    if (target.weapons.some(w => w.hp > 0 && !w.def.craft)) return;
    target.disabled = true;
    target.surrendered = true;
    target.shield = 0;
    target.moveTarget = null;
    target.target = null;
    audio.play('disabled');
    if (this.onMessage) this.onMessage(`${target.name} STRIKES COLOURS — SALVAGEABLE`);
    if (this.onShipDisabled) this.onShipDisabled(target);
  }

  // ============================================================= damage ====

  resolveHit(shooter, wdef, target, opts = {}) {
    if (!target.alive) return;
    const mods = shooter.commanderMods;
    const dmgMult = mods.dmgMult || 1;
    const traits = shooter.def.traits || {};
    target.lastAttacker = shooter;

    let hullDmg = 0;
    let deviceHit = false;

    if (target.shieldUp) {
      const sd = wdef.dmg.shield * dmgMult * (traits.shieldDmgMult || 1);
      const drained = Math.min(target.shield, sd);
      target.shield = Math.max(0, target.shield - sd);
      if (drained > 0) target.shieldHitCd = 4;   // suppress regen while under fire
      if (!target.shieldUp) target.shieldCollapseCd = 12;  // generator destabilized
      if (wdef.leech && drained > 0) {
        shooter.shield = Math.min(shooter.shieldMax, shooter.shield + drained * 0.7);
      }
      if (drained > 1) {
        if (this.onDamage) this.onDamage(shooter, target, 'shield', drained, wdef);
        this.spawnDamageText(target, String(Math.round(drained)), '#4fd2ff');
      } else if (wdef.dmg.hull * dmgMult >= 20 && (wdef.bleed || 0) < 0.3) {
        this.spawnDamageText(target, 'ABSORBED', '#8aa0b4');
      }
      hullDmg = wdef.dmg.hull * (wdef.bleed || 0) * dmgMult;
      if (wdef.empThroughShields && wdef.dmg.device > 0) {
        deviceHit = this.resolveDeviceDamage(shooter, wdef, target);
      }
      if (drained > 0) this.spawnShieldFlash(target, shooter.pos);
      if (target.isPlayer && !target.shieldUp && this.onMessage) {
        this.onMessage(`${target.name}: SHIELD DOWN`);
        audio.play('shield_down');
      }
    } else {
      hullDmg = wdef.dmg.hull * dmgMult;
      if (wdef.dmg.device > 0) {
        deviceHit = this.resolveDeviceDamage(shooter, wdef, target);
        if (!deviceHit) hullDmg += wdef.dmg.device * 0.5 * dmgMult; // miss bleeds to hull
      }
      if (hullDmg > 0) this.spawnExplosion(target.pos, 12 + hullDmg * 0.3, 0xffa060, target);
    }

    if (hullDmg > 0) {
      target.hull -= hullDmg;
      if (this.onDamage) this.onDamage(shooter, target, 'hull', hullDmg, wdef);
      if (hullDmg > 1) this.spawnDamageText(target, String(Math.round(hullDmg)), '#ffb545');
      if (target.hull <= 0) this.killShip(target, shooter);
    }
  }

  /** @returns true if a device actually took the hit */
  resolveDeviceDamage(shooter, wdef, target) {
    const key = this.pickDeviceKey(shooter, target);
    if (!key) return false;
    const acc = Math.min(0.97, 0.75 + (shooter.commanderMods.deviceAcc || 0));
    if (Math.random() > acc) return false;
    const amount = wdef.dmg.device * (shooter.commanderMods.dmgMult || 1) *
      ((shooter.def.traits || {}).deviceDmgMult || 1);

    if (key.startsWith('w:')) {
      const idx = parseInt(key.slice(2), 10);
      const w = target.weapons.find(x => x.index === idx);
      if (!w || w.hp <= 0) return false;
      w.hp = Math.max(0, w.hp - amount);
      if (this.onDamage) this.onDamage(shooter, target, 'device', amount, wdef);
      this.spawnDamageText(target, String(Math.round(amount)), '#c59bff');
      if (w.hp <= 0) {
        if (this.onMessage) this.onMessage(`${target.name}: ${w.def.short} MOUNT DESTROYED`);
        audio.play('device_destroyed', target.pos);
        this.checkSurrender(target);
      }
    } else {
      const d = target.devices[key];
      if (!d || d.hp <= 0) return false;
      d.hp = Math.max(0, d.hp - amount);
      if (this.onDamage) this.onDamage(shooter, target, 'device', amount, wdef);
      this.spawnDamageText(target, String(Math.round(amount)), '#c59bff');
      if (d.hp <= 0) {
        if (this.onMessage) this.onMessage(`${target.name}: ${key === 'shieldGen' ? 'SHIELD GENERATOR' : key.toUpperCase()} DESTROYED`);
        audio.play('device_destroyed', target.pos);
        if (key === 'engines') this.checkDisable(target);
      }
      this.checkSurrender(target);
    }
    this.spawnExplosion(target.pos, 16, 0xb07cff, target);
    return true;
  }

  /** which device does this shot go for — the attacker's focus, else auto */
  pickDeviceKey(shooter, target) {
    const focus = shooter.focusDevice;
    const okDev = (k) => target.devices[k] && target.devices[k].hp > 0;
    const okMount = (idx) => {
      const w = target.weapons.find(x => x.index === idx);
      return w && w.hp > 0;
    };
    if (focus) {
      if (focus.startsWith('w:') ? okMount(parseInt(focus.slice(2), 10)) : okDev(focus)) return focus;
    }
    // battle-computer auto priority: generator → engines → mounts → sensors
    if (okDev('shieldGen')) return 'shieldGen';
    if (okDev('engines')) return 'engines';
    const live = target.weapons.filter(w => w.hp > 0);
    if (live.length) return 'w:' + live[(Math.random() * live.length) | 0].index;
    if (okDev('sensors')) return 'sensors';
    return null;
  }

  killShip(ship, killer) {
    if (!ship.alive) return;
    ship.alive = false;
    ship.hull = 0;
    this.spawnExplosion(ship.pos, ship.def.size * 3.2, 0xffb060);
    this.spawnExplosion(ship.pos, ship.def.size * 1.6, 0xffffff);
    this.spawnDebris(ship);
    for (const sq of ship.squadrons) sq.dock(this);
    this.scene.remove(ship.mesh);
    this.clearMarkersFor(ship);
    if (this.onShipKilled) this.onShipKilled(ship, killer);
  }

  // ============================================================ effects ====

  spawnShieldFlash(ship, fromPos) {
    audio.play('shield_hit', ship.pos);
    const r = ship.def.size * 1.35;
    // a bright cap where the shot landed, fading into the whole envelope
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshBasicMaterial({
        color: 0x35c8ff, transparent: true, opacity: 0.38, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    mesh.position.copy(ship.pos);
    if (fromPos) {
      _v1.copy(fromPos).sub(ship.pos).normalize();
      mesh.quaternion.setFromUnitVectors(_Y_AXIS, _v1);
    }
    this.scene.add(mesh);
    this.effects.push({ mesh, ttl: 0.26, ttlMax: 0.26, follow: ship, kind: 'shield' });
  }

  /** tumbling wreckage thrown clear when a hull breaks up */
  spawnDebris(ship) {
    const n = Math.min(14, 5 + Math.round(ship.def.size / 6));
    const mat = new THREE.MeshStandardMaterial({
      color: ship.isPlayer ? 0x8b98a6 : 0x6a5588,
      roughness: 0.7, metalness: 0.35, flatShading: true,
      transparent: true, opacity: 1
    });
    for (let i = 0; i < n; i++) {
      const sz = ship.def.size * (0.06 + Math.random() * 0.16);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz * (0.4 + Math.random()), sz * (0.6 + Math.random() * 1.8)),
        mat
      );
      const pos = ship.pos.clone().add(_v1.randomDirection().multiplyScalar(ship.def.size * 0.4));
      mesh.position.copy(pos);
      mesh.quaternion.copy(ship.quat);
      this.scene.add(mesh);
      this.effects.push({
        mesh, kind: 'debris', ttl: 3.5 + Math.random() * 2.5, ttlMax: 6,
        pos, vel: _v1.randomDirection().multiplyScalar(14 + Math.random() * 46).add(ship.vel).clone(),
        spin: { x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3 }
      });
    }
  }

  /** venting plasma from a wrecked subsystem — a running damage read-out */
  spawnSmoke(ship, offset) {
    const spr = this._makeSprite(0xff8a4a, ship.def.size * 0.5);
    spr.material.opacity = 0.35;
    const off = offset ? offset.clone() : new THREE.Vector3();
    spr.position.copy(off).applyQuaternion(ship.quat).add(ship.pos);
    this.scene.add(spr);
    this.effects.push({
      mesh: spr, kind: 'smoke', ttl: 1.4, ttlMax: 1.4, follow: ship, off,
      size: ship.def.size * 0.5,
      drift: _v1.randomDirection().setY(Math.abs(_v1.y)).clone()
    });
  }

  /** floating combat number above a ship (rate-limited per target) */
  spawnDamageText(target, text, color) {
    if (target._lastDmgText != null && this.time - target._lastDmgText < 0.15) return;
    target._lastDmgText = this.time;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 30px "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.fillText(text, 80, 24);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(target.pos);
    spr.position.y += target.def.size * 1.1;
    spr.position.x += (Math.random() - 0.5) * target.def.size;
    spr.scale.set(56, 17, 1);
    this.scene.add(spr);
    this.effects.push({ mesh: spr, ttl: 0.9, ttlMax: 0.9, kind: 'text', vy: 20 });
  }

  spawnExplosion(pos, size, color, follow = null) {
    audio.play(size >= 60 ? 'explosion_big' : 'explosion_small', pos);
    const s = this._makeSprite(color, size);
    s.position.copy(pos);
    if (follow) {
      _v1.randomDirection().multiplyScalar(follow.def.size * 0.5);
      s.position.add(_v1);
    }
    this.scene.add(s);
    this.effects.push({ mesh: s, ttl: 0.5, ttlMax: 0.5, grow: size * 1.6, kind: 'boom' });
  }

  // ============================================================ markers ====

  /** range rings + firing-arc wedges for the primary selected ship */
  setRangeViz(ship) {
    if (this._rangeViz) {
      this._rangeViz.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.markerGroup.remove(this._rangeViz.group);
      this._rangeViz = null;
    }
    if (!ship) return;
    const group = new THREE.Group();
    const wedges = new THREE.Group();     // rotates with the hull; rings don't
    group.add(wedges);
    for (const w of ship.weapons) {
      if (w.hp <= 0 || !w.def.range) continue;    // hangar wings have no gun range
      const r = w.def.range;
      const ringPts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineBasicMaterial({ color: w.def.color, transparent: true, opacity: 0.1, depthWrite: false })
      );
      ring.renderOrder = 4;
      group.add(ring);
      if (w.def.arc < 330) {
        const az = Math.atan2(w.slot.dir[0], w.slot.dir[2]);
        const half = THREE.MathUtils.degToRad(w.def.arc / 2);
        const pts = [new THREE.Vector3(0, 0, 0)];
        for (let i = 0; i <= 24; i++) {
          const a = az - half + (i / 24) * 2 * half;
          pts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
        }
        pts.push(new THREE.Vector3(0, 0, 0));
        const wl = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: w.def.color, transparent: true, opacity: 0.22, depthWrite: false })
        );
        wl.renderOrder = 4;
        wedges.add(wl);
      }
    }
    this.markerGroup.add(group);
    this._rangeViz = { ship, group, wedges };
  }

  setSelection(ships) {
    const keep = new Set(ships.map(s => s.id));
    for (const [id, ring] of this._selRings) {
      if (!keep.has(id)) { this.markerGroup.remove(ring); this._selRings.delete(id); }
    }
    for (const s of ships) {
      if (!this._selRings.has(s.id)) {
        const ring = this._makeRing(0x35c8ff);
        this._selRings.set(s.id, ring);
        this.markerGroup.add(ring);
      }
    }
  }

  setTargetMarker(ship) { this._targetShip = ship || null; }

  clearMarkersFor(ship) {
    const ring = this._selRings.get(ship.id);
    if (ring) { this.markerGroup.remove(ring); this._selRings.delete(ship.id); }
    const blip = this._blips.get(ship.id);
    if (blip) { this.markerGroup.remove(blip); this._blips.delete(ship.id); }
    const wp = this._wpPaths && this._wpPaths.get(ship.id);
    if (wp) { this.markerGroup.remove(wp); this._wpPaths.delete(ship.id); }
    const mk = this._moveMarkers.get(ship.id);
    if (mk) {
      for (const part of [mk.ring, mk.line, mk.vline, mk.planeRing, mk.diamond]) this.markerGroup.remove(part);
      this._moveMarkers.delete(ship.id);
    }
    if (this._targetShip === ship) this._targetShip = null;
  }

  /** dashed chain showing the remaining legs of a multi-leg order */
  _updateWaypointPath(ship) {
    if (!this._wpPaths) this._wpPaths = new Map();
    let line = this._wpPaths.get(ship.id);
    const pts = ship.waypoints || [];
    if (!pts.length) { if (line) line.visible = false; return; }
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 16), 3));
      line = new THREE.Line(geo, new THREE.LineDashedMaterial({
        color: 0x4dd47a, transparent: true, opacity: 0.5,
        dashSize: 26, gapSize: 18, depthWrite: false
      }));
      line.frustumCulled = false;
      line.renderOrder = 5;
      this.markerGroup.add(line);
      this._wpPaths.set(ship.id, line);
    }
    line.visible = true;
    const arr = line.geometry.attributes.position;
    const chain = [ship.moveTarget, ...pts].slice(0, 16);
    for (let i = 0; i < arr.count; i++) {
      const p = chain[Math.min(i, chain.length - 1)];
      arr.setXYZ(i, p.x, p.y, p.z);
    }
    arr.needsUpdate = true;
    line.geometry.setDrawRange(0, chain.length);
    line.computeLineDistances();
  }

  updateMarkers(dt) {
    const pulse = 1 + Math.sin(this.time * 5) * 0.08;
    for (const [id, ring] of this._selRings) {
      const s = this.ships.find(x => x.id === id);
      if (!s || !s.alive) { ring.visible = false; continue; }
      ring.visible = true;
      ring.position.copy(s.pos);
      ring.position.y -= s.def.size * 0.7;
      ring.scale.setScalar(s.def.size * 1.5);
    }
    // move order markers for player ships
    for (const s of this.ships) {
      if (!s.controllable) continue;
      const has = s.alive && s.moveTarget;
      let mk = this._moveMarkers.get(s.id);
      if (has && !mk) {
        mk = this._makeMoveMarker(0x4dd47a, 0.8);
        this._moveMarkers.set(s.id, mk);
      }
      if (mk) {
        this._setMarkerVisible(mk, !!has);
        if (has) {
          const t = s.moveTarget;
          this._updateWaypointPath(s);
          mk.diamond.position.copy(t);
          mk.ring.position.copy(t);
          mk.ring.scale.setScalar(26 * pulse);
          _v1.set(t.x, 0, t.z);
          mk.planeRing.position.copy(_v1);
          mk.planeRing.scale.setScalar(14);
          mk.planeRing.visible = Math.abs(t.y) > 8;
          mk.vline.visible = Math.abs(t.y) > 8;
          this._setLine(mk.vline, _v1, t);
          this._setLine(mk.line, s.pos, t);
        }
      }
    }
    // range/arc visualization follows the primary ship
    if (this._rangeViz) {
      const s = this._rangeViz.ship;
      if (!s.alive) this.setRangeViz(null);
      else {
        this._rangeViz.group.position.copy(s.pos);
        _v1.set(0, 0, 1).applyQuaternion(s.quat);
        this._rangeViz.wedges.rotation.y = Math.atan2(_v1.x, _v1.z);
      }
    }
    // unconfirmed contact blips
    for (const s of this.ships) {
      const wantBlip = !s.isPlayer && s.alive && s.blip;
      let b = this._blips.get(s.id);
      if (wantBlip && !b) {
        b = this._makeSprite(0xff5252, 30);
        b.material.opacity = 0.5;
        this.markerGroup.add(b);
        this._blips.set(s.id, b);
      }
      if (b) {
        b.visible = wantBlip;
        if (wantBlip) {
          b.position.copy(s.pos);
          b.material.opacity = 0.25 + 0.25 * Math.abs(Math.sin(this.time * 3));
        }
      }
    }
    // target bracket
    const ts = this._targetShip;
    if (ts && ts.alive && ts.detected) {
      this._targetRing.visible = true;
      this._targetRing.position.copy(ts.pos);
      this._targetRing.scale.setScalar(ts.def.size * 1.8 * pulse);
    } else {
      this._targetRing.visible = false;
    }
  }

  // ============================================================= update ====

  /** fog of war: an enemy is confirmed when any player ship has it on sensors;
   *  slightly beyond that range it shows as an unconfirmed blip */
  updateDetection() {
    for (const e of this.ships) {
      if (e.isPlayer || !e.alive) continue;
      let det = false, blip = false;
      for (const p of this.ships) {
        if (!p.isPlayer || !p.alive) continue;
        const d = p.pos.distanceTo(e.pos);
        const r = p.sensorRange();
        if (d <= r) { det = true; break; }
        if (d <= r * 1.35) blip = true;
      }
      if (det && !e.detected && this.onMessage && !e._everDetected) {
        e._everDetected = true;
        this.onMessage(`CONTACT CONFIRMED: ${e.def.className.toUpperCase()}`);
      }
      e.detected = det;
      e.blip = blip && !det;
      e.mesh.visible = det;
    }
  }

  update(dt, cameraPos) {
    this.time += dt;
    this._camPos = cameraPos;

    for (const s of this.ships) s.update(dt, this);
    for (const sq of this.squadrons) sq.update(dt, this);
    this.updateDetection();

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.pos.addScaledVector(p.vel, dt);
      p.sprite.position.copy(p.pos);
      p.life -= dt;
      const t = p.target;
      let dead = p.life <= 0;
      if (!dead && t.alive) {
        if (p.pos.distanceTo(t.pos) < Math.max(t.def.size * 1.15, p.wdef.prox || 0)) {
          this.resolveHit(p.shooter, p.wdef, t);
          dead = true;
        }
      }
      if (dead) {
        this.scene.remove(p.sprite);
        this.projectiles.splice(i, 1);
      }
    }

    // missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.armTime = Math.max(0, m.armTime - dt);
      m.life -= dt;
      const t = m.target;
      let dead = m.hp <= 0 || m.life <= 0;
      if (!dead && t.alive) {
        // homing: steer velocity toward target
        _v1.copy(t.pos).sub(m.pos).normalize().multiplyScalar(m.wdef.missile.speed);
        _v2.copy(_v1).sub(m.vel);
        const maxTurn = m.wdef.missile.speed * m.wdef.missile.turn * dt;
        if (_v2.length() > maxTurn) _v2.normalize().multiplyScalar(maxTurn);
        m.vel.add(_v2);
        m.pos.addScaledVector(m.vel, dt);
        m.sprite.position.copy(m.pos);
        m.tail.position.copy(m.pos);
        this._orientTracer(m.tail, m.vel);
        if (m.pos.distanceTo(t.pos) < t.def.size * 1.2) {
          this.resolveHit(m.shooter, m.wdef, t);
          this.spawnExplosion(m.pos, 30, 0xffc879);
          dead = true;
        }
      } else if (!dead) {
        m.pos.addScaledVector(m.vel, dt);
        m.sprite.position.copy(m.pos);
        m.tail.position.copy(m.pos);
      }
      if (dead) {
        this.scene.remove(m.sprite);
        this.scene.remove(m.tail);
        this.missiles.splice(i, 1);
      }
    }

    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.ttl -= dt;
      b.mesh.material.opacity = 0.95 * Math.max(0, b.ttl / b.ttlMax);
      if (b.ttl <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.beams.splice(i, 1);
      }
    }

    // effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.ttl -= dt;
      const k = Math.max(0, e.ttl / e.ttlMax);
      if (e.kind === 'boom') {
        const sc = e.grow * (1.6 - k * 0.6);
        e.mesh.scale.set(sc, sc, 1);
        e.mesh.material.opacity = k;
      } else if (e.kind === 'shield') {
        e.mesh.material.opacity = 0.38 * k;
        e.mesh.scale.setScalar(1 + (1 - k) * 0.12);
        if (e.follow) e.mesh.position.copy(e.follow.pos);
      } else if (e.kind === 'debris') {
        e.pos.addScaledVector(e.vel, dt);
        e.vel.multiplyScalar(1 - 0.15 * dt);
        e.mesh.position.copy(e.pos);
        e.mesh.rotation.x += e.spin.x * dt;
        e.mesh.rotation.y += e.spin.y * dt;
        e.mesh.material.opacity = Math.min(1, k * 1.6);
      } else if (e.kind === 'smoke') {
        if (e.follow && e.follow.alive) {
          _v1.copy(e.off).applyQuaternion(e.follow.quat).add(e.follow.pos);
          e.mesh.position.copy(_v1).addScaledVector(e.drift, (1 - k) * 40);
        }
        const sc = e.size * (0.6 + (1 - k) * 1.5);
        e.mesh.scale.set(sc, sc, 1);
        e.mesh.material.opacity = 0.35 * k;
      } else if (e.kind === 'text') {
        e.mesh.position.y += e.vy * dt;
        e.mesh.material.opacity = Math.min(1, k * 2.2);
      }
      if (e.ttl <= 0) {
        this.scene.remove(e.mesh);
        if (e.mesh.geometry && e.kind === 'shield') e.mesh.geometry.dispose();
        if (e.mesh.material) {
          if (e.mesh.material.map && e.kind === 'text') e.mesh.material.map.dispose();
          e.mesh.material.dispose();
        }
        this.effects.splice(i, 1);
      }
    }

    this.updateSmoke(dt);
    this.updateMarkers(dt);
  }

  /** ships trail plasma from destroyed devices and wrecked mounts */
  updateSmoke(dt) {
    for (const s of this.ships) {
      if (!s.alive || !s.detected) continue;
      let vents = 0;
      for (const k of ['engines', 'shieldGen', 'sensors']) if (s.devices[k].hp <= 0) vents++;
      for (const w of s.weapons) if (w.hp <= 0) vents++;
      if (s.hull < s.hullMax * 0.35) vents++;
      if (!vents) continue;
      s._smokeCd = (s._smokeCd || 0) - dt * vents;
      if (s._smokeCd > 0) continue;
      s._smokeCd = 0.22;
      _v2.set(
        (Math.random() - 0.5) * s.def.size * 0.7,
        (Math.random() - 0.5) * s.def.size * 0.4,
        (Math.random() - 0.5) * s.def.size * 1.2
      );
      this.spawnSmoke(s, _v2);
    }
  }

  dispose() {
    for (const sq of this.squadrons) sq.dock(this);
    for (const s of this.ships) this.scene.remove(s.mesh);
    for (const p of this.projectiles) this.scene.remove(p.sprite);
    for (const m of this.missiles) { this.scene.remove(m.sprite); this.scene.remove(m.tail); }
    for (const b of this.beams) this.scene.remove(b.mesh);
    for (const e of this.effects) this.scene.remove(e.mesh);
    this.scene.remove(this.markerGroup);
  }
}
