// ============================================================================
// BROADSIDE — HUD reachability check.
//
//   node tools/hittest.js            (needs the dev server on :8080)
//
// A control that is on screen and unclipped can still be untappable: the top
// and bottom bars span the full width, so on a short landscape phone their
// empty stretches sat over the ends of the side lists and swallowed the taps.
// Nothing about the layout looks wrong in a screenshot — the button is right
// there — so this walks every HUD control, finds the centre of the part
// actually visible inside whatever scroll box clips it, and asks the document
// what is on top at that point. Anything but the control itself is a bug.
// ============================================================================

import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--use-gl=swiftshader'] });
const VIEWS = [['iphone-se-land', 667, 375], ['iphone-15-land', 852, 393], ['15-pro-max-land', 932, 430], ['ipad', 1180, 820]];
let bad = 0;
for (const [name, w, h] of VIEWS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.tap('#btn-newgame');
  await page.evaluate(async () => {
    const d = await import('./src/data.js');
    const c = window.BS.campaign;
    c.missionIndex = d.MISSIONS.findIndex(m => m.id === 'm4d');
    for (const [cls, n] of [['dd_sabre','UES Sabre'], ['dd_rapier','UES Rapier'], ['cr_warhammer','UES Warhammer']])
      c.fleet.push(d.makeShipRecord(cls, n));
  });
  await page.tap('#btn-refit-launch'); await page.waitForTimeout(700); await page.tap('#btn-launch');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    window.BS.mission.tutorial = null; document.getElementById('tutorial').classList.add('hidden');
    const m = window.BS.mission;
    const foe = m.world.ships.find(s => !s.isPlayer && s.alive);
    if (foe) { foe.detected = true; foe.blip = false; m.setTarget(foe); }
    for (let i = 0; i < 60; i++) m.update(0.05);
  });
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => {
    const out = [];
    const sel = '#hud button, #hud input[type=range]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest('.hidden')) continue;
      // test the centre of the part that is actually VISIBLE inside whatever
      // scroll box clips it — a card scrolled out of the list is not a bug
      let box = { l: r.left, t: r.top, rr: r.right, b: r.bottom };
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowX === 'auto') {
          const pr = p.getBoundingClientRect();
          box = { l: Math.max(box.l, pr.left), t: Math.max(box.t, pr.top),
                  rr: Math.min(box.rr, pr.right), b: Math.min(box.b, pr.bottom) };
        }
      }
      if (box.rr - box.l < 4 || box.b - box.t < 4) continue;      // scrolled out of view
      const x = (box.l + box.rr) / 2, y = (box.t + box.b) / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { out.push({ el: el.id || el.className, why: 'offscreen' }); continue; }
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit) || hit.closest && hit.closest(sel) === el)) {
        out.push({ el: el.id || el.className, blockedBy: hit ? (hit.id || hit.className || hit.tagName) : null });
      }
    }
    return out;
  });
  console.log(name.padEnd(17), res.length ? 'UNREACHABLE: ' + JSON.stringify(res) : 'all controls reachable');
  bad += res.length;
  await page.close();
}
console.log(bad ? `\n${bad} control(s) blocked` : '\nevery HUD control is the topmost element at its own centre');
await browser.close();
process.exit(bad ? 1 : 0);
