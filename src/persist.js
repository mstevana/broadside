// ============================================================================
// BROADSIDE — mid-mission save/resume.
//
// A capital-ship battle runs for minutes; on a phone that is long enough to be
// interrupted by a call, a notification, or the OS evicting the tab. This
// serializes enough of the live sim to put the player back exactly where they
// were: ship positions, velocities, facing, damage, power, weapon charge and
// ammo, wing state, orders, wave progress and mission bookkeeping.
//
// Transient things (projectiles in flight, effects, damage numbers) are
// deliberately dropped — reproducing them is not worth the complexity, and a
// resumed battle losing one volley in flight is imperceptible.
// ============================================================================

const KEY = 'broadside_mission_v1';
const VERSION = 1;

const v3 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];

function saveShip(s) {
  return {
    cls: s.def.id,
    name: s.name,
    player: s.isPlayer,
    pos: v3(s.pos), vel: v3(s.vel),
    quat: [+s.quat.x.toFixed(4), +s.quat.y.toFixed(4), +s.quat.z.toFixed(4), +s.quat.w.toFixed(4)],
    hull: +s.hull.toFixed(1), shield: +s.shield.toFixed(1),
    reserve: +s.reserve.toFixed(1),
    shieldHitCd: +s.shieldHitCd.toFixed(2),
    shieldCollapseCd: +s.shieldCollapseCd.toFixed(2),
    devices: { engines: s.devices.engines.hp, shieldGen: s.devices.shieldGen.hp, sensors: s.devices.sensors.hp },
    weapons: s.weapons.map(w => ({
      i: w.index, hp: +w.hp.toFixed(1), charge: +w.charge.toFixed(3),
      enabled: w.enabled, ammo: w.ammo === Infinity ? null : w.ammo
    })),
    squadrons: s.squadrons.map(q => ({
      state: q.state,
      craft: q.craft.map(c => ({ alive: c.alive, hp: c.hp, pos: v3(c.pos), vel: v3(c.vel) }))
    })),
    sliders: { ...s.sliders },
    behavior: s.behavior,
    move: s.moveTarget ? v3(s.moveTarget) : null,
    waypoints: (s.waypoints || []).map(v3),
    focusDevice: s.focusDevice,
    detected: s.detected,
    disabled: s.disabled,
    surrendered: !!s.surrendered,
    objectiveDisable: !!s.objectiveDisable,
    flee: s.fleePoint ? v3(s.fleePoint) : null,
    fleeAfter: s.fleeAfter,
    fleeing: !!s._fleeing,
    boss: !!s._isBoss,
    // cross-references are stored as ids and re-linked after all ships exist
    id: s.id,
    targetId: s.target && s.target.alive ? s.target.id : null,
    boundIds: s.weapons.map(w => (w.boundTarget && w.boundTarget.alive ? w.boundTarget.id : null))
  };
}

/**
 * @param {MissionRun} m
 * @param {object} campaign
 * @param {object} extra  { missionId, skirmish, fleetSnapshot }
 */
export function saveMission(m, campaign, extra = {}) {
  if (!m || m.over) return false;
  try {
    const data = {
      v: VERSION,
      savedAt: Date.now(),
      missionId: m.def.id,
      skirmish: !!m.skirmish,
      campaign: JSON.parse(JSON.stringify(campaign)),
      fleetSnapshot: extra.fleetSnapshot || null,
      run: {
        elapsed: +m.elapsed.toFixed(2),
        worldTime: +m.world.time.toFixed(2),
        timeScale: m.timeScale,
        waveNum: m.waveNum,
        kills: m.kills,
        salvage: m.salvage,
        lostShips: m.lostShips.slice(),
        stats: m.stats,
        deviceWasLost: m.deviceWasLost,
        bossGenFirst: m.bossGenFirst,
        _bossGenAtHalf: m._bossGenAtHalf,
        waves: m.waves.map(w => ({ spawned: w.spawned })),
        selectionIds: m.selection.map(s => s.id)
      },
      ships: m.world.ships.filter(s => s.alive).map(saveShip)
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;   // quota, private mode, or a serialization surprise
  }
}

export function loadMissionSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === VERSION ? d : null;
  } catch (e) { return null; }
}

export function clearMissionSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function hasMissionSave() { return !!loadMissionSave(); }

/** apply a saved ship record onto a freshly constructed Ship */
export function restoreShip(s, rec, THREE) {
  s.pos.set(...rec.pos);
  s.vel.set(...rec.vel);
  s.quat.set(...rec.quat);
  s.mesh.position.copy(s.pos);
  s.mesh.quaternion.copy(s.quat);
  s.hull = rec.hull;
  s.shield = rec.shield;
  s.reserve = rec.reserve;
  s.shieldHitCd = rec.shieldHitCd || 0;
  s.shieldCollapseCd = rec.shieldCollapseCd || 0;
  for (const k of ['engines', 'shieldGen', 'sensors']) s.devices[k].hp = rec.devices[k];
  for (const w of s.weapons) {
    const sw = rec.weapons.find(x => x.i === w.index);
    if (!sw) continue;
    w.hp = sw.hp; w.charge = sw.charge; w.enabled = sw.enabled;
    w.ammo = sw.ammo == null ? Infinity : sw.ammo;
  }
  s.squadrons.forEach((q, qi) => {
    const sq = rec.squadrons[qi];
    if (!sq) return;
    q.state = sq.state;
    sq.craft.forEach((c, ci) => {
      const live = q.craft[ci];
      if (!live) return;
      live.alive = c.alive; live.hp = c.hp;
      live.pos.set(...c.pos); live.vel.set(...c.vel);
    });
  });
  Object.assign(s.sliders, rec.sliders);
  s.behavior = rec.behavior;
  s.moveTarget = rec.move ? new THREE.Vector3(...rec.move) : null;
  s.waypoints = (rec.waypoints || []).map(p => new THREE.Vector3(...p));
  s.focusDevice = rec.focusDevice;
  s.detected = rec.detected;
  s.disabled = rec.disabled;
  s.surrendered = rec.surrendered;
  s.objectiveDisable = rec.objectiveDisable;
  if (rec.flee) { s.fleePoint = new THREE.Vector3(...rec.flee); s.fleeAfter = rec.fleeAfter; }
  s._fleeing = rec.fleeing;
  s._savedId = rec.id;
}
