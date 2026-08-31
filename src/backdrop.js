// ============================================================================
// BROADSIDE — deep-space backdrop.
//
// Homeworld's signature was that space was never empty: every battle happened
// in front of something enormous. This paints a per-mission backdrop from a
// seeded RNG — layered nebula clouds, dust lanes, a distant star field and an
// optional planet with a terminator and atmospheric rim — onto a cube of
// canvases, so it costs one draw call and no assets.
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

const FACE_DIRS = [
  // +X, -X, +Y, -Y, +Z, -Z  — right-handed, matching CubeTexture order
  [ 1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

/** direction vector for a pixel on a cube face */
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

/**
 * @param {object} opts
 *   seed      — deterministic per mission
 *   palette   — [[r,g,b], ...] nebula tints
 *   planet    — { dir:[x,y,z], size, color, ring } | null
 *   density   — 0..1 nebula coverage
 */
export function makeBackdrop({
  seed = 1, size = 256, density = 0.75,
  palette = [[90, 130, 210], [150, 90, 190], [40, 90, 150]],
  planet = null, starDensity = 1
} = {}) {
  const rand = rng(seed);

  // --- nebula blobs live in 3D so they wrap seamlessly across faces ---
  const blobs = [];
  const nBlobs = Math.round(26 * density);
  for (let i = 0; i < nBlobs; i++) {
    const v = new THREE.Vector3().randomDirection();
    // clump blobs into two or three cloud banks rather than sprinkling them
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

  // --- dust lanes: dark bands that cut across the clouds ---
  const lanes = [];
  for (let i = 0; i < 4; i++) {
    lanes.push({ dir: new THREE.Vector3().randomDirection(), width: 0.05 + rand() * 0.10 });
  }

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

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [dx, dy, dz] = faceDir(f, (x + 0.5) / size, (y + 0.5) / size);
        dir.set(dx, dy, dz).normalize();

        // deep space base, slightly warmer toward one pole for interest
        let r = 5, g = 8, b = 14;

        for (const bl of blobs) {
          const dot = dir.dot(bl.dir);
          if (dot <= 0) continue;
          const ang = 1 - dot;                       // 0 at centre
          const fall = Math.exp(-(ang * ang) / (2 * bl.spread * bl.spread));
          if (fall < 0.004) continue;
          const k = fall * bl.gain;
          r += bl.col[0] * k; g += bl.col[1] * k; b += bl.col[2] * k;
        }
        // dust lanes subtract
        for (const ln of lanes) {
          const perp = Math.abs(dir.dot(ln.dir));
          const band = Math.exp(-(perp * perp) / (2 * ln.width * ln.width));
          const k = 1 - band * 0.55;
          r *= k; g *= k; b *= k;
        }

        // Blob accumulation is unbounded, which blew the brighter regions out
        // to white. Compress it into a ceiling well under the bloom threshold
        // so the backdrop stays a backdrop and never glows.
        const i = (y * size + x) * 4;
        d[i]     = CEIL * (1 - Math.exp(-r / KNEE));
        d[i + 1] = CEIL * (1 - Math.exp(-g / KNEE));
        d[i + 2] = CEIL * (1 - Math.exp(-b / KNEE));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // --- stars, drawn on top so they stay crisp ---
    const nStars = Math.round(size * size * 0.0022 * starDensity);
    for (let i = 0; i < nStars; i++) {
      const x = rand() * size, y = rand() * size;
      const m = rand();
      const rad = m > 0.985 ? 1.5 : (m > 0.9 ? 0.9 : 0.55);
      const a = 0.25 + rand() * 0.75;
      const tint = rand();
      ctx.fillStyle = tint > 0.85 ? `rgba(190,215,255,${a})`
        : tint < 0.12 ? `rgba(255,225,195,${a})` : `rgba(240,246,255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (rad > 1.2) {                                    // faint bloom halo
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 5);
        gr.addColorStop(0, `rgba(200,225,255,${a * 0.35})`);
        gr.addColorStop(1, 'rgba(200,225,255,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      }
    }
    faces.push(cv);
  }

  // --- planet: drawn into whichever face it faces, with a terminator ---
  if (planet) {
    const pd = new THREE.Vector3(...planet.dir).normalize();
    for (let f = 0; f < 6; f++) {
      const ax = new THREE.Vector3(...FACE_DIRS[f]);
      if (pd.dot(ax) < 0.55) continue;                    // not on this face
      const ctx = faces[f].getContext('2d');
      // project the planet direction onto the face
      let u = 0.5, v = 0.5;
      const t = 1 / pd.dot(ax);
      const p = pd.clone().multiplyScalar(t);
      // invert faceDir for this face
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

      // lit disc with a soft terminator sweeping from the light direction
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

      // banding / continents
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

      // atmospheric rim
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

// Per-region backdrops. Each mission names one; skirmish picks at random.
export const BACKDROPS = {
  verge: {
    seed: 11, density: 0.6,
    palette: [[70, 110, 190], [40, 80, 150], [110, 90, 180]],
    planet: { dir: [-0.5, -0.15, 0.85], size: 0.40, color: [70, 96, 140], lit: [0.5, -0.4] }
  },
  relay: {
    seed: 23, density: 0.5,
    palette: [[60, 100, 160], [30, 70, 120], [90, 70, 140]],
    planet: null
  },
  drift: {
    seed: 37, density: 0.85,
    palette: [[150, 80, 180], [90, 60, 170], [190, 110, 130]],
    planet: { dir: [0.8, 0.25, -0.5], size: 0.26, color: [130, 78, 90], lit: [-0.5, -0.35] }
  },
  anchorage: {
    seed: 51, density: 0.65,
    palette: [[70, 130, 150], [50, 90, 130], [120, 110, 90]],
    planet: { dir: [0.15, -0.35, -0.9], size: 0.55, color: [96, 110, 96], lit: [0.4, 0.5] }
  },
  shoal: {
    seed: 73, density: 0.9,
    palette: [[70, 190, 150], [40, 120, 110], [120, 70, 160]],
    planet: { dir: [-0.35, 0.4, -0.85], size: 0.34, color: [58, 120, 100], lit: [0.55, -0.3] }
  },
  home: {
    seed: 91, density: 0.55,
    palette: [[80, 120, 200], [50, 90, 160], [140, 120, 190]],
    planet: { dir: [0.55, -0.3, 0.75], size: 0.5, color: [64, 100, 150], lit: [-0.45, -0.4] }
  }
};

const CACHE = new Map();

export function getBackdrop(name) {
  if (!BACKDROPS[name]) name = 'verge';
  if (!CACHE.has(name)) CACHE.set(name, makeBackdrop(BACKDROPS[name]));
  return CACHE.get(name);
}
