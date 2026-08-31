// ============================================================================
// BROADSIDE — Vessari AI
//
// The Shoal fights with the same toolkit the player has, not a reduced one:
//
//   Doctrine   — the pack agrees on a focus target and concentrates on it,
//                weighting wounded hulls, leech-support and the ship doing the
//                most damage to them.
//   Kill chain — weapons are gated by role exactly as a player would gate them:
//                arcs held while a deflector is up, spine cannons held until it
//                drops, so nothing is wasted on the wrong layer.
//   Surgery    — once a deflector is down the pack picks a subsystem and
//                commits to it: drives on anything trying to leave, the shield
//                generator on anything standing and fighting.
//   Carriers   — wings launch against a chosen strike target and are recalled
//                when the escort screen is needed at home.
//   Withdrawal — a mauled hull disengages; if the whole pack is losing badly
//                the survivors break contact together rather than trickling in.
//   Power      — reactor posture follows the tactical situation.
// ============================================================================

import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** who the pack should be killing right now */
function choosePackTarget(world) {
  const players = world.playerShips();
  if (!players.length) return null;
  let best = null, bestScore = -Infinity;
  for (const p of players) {
    const frac = (p.shield + p.hull) / (p.shieldMax + p.hullMax);
    let score = (1 - frac) * 120;                       // finish the wounded
    if (!p.shieldUp) score += 45;                       // its armour is open
    if (p.def.traits && p.def.traits.shieldDmgMult) score += 25;  // the can opener
    if (p.squadrons.some(q => q.launched)) score += 18;           // the carrier
    score += (world._threat && world._threat.get(p.id) || 0) * 0.05;
    // prefer something the pack can actually reach
    const near = world.ships.reduce((m, s) =>
      (!s.isPlayer && s.alive ? Math.min(m, s.pos.distanceTo(p.pos)) : m), Infinity);
    score -= near * 0.02;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** subsystem the pack commits to once a deflector is down */
function choosePackDevice(target) {
  if (!target || target.shieldUp) return null;
  const ok = (k) => target.devices[k] && target.devices[k].hp > 0;
  // something trying to leave gets its drives taken first
  const leaving = target.moveTarget && target.vel.length() > target.def.speed * 0.35;
  if (leaving && ok('engines')) return 'engines';
  if (ok('shieldGen')) return 'shieldGen';
  if (ok('engines')) return 'engines';
  const live = target.weapons.filter(w => w.hp > 0 && !w.def.craft);
  // silence point-defence so the spore swarms get through
  const pd = live.find(w => w.def.pd);
  if (pd) return 'w:' + pd.index;
  if (live.length) return 'w:' + live[0].index;
  return ok('sensors') ? 'sensors' : null;
}

export function updateAI(world, dt) {
  // ---- threat memory: who is hurting us most ----
  if (!world._threat) world._threat = new Map();

  // ---- pack doctrine, renegotiated every few seconds ----
  world._packTimer = (world._packTimer || 0) - dt;
  if (world._packTimer <= 0) {
    world._packTimer = 4 + Math.random() * 3;
    world._packTarget = choosePackTarget(world);
    world._packDevice = choosePackDevice(world._packTarget);
    for (const [k, v] of world._threat) world._threat.set(k, v * 0.6);  // decay

    // fleet-wide morale: if the pack is being wiped out, survivors break off
    const pack = world.ships.filter(s => !s.isPlayer && s.alive && !s.disabled);
    if (pack.length) {
      const health = pack.reduce((a, s) => a + s.hull / s.hullMax, 0) / pack.length;
      const outnumbered = pack.length < world.playerShips().length;
      world._packBroken = health < 0.3 && outnumbered && pack.length <= 2;
    }
  }

  for (const s of world.ships) {
    if (s.isPlayer || !s.alive || s.disabled) continue;
    s._aiTick = (s._aiTick || 0) - dt;
    if (s._aiTick > 0) continue;
    s._aiTick = 0.7 + Math.random() * 0.5;

    // Objective ship with an escape route. It does NOT bolt at spawn — that
    // made the chase mathematically unwinnable — it holds with its escort
    // until it is engaged (or its nerve breaks), then runs for the exit.
    if (s.fleePoint) {
      if (!s._fleeing) {
        const engaged = s.hull < s.hullMax || s.shield < s.shieldMax * 0.92;
        if (engaged || world.time > (s.fleeAfter || 45)) {
          s._fleeing = true;
          if (world.onMessage) world.onMessage(`${s.name} IS RUNNING FOR THE DRIFT`);
        }
      }
      if (s._fleeing) {
        s.behavior = 'defensive';
        s.sliders.eng = 1.8; s.sliders.shd = 1.2; s.sliders.wep = 0.5; s.sliders.sen = 0.5;
        if (!s.moveTarget || s.moveTarget.distanceTo(s.fleePoint) > 100) {
          s.moveTarget = s.fleePoint.clone();
        }
        continue;
      }
      s.behavior = 'defensive';
      s.sliders.eng = 0.6; s.sliders.shd = 1.6; s.sliders.wep = 0.8; s.sliders.sen = 1.0;
      s.moveTarget = null;
      continue;
    }

    const players = world.playerShips();
    if (!players.length) { s.moveTarget = null; s.target = null; continue; }

    const nearest = players.reduce((a, b) =>
      (s.pos.distanceTo(b.pos) < s.pos.distanceTo(a.pos) ? b : a));

    // ---- withdrawal: individually when mauled, or with the pack when broken ----
    const big = s.def.size > 50;
    if (!big && !s._retreatUntil && !s._retreated && s.hull < s.hullMax * 0.25) {
      s._retreatUntil = world.time + 9;
      s._retreated = true;
    }
    // A broken pack breaks contact ONCE. Refreshing it every tick let the last
    // survivor kite forever and the mission could never end.
    if (world._packBroken && !big && !s._packRetreated) {
      s._packRetreated = true;
      s._retreatUntil = world.time + 8;
    }

    if (s._retreatUntil) {
      // clear of the fight, or out of time: turn and fight rather than kite
      const clear = s.pos.distanceTo(nearest.pos) > 1900;
      if (world.time > s._retreatUntil || clear) {
        s._retreatUntil = null;
      } else {
        s.behavior = 'defensive';
        s.target = null;
        s.sliders.shd = 1.3; s.sliders.eng = 1.6; s.sliders.wep = 0.5; s.sliders.sen = 0.8;
        for (const q of s.squadrons) if (q.state === 'launched') q.recall();
        _v1.copy(s.pos).sub(nearest.pos);
        if (_v1.lengthSq() < 1) _v1.set(1, 0, 0.3);
        if (!s.moveTarget || s.moveTarget.distanceTo(s.pos) < 300) {
          s.moveTarget = s.pos.clone().addScaledVector(_v1.normalize(), 1100);
        }
        continue;
      }
    }

    // ---- victim ----
    let victim;
    if (s.def.id === 'vx_lamprey') {
      victim = players.reduce((a, b) => (b.shield > (a ? a.shield : -1) ? b : a), null);
    } else if (world._packTarget && world._packTarget.alive &&
               s.pos.distanceTo(world._packTarget.pos) < s.sensorRange() * 1.2) {
      victim = world._packTarget;
    } else {
      victim = nearest;
    }
    s.target = victim;
    s.behavior = 'aggressive';

    // ---- surgical targeting, same mechanic the player uses ----
    s.focusDevice = (victim === world._packTarget) ? world._packDevice
      : choosePackDevice(victim);

    // ---- weapon discipline: don't waste a layer's worth of fire ----
    // Gating strictly on shieldUp made the Shoal harmless: its hull guns idled
    // through the whole engagement while its arcs lost the shield race. Hull
    // weapons open up as the deflector nears collapse instead.
    const shieldUp = victim.shieldUp;
    const shieldFrac = victim.shield / victim.shieldMax;
    const nearlyOpen = shieldFrac < 0.35;
    for (const w of s.weapons) {
      if (w.hp <= 0 || w.def.craft) continue;
      if (w.def.pd) { w.enabled = true; continue; }
      switch (w.def.role) {
        case 'shield': w.enabled = shieldUp; break;
        case 'hull':   w.enabled = !shieldUp || nearlyOpen || (w.def.bleed || 0) >= 0.4; break;
        case 'device': w.enabled = !shieldUp || !!w.def.empThroughShields; break;
        default:       w.enabled = true;
      }
    }

    // ---- carriers: strike when there is something to strike ----
    for (const q of s.squadrons) {
      const dist = s.pos.distanceTo(victim.pos);
      const threatened = world.missiles.some(m =>
        m.shooter.faction !== s.faction && m.pos.distanceTo(s.pos) < 700);
      if (!q.launched && q.operable && dist < 1500) q.launch(world);
      else if (q.state === 'launched' && threatened && q.def.role === 'pd') {
        // interceptors come home to screen the carrier
        q.recall();
      }
    }

    // ---- power posture ----
    if (s.shield < s.shieldMax * 0.35) {
      s.sliders.wep = 0.8; s.sliders.shd = 1.7; s.sliders.eng = 1.0; s.sliders.sen = 0.7;
    } else if (!shieldUp) {
      s.sliders.wep = 1.7; s.sliders.shd = 0.9; s.sliders.eng = 0.9; s.sliders.sen = 0.7;
    } else {
      s.sliders.wep = 1.2; s.sliders.shd = 1.1; s.sliders.eng = 1.0; s.sliders.sen = 0.9;
    }

    // ---- station: hold preferred range on an orbit point ----
    const want = s.def.aiRange || 800;
    const d = s.pos.distanceTo(victim.pos);
    if (d > want * 1.25 || d < want * 0.5 || !s.moveTarget) {
      _v1.copy(s.pos).sub(victim.pos);
      if (_v1.lengthSq() < 1) _v1.set(1, 0, 0);
      _v1.normalize();
      _v2.crossVectors(_v1, THREE.Object3D.DEFAULT_UP).normalize();
      if (s.id % 2 === 0) _v2.negate();
      const point = victim.pos.clone()
        .addScaledVector(_v1, want * 0.85)
        .addScaledVector(_v2, want * 0.45);
      point.y = victim.pos.y + (s.id % 3 - 1) * 120;
      s.moveTarget = point;
    }
  }
}
