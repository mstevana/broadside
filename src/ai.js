// ============================================================================
// BROADSIDE — Vessari AI
// Simple but purposeful: pick a victim, hold preferred range with an orbit
// point, let the ship's own weapon logic (aggressive) do the shooting.
// Special cases: fleeing objective ships, leech ships hunting fat shields.
// ============================================================================

import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export function updateAI(world, dt) {
  for (const s of world.ships) {
    if (s.isPlayer || !s.alive || s.disabled) continue;
    s._aiTick = (s._aiTick || 0) - dt;
    if (s._aiTick > 0) continue;
    s._aiTick = 0.8 + Math.random() * 0.6;

    // fleeing objective ship: run for the exit, never fight back much
    if (s.fleePoint) {
      s.behavior = 'defensive';
      if (!s.moveTarget || s.moveTarget.distanceTo(s.fleePoint) > 100) {
        s.moveTarget = s.fleePoint.clone();
      }
      continue;
    }

    const players = world.playerShips();
    if (!players.length) { s.moveTarget = null; s.target = null; continue; }

    // choose victim
    let victim = null;
    if (s.def.id === 'vx_lamprey') {
      // leech ships hunt the strongest remaining shield
      victim = players.reduce((a, b) => (b.shield > (a ? a.shield : -1) ? b : a), null);
    } else {
      let bd = Infinity;
      for (const p of players) {
        const d = s.pos.distanceTo(p.pos);
        // slight preference for damaged targets
        const score = d * (0.6 + 0.4 * (p.hull / p.hullMax));
        if (score < bd) { bd = score; victim = p; }
      }
    }
    s.target = victim;
    s.behavior = 'aggressive';

    // hold preferred range on an orbit point around the victim
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
