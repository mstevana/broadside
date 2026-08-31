// ============================================================================
// BROADSIDE — procedural texture generation (canvas → THREE textures)
//
// Every map is drawn at load time from a seeded RNG, so the fleet looks
// hand-finished but ships nothing. Each set produces an albedo map, a normal
// map derived from a height pass, and (for hard-surface hulls) a roughness
// map — so plating, seams, rivets and weathering catch the light instead of
// being painted on flat.
//
// Albedo maps are drawn near-white and TINT the material colour, which keeps
// the faction palette in data/meshes and the detail here.
//
// UVs are baked triplanar in meshes.js at a fixed world-units-per-tile, so a
// corvette and a battleship share the same plate size — the thing that makes
// a fleet read as one navy.
// ============================================================================

import * as THREE from 'three';

// deterministic RNG so the fleet looks identical every session
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** downscale a canvas (used for low-frequency maps) */
function downscale(cv, size) {
  if (cv.width <= size) return cv;
  const out = canvas(size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv, 0, 0, size, size);
  return out;
}

function texture(cv, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  if (srgb && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sobel a height canvas into a tangent-space normal map. */
function heightToNormal(heightCv, strength = 2.2) {
  const S = heightCv.width;
  const src = heightCv.getContext('2d').getImageData(0, 0, S, S).data;
  const out = canvas(S);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 3×3 Sobel
      const tl = h(x - 1, y - 1), t = h(x, y - 1), tr = h(x + 1, y - 1);
      const l = h(x - 1, y), r = h(x + 1, y);
      const bl = h(x - 1, y + 1), b = h(x, y + 1), br = h(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const g = (v) => `rgb(${(v * 255) | 0},${(v * 255) | 0},${(v * 255) | 0})`;

// ========================================================= HULL PLATING ====
//
// Recursive subdivision produces irregular panels; each gets its own tone,
// a recessed seam, rivet lines, and weathering streaks running with gravity-
// free grime patterns (vents, scorch, thruster wash).

function plating({
  size = 512, seed = 7, base = 0.90, panelVar = 0.085,
  minPanel = 44, rivets = true, wear = 1, hatches = true
} = {}) {
  const rand = rng(seed);
  const col = canvas(size), hgt = canvas(size), rgh = canvas(size);
  const c = col.getContext('2d'), hh = hgt.getContext('2d'), rr = rgh.getContext('2d');

  c.fillStyle = g(base); c.fillRect(0, 0, size, size);
  hh.fillStyle = g(0.55); hh.fillRect(0, 0, size, size);
  rr.fillStyle = g(0.62); rr.fillRect(0, 0, size, size);

  const panels = [];
  const DEPTH = 6;
  (function split(x, y, w, h, depth) {
    const small = w < minPanel * 2 || h < minPanel * 2;
    // only allow an early stop once the plate is already subdivided a few
    // times — stopping at the root would leave the whole sheet as one panel
    const mayStop = depth <= DEPTH - 3;
    if (depth <= 0 || small || (mayStop && rand() < 0.22)) {
      panels.push([x, y, w, h]);
      return;
    }
    if (w >= h) {
      const cut = Math.round(w * (0.34 + rand() * 0.32));
      split(x, y, cut, h, depth - 1);
      split(x + cut, y, w - cut, h, depth - 1);
    } else {
      const cut = Math.round(h * (0.34 + rand() * 0.32));
      split(x, y, w, cut, depth - 1);
      split(x, y + cut, w, h - cut, depth - 1);
    }
  })(0, 0, size, size, DEPTH);

  for (const [x, y, w, h] of panels) {
    const tone = base + (rand() - 0.5) * 2 * panelVar;
    c.fillStyle = g(tone); c.fillRect(x, y, w, h);
    // panel is slightly proud, its border recessed → a real seam in the normal
    hh.fillStyle = g(0.58 + (rand() - 0.5) * 0.06);
    hh.fillRect(x + 1, y + 1, w - 2, h - 2);
    hh.strokeStyle = g(0.30); hh.lineWidth = 2;
    hh.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // recessed seam, then a worn highlight on the lip just inside it
    c.strokeStyle = `rgba(0,0,0,${0.42 + rand() * 0.18})`; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);
    c.strokeStyle = `rgba(255,255,255,0.18)`; c.lineWidth = 1;
    c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    // varied panel finish
    rr.fillStyle = g(0.5 + rand() * 0.34);
    rr.fillRect(x, y, w, h);

    // vent grille: a run of louvres cut into the plate
    if (w > minPanel && h > minPanel * 0.7 && rand() < 0.22) {
      const n = 3 + ((rand() * 4) | 0);
      const gw = w * 0.52, gh = h * 0.44;
      const gx = x + (w - gw) * 0.5, gy = y + (h - gh) * 0.5;
      for (let i = 0; i < n; i++) {
        const ly = gy + (i + 0.5) * (gh / n);
        c.strokeStyle = 'rgba(0,0,0,0.42)'; c.lineWidth = Math.max(1.5, gh / n * 0.42);
        c.beginPath(); c.moveTo(gx, ly); c.lineTo(gx + gw, ly); c.stroke();
        hh.strokeStyle = g(0.22); hh.lineWidth = Math.max(1.5, gh / n * 0.42);
        hh.beginPath(); hh.moveTo(gx, ly); hh.lineTo(gx + gw, ly); hh.stroke();
      }
    }
    // hazard band along a plate edge
    if (rand() < 0.10 && w > minPanel && h > 16) {
      const bh = Math.min(9, h * 0.22);
      c.save();
      c.beginPath(); c.rect(x + 2, y + 2, w - 4, bh); c.clip();
      for (let i = -1; i < w / 9 + 1; i++) {
        c.fillStyle = i % 2 ? 'rgba(255,181,69,0.55)' : 'rgba(30,36,46,0.55)';
        c.beginPath();
        const bx = x + i * 9;
        c.moveTo(bx, y + 2); c.lineTo(bx + 9, y + 2);
        c.lineTo(bx + 9 - bh, y + 2 + bh); c.lineTo(bx - bh, y + 2 + bh);
        c.closePath(); c.fill();
      }
      c.restore();
    }
    // occasional inset hatch / access plate
    if (hatches && w > minPanel * 1.4 && h > minPanel * 1.4 && rand() < 0.42) {
      const hw = Math.round(w * (0.24 + rand() * 0.24));
      const hgh = Math.round(h * (0.24 + rand() * 0.24));
      const hx = x + Math.round((w - hw) * rand());
      const hy = y + Math.round((h - hgh) * rand());
      c.fillStyle = g(tone - 0.08); c.fillRect(hx, hy, hw, hgh);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hgh - 1);
      hh.fillStyle = g(0.44); hh.fillRect(hx, hy, hw, hgh);
      rr.fillStyle = g(0.78); rr.fillRect(hx, hy, hw, hgh);
    }

    // rivet line along the longer edge
    if (rivets && rand() < 0.6) {
      const n = Math.max(2, Math.floor((w > h ? w : h) / 13));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = w > h ? x + t * w : x + 3.5;
        const py = w > h ? y + 3.5 : y + t * h;
        c.fillStyle = 'rgba(255,255,255,0.26)';
        c.beginPath(); c.arc(px, py, 1.5, 0, 7); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.20)';
        c.beginPath(); c.arc(px + 0.8, py + 0.8, 1.3, 0, 7); c.fill();
        hh.fillStyle = g(0.86);
        hh.beginPath(); hh.arc(px, py, 1.7, 0, 7); hh.fill();
      }
    }
  }

  // weathering: grime washes and scorch, drawn as soft directional smears
  for (let i = 0; i < 26 * wear; i++) {
    const x = rand() * size, y = rand() * size;
    const len = 18 + rand() * 90, wdt = 3 + rand() * 12;
    const vertical = rand() < 0.65;
    const grd = vertical
      ? c.createLinearGradient(x, y, x, y + len)
      : c.createLinearGradient(x, y, x + len, y);
    const a = 0.05 + rand() * 0.12;
    grd.addColorStop(0, `rgba(20,26,34,${a})`);
    grd.addColorStop(1, 'rgba(20,26,34,0)');
    c.fillStyle = grd;
    c.fillRect(x, y, vertical ? wdt : len, vertical ? len : wdt);
    rr.fillStyle = `rgba(255,255,255,${a * 1.6})`;
    rr.fillRect(x, y, vertical ? wdt : len, vertical ? len : wdt);
  }
  // scratches down to bare metal
  for (let i = 0; i < 16 * wear; i++) {
    const x = rand() * size, y = rand() * size;
    const a = rand() * Math.PI * 2, len = 8 + rand() * 40;
    c.strokeStyle = `rgba(255,255,255,${0.06 + rand() * 0.12})`;
    c.lineWidth = rand() < 0.7 ? 1 : 2;
    c.beginPath(); c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
  }

  return {
    map: texture(col, { srgb: true }),
    normalMap: texture(heightToNormal(hgt, 2.0)),
    roughnessMap: texture(downscale(rgh, 256))
  };
}

// ============================================================= CARAPACE ====
//
// Vessari hulls are grown: overlapping chitin scales in offset rows, mottled
// subsurface colouring, and faint capillary veins running between plates.

function carapace({ size = 512, seed = 3, base = 0.92, scale = 44 } = {}) {
  const rand = rng(seed);
  const col = canvas(size), hgt = canvas(size);
  const c = col.getContext('2d'), hh = hgt.getContext('2d');

  c.fillStyle = g(base); c.fillRect(0, 0, size, size);
  hh.fillStyle = g(0.34); hh.fillRect(0, 0, size, size);

  // subsurface mottling
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size, r = 12 + rand() * 60;
    const grd = c.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(40,26,60,0.16)' : 'rgba(255,240,255,0.13)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }

  // scale rows — wrap by drawing an extra column/row past each edge
  const rows = Math.ceil(size / (scale * 0.62)) + 1;
  const cols = Math.ceil(size / scale) + 1;
  for (let ry = -1; ry < rows; ry++) {
    for (let cx = -1; cx < cols; cx++) {
      const ox = (ry % 2 ? scale * 0.5 : 0);
      const x = cx * scale + ox + (rand() - 0.5) * 4;
      const y = ry * scale * 0.62 + (rand() - 0.5) * 3;
      const rw = scale * (0.56 + rand() * 0.1);
      const rh = scale * (0.42 + rand() * 0.1);

      const grd = c.createRadialGradient(x, y - rh * 0.3, rh * 0.15, x, y, rw);
      grd.addColorStop(0, 'rgba(255,250,255,0.20)');
      grd.addColorStop(0.62, 'rgba(255,250,255,0.04)');
      grd.addColorStop(1, 'rgba(24,14,40,0.30)');
      c.fillStyle = grd;
      c.beginPath(); c.ellipse(x, y, rw, rh, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(26,16,42,0.34)'; c.lineWidth = 1.4;
      c.beginPath(); c.ellipse(x, y, rw, rh, 0, 0, 7); c.stroke();

      // scale relief: raised centre falling to a groove at the rim
      const hg = hh.createRadialGradient(x, y - rh * 0.25, 1, x, y, rw);
      hg.addColorStop(0, g(0.82));
      hg.addColorStop(0.7, g(0.5));
      hg.addColorStop(1, g(0.18));
      hh.fillStyle = hg;
      hh.beginPath(); hh.ellipse(x, y, rw, rh, 0, 0, 7); hh.fill();
    }
  }

  // capillary veins
  for (let i = 0; i < 22; i++) {
    let x = rand() * size, y = rand() * size;
    let a = rand() * Math.PI * 2;
    c.strokeStyle = `rgba(120,255,215,${0.05 + rand() * 0.10})`;
    c.lineWidth = 0.8 + rand() * 1.4;
    hh.strokeStyle = g(0.66); hh.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x, y);
    hh.beginPath(); hh.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      a += (rand() - 0.5) * 1.1;
      x += Math.cos(a) * 14; y += Math.sin(a) * 14;
      c.lineTo(x, y); hh.lineTo(x, y);
    }
    c.stroke(); hh.stroke();
  }

  return {
    map: texture(col, { srgb: true }),
    normalMap: texture(heightToNormal(hgt, 1.5))
  };
}

// =============================================================== BRUSHED ====

function brushed({ size = 256, seed = 11, base = 0.96 } = {}) {
  const rand = rng(seed);
  const col = canvas(size), hgt = canvas(size);
  const c = col.getContext('2d'), hh = hgt.getContext('2d');
  c.fillStyle = g(base); c.fillRect(0, 0, size, size);
  hh.fillStyle = g(0.5); hh.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i++) {
    const y = rand() * size, len = 20 + rand() * 120, x = rand() * size;
    const a = 0.015 + rand() * 0.035;
    c.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    c.lineWidth = rand() < 0.8 ? 1 : 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (rand() - 0.5) * 2); c.stroke();
    hh.strokeStyle = rand() < 0.5 ? g(0.58) : g(0.42);
    hh.lineWidth = 1;
    hh.beginPath(); hh.moveTo(x, y); hh.lineTo(x + len, y); hh.stroke();
  }
  return { map: texture(col, { srgb: true }), normalMap: texture(heightToNormal(hgt, 1.0)) };
}

// ================================================================ BONE ====

function bone({ size = 256, seed = 23, base = 0.88 } = {}) {
  const rand = rng(seed);
  const col = canvas(size), hgt = canvas(size);
  const c = col.getContext('2d'), hh = hgt.getContext('2d');
  c.fillStyle = g(base); c.fillRect(0, 0, size, size);
  hh.fillStyle = g(0.5); hh.fillRect(0, 0, size, size);
  // lengthwise striations + calcite blotches
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    c.strokeStyle = `rgba(90,70,110,${0.03 + rand() * 0.07})`;
    c.lineWidth = 0.7 + rand() * 2.6;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (rand() - 0.5) * 20, size); c.stroke();
    hh.strokeStyle = rand() < 0.5 ? g(0.60) : g(0.40); hh.lineWidth = 1.5;
    hh.beginPath(); hh.moveTo(x, 0); hh.lineTo(x + (rand() - 0.5) * 20, size); hh.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 18;
    const grd = c.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.16)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  return { map: texture(col, { srgb: true }), normalMap: texture(heightToNormal(hgt, 1.2)) };
}

// =============================================================== DECALS ====
//
// One transparent atlas per ship class: pennant number, fleet insignia and a
// warning chevron band. Applied to flat decal quads on the flanks, so the
// lettering never smears across the triplanar plating.

export function makeDecal(code, accent = '#35c8ff', sub = '') {
  const W = 512, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);

  // The plate is PAINTED, not a transparent overlay: pale lettering on light
  // hull plating would otherwise disappear. A dark slate ground guarantees
  // contrast wherever the plate is fitted.
  const grd = c.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(38,48,60,0.97)');
  grd.addColorStop(1, 'rgba(22,29,39,0.97)');
  c.fillStyle = grd;
  c.fillRect(0, 0, W, H);
  // rivets around the plate edge
  c.fillStyle = 'rgba(150,168,186,0.55)';
  for (let i = 0; i < 22; i++) {
    const t = (i + 0.5) / 22;
    c.beginPath(); c.arc(t * W, 7, 2.4, 0, 7); c.fill();
    c.beginPath(); c.arc(t * W, H - 7, 2.4, 0, 7); c.fill();
  }

  // hazard chevrons down the left edge
  c.save();
  c.beginPath(); c.rect(0, 0, 74, H); c.clip();
  for (let i = -1; i < 8; i++) {
    c.fillStyle = i % 2 ? 'rgba(255,181,69,0.85)' : 'rgba(24,32,44,0.85)';
    c.beginPath();
    const y = i * 26;
    c.moveTo(0, y); c.lineTo(74, y - 34); c.lineTo(74, y - 8); c.lineTo(0, y + 26);
    c.closePath(); c.fill();
  }
  c.restore();

  // pennant number
  c.font = 'bold 74px "SF Mono", Menlo, monospace';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(238,247,255,0.98)';
  c.fillText(code, 96, H * 0.44);
  const w = c.measureText(code).width;

  // accent underline + class strip
  c.fillStyle = accent;
  c.fillRect(96, H * 0.72, w, 7);
  if (sub) {
    c.font = 'bold 22px "SF Mono", Menlo, monospace';
    c.fillStyle = 'rgba(226,238,248,0.72)';
    c.fillText(sub, 100 + w + 16, H * 0.44);
  }

  // riveted plate border
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 3;
  c.strokeRect(1.5, 1.5, W - 3, H - 3);
  c.strokeStyle = 'rgba(160,180,200,0.30)'; c.lineWidth = 1;
  c.strokeRect(4.5, 4.5, W - 9, H - 9);

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ======================================================== material sets ====
//
// Built once at module load and shared by every ship.

const HULL_A = plating({ seed: 7,  base: 0.92, minPanel: 46, wear: 1.0 });
const HULL_B = plating({ seed: 19, base: 0.89, minPanel: 34, wear: 1.5 });
const HULL_C = plating({ seed: 31, base: 0.93, minPanel: 62, wear: 0.7, hatches: false });
const BRUSH  = brushed({ seed: 11 });
const CARA_A = carapace({ seed: 3,  size: 448, scale: 54 });
const CARA_B = carapace({ seed: 13, size: 448, scale: 36 });
const BONE   = bone({ seed: 23 });

export const TEX = { HULL_A, HULL_B, HULL_C, BRUSH, CARA_A, CARA_B, BONE };

/** world units covered by one texture tile, per texture set */
export const TILE = 15;

export function hullMaterial(color, set, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap || null,
    normalScale: new THREE.Vector2(opts.normal ?? 0.9, opts.normal ?? 0.9),
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.35,
    flatShading: opts.flat ?? true
  });
}
