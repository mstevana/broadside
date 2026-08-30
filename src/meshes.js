// ============================================================================
// BROADSIDE — procedural ship meshes & shared visual assets
// Human hulls: angular slabs, gunmetal + cyan running lights.
// Vessari hulls: organic lobes, dark violet chitin + teal glow.
// Ship local frame: +Z bow, +Y up.
// ============================================================================

import * as THREE from 'three';

const HUMAN_HULL = new THREE.MeshStandardMaterial({ color: 0x93a4b5, roughness: 0.5, metalness: 0.35, flatShading: true });
const HUMAN_DARK = new THREE.MeshStandardMaterial({ color: 0x55626f, roughness: 0.55, metalness: 0.35, flatShading: true });
const HUMAN_GLOW = new THREE.MeshBasicMaterial({ color: 0x35c8ff });
const VESS_HULL = new THREE.MeshStandardMaterial({ color: 0x7a5f9e, roughness: 0.4, metalness: 0.2, flatShading: true });
const VESS_DARK = new THREE.MeshStandardMaterial({ color: 0x4a3a68, roughness: 0.5, metalness: 0.2, flatShading: true });
const VESS_GLOW = new THREE.MeshBasicMaterial({ color: 0x59ffc8 });
const ENGINE_GLOW_H = new THREE.MeshBasicMaterial({ color: 0x66d9ff });
const ENGINE_GLOW_V = new THREE.MeshBasicMaterial({ color: 0xa9ff8a });
const TURRET_MAT = new THREE.MeshStandardMaterial({ color: 0xb9c4d0, roughness: 0.45, metalness: 0.4, flatShading: true });
const TURRET_MAT_V = new THREE.MeshStandardMaterial({ color: 0x9a7fc0, roughness: 0.45, metalness: 0.25, flatShading: true });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}
function sph(r, mat, x = 0, y = 0, z = 0, ws = 8, hs = 6, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

// Small turret nub added at each weapon slot so mounts read visually.
function addTurrets(group, def, mat) {
  for (const s of def.slots) {
    const t = new THREE.Group();
    t.add(cyl(1.6, 2.0, 1.6, mat, 0, 0.6, 0, 6));
    const barrel = box(0.7, 0.7, 3.4, mat, 0, 1.2, 1.6);
    t.add(barrel);
    t.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const d = new THREE.Vector3(s.dir[0], s.dir[1], s.dir[2]).normalize();
    t.lookAt(t.position.clone().add(d));
    group.add(t);
  }
}

// ---------------------------------------------------------------- humans ----

function buildFalchion(def) {
  const g = new THREE.Group();
  const spin = [];
  g.add(box(6, 5, 34, HUMAN_HULL, 0, 0, 0));                    // spine
  g.add(box(10, 3.5, 12, HUMAN_DARK, 0, 0, 12));                // bow wedge
  g.add(box(4, 2, 6, HUMAN_GLOW, 0, 0, 19.5));                  // bow light
  g.add(box(9, 4, 8, HUMAN_DARK, 0, 0, -13));                   // stern block
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 1.7, 6, 18), HUMAN_HULL);
  ring.position.z = 2; ring.rotation.y = 0;                     // habitat ring spins about Z
  spin.push(ring);
  g.add(ring);
  g.add(cyl(1.2, 1.2, 6, HUMAN_DARK, 3, 0, -17).rotateX(Math.PI / 2));
  g.add(cyl(1.2, 1.2, 6, HUMAN_DARK, -3, 0, -17).rotateX(Math.PI / 2));
  const e1 = sph(1.3, ENGINE_GLOW_H, 3, 0, -20.5); const e2 = sph(1.3, ENGINE_GLOW_H, -3, 0, -20.5);
  g.add(e1, e2);
  addTurrets(g, def, TURRET_MAT);
  return { group: g, spin, engines: [e1, e2] };
}

function buildDestroyer(def, variant) {
  const g = new THREE.Group();
  g.add(box(7, 6, 44, HUMAN_HULL, 0, 0, 0));
  g.add(box(12, 4, 16, HUMAN_DARK, 0, -1, 6));
  g.add(box(5, 3, 10, HUMAN_DARK, 0, 3.5, -6));                 // superstructure
  g.add(box(3, 1.5, 8, HUMAN_GLOW, 0, 0.5, 20));
  if (variant === 'sensor') {
    const dish = cyl(0.3, 3.2, 2.4, HUMAN_DARK, 0, 7, -2, 10);  // sensor mast
    g.add(dish);
    g.add(cyl(0.4, 0.4, 5, HUMAN_DARK, 0, 4.5, -2));
  } else {
    g.add(box(2.5, 2.5, 14, HUMAN_DARK, 0, 5, 4));              // fire-control spine
  }
  g.add(cyl(1.6, 1.6, 7, HUMAN_DARK, 4, -1, -22).rotateX(Math.PI / 2));
  g.add(cyl(1.6, 1.6, 7, HUMAN_DARK, -4, -1, -22).rotateX(Math.PI / 2));
  const e1 = sph(1.7, ENGINE_GLOW_H, 4, -1, -26); const e2 = sph(1.7, ENGINE_GLOW_H, -4, -1, -26);
  g.add(e1, e2);
  addTurrets(g, def, TURRET_MAT);
  return { group: g, spin: [], engines: [e1, e2] };
}

function buildCruiser(def, variant) {
  const g = new THREE.Group();
  const L = variant === 'flag' ? 62 : 54;
  g.add(box(12, 8, L, HUMAN_HULL, 0, 0, 0));
  g.add(box(18, 5, L * 0.45, HUMAN_DARK, 0, -1, 2));            // wing slabs
  g.add(box(8, 5, 18, HUMAN_DARK, 0, 5.5, -4));                 // citadel
  g.add(box(4, 2, 10, HUMAN_GLOW, 0, 0, L / 2 + 3));
  if (variant === 'shield') {
    // capacitor spheres along the spine
    g.add(sph(3, HUMAN_GLOW, 0, 6, 10));
    g.add(sph(3, HUMAN_GLOW, 0, 6, -14));
  } else {
    g.add(box(3, 3, 26, HUMAN_DARK, 5, 6, 2));
    g.add(box(3, 3, 26, HUMAN_DARK, -5, 6, 2));
  }
  const engines = [];
  for (const x of [-6, 0, 6]) {
    g.add(cyl(2.2, 2.2, 8, HUMAN_DARK, x, -1, -L / 2 - 2).rotateX(Math.PI / 2));
    const e = sph(2.3, ENGINE_GLOW_H, x, -1, -L / 2 - 6.5);
    engines.push(e); g.add(e);
  }
  addTurrets(g, def, TURRET_MAT);
  return { group: g, spin: [], engines };
}

// --------------------------------------------------------------- vessari ----

function buildVessari(def, tier) {
  const g = new THREE.Group();
  const s = def.size / 30;
  // main lobed body
  g.add(sph(9 * s, VESS_HULL, 0, 0, 2 * s, 10, 8, 0.75, 0.6, 1.9));
  g.add(sph(6 * s, VESS_DARK, 0, 1.5 * s, -8 * s, 8, 6, 1.0, 0.75, 1.1));
  g.add(sph(4 * s, VESS_HULL, 0, -1 * s, 11 * s, 8, 6, 0.7, 0.55, 1.3));
  // dorsal spine fins
  for (let i = 0; i < 3 + tier; i++) {
    const z = (6 - i * 5) * s;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 6 * s + i, 5), VESS_DARK);
    fin.position.set(0, 4.5 * s, z);
    g.add(fin);
  }
  // side tendrils
  const t1 = cyl(0.6 * s, 1.4 * s, 12 * s, VESS_DARK, 6 * s, -1 * s, 4 * s, 6);
  t1.rotation.z = Math.PI / 2.4; g.add(t1);
  const t2 = cyl(0.6 * s, 1.4 * s, 12 * s, VESS_DARK, -6 * s, -1 * s, 4 * s, 6);
  t2.rotation.z = -Math.PI / 2.4; g.add(t2);
  // bioluminescent nodes
  g.add(sph(1.2 * s, VESS_GLOW, 0, 2 * s, 12 * s));
  g.add(sph(0.9 * s, VESS_GLOW, 3.5 * s, 1 * s, 6 * s));
  g.add(sph(0.9 * s, VESS_GLOW, -3.5 * s, 1 * s, 6 * s));
  const e1 = sph(1.6 * s, ENGINE_GLOW_V, 0, 0.5 * s, -13 * s);
  g.add(e1);
  addTurrets(g, def, TURRET_MAT_V);
  return { group: g, spin: [], engines: [e1] };
}

// ----------------------------------------------------------------- entry ----

export function buildShipMesh(def) {
  let built;
  switch (def.id) {
    case 'hc_falchion': built = buildFalchion(def); break;
    case 'dd_sabre':    built = buildDestroyer(def, 'sensor'); break;
    case 'dd_rapier':   built = buildDestroyer(def, 'laser'); break;
    case 'cr_bulwark':  built = buildCruiser(def, 'shield'); break;
    case 'cr_warhammer':built = buildCruiser(def, 'flag'); break;
    case 'vx_stinger':  built = buildVessari(def, 0); break;
    case 'vx_mantis':   built = buildVessari(def, 1); break;
    case 'vx_lamprey':  built = buildVessari(def, 1); break;
    case 'vx_basilisk': built = buildVessari(def, 2); break;
    case 'vx_hierophant': built = buildVessari(def, 3); break;
    default:            built = buildVessari(def, 0);
  }
  return built;
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
  const tex = new THREE.CanvasTexture(c);
  return tex;
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
