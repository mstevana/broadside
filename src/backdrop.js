// ============================================================================
// BROADSIDE — deep-space backdrop.
//
// Homeworld's signature was that space was never empty: every battle happened
// in front of something enormous. Each mission region paints its own sky onto
// a cube texture — one draw call, no runtime cost — combining:
//
//   * real NASA/ESA/CSA nebula photography (assets/nebula, see CREDITS.md),
//     projected onto the sky gnomonically so it crosses cube-face boundaries
//     without a seam;
//   * a procedural cloud layer that fills the rest of the sky and blends the
//     photographs into it;
//   * dust lanes, and a graded star field that skips anywhere the photograph
//     already supplies stars of its own.
//
// Everything is tonally compressed below the bloom threshold, so the backdrop
// reads as distance rather than glowing.
// ============================================================================

import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- nebula plates ----

const PLATE_SIZE = 256;          // sampling resolution; face patches are smaller
const PLATES = {};
let platePromise = null;

/** NASA/ESA/CSA imagery — see CREDITS.md for full attribution */
export const NEBULA_PLATES = {
  carina:       'assets/nebula/carina.jpg',
  helix:        'assets/nebula/helix.jpg',
  crab:         'assets/nebula/crab.jpg',
  southernring: 'assets/nebula/southernring.jpg',
  eagle:        'assets/nebula/eagle.jpg',
  tarantula:    'assets/nebula/tarantula.jpg'
};

function loadPlate(name, url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // downsample once into a sampling buffer: face patches are ~100-200px
      // across, so pulling from a 512px source directly would alias its stars
      // into sparkle noise
      const cv = document.createElement('canvas');
      cv.width = cv.height = PLATE_SIZE;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, PLATE_SIZE, PLATE_SIZE);
      PLATES[name] = ctx.getImageData(0, 0, PLATE_SIZE, PLATE_SIZE).data;
      resolve();
    };
    img.onerror = () => resolve();    // missing plate: fall back to procedural
    img.src = url;
  });
}

/** kick off (or await) loading of every nebula plate */
export function preloadNebulae() {
  if (!platePromise) {
    platePromise = Promise.all(
      Object.entries(NEBULA_PLATES).map(([n, u]) => loadPlate(n, u))
    );
  }
  return platePromise;
}

// ------------------------------------------------------------- cube kit ----

const FACE_AXES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

/** direction vector for a pixel on a cube face (WebGL cubemap convention) */
function faceDir(face, u, v) {
  const a = u * 2 - 1, b = v * 2 - 1;
  switch (face) {
    case 0: return [ 1, -b, -a];
    case 1: return [-1, -b,  a];
    case 2: return [ a,  1,  b];
    case 3: return [ a, -1, -b];
    case 4: return [ a, -b,  1];
    default: return [-a, -b, -1];
  }
}

/** orthonormal basis around a forward direction, rolled by `roll` */
function basis(fwd, roll) {
  const f = new THREE.Vector3(...fwd).normalize();
  const tmp = Math.abs(f.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(tmp, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const r2 = r.clone().multiplyScalar(c).addScaledVector(u, s);
    const u2 = u.clone().multiplyScalar(c).addScaledVector(r, -s);
    r.copy(r2); u.copy(u2);
  }
  return { f, r, u };
}

// =============================================================== builder ====

export function makeBackdrop({
  seed = 1, size = 320, density = 0.75,
  palette = [[90, 130, 210], [150, 90, 190], [40, 90, 150]],
  planet = null, starDensity = 1, nebulae = []
} = {}) {
  const rand = rng(seed);

  // --- procedural cloud banks (3D, so they wrap across faces) ---
  const blobs = [];
  const nBlobs = Math.round(26 * density);
  for (let i = 0; i < nBlobs; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (i > 3) {
      const anchor = blobs[(rand() * Math.min(blobs.length, 4)) | 0];
      v.lerp(anchor.dir, 0.55 + rand() * 0.3).normalize();
    }
    const col = palette[(rand() * palette.length) | 0];
    blobs.push({
      dir: v,
      spread: 0.10 + rand() * 0.42,
      gain: (0.05 + rand() * 0.22) * density,
      col
    });
  }

  // Dust lanes are great-circle bands. Narrow ones read as a drawn line
  // rather than dust, especially once the tonal compressor sharpens them, so
  // they are wide and shallow.
  const lanes = [];
  for (let i = 0; i < 3; i++) {
    lanes.push({ dir: new THREE.Vector3().randomDirection(), width: 0.16 + rand() * 0.16 });
  }

  // --- photographic plates, placed on the sky ---
  const plates = nebulae
    .filter(n => PLATES[n.img])
    .map(n => {
      const b = basis(n.dir, n.roll || 0);
      return {
        data: PLATES[n.img],
        f: b.f, r: b.r, u: b.u,
        tan: Math.tan(n.span || 0.55),        // half-extent as a tangent
        cosLimit: Math.cos(Math.min(1.45, (n.span || 0.55) * 1.9)),
        gain: n.gain != null ? n.gain : 1
      };
    });

  const CEIL = 152;    // max nebula channel; bloom threshold sits at ~224
  const KNEE = 95;
  const faces = [];
  const dir = new THREE.Vector3();

  for (let f = 0; f < 6; f++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const photoLum = new Float32Array(size * size);   // where a plate supplied light

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [dx, dy, dz] = faceDir(f, (x + 0.5) / size, (y + 0.5) / size);
        dir.set(dx, dy, dz).normalize();

        let r = 5, g = 8, b = 14;

        // ---- procedural clouds ----
        for (const bl of blobs) {
          const dot = dir.dot(bl.dir);
          if (dot <= 0) continue;
          const ang = 1 - dot;
          const fall = Math.exp(-(ang * ang) / (2 * bl.spread * bl.spread));
          if (fall < 0.004) continue;
          const k = fall * bl.gain;
          r += bl.col[0] * k; g += bl.col[1] * k; b += bl.col[2] * k;
        }

        // ---- dust lanes cut across the procedural layer ----
        for (const ln of lanes) {
          const perp = Math.abs(dir.dot(ln.dir));
          const band = Math.exp(-(perp * perp) / (2 * ln.width * ln.width));
          const k = 1 - band * 0.38;
          r *= k; g *= k; b *= k;
        }

        // Procedural light is unbounded, so compress it to a ceiling under the
        // bloom threshold. Photographs are composited AFTER this, in display
        // space — running them through the compressor flattened their contrast
        // and turned the plate's soft edge into a visible cut.
        let outR = CEIL * (1 - Math.exp(-r / KNEE));
        let outG = CEIL * (1 - Math.exp(-g / KNEE));
        let outB = CEIL * (1 - Math.exp(-b / KNEE));

        // ---- photographic plates (gnomonic, hence seamless across faces) ----
        let pl = 0;
        for (const p of plates) {
          const dot = dir.dot(p.f);
          if (dot <= p.cosLimit || dot <= 0.02) continue;
          const su = dir.dot(p.r) / dot / p.tan;      // -1..1 inside the plate
          const sv = dir.dot(p.u) / dot / p.tan;
          if (su < -1 || su > 1 || sv < -1 || sv > 1) continue;

          // dissolve the rectangular edge into space over a wide margin
          const rad = Math.sqrt(su * su + sv * sv);
          if (rad > 1) continue;
          let mask = rad < 0.32 ? 1 : 1 - (rad - 0.32) / 0.68;
          mask = mask * mask * (3 - 2 * mask);        // smoothstep
          const k = mask * p.gain;
          if (k < 0.004) continue;

          // bilinear sample
          const fx = (su * 0.5 + 0.5) * (PLATE_SIZE - 1);
          const fy = (0.5 - sv * 0.5) * (PLATE_SIZE - 1);
          const x0 = fx | 0, y0 = fy | 0;
          const x1 = Math.min(PLATE_SIZE - 1, x0 + 1), y1 = Math.min(PLATE_SIZE - 1, y0 + 1);
          const tx = fx - x0, ty = fy - y0;
          const i00 = (y0 * PLATE_SIZE + x0) * 4, i10 = (y0 * PLATE_SIZE + x1) * 4;
          const i01 = (y1 * PLATE_SIZE + x0) * 4, i11 = (y1 * PLATE_SIZE + x1) * 4;
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
          const w01 = (1 - tx) * ty, w11 = tx * ty;
          const pr = p.data[i00] * w00 + p.data[i10] * w10 + p.data[i01] * w01 + p.data[i11] * w11;
          const pg = p.data[i00 + 1] * w00 + p.data[i10 + 1] * w10 + p.data[i01 + 1] * w01 + p.data[i11 + 1] * w11;
          const pb = p.data[i00 + 2] * w00 + p.data[i10 + 2] * w10 + p.data[i01 + 2] * w01 + p.data[i11 + 2] * w11;

          // cross-fade rather than add: preserves the photograph's tonality,
          // and its own dark dust properly occludes the sky behind it
          outR += (pr - outR) * k;
          outG += (pg - outG) * k;
          outB += (pb - outB) * k;
          pl = Math.max(pl, (pr + pg + pb) / 3 * k);
        }
        photoLum[y * size + x] = pl;

        const i = (y * size + x) * 4;
        d[i] = outR; d[i + 1] = outG; d[i + 2] = outB;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // ---- stars, but not on top of a photograph that has its own ----
    const nStars = Math.round(size * size * 0.0022 * starDensity);
    for (let i = 0; i < nStars; i++) {
      const x = rand() * size, y = rand() * size;
      if (photoLum[(y | 0) * size + (x | 0)] > 14) continue;
      const m = rand();
      const rad = m > 0.985 ? 1.5 : (m > 0.9 ? 0.9 : 0.55);
      const a = 0.25 + rand() * 0.75;
      const tint = rand();
      ctx.fillStyle = tint > 0.85 ? `rgba(190,215,255,${a})`
        : tint < 0.12 ? `rgba(255,225,195,${a})` : `rgba(240,246,255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (rad > 1.2) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 5);
        gr.addColorStop(0, `rgba(200,225,255,${a * 0.35})`);
        gr.addColorStop(1, 'rgba(200,225,255,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      }
    }
    faces.push(cv);
  }

  // --- planet, drawn into whichever face it faces ---
  if (planet) {
    const pd = new THREE.Vector3(...planet.dir).normalize();
    for (let f = 0; f < 6; f++) {
      const ax = new THREE.Vector3(...FACE_AXES[f]);
      if (pd.dot(ax) < 0.55) continue;
      const ctx = faces[f].getContext('2d');
      const t = 1 / pd.dot(ax);
      const p = pd.clone().multiplyScalar(t);
      let u = 0.5, v = 0.5;
      switch (f) {
        case 0: u = (-p.z + 1) / 2; v = (-p.y + 1) / 2; break;
        case 1: u = ( p.z + 1) / 2; v = (-p.y + 1) / 2; break;
        case 2: u = ( p.x + 1) / 2; v = ( p.z + 1) / 2; break;
        case 3: u = ( p.x + 1) / 2; v = (-p.z + 1) / 2; break;
        case 4: u = ( p.x + 1) / 2; v = (-p.y + 1) / 2; break;
        default: u = (-p.x + 1) / 2; v = (-p.y + 1) / 2;
      }
      const cx = u * size, cy = v * size, R = planet.size * size;
      const [pr, pg, pb] = planet.color;
      const lx = planet.lit ? planet.lit[0] : -0.55;
      const ly = planet.lit ? planet.lit[1] : -0.5;
      const grd = ctx.createRadialGradient(
        cx + lx * R * 0.75, cy + ly * R * 0.75, R * 0.06, cx, cy, R);
      grd.addColorStop(0, `rgb(${Math.min(255, pr * 1.5)},${Math.min(255, pg * 1.5)},${Math.min(255, pb * 1.5)})`);
      grd.addColorStop(0.42, `rgb(${pr},${pg},${pb})`);
      grd.addColorStop(0.78, `rgb(${pr * 0.32 | 0},${pg * 0.32 | 0},${pb * 0.32 | 0})`);
      grd.addColorStop(1, 'rgb(3,5,9)');
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
      ctx.fillStyle = grd; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      const prand = rng(seed * 31 + 7);
      for (let i = 0; i < 16; i++) {
        const by = cy - R + prand() * R * 2;
        const bh = R * (0.03 + prand() * 0.10);
        ctx.fillStyle = `rgba(${pr * 1.2 | 0},${pg * 1.15 | 0},${pb},${0.05 + prand() * 0.10})`;
        ctx.beginPath();
        ctx.ellipse(cx + (prand() - 0.5) * R * 0.5, by, R * (0.7 + prand() * 0.5), bh, 0, 0, 7);
        ctx.fill();
      }
      ctx.restore();
      const rim = ctx.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.13);
      rim.addColorStop(0, `rgba(${pr},${pg + 40},${pb + 70},0)`);
      rim.addColorStop(0.45, `rgba(${pr},${pg + 50},${pb + 90},0.30)`);
      rim.addColorStop(1, `rgba(${pr},${pg + 50},${pb + 90},0)`);
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, 7); ctx.fill();
    }
  }

  const tex = new THREE.CubeTexture(faces);
  tex.needsUpdate = true;
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================== regions ====
//
// Each region places one or two real nebulae on its sky, with the procedural
// cloud layer tinted to match so the photographs sit inside a sky rather than
// on top of one.

export const BACKDROPS = {
  verge: {
    seed: 11, density: 0.5,
    palette: [[70, 110, 190], [40, 80, 150], [110, 90, 180]],
    nebulae: [{ img: 'eagle', dir: [-0.35, 0.15, 0.92], span: 0.62, roll: 0.4, gain: 0.95 }],
    planet: { dir: [-0.5, -0.15, 0.85], size: 0.40, color: [70, 96, 140], lit: [0.5, -0.4] }
  },
  relay: {
    seed: 23, density: 0.4,
    palette: [[60, 100, 160], [30, 70, 120], [90, 70, 140]],
    nebulae: [{ img: 'helix', dir: [0.82, 0.22, -0.52], span: 0.5, roll: 1.1, gain: 0.85 }],
    planet: null
  },
  drift: {
    seed: 37, density: 0.55,
    palette: [[150, 80, 180], [90, 60, 170], [190, 110, 130]],
    nebulae: [
      { img: 'crab', dir: [0.25, 0.1, 0.96], span: 0.58, roll: -0.6, gain: 1.0 },
      { img: 'southernring', dir: [-0.85, -0.3, -0.42], span: 0.34, roll: 0.2, gain: 0.7 }
    ],
    planet: { dir: [0.8, 0.25, -0.5], size: 0.26, color: [130, 78, 90], lit: [-0.5, -0.35] }
  },
  anchorage: {
    seed: 51, density: 0.45,
    palette: [[70, 130, 150], [50, 90, 130], [120, 110, 90]],
    nebulae: [{ img: 'tarantula', dir: [-0.55, 0.35, 0.75], span: 0.6, roll: 2.2, gain: 0.8 }],
    planet: { dir: [0.15, -0.35, -0.9], size: 0.55, color: [96, 110, 96], lit: [0.4, 0.5] }
  },
  shoal: {
    seed: 73, density: 0.5,
    palette: [[70, 190, 150], [40, 120, 110], [120, 70, 160]],
    nebulae: [{ img: 'carina', dir: [0.15, -0.25, 0.95], span: 0.72, roll: 0, gain: 1.0 }],
    planet: { dir: [-0.35, 0.4, -0.85], size: 0.34, color: [58, 120, 100], lit: [0.55, -0.3] }
  },
  home: {
    // the idle title camera starts looking along roughly (0,-0.28,-0.96), so
    // the plate is centred there — the menu opens on the nebula, not on empty sky
    seed: 91, density: 0.4,
    palette: [[80, 120, 200], [50, 90, 160], [140, 120, 190]],
    nebulae: [{ img: 'carina', dir: [0.06, -0.24, -0.97], span: 0.70, roll: 0.1, gain: 0.95 }],
    planet: { dir: [0.75, 0.18, 0.64], size: 0.44, color: [64, 100, 150], lit: [-0.45, -0.4] }
  }
};

const CACHE = new Map();
const CACHE_LIMIT = 3;        // ~2.4MB of VRAM each; a session visits few

/** Resolves once the plates are loaded; regenerates nothing on repeat calls. */
export async function getBackdrop(name) {
  if (!BACKDROPS[name]) name = 'verge';
  if (CACHE.has(name)) {
    const tex = CACHE.get(name);
    CACHE.delete(name); CACHE.set(name, tex);      // touch for LRU
    return tex;
  }
  await preloadNebulae();
  if (!CACHE.has(name)) {
    CACHE.set(name, makeBackdrop(BACKDROPS[name]));
    while (CACHE.size > CACHE_LIMIT) {
      const oldest = CACHE.keys().next().value;
      const tex = CACHE.get(oldest);
      CACHE.delete(oldest);
      if (tex && tex.dispose) tex.dispose();
    }
  }
  return CACHE.get(name);
}
