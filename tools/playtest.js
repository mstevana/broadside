// ============================================================================
// BROADSIDE — campaign playtest harness.
//
//   node tools/playtest.js [runs] [--mission N] [--verbose]
//
// Plays the campaign end to end in headless Chromium with the bot commander
// driving, buying a sensible refit between missions, and reports per-mission
// win rates, durations and losses. This is how campaign balance is validated:
// a human never has to grind five missions to find out mission 5 is
// impossible.
// ============================================================================

import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';

const RUNS = parseInt(process.argv[2], 10) || 3;
const ONLY = process.argv.includes('--mission')
  ? parseInt(process.argv[process.argv.indexOf('--mission') + 1], 10) : null;
const VERBOSE = process.argv.includes('--verbose');
const DIFF = process.argv.includes('--difficulty')
  ? process.argv[process.argv.indexOf('--difficulty') + 1] : null;
const BOT_SRC = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');

const MAX_SIM_SECONDS = 900;      // a mission that runs this long is a stalemate
const STEP = 0.05;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 900, height: 430 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.addScriptTag({ content: BOT_SRC.replace('export function', 'window.makeBot = function'), type: 'module' })
  .catch(async () => {
    // module scope hides the global; fall back to a plain classic script
    await page.addScriptTag({ content: BOT_SRC.replace('export function makeBot', 'window.makeBot = function') });
  });

/** play one mission to its conclusion; returns a result record */
async function playMission(page) {
  return page.evaluate(async ({ MAX, STEP }) => {
    const BS = window.BS;
    const bot = window.makeBot(BS);
    const m = BS.mission;
    const def = m.def;
    let t = 0, botTick = 0;
    while (BS.mission && t < MAX) {
      if (botTick <= 0) { bot.update(BS.mission); botTick = 0.4; }
      BS.mission.update(STEP);
      botTick -= STEP; t += STEP;
      if (Math.round(t * 20) % 2000 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const stalled = !!BS.mission;
    if (stalled) return { name: def.name, stalled: true, seconds: t };
    return {
      name: def.name,
      stalled: false,
      seconds: +t.toFixed(0),
      won: document.getElementById('db-title').textContent.includes('COMPLETE'),
      body: document.getElementById('db-body').innerText.replace(/\n+/g, ' | '),
      fleet: BS.campaign.fleet.map(f => `${f.name} ${f.hull}/${window.__hullMax[f.cls]}`),
      // how badly the fleet was mauled — a campaign nobody can lose is as
      // broken as one nobody can win
      attrition: (() => {
        let cur = 0, max = 0;
        for (const f of BS.campaign.fleet) { cur += f.hull; max += window.__hullMax[f.cls]; }
        return max ? +(100 - (cur / max) * 100).toFixed(0) : 0;
      })(),
      points: BS.campaign.points
    };
  }, { MAX: MAX_SIM_SECONDS, STEP });
}

/** spend the refit budget like a player would: repair, then fill empty mounts */
async function autoRefit(page) {
  return page.evaluate(async () => {
    const d = await import('./src/data.js');
    const c = window.BS.campaign;
    const spend = (n) => { if (c.points < n) return false; c.points -= n; return true; };

    // 1. repair hulls
    for (const rec of c.fleet) {
      const def = d.SHIP_CLASSES[rec.cls];
      const missing = def.hull - rec.hull;
      if (missing <= 0) continue;
      const cost = Math.min(Math.ceil(missing / d.REPAIR.hullPerPoint), c.points);
      if (cost > 0) { c.points -= cost; rec.hull = Math.min(def.hull, rec.hull + cost * d.REPAIR.hullPerPoint); }
    }
    // 2. rebuild destroyed devices and mounts
    for (const rec of c.fleet) {
      const def = d.SHIP_CLASSES[rec.cls];
      for (const k of ['engines', 'shieldGen', 'sensors']) {
        if (rec.devices[k] <= 0 && spend(d.REPAIR.deviceRestoreCost)) rec.devices[k] = def.devices[k];
      }
      for (const slot of rec.slots) {
        if (slot.hp <= 0 && spend(d.REPAIR.deviceRestoreCost)) slot.hp = d.MOUNT_HP;
      }
    }
    // 3. buy a new hull if affordable and unlocked, else fill empty mounts
    for (const clsId of d.SHOP_SHIPS) {
      const def = d.SHIP_CLASSES[clsId];
      if (c.fleet.length >= d.MAX_FLEET) break;
      if (c.missionIndex <= def.unlockAfter) continue;
      if (c.fleet.some(f => f.cls === clsId)) continue;
      if (spend(def.cost)) {
        const used = new Set(c.fleet.map(r => r.name));
        const name = d.HUMAN_SHIP_NAMES.find(n => !used.has(n)) || def.name;
        c.fleet.push(d.makeShipRecord(clsId, name));
      }
    }
    // 4. spend leftovers on missing weapons (prefer a balanced kill chain)
    const WANT = ['energy_shell', 'railgun', 'pulse_laser', 'pd_laser', 'precision_laser'];
    for (const rec of c.fleet) {
      const def = d.SHIP_CLASSES[rec.cls];
      rec.slots.forEach((slot, i) => {
        if (slot.w) return;
        const list = def.slots[i].hangar ? d.SHOP_CRAFT : WANT;
        for (const wid of list) {
          const w = d.WEAPONS[wid];
          if (c.points >= w.cost) { c.points -= w.cost; slot.w = wid; break; }
        }
      });
    }
    // 5. commander attributes
    const { attrPointsAvailable } = await import('./src/refit.js');
    let avail = attrPointsAvailable(c);
    const order = ['combat', 'engineering', 'science'];
    let i = 0;
    while (avail-- > 0) { c.attrs[order[i % 3]]++; i++; }
    return { points: c.points, fleet: c.fleet.length };
  });
}

// ---------------------------------------------------------------- main ----

const stats = new Map();
for (let run = 0; run < RUNS; run++) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.addScriptTag({ content: BOT_SRC.replace('export function makeBot', 'window.makeBot = function') });
  await page.evaluate(async () => {
    const d = await import('./src/data.js');
    window.__hullMax = Object.fromEntries(
      Object.entries(d.SHIP_CLASSES).map(([k, v]) => [k, v.hull]));
  });
  if (DIFF) await page.evaluate((d) => window.BS.setSetting('difficulty', d), DIFF);
  await page.click('#btn-newgame');

  const total = await page.evaluate(async () => (await import('./src/data.js')).MISSIONS.length);
  for (let mi = 0; mi < total; mi++) {
    if (ONLY != null && mi + 1 !== ONLY) {
      // fast-forward: skip ahead without playing
      await page.evaluate((i) => { window.BS.campaign.missionIndex = i; }, mi + 1);
      continue;
    }
    await autoRefit(page);
    await page.click('#btn-refit-launch');
    await page.click('#btn-launch');
    await page.waitForTimeout(120);
    const r = await playMission(page);
    const key = `M${mi + 1} ${r.name}`;
    if (!stats.has(key)) stats.set(key, { won: 0, lost: 0, stalled: 0, secs: [], attr: [], notes: [] });
    const st = stats.get(key);
    if (r.stalled) { st.stalled++; st.notes.push('STALEMATE'); }
    else {
      st.secs.push(r.seconds);
      if (r.won) st.won++; else { st.lost++; st.notes.push(r.body.slice(0, 70)); }
      if (r.attrition != null) st.attr.push(r.attrition);
      if (VERBOSE) console.log(`  run${run} ${key}: ${r.won ? 'WIN' : 'LOSS'} ${r.seconds}s | ${r.fleet.join(', ')}`);
    }
    await page.waitForTimeout(120);
    if (r.stalled) break;                 // campaign can't continue
    await page.click('#btn-db-next');      // debrief -> refit (or retry)
    await page.waitForTimeout(120);
    if (!r.won) break;                     // a loss ends this campaign run
  }
}

console.log('\n=== CAMPAIGN PLAYTEST ===  runs=' + RUNS + (DIFF ? '  difficulty=' + DIFF : ''));
for (const [k, v] of stats) {
  const n = v.won + v.lost + v.stalled;
  const avg = v.secs.length ? Math.round(v.secs.reduce((a, b) => a + b, 0) / v.secs.length) : '-';
  const min = v.secs.length ? Math.min(...v.secs) : '-';
  const max = v.secs.length ? Math.max(...v.secs) : '-';
  const at = v.attr.length ? Math.round(v.attr.reduce((a, b) => a + b, 0) / v.attr.length) : '-';
  console.log(`${k.padEnd(26)} win ${v.won}/${n}  stalls ${v.stalled}  time ${avg}s (${min}-${max})  fleet damage ${at}%`);
  for (const note of v.notes.slice(0, 2)) console.log(`      ${note}`);
}
console.log(errors.length ? '\nERRORS:\n' + errors.slice(0, 8).join('\n') : '\nno page errors');
await browser.close();
