// ============================================================================
// BROADSIDE — debrief & spaceport refit screens (DOM), campaign economics.
// Resource points are awarded at debrief and are LOST at launch — spend them.
// ============================================================================

import {
  WEAPONS, SHIP_CLASSES, SHOP_WEAPONS, SHOP_SHIPS, MAX_FLEET,
  ATTRS, REPAIR, MOUNT_HP, levelForXp, makeShipRecord, HUMAN_SHIP_NAMES
} from './data.js';

const $ = (id) => document.getElementById(id);

export function commanderMods(campaign) {
  const a = campaign.attrs;
  return {
    dmgMult: 1 + 0.06 * a.combat,
    sensorMult: 1 + 0.10 * a.science,
    deviceAcc: 0.06 * a.science
  };
}

export function attrPointsAvailable(campaign) {
  const total = levelForXp(campaign.xp);
  const spent = campaign.attrs.combat + campaign.attrs.engineering + campaign.attrs.science;
  return total - spent;
}

function roleTag(role) {
  const map = { shield: 'shield', hull: 'hull', device: 'device', pd: 'pd', multi: 'hull' };
  const label = { shield: 'ANTI-SHIELD', hull: 'ANTI-HULL', device: 'ANTI-DEVICE', pd: 'POINT-DEF', multi: 'GENERAL' };
  return `<span class="tag ${map[role]}">${label[role]}</span>`;
}

function weaponStatLine(w) {
  const bits = [];
  if (w.dmg.shield) bits.push(`SHD ${w.dmg.shield}`);
  if (w.dmg.hull) bits.push(`HULL ${w.dmg.hull}`);
  if (w.dmg.device) bits.push(`DEV ${w.dmg.device}`);
  bits.push(`RNG ${w.range}`);
  bits.push(`CYC ${w.charge}s`);
  bits.push(`PWR ${w.energy}`);
  if (w.ammo != null) bits.push(`AMMO ${w.ammo}${w.salvo ? '×' + w.salvo : ''}`);
  return bits.join(' · ');
}

// ================================================================ modal ====

function openModal(html) {
  $('modal-sheet').innerHTML = html;
  $('modal').classList.remove('hidden');
}
export function closeModal() { $('modal').classList.add('hidden'); }

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// ============================================================== debrief ====

/**
 * @param {object} result { won, missionDef, secondaryMet, lostShips[], disabledPrize }
 */
export function renderDebrief(campaign, result, onContinue) {
  const m = result.missionDef;
  $('db-title').textContent = result.won ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('db-title').style.color = result.won ? 'var(--green)' : 'var(--red)';
  $('db-sub').textContent = `${m.name} — ${m.region}`;
  const body = $('db-body');
  let html = '';

  if (result.won) {
    const engBonus = campaign.attrs.engineering * 20;
    const pts = m.basePoints + (result.secondaryMet ? m.secondaryPoints : 0) + engBonus;
    const xp = m.xp + (result.secondaryMet ? m.secondaryXp : 0);
    html += `<div class="result-line"><span>Base award</span><span class="v">+${m.basePoints} pts</span></div>`;
    html += `<div class="result-line ${result.secondaryMet ? '' : 'bad'}"><span>Secondary — ${m.secondaryText}</span>`
      + `<span class="v">${result.secondaryMet ? '+' + m.secondaryPoints + ' pts' : 'NOT MET'}</span></div>`;
    if (engBonus) html += `<div class="result-line"><span>Engineering corps</span><span class="v">+${engBonus} pts</span></div>`;
    html += `<div class="result-line"><span>Experience</span><span class="v">+${xp} XP</span></div>`;
    for (const name of result.lostShips) {
      html += `<div class="result-line bad"><span>SHIP LOST — ${name}</span><span class="v">struck from the registry</span></div>`;
    }
    campaign.points = pts;
    campaign.xp += xp;
  } else {
    html += `<div class="result-line bad"><span>${result.failReason || 'Fleet destroyed.'}</span><span class="v">NO AWARD</span></div>`;
    html += `<p class="dim" style="margin-top:10px">The fleet has been restored to its pre-mission state. Refit and try again.</p>`;
  }

  // ---- after-action gunnery report ----
  if (result.stats) {
    const dealt = Object.entries(result.stats.dealt)
      .map(([id, d]) => ({ id, ...d, total: d.shield + d.hull + d.device }))
      .sort((a, b) => b.total - a.total);
    if (dealt.length) {
      html += `<h3 style="margin-top:14px;color:var(--amber);font-size:11px;letter-spacing:0.14em">GUNNERY REPORT — DAMAGE DEALT</h3>`;
      for (const d of dealt.slice(0, 10)) {
        const w = WEAPONS[d.id];
        html += `<div class="result-line"><span>${w ? w.name : d.id}</span>`
          + `<span class="v">SHD ${Math.round(d.shield)} · HULL ${Math.round(d.hull)} · DEV ${Math.round(d.device)}</span></div>`;
      }
    }
    const taken = Object.entries(result.stats.taken).sort((a, b) => b[1] - a[1]);
    if (taken.length) {
      html += `<h3 style="margin-top:12px;color:var(--amber);font-size:11px;letter-spacing:0.14em">DAMAGE TAKEN</h3>`;
      for (const [name, amt] of taken) {
        html += `<div class="result-line"><span>${name}</span><span class="v">${Math.round(amt)}</span></div>`;
      }
    }
  }
  body.innerHTML = html;
  $('btn-db-next').textContent = result.won ? 'TO SPACEPORT' : 'RETRY';
  $('btn-db-next').onclick = onContinue;
}

// ================================================================ refit ====

export function renderRefit(campaign, cb /* { onLaunch, onMenu, onSave } */) {
  const won = campaign.missionIndex;
  $('refit-sub').textContent = campaign.done
    ? 'CAMPAIGN COMPLETE — FREE PLAY'
    : `NEXT: MISSION ${campaign.missionIndex + 1}`;

  const redraw = () => renderRefit(campaign, cb);
  const spend = (n) => {
    if (campaign.points < n) return false;
    campaign.points -= n;
    cb.onSave();
    return true;
  };

  $('pts-value').textContent = campaign.points;

  // ---- commander attributes ----
  const avail = attrPointsAvailable(campaign);
  const attrsBox = $('refit-attrs');
  let ah = `<h3>COMMANDER — LEVEL ${levelForXp(campaign.xp)} (${campaign.xp} XP)`
    + (avail > 0 ? ` — <span style="color:var(--green)">${avail} POINT${avail > 1 ? 'S' : ''} TO ASSIGN</span>` : '') + `</h3>`;
  for (const key of Object.keys(ATTRS)) {
    ah += `<div class="attr-row"><b>${ATTRS[key].name} ${campaign.attrs[key]}</b>`
      + `<span class="desc">${ATTRS[key].desc}</span>`
      + (avail > 0 ? `<button class="fix-btn" data-attr="${key}">+1</button>` : '') + `</div>`;
  }
  attrsBox.innerHTML = ah;
  attrsBox.querySelectorAll('[data-attr]').forEach(btn => {
    btn.addEventListener('click', () => {
      campaign.attrs[btn.dataset.attr]++;
      cb.onSave();
      redraw();
    });
  });

  // ---- fleet ----
  const fleetBox = $('refit-fleet');
  fleetBox.innerHTML = '';
  campaign.fleet.forEach((rec, shipIdx) => {
    const def = SHIP_CLASSES[rec.cls];
    const box = document.createElement('div');
    box.className = 'panel-box refit-ship';

    const hullMissing = def.hull - rec.hull;
    const hullCost = Math.ceil(hullMissing / REPAIR.hullPerPoint);
    let h = `<div class="hd"><span class="nm">${rec.name}</span><span class="cls">${def.className} — ${def.role}</span></div>`;
    h += `<div class="lbl" style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-dim)"><span>HULL</span><span>${rec.hull}/${def.hull}</span></div>`;
    h += `<div class="bar hull"><i style="transform:scaleX(${rec.hull / def.hull})"></i></div>`;
    h += `<div class="slot-row" style="margin-top:8px">`;
    if (hullMissing > 0) {
      h += `<button class="fix-btn" data-act="hull" ${campaign.points < 1 ? 'disabled' : ''}>REPAIR HULL — ${Math.min(hullCost, campaign.points)}/${hullCost} pts</button>`;
    }
    // destroyed devices
    for (const dk of ['engines', 'shieldGen', 'sensors']) {
      if (rec.devices[dk] <= 0) {
        h += `<button class="fix-btn" data-act="dev" data-dev="${dk}" ${campaign.points < REPAIR.deviceRestoreCost ? 'disabled' : ''}>REBUILD ${dk === 'shieldGen' ? 'SHIELD GEN' : dk.toUpperCase()} — ${REPAIR.deviceRestoreCost} pts</button>`;
      }
    }
    h += `</div><div class="slot-row">`;
    rec.slots.forEach((slot, i) => {
      const w = slot.w ? WEAPONS[slot.w] : null;
      const destroyed = slot.hp <= 0;
      h += `<button class="slot-btn ${w ? '' : 'empty'} ${destroyed ? 'destroyed' : ''}" data-slot="${i}">`
        + `<span class="t">MOUNT ${i + 1}${destroyed ? ' — DESTROYED' : ''}</span>`
        + `${w ? w.short : '— EMPTY —'}</button>`;
    });
    h += `</div>`;
    box.innerHTML = h;

    const hullBtn = box.querySelector('[data-act="hull"]');
    if (hullBtn) hullBtn.addEventListener('click', () => {
      const pay = Math.min(hullCost, campaign.points);
      if (pay <= 0) return;
      campaign.points -= pay;
      rec.hull = Math.min(def.hull, rec.hull + pay * REPAIR.hullPerPoint);
      cb.onSave(); redraw();
    });
    box.querySelectorAll('[data-act="dev"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!spend(REPAIR.deviceRestoreCost)) return;
        rec.devices[btn.dataset.dev] = SHIP_CLASSES[rec.cls].devices[btn.dataset.dev];
        redraw();
      });
    });
    box.querySelectorAll('[data-slot]').forEach(btn => {
      btn.addEventListener('click', () => openSlotModal(campaign, rec, parseInt(btn.dataset.slot, 10), cb, redraw));
    });
    fleetBox.appendChild(box);
  });

  // ---- shipyard ----
  const yard = $('refit-shipyard');
  yard.innerHTML = '';
  for (const clsId of SHOP_SHIPS) {
    const def = SHIP_CLASSES[clsId];
    const locked = won <= def.unlockAfter;
    const full = campaign.fleet.length >= MAX_FLEET;
    const btn = document.createElement('button');
    btn.className = 'pick-item';
    btn.disabled = locked || full || campaign.points < def.cost;
    btn.innerHTML = `<div class="hd2"><span>${def.name} — ${def.className}</span><span class="cost">${def.cost} pts</span></div>`
      + `<div class="d">${def.role}. ${def.desc}${locked ? ` <b style="color:var(--red)">LOCKED — complete mission ${def.unlockAfter + 1}</b>` : ''}`
      + `${full ? ' <b style="color:var(--amber)">FLEET FULL</b>' : ''}</div>`;
    btn.addEventListener('click', () => {
      if (!spend(def.cost)) return;
      const used = new Set(campaign.fleet.map(r => r.name));
      const name = HUMAN_SHIP_NAMES.find(n => !used.has(n)) || `UES ${def.name}`;
      campaign.fleet.push(makeShipRecord(clsId, name));
      redraw();
    });
    yard.appendChild(btn);
  }

  $('btn-refit-launch').onclick = cb.onLaunch;
  $('btn-refit-menu').onclick = cb.onMenu;
}

// ------------------------------------------------------------ slot modal ----

function openSlotModal(campaign, rec, slotIdx, cb, redraw) {
  const slot = rec.slots[slotIdx];
  const def = SHIP_CLASSES[rec.cls];
  let h = `<h3>${rec.name} — MOUNT ${slotIdx + 1}</h3>`;

  if (slot.hp <= 0) {
    h += `<p class="d" style="color:var(--red);font-size:10px;margin-bottom:8px">Mount destroyed in action.</p>`;
    h += `<button class="pick-item" data-fixmount ${campaign.points < REPAIR.deviceRestoreCost ? 'disabled' : ''}>`
      + `<div class="hd2"><span>REBUILD MOUNT</span><span class="cost">${REPAIR.deviceRestoreCost} pts</span></div></button>`;
  } else {
    if (slot.w) {
      const w = WEAPONS[slot.w];
      h += `<button class="pick-item" data-unmount><div class="hd2"><span>UNMOUNT ${w.name}</span><span class="cost">to stores</span></div>`
        + `<div class="d">${roleTag(w.role)}${weaponStatLine(w)}</div></button>`;
    }
    // stores
    const inv = campaign.inventory;
    if (inv.length) {
      h += `<h3 style="margin-top:10px">FROM STORES</h3>`;
      inv.forEach((wid, i) => {
        const w = WEAPONS[wid];
        h += `<button class="pick-item" data-inv="${i}"><div class="hd2"><span>${w.name}</span><span class="cost">fit — free</span></div>`
          + `<div class="d">${roleTag(w.role)}${weaponStatLine(w)}</div></button>`;
      });
    }
    h += `<h3 style="margin-top:10px">PROCUREMENT</h3>`;
    for (const wid of SHOP_WEAPONS) {
      const w = WEAPONS[wid];
      h += `<button class="pick-item" data-buy="${wid}" ${campaign.points < w.cost ? 'disabled' : ''}>`
        + `<div class="hd2"><span>${w.name}</span><span class="cost">${w.cost} pts</span></div>`
        + `<div class="d">${roleTag(w.role)}${weaponStatLine(w)}<br>${w.desc}</div></button>`;
    }
  }
  openModal(h);

  const sheet = $('modal-sheet');
  const fix = sheet.querySelector('[data-fixmount]');
  if (fix) fix.addEventListener('click', () => {
    if (campaign.points < REPAIR.deviceRestoreCost) return;
    campaign.points -= REPAIR.deviceRestoreCost;
    slot.hp = MOUNT_HP;
    cb.onSave(); closeModal(); redraw();
  });
  const un = sheet.querySelector('[data-unmount]');
  if (un) un.addEventListener('click', () => {
    campaign.inventory.push(slot.w);
    slot.w = null;
    cb.onSave(); closeModal(); redraw();
  });
  sheet.querySelectorAll('[data-inv]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.inv, 10);
      if (slot.w) campaign.inventory.push(slot.w);
      slot.w = campaign.inventory.splice(i, 1)[0];
      cb.onSave(); closeModal(); redraw();
    });
  });
  sheet.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wid = btn.dataset.buy;
      const w = WEAPONS[wid];
      if (campaign.points < w.cost) return;
      campaign.points -= w.cost;
      if (slot.w) campaign.inventory.push(slot.w);
      slot.w = wid;
      cb.onSave(); closeModal(); redraw();
    });
  });
}
