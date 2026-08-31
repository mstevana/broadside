// ============================================================================
// BROADSIDE — procedural ship meshes & shared visual assets
//
// Every hull is built from primitives at authoring time, then merged per
// material into a handful of draw calls, so detail is cheap on a phone.
//
// United Earth Navy — angular armour slabs, exposed truss spines, radiator
//   fins, lit window strips, hull numbers, gunmetal + cyan running lights.
// Vessari Shoal — grown, not built: segmented carapace, rib arches, tendrils,
//   bioluminescent veins that pulse, chitin violet + teal glow.
//
// Ship local frame: +Z bow, +Y up.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from './merge.js';
import { TEX, TILE, hullMaterial, makeDecal } from './textures.js';

// ------------------------------------------------------------- materials ----

const M = {
  // human hard-surface: heavy plating on the main hull, tighter panels on
  // secondary structure, wide clean plates on armour belts, brushed trim
  hull:    hullMaterial(0x9fb0c1, TEX.HULL_A, { roughness: 0.58, metalness: 0.36, normal: 1.5 }),
  plate:   hullMaterial(0x78879a, TEX.HULL_B, { roughness: 0.62, metalness: 0.40, normal: 1.6 }),
  dark:    hullMaterial(0x4b5866, TEX.HULL_B, { roughness: 0.72, metalness: 0.45, normal: 1.7 }),
  trim:    hullMaterial(0xc8d4df, TEX.BRUSH,  { roughness: 0.38, metalness: 0.55, normal: 0.6 }),
  turret:  hullMaterial(0xbecad6, TEX.HULL_C, { roughness: 0.46, metalness: 0.48, normal: 1.4 }),
  glow:    new THREE.MeshBasicMaterial({ color: 0x35c8ff }),
  window:  new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  engine:  new THREE.MeshBasicMaterial({ color: 0x66d9ff }),
  // vessari: chitin scales, smooth-shaded so the scales read as organic
  vHull:   hullMaterial(0x8367ab, TEX.CARA_A, { roughness: 0.48, metalness: 0.12, flat: false, normal: 1.4 }),
  vPlate:  hullMaterial(0x67508f, TEX.CARA_B, { roughness: 0.52, metalness: 0.12, flat: false, normal: 1.3 }),
  // ridge plates, fins and tendrils are hard chitin, not scaled hide — the
  // scale map turns small cylinders into bubble wrap
  vDark:   hullMaterial(0x40325e, TEX.BONE,   { roughness: 0.62, metalness: 0.10, flat: false, normal: 0.8 }),
  vBone:   hullMaterial(0xb9a8cc, TEX.BONE,   { roughness: 0.52, metalness: 0.08, flat: false, normal: 0.8 }),
  vTurret: hullMaterial(0x9a7fc0, TEX.BONE,   { roughness: 0.46, metalness: 0.18, flat: false, normal: 0.9 }),
  vGlow:   new THREE.MeshBasicMaterial({ color: 0x59ffc8 }),
  vEngine: new THREE.MeshBasicMaterial({ color: 0xa9ff8a })
};

// ------------------------------------------------------------ UV baking ----
//
// Primitive UVs would stretch a 60m armour belt and a 2m greeble to the same
// 0..1 range, so plate size would vary wildly across one hull. Instead we
// project triplanar in ship-local space at a fixed world-units-per-tile: every
// ship in the fleet ends up with the same plate scale.

function bakeTriplanarUV(geo, tile) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor ? nor.getX(i) : 0);
    const ay = Math.abs(nor ? nor.getY(i) : 1);
    const az = Math.abs(nor ? nor.getZ(i) : 0);
    let u, v;
    if (ax >= ay && ax >= az)      { u = z; v = y; }   // facing ±X
    else if (ay >= ax && ay >= az) { u = x; v = z; }   // facing ±Y
    else                           { u = x; v = y; }   // facing ±Z
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ------------------------------------------------------- geometry builder ----
//
// Parts accumulate as {geo, mat}; `assemble` merges per material. Emissive
// parts that must pulse are kept in their own group so we can animate them.

class Hull {
  constructor() { this.parts = []; this.glowParts = []; }

  add(geo, mat, { pos, rot, scale, quat } = {}) {
    const m = new THREE.Matrix4();
    const q = quat || new THREE.Quaternion();
    if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    m.compose(
      new THREE.Vector3(...(pos || [0, 0, 0])),
      q,
      new THREE.Vector3(...(scale || [1, 1, 1]))
    );
    const g = geo.clone().applyMatrix4(m);
    bakeTriplanarUV(g, TILE);
    this.parts.push({ geo: g, mat });
    return this;
  }

  box(w, h, d, mat, pos, opts = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, { pos, ...opts });
  }
  cyl(rt, rb, h, seg, mat, pos, opts = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, { pos, ...opts });
  }
  sphere(r, ws, hs, mat, pos, opts = {}) {
    return this.add(new THREE.SphereGeometry(r, ws, hs), mat, { pos, ...opts });
  }
  cone(r, h, seg, mat, pos, opts = {}) {
    return this.add(new THREE.ConeGeometry(r, h, seg), mat, { pos, ...opts });
  }

  /** mirrored pair about X */
  pair(fn) { fn(1); fn(-1); return this; }

  /** a row of small greeble boxes along Z — reads as plating and machinery */
  greebleRow(mat, { x, y, z0, z1, n, w = 1.2, h = 1.0, d = 2.4, jitter = 0.5 }) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const z = z0 + (z1 - z0) * t;
      const j = (Math.sin(i * 12.9898 + x) * 43758.5453) % 1;
      const s = 1 + Math.abs(j) * jitter;
      this.box(w * s, h * s, d, mat, [x, y, z]);
    }
    return this;
  }

  /** lit window strip: a thin emissive bar */
  windows(mat, { x, y, z, len, count, vertical = false }) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
      const off = t * len;
      this.box(vertical ? 0.5 : 0.45, 0.45, vertical ? 0.45 : 0.9, mat,
        vertical ? [x, y + off, z] : [x, y, z + off]);
    }
    return this;
  }

  assemble() {
    const group = new THREE.Group();
    const byMat = new Map();
    for (const p of this.parts) {
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat).push(p.geo);
    }
    for (const [mat, geos] of byMat) {
      const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      if (!merged) continue;
      group.add(new THREE.Mesh(merged, mat));
    }
    return group;
  }
}

// ------------------------------------------------------------- weapon art ----
//
// Turrets differ by what the mount carries, so a loadout is readable on the
// model: barbette + long barrels for guns, emitter vanes for lasers, launch
// cells for missiles, a spinning drum for PD, bay doors for hangars.

function addMount(hull, slot, wdef, faction) {
  const v = faction === 'vessari';
  const base = v ? M.vTurret : M.turret;
  const dark = v ? M.vDark : M.dark;
  const glow = v ? M.vGlow : M.glow;
  const pos = slot.pos;
  const dir = new THREE.Vector3(slot.dir[0], slot.dir[1], slot.dir[2]).normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
  );

  // everything below is authored in mount space (+Z = the arc centre)
  const sub = new Hull();
  const kind = !wdef ? 'empty'
    : (wdef.craft ? 'hangar'
      : (slot.hangar ? 'hangar'
        : (wdef.pd ? 'pd'
          : (wdef.missile ? 'missile'
            : (wdef.type === 'laser' ? 'laser' : 'gun')))));

  if (kind === 'hangar') {
    sub.box(9, 1.6, 12, dark, [0, 0, 0]);
    sub.box(7.4, 0.9, 4.6, glow, [0, 0.5, 1.2]);       // lit bay mouth
    sub.pair(s => sub.box(0.8, 1.4, 11, base, [s * 4.2, 0.4, 0]));
  } else if (kind === 'empty') {
    sub.cyl(1.9, 2.3, 1.0, 8, dark, [0, 0.4, 0]);
    sub.box(2.6, 0.4, 2.6, dark, [0, 0.9, 0]);
  } else if (kind === 'pd') {
    sub.cyl(1.7, 2.1, 1.3, 10, base, [0, 0.6, 0]);
    sub.cyl(1.3, 1.3, 1.5, 8, dark, [0, 1.6, 0]);       // rotating drum
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      sub.box(0.28, 0.28, 2.6, base, [Math.sin(a) * 0.7, 1.7, Math.cos(a) * 0.7 + 1.1]);
    }
    sub.box(0.7, 0.7, 0.7, glow, [0, 2.5, 0]);
  } else if (kind === 'laser') {
    sub.cyl(2.0, 2.4, 1.2, 8, base, [0, 0.5, 0]);
    sub.box(2.4, 1.6, 3.0, base, [0, 1.5, 0.4]);        // emitter housing
    sub.pair(s => sub.box(0.35, 2.2, 3.4, dark, [s * 1.4, 1.7, 1.3]));  // cooling vanes
    sub.cyl(0.42, 0.42, 3.6, 6, base, [0, 1.5, 2.4], { rot: [Math.PI / 2, 0, 0] });
    sub.sphere(0.6, 8, 6, glow, [0, 1.5, 4.1]);         // lens
  } else if (kind === 'missile') {
    sub.box(4.4, 2.2, 4.0, base, [0, 1.0, 0]);          // launcher block
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        sub.box(0.9, 0.9, 0.5, dark, [(c - 1) * 1.3, 0.5 + r * 1.1, 2.1]);
      }
    }
    sub.box(4.6, 0.4, 0.6, glow, [0, 2.3, 0.6]);
  } else { // gun
    sub.cyl(2.2, 2.6, 1.3, 10, base, [0, 0.5, 0]);      // barbette
    sub.box(3.0, 1.8, 3.6, base, [0, 1.5, 0.2]);        // gunhouse
    sub.box(2.2, 1.2, 1.0, dark, [0, 1.5, -1.8]);       // counterweight
    sub.pair(s => sub.cyl(0.42, 0.5, 5.2, 6, base, [s * 0.8, 1.6, 2.8], { rot: [Math.PI / 2, 0, 0] }));
  }

  // fold the mount's local geometry into the hull at the slot transform
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]), quat, new THREE.Vector3(1, 1, 1)
  );
  for (const p of sub.parts) {
    const geo = p.geo.clone().applyMatrix4(m);
    bakeTriplanarUV(geo, TILE);
    hull.parts.push({ geo, mat: p.mat });
  }
}

function addMounts(hull, def) {
  def.slots.forEach((slot, i) => {
    const wid = def.defaultLoadout ? def.defaultLoadout[i] : null;
    // the mount silhouette follows the class's doctrine loadout
    addMount(hull, slot, wid ? WEAPON_SHAPES[wid] : null, def.faction);
  });
}

// Minimal shape descriptors so meshes.js doesn't import the whole data table.
const WEAPON_SHAPES = {
  pulse_laser:       { type: 'laser' },
  heavy_laser:       { type: 'laser' },
  precision_laser:   { type: 'laser' },
  pd_laser:          { type: 'laser', pd: true },
  railgun:           { type: 'gun' },
  autocannon:        { type: 'gun', pd: true },
  energy_shell:      { type: 'gun' },
  torpedo:           { type: 'missile', missile: true },
  swarm_missiles:    { type: 'missile', missile: true },
  disruptor_missile: { type: 'missile', missile: true },
  fighter_wing:      { craft: true },
  bomber_wing:       { craft: true },
  gunboat_wing:      { craft: true },
  v_drone_wing:      { craft: true },
  v_plasma_arc:      { type: 'laser' },
  v_spine_cannon:    { type: 'gun' },
  v_needle_beam:     { type: 'laser' },
  v_spore_swarm:     { type: 'missile', missile: true },
  v_leech_beam:      { type: 'laser' }
};

// =============================================================== DECALS ====
//
// Pennant numbers are painted on flat quads on each flank rather than baked
// into the tiling plating, so the lettering stays crisp and unrepeated. Both
// sides are ROTATED (never mirror-scaled) so the text reads correctly from
// either beam.

const DECALS = {
  hc_falchion:  { code: 'CV-11',  sub: 'FALCHION',  accent: '#35c8ff' },
  dd_sabre:     { code: 'DD-207', sub: 'SABRE',     accent: '#4dd47a' },
  dd_rapier:    { code: 'DD-214', sub: 'RAPIER',    accent: '#b07cff' },
  cr_bulwark:   { code: 'CA-32',  sub: 'BULWARK',   accent: '#35c8ff' },
  cr_warhammer: { code: 'CA-40',  sub: 'WARHAMMER', accent: '#ffb545' }
};

const DECAL_MATS = new Map();

/** raised nameplate built into the hull; returns the outer-face X */
function addNamePlate(hull, { x, y, z, w, h }) {
  const t = 0.7;
  hull.box(t, h + 1.2, w + 1.6, M.plate, [ x + t / 2, y, z]);
  hull.box(t, h + 1.2, w + 1.6, M.plate, [-x - t / 2, y, z]);
  return x + t + 0.06;
}

function addDecalPanels(group, def, { x, y, z, w, h }) {
  const spec = DECALS[def.id];
  if (!spec) return;
  let mat = DECAL_MATS.get(def.id);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: makeDecal(spec.code, spec.accent, spec.sub),
      transparent: true, roughness: 0.65, metalness: 0.1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      depthWrite: false
    });
    DECAL_MATS.set(def.id, mat);
  }
  const geos = [];
  for (const side of [1, -1]) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(side * Math.PI / 2);          // face ±X without mirroring the art
    g.translate(side * x, y, z);
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.renderOrder = 1;
  group.add(mesh);
}

// ================================================================ HUMANS ====

/** shared human detailing: radiators, truss, antennae, hull numbers */
function humanDetails(h, { len, wid, ht }) {
  // dorsal truss spine
  const z0 = -len * 0.28, z1 = len * 0.30;
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const z = z0 + (z1 - z0) * t;
    h.pair(s => h.box(0.3, 0.3, 0.3, M.dark, [s * wid * 0.30, ht * 0.62, z], { scale: [1, 5, 1] }));
    h.box(wid * 0.62, 0.26, 0.26, M.dark, [0, ht * 0.62 + 1.1, z]);
  }
  // ventral radiator fins, angled out and down — the flanks stay clear for
  // the nameplate and boat bays
  h.pair(s => {
    for (let i = 0; i < 3; i++) {
      const z = (-0.18 + i * 0.15) * len;
      h.box(0.26, ht * 1.0, len * 0.075, M.trim, [s * wid * 0.30, -ht * 1.0, z],
        { rot: [0, 0, s * 0.5] });
      h.box(0.5, 0.4, len * 0.085, M.dark, [s * wid * 0.24, -ht * 0.52, z]);  // root spar
    }
  });
  // antenna cluster
  h.cyl(0.14, 0.14, ht * 1.5, 4, M.trim, [0, ht * 1.2, -len * 0.20]);
  h.box(1.6, 0.2, 0.2, M.trim, [0, ht * 1.85, -len * 0.20]);
  // greeble strakes along the flanks
  h.pair(s => h.greebleRow(M.plate, {
    x: s * wid * 0.48, y: -ht * 0.05, z0: -len * 0.26, z1: len * 0.26,
    n: 9, w: 1.1, h: 1.0, d: len * 0.035
  }));
  // running lights: red to port, green to starboard
  h.box(0.5, 0.5, 0.5, M.window, [wid * 0.50, ht * 0.55, len * 0.30]);
  h.box(0.5, 0.5, 0.5, M.glow, [-wid * 0.50, ht * 0.55, len * 0.30]);
}

function buildFalchion(def) {
  const h = new Hull();
  const spin = [];
  // slim armoured spine with a faceted bow
  h.box(6.4, 5.2, 30, M.hull, [0, 0, 0]);
  h.box(7.6, 4.0, 8, M.plate, [0, 0.3, -1]);
  h.box(5.0, 3.4, 9, M.plate, [0, 0, 13], { rot: [0, 0, Math.PI / 4], scale: [0.85, 0.85, 1] });
  h.cone(3.0, 7, 6, M.trim, [0, 0, 19], { rot: [Math.PI / 2, 0, 0] });      // ram bow
  h.box(1.2, 1.2, 3.4, M.glow, [0, 0, 22]);                                  // bow lamp
  // bridge block with lit windows
  h.box(4.6, 3.0, 5.6, M.plate, [0, 3.6, -3]);
  h.windows(M.window, { x: 0, y: 4.3, z: -3, len: 3.6, count: 4 });
  h.pair(s => h.box(0.4, 0.9, 4.0, M.trim, [s * 2.5, 4.2, -3]));
  // stern machinery
  h.box(8.4, 4.6, 8, M.plate, [0, 0, -12]);
  h.greebleRow(M.dark, { x: 0, y: 2.6, z0: -15, z1: -9, n: 4, w: 3.2, h: 1.2, d: 1.2 });
  humanDetails(h, { len: 30, wid: 7, ht: 3.2 });

  // --- spinning habitat ring on its own pylon (kept separate to animate) ---
  const ringHull = new Hull();
  ringHull.add(new THREE.TorusGeometry(9.2, 1.5, 8, 24), M.hull, {});
  for (let i = 0; i < 8; i++) {                       // habitat modules + windows
    const a = (i / 8) * Math.PI * 2;
    ringHull.box(2.4, 2.0, 1.8, M.plate, [Math.cos(a) * 9.2, Math.sin(a) * 9.2, 0],
      { rot: [0, 0, a] });
    ringHull.box(1.5, 0.5, 2.0, M.window, [Math.cos(a) * 9.2, Math.sin(a) * 9.2, 0.9],
      { rot: [0, 0, a] });
  }
  for (let i = 0; i < 4; i++) {                       // spokes
    const a = (i / 4) * Math.PI * 2;
    ringHull.box(0.7, 9.2, 0.7, M.trim, [Math.cos(a) * 4.6, Math.sin(a) * 4.6, 0],
      { rot: [0, 0, a + Math.PI / 2] });
  }
  const ring = ringHull.assemble();
  ring.position.z = 1;
  spin.push(ring);

  h.cyl(2.2, 2.2, 3.0, 8, M.dark, [0, 0, 1], { rot: [Math.PI / 2, 0, 0] });  // ring hub
  addMounts(h, def);

  for (const x of [-3.2, 3.2]) {
    h.cyl(1.5, 2.2, 3.4, 8, M.dark, [x, 0, -17.4], { rot: [Math.PI / 2, 0, 0] });
  }
  const plateX = addNamePlate(h, { x: 3.2, y: 0.2, z: -3.5, w: 6.4, h: 2.4 });
  const group = h.assemble();
  ring.name = '__spin';
  group.add(ring);
  const engines = [];
  for (const x of [-3.2, 3.2]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), M.engine);
    e.position.set(x, 0, -18.9); e.name = '__engine';
    group.add(e); engines.push(e);
  }
  addDecalPanels(group, def, { x: plateX, y: 0.2, z: -3.5, w: 6.4, h: 2.4 });
  return { group, spin, engines };
}

function buildDestroyer(def, variant) {
  const h = new Hull();
  const L = 46;
  // long hull with a knife bow and a raked forward deck
  h.box(7.4, 6.0, L, M.hull, [0, 0, 0]);
  h.box(10.5, 3.4, L * 0.42, M.plate, [0, -1.4, 2]);              // belly armour
  h.box(5.2, 4.2, 12, M.plate, [0, 0.4, 15], { rot: [0, 0, Math.PI / 4], scale: [0.8, 0.8, 1] });
  h.cone(2.6, 8, 6, M.trim, [0, 0, 23], { rot: [Math.PI / 2, 0, 0] });
  h.box(1.0, 1.0, 3.0, M.glow, [0, 0, 26]);
  // superstructure + bridge windows
  h.box(5.4, 3.4, 9, M.plate, [0, 4.0, -4]);
  h.box(4.0, 2.2, 5, M.hull, [0, 6.4, -3]);
  h.windows(M.window, { x: 0, y: 6.8, z: -3, len: 3.2, count: 4 });
  h.pair(s => h.box(2.0, 2.6, 6.0, M.plate, [s * 4.6, 1.2, -2]));  // sponsons

  if (variant === 'sensor') {
    // Sabre: a scanner boat — big phased array, dish, sensor blisters
    h.cyl(0.5, 0.5, 7, 6, M.trim, [0, 8.6, -6]);
    h.box(6.4, 4.0, 0.6, M.trim, [0, 11.6, -6], { rot: [0.25, 0, 0] });   // phased array
    for (let r = 0; r < 3; r++) {                                          // lit array faces
      h.box(5.4, 0.55, 0.22, M.glow, [0, 10.5 + r * 1.1, -5.72 + r * 0.28], { rot: [0.25, 0, 0] });
    }
    h.cyl(0.4, 3.4, 2.6, 12, M.plate, [0, 7.4, 6], { rot: [-0.5, 0, 0] }); // dish
    h.sphere(0.8, 8, 6, M.glow, [0, 8.4, 7.4]);
    h.pair(s => h.sphere(1.4, 8, 6, M.plate, [s * 4.0, 2.4, 8], { scale: [1, 0.8, 1.3] }));
  } else {
    // Rapier: fire-control refit — armoured director spine, laser capacitors
    h.box(3.0, 3.0, 22, M.plate, [0, 6.0, 4]);
    h.greebleRow(M.dark, { x: 0, y: 7.8, z0: -4, z1: 13, n: 6, w: 2.2, h: 0.9, d: 1.6 });
    h.pair(s => h.cyl(1.1, 1.1, 9, 8, M.trim, [s * 2.6, 5.2, 8], { rot: [Math.PI / 2, 0, 0] }));
    h.box(2.2, 1.6, 4.0, M.glow, [0, 8.0, 15]);                            // director optics
  }
  humanDetails(h, { len: L, wid: 8, ht: 3.6 });
  addMounts(h, def);

  for (const x of [-4.2, 0, 4.2]) {
    h.cyl(1.7, 2.4, 4.0, 8, M.dark, [x, -1, -24], { rot: [Math.PI / 2, 0, 0] });
  }
  const plateX = addNamePlate(h, { x: 3.7, y: 2.4, z: 13, w: 9, h: 2.6 });
  const group = h.assemble();
  const engines = [];
  for (const x of [-4.2, 0, 4.2]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), M.engine);
    e.position.set(x, -1, -25.8); e.name = '__engine';
    group.add(e); engines.push(e);
  }
  addDecalPanels(group, def, { x: plateX, y: 2.4, z: 13, w: 9, h: 2.6 });
  return { group, spin: [], engines };
}

function buildCruiser(def, variant) {
  const h = new Hull();
  const flag = variant === 'flag';
  const L = flag ? 64 : 56;
  const W = flag ? 13 : 12;
  // deep armoured citadel with stepped forward decks
  h.box(W, 9, L, M.hull, [0, 0, 0]);
  h.box(W * 1.5, 5.0, L * 0.5, M.plate, [0, -2.0, 0]);              // belly / hangar deck
  h.box(W * 0.8, 6.0, L * 0.30, M.plate, [0, 2.4, L * 0.22]);
  h.box(W * 0.55, 4.6, 14, M.plate, [0, 1.0, L * 0.42], { rot: [0, 0, Math.PI / 4], scale: [0.8, 0.8, 1] });
  h.cone(3.4, 10, 6, M.trim, [0, 0, L * 0.55], { rot: [Math.PI / 2, 0, 0] });
  h.box(1.6, 1.6, 4, M.glow, [0, 0, L * 0.60]);
  // island superstructure with several window decks
  h.box(7.2, 4.0, 16, M.plate, [0, 6.2, -4]);
  h.box(5.4, 3.0, 10, M.hull, [0, 9.4, -4]);
  for (let d = 0; d < 3; d++) {
    h.windows(M.window, { x: 0, y: 7.0 + d * 1.6, z: -4, len: 10, count: 7 });
  }
  h.pair(s => h.box(0.5, 3.0, 12, M.trim, [s * 3.6, 8.0, -4]));
  // flank armour belts + boat bays
  h.pair(s => {
    h.box(2.6, 5.0, L * 0.62, M.plate, [s * (W * 0.62), -0.6, 0]);
    h.greebleRow(M.dark, { x: s * (W * 0.72), y: -0.6, z0: -L * 0.30, z1: -L * 0.06, n: 6, w: 1.0, h: 1.6, d: L * 0.03 });
  });

  if (variant === 'shield') {
    // Bulwark: capacitor banks and emitter rings — visibly an energy ship
    for (const z of [12, -6, -20]) {
      h.cyl(3.2, 3.2, 5.0, 12, M.trim, [0, 7.0, z], { rot: [Math.PI / 2, 0, 0] });
      h.cyl(3.4, 3.4, 0.8, 12, M.glow, [0, 7.0, z + 2.6], { rot: [Math.PI / 2, 0, 0] });
    }
    h.pair(s => h.box(1.0, 1.0, L * 0.5, M.glow, [s * 4.4, 8.4, 0]));   // bus bars
    h.pair(s => h.cyl(1.6, 2.4, 4.0, 8, M.plate, [s * 7.0, 4.0, 18], { rot: [Math.PI / 2, 0, 0] }));
  } else {
    // Warhammer: heavy spinal rail assembly running most of the hull
    h.box(4.0, 4.0, L * 0.78, M.plate, [0, 5.0, 4]);
    h.pair(s => h.cyl(1.3, 1.3, L * 0.66, 8, M.trim, [s * 2.6, 5.0, 6], { rot: [Math.PI / 2, 0, 0] }));
    h.greebleRow(M.dark, { x: 0, y: 7.4, z0: -18, z1: 20, n: 9, w: 3.0, h: 1.2, d: 1.8 });
    h.pair(s => h.cyl(1.35, 1.35, 1.0, 8, M.glow, [s * 2.6, 5.0, L * 0.39], { rot: [Math.PI / 2, 0, 0] }));
  }
  humanDetails(h, { len: L, wid: W + 3, ht: 5.0 });
  addMounts(h, def);

  for (const x of [-7, 0, 7]) {
    h.cyl(2.3, 3.2, 5.0, 10, M.dark, [x, -1, -L / 2 - 2], { rot: [Math.PI / 2, 0, 0] });
  }
  const plateX = addNamePlate(h, { x: W * 0.62 + 1.3, y: -0.4, z: L * 0.17, w: 15, h: 4.0 });
  const group = h.assemble();
  const engines = [];
  for (const x of [-7, 0, 7]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(2.0, 10, 8), M.engine);
    e.position.set(x, -1, -L / 2 - 4.4); e.name = '__engine';
    group.add(e); engines.push(e);
  }
  addDecalPanels(group, def, { x: plateX, y: -0.4, z: L * 0.17, w: 15, h: 4.0 });
  return { group, spin: [], engines };
}

// =============================================================== VESSARI ====
//
// Grown hulls: a segmented carapace spine, rib arches over a soft core,
// mandibles at the prow, trailing tendrils, and veins that pulse.

function buildVessari(def, tier) {
  const h = new Hull();
  const S = def.size / 30;
  const L = 26 * S;
  const glowNodes = [];

  // --- core body: stacked segments tapering fore and aft ---
  const segs = 5 + tier;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const z = (0.62 - t * 1.18) * L;
    const taper = Math.sin(Math.PI * (0.20 + t * 0.72));
    const r = 6.4 * S * taper;
    h.sphere(r, 12, 9, i % 2 ? M.vHull : M.vPlate, [0, 0, z], { scale: [1.05, 0.72, 0.85] });
    // carapace ridge plate over each segment
    h.box(r * 0.5, r * 0.5, r * 1.15, M.vDark, [0, r * 0.62, z], { rot: [0, 0, Math.PI / 4] });
  }

  // --- prow: mandibles around a lit maw ---
  h.sphere(4.2 * S, 10, 8, M.vHull, [0, 0, 0.74 * L], { scale: [0.8, 0.62, 1.5] });
  h.pair(s => {
    h.cone(1.5 * S, 9 * S, 6, M.vBone, [s * 2.6 * S, 0.4 * S, 0.90 * L], { rot: [Math.PI / 2 - 0.16, 0, -s * 0.20] });
    h.cone(1.2 * S, 7 * S, 6, M.vBone, [s * 1.8 * S, -2.0 * S, 0.86 * L], { rot: [Math.PI / 2 - 0.10, 0, -s * 0.12] });
  });
  glowNodes.push({ r: 1.5 * S, pos: [0, 0, 0.80 * L] });

  // --- rib arches over the dorsal line ---
  const ribs = 3 + tier;
  for (let i = 0; i < ribs; i++) {
    const t = i / Math.max(1, ribs - 1);
    const z = (0.42 - t * 0.86) * L;
    const rr = (4.6 + tier * 0.5) * S * (0.75 + 0.35 * Math.sin(Math.PI * t));
    h.add(new THREE.TorusGeometry(rr, 0.42 * S, 6, 14, Math.PI * 1.15), M.vBone,
      { pos: [0, 0.5 * S, z], rot: [0, 0, Math.PI * 0.075] });
  }

  // --- dorsal fin blades ---
  for (let i = 0; i < 2 + tier; i++) {
    const t = i / Math.max(1, 1 + tier);
    const z = (0.34 - t * 0.72) * L;
    const fh = (5 + tier * 1.6) * S * (1 - t * 0.35);
    h.cone(1.3 * S, fh, 5, M.vDark, [0, (5.0 * S) + fh * 0.35, z], { rot: [-0.22, 0, 0] });
  }

  // --- trailing tendrils, thicker on bigger hulls ---
  const tend = 2 + tier;
  for (let i = 0; i < tend; i++) {
    const a = (i / tend) * Math.PI * 2 + 0.4;
    const rad = 4.4 * S;
    const tx = Math.cos(a) * rad, ty = Math.sin(a) * rad * 0.6;
    h.cyl(0.26 * S, 1.15 * S, 12 * S, 6, M.vDark, [tx * 1.25, ty * 1.25, -0.60 * L],
      { rot: [Math.PI / 2 - 0.34, 0, 0] });
    glowNodes.push({ r: 0.42 * S, pos: [tx * 1.5, ty * 1.5, -0.80 * L] });
  }

  // --- flank vein strips (emissive, animated) ---
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const z = (0.44 - t * 0.92) * L;
    const r = 5.2 * S * Math.sin(Math.PI * (0.22 + t * 0.68));
    glowNodes.push({ r: 0.62 * S, pos: [ r, 0.4 * S, z] });
    glowNodes.push({ r: 0.62 * S, pos: [-r, 0.4 * S, z] });
  }
  // stern vent housings, so the drive glow sits inside anatomy
  {
    const eCount = tier >= 2 ? 3 : 1;
    for (let i = 0; i < eCount; i++) {
      const x = eCount === 1 ? 0 : (i - 1) * 3.4 * S;
      h.sphere(2.0 * S, 10, 8, M.vDark, [x, 0, -0.78 * L], { scale: [1, 0.9, 1.5] });
    }
  }
  addMounts(h, def);

  const group = h.assemble();

  // bioluminescent nodes live in their own mesh so they can pulse
  const glowGeos = glowNodes.map(n => new THREE.SphereGeometry(n.r, 8, 6)
    .translate(n.pos[0], n.pos[1], n.pos[2]));
  const veins = new THREE.Mesh(mergeGeometries(glowGeos), M.vGlow.clone());
  veins.material.transparent = true;
  veins.name = '__veins';
  group.add(veins);

  const engines = [];
  const eCount = tier >= 2 ? 3 : 1;
  for (let i = 0; i < eCount; i++) {
    const x = eCount === 1 ? 0 : (i - 1) * 3.4 * S;
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.25 * S, 10, 8), M.vEngine);
    e.position.set(x, 0, -0.84 * L); e.name = '__engine';
    group.add(e); engines.push(e);
  }
  return { group, spin: [], engines, veins };
}

// ----------------------------------------------------------------- entry ----

function buildPrototype(def) {
  switch (def.id) {
    case 'hc_falchion':   return buildFalchion(def);
    case 'dd_sabre':      return buildDestroyer(def, 'sensor');
    case 'dd_rapier':     return buildDestroyer(def, 'laser');
    case 'cr_bulwark':    return buildCruiser(def, 'shield');
    case 'cr_warhammer':  return buildCruiser(def, 'flag');
    case 'vx_stinger':    return buildVessari(def, 0);
    case 'vx_mantis':     return buildVessari(def, 1);
    case 'vx_lamprey':    return buildVessari(def, 1);
    case 'vx_basilisk':   return buildVessari(def, 2);
    case 'vx_hierophant': return buildVessari(def, 3);
    default:              return buildVessari(def, 0);
  }
}

// One prototype per class; every hull after the first is a clone sharing its
// merged geometry and textured materials, so a twelve-ship skirmish costs the
// same VRAM as one of each.
const PROTOTYPES = new Map();

export function buildShipMesh(def) {
  if (!PROTOTYPES.has(def.id)) PROTOTYPES.set(def.id, buildPrototype(def));
  const proto = PROTOTYPES.get(def.id);
  const group = proto.group.clone(true);
  const spin = [], engines = [];
  let veins = null;
  group.traverse(o => {
    if (o.name === '__spin') spin.push(o);
    else if (o.name === '__engine') engines.push(o);
    else if (o.name === '__veins') veins = o;
  });
  // veins pulse per ship, so that one material must be its own
  if (veins) veins.material = veins.material.clone();
  return { group, spin, engines, veins };
}

// ---------------------------------------------------------- support craft ----

export function buildCraftMesh(wdef, faction) {
  const v = faction === 'vessari';
  const h = new Hull();
  const hullMat = v ? M.vHull : M.plate;
  const trimMat = v ? M.vBone : M.trim;
  const glowMat = new THREE.MeshBasicMaterial({ color: wdef.color });
  const heavy = wdef.craft.hp > 30;      // gunboat
  const mid = wdef.craft.hp > 16;        // bomber
  const s = heavy ? 1.6 : (mid ? 1.25 : 0.95);

  h.box(2.2 * s, 1.5 * s, 7.5 * s, hullMat, [0, 0, 0]);
  h.cone(1.1 * s, 3.0 * s, 6, trimMat, [0, 0, 5.0 * s], { rot: [Math.PI / 2, 0, 0] });
  h.box(0.9 * s, 1.0 * s, 1.6 * s, glowMat, [0, 0.5 * s, 2.6 * s]);      // canopy

  if (heavy) {
    h.box(9.0 * s, 1.0 * s, 3.0 * s, hullMat, [0, -0.2 * s, -0.6 * s]);
    h.pair(k => {
      h.cyl(0.8 * s, 0.8 * s, 5.0 * s, 6, trimMat, [k * 3.2 * s, 0, 0], { rot: [Math.PI / 2, 0, 0] });
      h.cyl(0.3 * s, 0.3 * s, 4.0 * s, 5, trimMat, [k * 1.6 * s, -0.9 * s, 3.0 * s], { rot: [Math.PI / 2, 0, 0] });
    });
    h.box(2.2 * s, 1.8 * s, 3.4 * s, hullMat, [0, 1.2 * s, -1.4 * s]);
  } else if (mid) {
    h.box(8.2 * s, 0.8 * s, 2.6 * s, hullMat, [0, 0, -0.5 * s]);
    h.box(1.8 * s, 1.8 * s, 4.0 * s, hullMat, [0, -1.0 * s, 0.4 * s]);   // bomb bay
    h.pair(k => h.box(0.5 * s, 1.8 * s, 2.2 * s, trimMat, [k * 4.0 * s, 0.5 * s, -1.2 * s]));
  } else {
    h.box(8.6 * s, 0.6 * s, 2.0 * s, hullMat, [0, 0, -0.4 * s], { rot: [0, 0.12, 0] });
    h.pair(k => h.box(0.4 * s, 1.6 * s, 1.8 * s, trimMat, [k * 4.2 * s, 0.6 * s, -1.4 * s]));
  }
  const group = h.assemble();
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.85 * s, 8, 6), glowMat);
  e.position.set(0, 0, -4.4 * s);
  group.add(e);
  return group;
}

// ------------------------------------------------------- shared textures ----

export function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function makeStarfield() {
  const g = new THREE.Group();
  const N = 900;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(14000 + Math.random() * 4000);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const b = 0.4 + Math.random() * 0.6;
    const tint = Math.random();
    col[i * 3] = b * (tint > 0.8 ? 0.8 : 1);
    col[i * 3 + 1] = b * 0.95;
    col[i * 3 + 2] = b * (tint > 0.6 ? 1 : 0.85);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 28, sizeAttenuation: true, vertexColors: true, fog: false, depthWrite: false });
  g.add(new THREE.Points(geo, mat));
  return g;
}
