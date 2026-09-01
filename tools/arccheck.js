// ============================================================================
// BROADSIDE — firing-arc visualisation check.
//
//   node tools/arccheck.js            (needs the dev server on :8080)
//
// A mount's firing arc is a CONE about its bore — Ship.inArc tests the full
// solid angle — but the tactical display draws a horizontal slice. Those two
// only agree when the bore lies in the plane, so the wedge is drawn at the
// cone's intersection with it. This sweeps the horizontal circle around every
// mount of every ship class, asks the SIM whether each bearing is covered, and
// compares that against the span the display would draw. Any disagreement is a
// wedge that lies to the player about where their guns bear.
// ============================================================================

import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 700, height: 440 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.click('#btn-newgame');
await page.click('#btn-refit-launch');
await page.waitForTimeout(800);
await page.click('#btn-launch');
await page.waitForTimeout(800);

const rows = await page.evaluate(async () => {
  const THREE = await import('three');
  const d = await import('./src/data.js');
  const { Ship } = await import('./src/ship.js');
  const out = [];
  for (const id of Object.keys(d.SHIP_CLASSES)) {
    const def = d.SHIP_CLASSES[id];
    if (!def.slots || !def.defaultLoadout) continue;
    const s = new Ship(d.makeShipRecord(id, id), {});
    s.pos.set(0, 0, 0);
    s.quat.identity();
    for (const w of s.weapons) {
      if (!w.def || !w.def.range) continue;
      let covered = 0;
      for (let deg = -180; deg < 180; deg++) {
        const a = deg * Math.PI / 180;
        if (s.inArc(w, new THREE.Vector3(Math.sin(a) * 100, 0, Math.cos(a) * 100))) covered++;
      }
      // mirror of arcHalfWidth() in src/world.js
      const dir = w.slot.dir;
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const cosE = Math.hypot(dir[0], dir[2]) / len;
      const cosH = Math.cos(w.def.arc / 2 * Math.PI / 180);
      let half;
      if (cosE < 1e-6) half = cosH <= 0 ? Math.PI : null;
      else { const c = cosH / cosE; half = c >= 1 ? null : (c <= -1 ? Math.PI : Math.acos(c)); }
      const drawn = half === null ? 0 : Math.min(360, half * 2 * 180 / Math.PI);
      out.push({
        ship: id, gun: w.def.short, arc: w.def.arc,
        az: +(Math.atan2(dir[0], dir[2]) * 180 / Math.PI).toFixed(1),
        actual: covered, drawn: +drawn.toFixed(0),
        ok: Math.abs(drawn - covered) <= 2
      });
    }
  }
  return out;
});

console.log('=== FIRING ARC CHECK ===  drawn wedge vs what Ship.inArc actually allows\n');
console.log('ship            gun        arc    az    actual  drawn');
for (const r of rows) {
  console.log(
    `${r.ship.padEnd(15)} ${r.gun.padEnd(9)} ${String(r.arc).padStart(4)} ${String(r.az).padStart(7)}  `
    + `${String(r.actual).padStart(5)}°  ${String(r.drawn).padStart(4)}°  ${r.ok ? '' : '  <-- MISMATCH'}`);
}
const bad = rows.filter(r => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} mounts drawn correctly`);
if (errors.length) console.log('\npage errors:', errors);
await browser.close();
process.exit(bad.length || errors.length ? 1 : 0);
