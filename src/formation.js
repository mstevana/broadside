// ============================================================================
// BROADSIDE — fleet formations.
//
// Move orders used to preserve whatever relative offsets the ships happened to
// have, which drifts into a shapeless clump over a long engagement. A named
// formation instead assigns each ship a slot relative to the order's heading,
// so a fleet arrives pointed the right way and in a shape that suits its job.
//
// Slots are laid out in formation space (+Z = the direction of travel, +X to
// starboard) and rotated onto the move vector.
// ============================================================================

import * as THREE from 'three';

export const FORMATIONS = {
  line: {
    name: 'LINE ABREAST', short: 'LINE',
    desc: 'Broadside on. Every hull can bring side arcs to bear.',
    // spread across the beam
    slot: (i, n, s) => [((i - (n - 1) / 2) * s), 0, 0]
  },
  column: {
    name: 'COLUMN', short: 'COLUMN',
    desc: 'Bows forward, one behind another. Narrow profile, spinal guns clear.',
    slot: (i, n, s) => [0, 0, -(i - (n - 1) / 2) * s]
  },
  echelon: {
    name: 'ECHELON', short: 'ECHELON',
    desc: 'Stepped back and out. Nothing masks the ship behind it.',
    slot: (i, n, s) => [ (i - (n - 1) / 2) * s * 0.8, 0, -(i - (n - 1) / 2) * s * 0.8 ]
  },
  screen: {
    name: 'SCREEN', short: 'SCREEN',
    desc: 'Escorts ring the flagship at three altitudes — point-defence overlaps.',
    slot: (i, n, s) => {
      if (i === 0) return [0, 0, 0];                       // flagship at the centre
      const k = i - 1, m = Math.max(1, n - 1);
      const a = (k / m) * Math.PI * 2;
      return [Math.sin(a) * s * 0.9, ((k % 3) - 1) * s * 0.34, Math.cos(a) * s * 0.9];
    }
  }
};

export const FORMATION_ORDER = ['line', 'column', 'echelon', 'screen'];

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Assign formation positions around a destination.
 * @param {Ship[]} ships    in display order; ships[0] is the guide
 * @param {THREE.Vector3} dest
 * @param {string} key      formation id
 * @param {number} spacing  world units between slots
 * @returns {THREE.Vector3[]} one point per ship, same order
 */
export function formationPoints(ships, dest, key, spacing = 190) {
  const f = FORMATIONS[key] || FORMATIONS.line;
  const n = ships.length;

  // heading: from the fleet's current centre toward the destination
  const centre = new THREE.Vector3();
  for (const s of ships) centre.add(s.pos);
  centre.divideScalar(Math.max(1, n));
  _fwd.copy(dest).sub(centre);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _right.crossVectors(_up, _fwd).normalize();

  // bigger fleets and bigger hulls need more room
  const spread = spacing + ships.reduce((a, s) => a + s.def.size, 0) / Math.max(1, n) * 1.6;

  return ships.map((s, i) => {
    const [x, y, z] = f.slot(i, n, spread);
    return new THREE.Vector3()
      .copy(dest)
      .addScaledVector(_right, x)
      .addScaledVector(_fwd, z)
      .add(new THREE.Vector3(0, y, 0));
  });
}
