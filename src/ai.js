// ============================================================================
// BROADSIDE — Vessari AI
// Pack doctrine: the Shoal periodically agrees on a focus target (the most
// damaged human ship) and concentrates fire. Individuals hold preferred range
// on orbit points, shift reactor power with the tactical situation, and light
// hulls break off to let their shields recover when badly mauled.
// Special cases: fleeing objective ships, leech ships hunting fat shields.
// ============================================================================

import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export function updateAI(world, dt) {
  // ---- pack focus target, renegotiated every few seconds ----
  world._packTimer = (world._packTimer || 0) - dt;
  if (world._packTimer <= 0) {
    world._packTimer = 5 + Math.random() * 3;
    const players = world.playerShips();
    let best = null, bs = Infinity;
    for (const p of players) {
      const frac = (p.shield + p.hull) / (p.shieldMax + p.hullMax);
      if (frac < bs) { bs = frac; best = p; }
    }
    world._packTarget = best;
  }

  for (const s of world.ships) {
    if (s.isPlayer || !s.alive || s.disabled) continue;
    s._aiTick = (s._aiTick || 0) - dt;
    if (s._aiTick > 0) continue;
    s._aiTick = 0.8 + Math.random() * 0.6;

    // fleeing objective ship: run for the exit, never fight back much
    if (s.fleePoint) {
      s.behavior = 'defensive';
      s.sliders.eng = 1.8; s.sliders.shd = 1.2; s.sliders.wep = 0.5; s.sliders.sen = 0.5;
      if (!s.moveTarget || s.moveTarget.distanceTo(s.fleePoint) > 100) {
        s.moveTarget = s.fleePoint.clone();
      }
      continue;
    }

    const players = world.playerShips();
    if (!players.length) { s.moveTarget = null; s.target = null; continue; }

    const nearest = players.reduce((a, b) =>
      (s.pos.distanceTo(b.pos) < s.pos.distanceTo(a.pos) ? b : a));

    // ---- retreat: a mauled light hull breaks off once to let its shield rebuild ----
    const big = s.def.size > 50;
    if (!big && !s._retreatUntil && !s._retreated && s.hull < s.hullMax * 0.25) {
      s._retreatUntil = world.time + 9;
      s._retreated = true;
    }
    if (s._retreatUntil) {
      if (world.time > s._retreatUntil) {
        s._retreatUntil = null;
      } else {
        s.behavior = 'defensive';
        s.target = null;
        s.sliders.shd = 1.3; s.sliders.eng = 1.6; s.sliders.wep = 0.5; s.sliders.sen = 0.8;
        _v1.copy(s.pos).sub(nearest.pos);
        if (_v1.lengthSq() < 1) _v1.set(1, 0, 0.3);
        if (!s.moveTarget || s.moveTarget.distanceTo(s.pos) < 300) {
          s.moveTarget = s.pos.clone().addScaledVector(_v1.normalize(), 1100);
        }
        continue;
      }
    }

    // ---- choose victim ----
    let victim;
    if (s.def.id === 'vx_lamprey') {
      // leech ships hunt the strongest remaining shield
      victim = players.reduce((a, b) => (b.shield > (a ? a.shield : -1) ? b : a), null);
    } else if (world._packTarget && world._packTarget.alive &&
               s.pos.distanceTo(world._packTarget.pos) < s.sensorRange() * 1.2) {
      victim = world._packTarget;
    } else {
      let bd = Infinity;
      victim = nearest;
      for (const p of players) {
        const d = s.pos.distanceTo(p.pos);
        const score = d * (0.6 + 0.4 * (p.hull / p.hullMax));
        if (score < bd) { bd = score; victim = p; }
      }
    }
    s.target = victim;
    s.behavior = 'aggressive';

    // carriers scramble their wings once the enemy is in reach
    for (const sq of s.squadrons) {
      if (!sq.launched && sq.operable && s.pos.distanceTo(victim.pos) < 1400) {
        sq.launch(world);
      }
    }

    // ---- power posture ----
    if (s.shield < s.shieldMax * 0.35) {
      s.sliders.shd = 1.6; s.sliders.wep = 0.8;
    } else if (victim && !victim.shieldUp) {
      s.sliders.wep = 1.6; s.sliders.shd = 0.8;
    } else {
      s.sliders.wep = 1.1; s.sliders.shd = 1.1;
    }
    s.sliders.eng = 1; s.sliders.sen = 0.9;

    // ---- hold preferred range on an orbit point around the victim ----
    const want = s.def.aiRange || 800;
    const d = s.pos.distanceTo(victim.pos);
    if (d > want * 1.25 || d < want * 0.5 || !s.moveTarget) {
      // tangential offset => ships circle rather than joust
      _v1.copy(s.pos).sub(victim.pos);
      if (_v1.lengthSq() < 1) _v1.set(1, 0, 0);
      _v1.normalize();
      _v2.crossVectors(_v1, THREE.Object3D.DEFAULT_UP).normalize();
      if (s.id % 2 === 0) _v2.negate();
      const point = victim.pos.clone()
        .addScaledVector(_v1, want * 0.85)
        .addScaledVector(_v2, want * 0.45);
      point.y = victim.pos.y + (s.id % 3 - 1) * 120;   // use the third dimension
      s.moveTarget = point;
    }
  }
}
