// ============================================================================
// BROADSIDE — entry point: renderer, campaign state machine, mission runner.
// ============================================================================

import * as THREE from 'three';
import { MISSIONS, SHIP_CLASSES, makeShipRecord, SKIRMISH_FLEET, SKIRMISH_MISSION, skirmishWave } from './data.js';
import { Ship } from './ship.js';
import { World } from './world.js';
import { updateAI } from './ai.js';
import { InputController } from './input.js';
import { HUD } from './hud.js';
import { renderDebrief, renderRefit, renderSkirmishDebrief, commanderMods, closeModal } from './refit.js';
import { makeStarfield } from './meshes.js';
import { getBackdrop } from './backdrop.js';
import { BloomComposer } from './bloom.js';
import { audio } from './audio.js';
import { music } from './music.js';
import { Tutorial } from './tutorial.js';
import { saveMission, loadMissionSave, clearMissionSave, hasMissionSave, restoreShip } from './persist.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'broadside_save_v1';

// ----------------------------------------------------------------- three ----

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
$('canvas-host').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080f);
scene.add(makeStarfield());

// bloom: engine flares, weapon fire and Vessari bioluminescence are already
// the only genuinely bright pixels, so a simple bright-pass reads correctly
// threshold sits above lit hull plating (~0.6 luminance) so only genuinely
// emissive things — drive flares, beams, windows, veins — actually glow
const bloom = new BloomComposer(renderer, { strength: 0.7, threshold: 0.88 });
bloom.setSize(window.innerWidth, window.innerHeight);

/** swap the deep-space backdrop (per mission region) */
function setBackdrop(name) {
  scene.background = name ? getBackdrop(name) : new THREE.Color(0x05080f);
}
setBackdrop('verge');
scene.add(new THREE.AmbientLight(0x3a4e66, 2.0));
scene.add(new THREE.HemisphereLight(0x8fb8d8, 0x1a2233, 1.4));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(0.6, 1, 0.3);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x3e6b9e, 0.9);
rim.position.set(-0.5, -0.6, -0.4);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 5, 40000);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (bloom.enabled) bloom.setSize(window.innerWidth, window.innerHeight);
});

// -------------------------------------------------------------- campaign ----

function newCampaign() {
  return {
    missionIndex: 0,
    fleet: [makeShipRecord('hc_falchion', 'UES Falchion')],
    inventory: [],
    points: 50,
    xp: 0,
    attrs: { combat: 0, engineering: 0, science: 0 },
    done: false
  };
}

function saveCampaign() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(campaign)); } catch (e) { /* private mode */ }
}
function loadCampaign() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

let campaign = loadCampaign();

// ---------------------------------------------------------------- screens ----

const SCREENS = ['screen-menu', 'screen-brief', 'screen-debrief', 'screen-refit'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  closeModal();
  hud.hide();
}

// ------------------------------------------------------------------- HUD ----

let mission = null;   // active MissionRun

const hud = new HUD({
  getWorld: () => mission && mission.world,
  getSelection: () => mission ? mission.selection : [],
  getPrimary: () => mission && mission.selection[0] || null,
  getTarget: () => {
    const p = mission && mission.selection[0];
    return p && p.target && p.target.alive && p.target.detected ? p.target : null;
  },
  onSelectShip: (ship) => mission && mission.select(ship),
  onFocusDevice: (key) => mission && mission.setFocusDevice(key),
  onBindWeapon: (w) => mission && mission.bindWeapon(w),
  onWing: (sq, action) => mission && mission.wingCommand(sq, action),
  onBehavior: (mode) => mission && mission.setBehavior(mode),
  onStop: () => mission && mission.allStop(),
  onPause: () => mission && mission.togglePause(),
  onSpeed: () => mission ? mission.cycleSpeed() : '1×',
  onSkipTutorial: () => { if (mission) { mission.tutorial = null; hud.tutorial(null); } },
  onToggleFollow: () => {
    input.follow = !input.follow;
    return input.follow;
  }
});

const input = new InputController(camera, renderer.domElement, {
  getWorld: () => mission && mission.world,
  getSelection: () => mission ? mission.selection : [],
  onSelectShip: (ship) => mission && mission.select(ship),
  onTargetShip: (ship) => mission && mission.setTarget(ship),
  onMoveCommand: (point) => mission && mission.moveCommand(point)
});

// ------------------------------------------------------------ MissionRun ----

class MissionRun {
  constructor(missionDef, campaign, opts = {}) {
    this.def = missionDef;
    this.campaign = campaign;
    this.world = new World(scene);
    this.selection = [];
    this.paused = false;
    this.timeScale = 1;
    this.over = false;
    this.overTimer = 0;
    this.result = null;
    this.elapsed = 0;
    this.lostShips = [];
    this.stats = { dealt: {}, taken: {} };
    this.salvage = 0;
    this.skirmish = !!missionDef.skirmish;
    this.waveNum = 0;
    this.kills = 0;
    this.tutorial = null;
    this.deviceWasLost = false;
    this.bossGenFirst = false;
    this.prize = null;
    this.boss = null;

    const mods = commanderMods(campaign);
    this.mods = mods;

    // player fleet, line abreast, bows toward +Z (skipped when resuming a save,
    // which restores every hull from its serialized state instead)
    if (!opts.restore) {
      const n = campaign.fleet.length;
      campaign.fleet.forEach((rec, i) => {
        const ship = new Ship(rec, { commanderMods: mods });
        const x = (i - (n - 1) / 2) * 160;
        this.world.addShip(ship, new THREE.Vector3(x, 0, -900), new THREE.Vector3(x, 0, 0));
      });
    }

    // waves
    this.waves = missionDef.waves.map(w => ({ ...w, spawned: false }));

    this.world.onMessage = (t) => hud.toast(t);
    this.world.onDamage = (shooter, target, kind, amount, wdef) => {
      if (amount <= 0) return;
      if (shooter.isPlayer) {
        const e = this.stats.dealt[wdef.id] ||
          (this.stats.dealt[wdef.id] = { shield: 0, hull: 0, device: 0 });
        e[kind] += amount;
      }
      if (target.isPlayer) {
        this.stats.taken[target.name] = (this.stats.taken[target.name] || 0) + amount;
      }
      // the Shoal remembers which hull is hurting it most
      if (shooter.isPlayer && !target.isPlayer) {
        const t = this.world._threat || (this.world._threat = new Map());
        t.set(shooter.id, (t.get(shooter.id) || 0) + amount);
      }
    };
    this.world.onShipKilled = (ship) => this.onShipKilled(ship);
    this.world.onShipDisabled = (ship) => {
      if (ship.surrendered) {
        const val = ship.def.salvage || 0;
        this.salvage += val;
        hud.toast(`${ship.name} CAPTURED — +${val} salvage`);
      } else {
        hud.toast(`${ship.name} DISABLED — objective secured`);
      }
      this.updateObjectiveText();
    };
  }

  /** rebuild a live battle from a serialized save */
  restoreFrom(save) {
    const r = save.run;
    this.elapsed = r.elapsed;
    this.world.time = r.worldTime;
    this.timeScale = r.timeScale || 1;
    this.waveNum = r.waveNum || 0;
    this.kills = r.kills || 0;
    this.salvage = r.salvage || 0;
    this.lostShips = r.lostShips || [];
    this.stats = r.stats || { dealt: {}, taken: {} };
    this.deviceWasLost = !!r.deviceWasLost;
    this.bossGenFirst = !!r.bossGenFirst;
    this._bossGenAtHalf = r._bossGenAtHalf;
    r.waves.forEach((w, i) => { if (this.waves[i]) this.waves[i].spawned = w.spawned; });

    for (const rec of save.ships) {
      const shipRec = rec.player
        ? (this.campaign.fleet.find(f => f.name === rec.name) || makeShipRecord(rec.cls, rec.name))
        : makeShipRecord(rec.cls, rec.name);
      const ship = new Ship(shipRec, rec.player ? { commanderMods: this.mods } : {});
      ship.name = rec.name;
      this.world.addShip(ship, new THREE.Vector3(...rec.pos));
      restoreShip(ship, rec, THREE);
      if (rec.objectiveDisable) this.prize = ship;
      if (rec.boss) this.boss = ship;
      // wings that were in the air need their meshes back in the scene
      for (const q of ship.squadrons) {
        if (q.launched) {
          for (const c of q.craft) {
            if (!c.alive) continue;
            if (!c.mesh) { q.launch(this.world); break; }
          }
        }
      }
    }
    // re-link cross references now that every hull exists
    const byId = new Map(this.world.ships.map(s => [s._savedId, s]));
    save.ships.forEach((rec) => {
      const ship = byId.get(rec.id);
      if (!ship) return;
      if (rec.targetId != null) ship.target = byId.get(rec.targetId) || null;
      ship.weapons.forEach((w, wi) => {
        const bid = rec.boundIds ? rec.boundIds[wi] : null;
        if (bid != null) w.boundTarget = byId.get(bid) || null;
      });
    });
    const sel = (r.selectionIds || []).map(id => byId.get(id)).filter(Boolean);
    this.selection = sel.length ? sel : this.world.playerShips().slice(0, 1);
  }

  /** call after the global `mission` reference is assigned (HUD reads it) */
  initUI() {
    hud.show();
    hud.buildShipBar();
    this.select(this.world.playerShips()[0]);
    hud.setPaused(false);
    hud.setSpeed('1×');
    this.updateObjectiveText();
  }

  // ---- spawning ----

  spawnWave(w) {
    w.spawned = true;
    for (const spec of w.ships) {
      const rec = makeShipRecord(spec.cls);
      const ship = new Ship(rec, {});
      const pos = new THREE.Vector3(spec.at[0], spec.at[1], spec.at[2]);
      this.world.addShip(ship, pos, new THREE.Vector3(0, 0, -1300));
      ship.behavior = 'aggressive';
      if (spec.objective === 'disable') {
        ship.objectiveDisable = true;
        this.prize = ship;
      }
      if (spec.flee) {
        ship.fleePoint = new THREE.Vector3(spec.flee[0], spec.flee[1], spec.flee[2]);
        ship.fleeAfter = spec.fleeAfter != null ? spec.fleeAfter : 45;
      }
      if (spec.boss) this.boss = ship;
    }
    if (w.delay !== 0 || w.afterCleared) {
      hud.toast('NEW CONTACTS ON SENSORS');
      audio.play('alert');
    }
  }

  // ---- selection & orders ----

  select(ship) {
    if (ship === null) {
      this.selection = this.world.playerShips();
      hud.toast('ALL SHIPS SELECTED');
    } else if (ship.isPlayer && ship.alive) {
      this.selection = [ship];
    }
    this.world.setSelection(this.selection);
    this.world.setRangeViz(this.selection[0] || null);
    input.setFollow(this.selection[0] || null);
    hud.refreshBehavior();
  }

  /** launch or recall a hangar wing */
  wingCommand(sq, action) {
    if (action === 'recall') {
      hud.toast(`${sq.def.short} WING RECALLED`);
      return;
    }
    if (!sq.operable) { hud.toast(`${sq.def.short} WING UNAVAILABLE`); return; }
    if (sq.launch(this.world)) hud.toast(`${sq.def.short} WING AWAY`);
  }

  /** long-press on a weapon button: bind/rebind/release it on the current target */
  bindWeapon(w) {
    const prim = this.selection[0];
    const t = prim && prim.target && prim.target.alive && prim.target.detected
      ? prim.target : null;
    if (t && w.boundTarget !== t) {
      w.boundTarget = t;
      hud.toast(`${w.def.short} BOUND → ${t.name}`);
    } else if (w.boundTarget) {
      w.boundTarget = null;
      hud.toast(`${w.def.short}: bound target released`);
    } else {
      hud.toast('LONG-PRESS binds a weapon — designate a target first');
    }
  }

  setTarget(enemy) {
    if (!enemy || enemy.faction === 'human') return;
    if (!enemy.detected) {
      hud.toast('CONTACT UNCONFIRMED — extend sensor range');
      return;
    }
    for (const s of this.selection) { s.target = enemy; }
    this.world.setTargetMarker(enemy);
    hud.toast(`TARGET: ${enemy.name}`);
  }

  setFocusDevice(key) {
    for (const s of this.selection) s.focusDevice = key;
  }

  setBehavior(mode) {
    for (const s of this.selection) s.behavior = mode;
  }

  moveCommand(point) {
    const sel = this.selection.filter(s => s.alive);
    if (!sel.length) return;
    // preserve formation: offset each ship from the selection centroid
    const centroid = new THREE.Vector3();
    for (const s of sel) centroid.add(s.pos);
    centroid.divideScalar(sel.length);
    for (const s of sel) {
      const offset = s.pos.clone().sub(centroid);
      if (offset.length() > 400) offset.setLength(400);
      s.moveTarget = point.clone().add(sel.length > 1 ? offset : new THREE.Vector3());
      s._pursuitOrder = false;    // explicit orders override aggressive pursuit
    }
    this._tutMoved = true;
  }

  allStop() {
    for (const s of this.selection) s.moveTarget = null;
    hud.toast('ALL STOP');
  }

  togglePause() {
    this._tutSpeed = true;
    this.paused = !this.paused;
    if (this.paused) autosave();
    hud.setPaused(this.paused);
    if (this.paused) hud.toast('PAUSED — orders can still be issued', 2000);
  }

  cycleSpeed() {
    this._tutSpeed = true;
    this.timeScale = this.timeScale >= 4 ? 1 : this.timeScale * 2;
    return `${this.timeScale}×`;
  }

  // ---- events ----

  onShipKilled(ship) {
    if (!ship.isPlayer) { this.kills++; this.salvage += Math.round((ship.def.salvage || 0) * 0.4); }
    if (ship.isPlayer) {
      this.lostShips.push(ship.name);
      hud.toast(`${ship.name} DESTROYED`);
      this.selection = this.selection.filter(s => s !== ship);
      if (!this.selection.length) {
        const rest = this.world.playerShips();
        if (rest.length) this.select(rest[0]);
      }
      this.world.setSelection(this.selection);
    } else if (ship === this.boss && !this.bossGenChecked) {
      this.bossGenChecked = true;
      this.bossGenFirst = ship.devices.shieldGen.hp <= 0 && ship.hull >= -1 && this._bossGenAtHalf !== false;
    }
    this.updateObjectiveText();
  }

  // ---- objective bookkeeping ----

  updateObjectiveText() {
    const left = this.world.ships.filter(s => !s.isPlayer && s.alive && !s.disabled).length;
    if (this.skirmish) {
      hud.setObjective(`SKIRMISH — wave ${this.waveNum} · ${left} hostiles · ${this.kills} kills · score ${this.salvage}`);
      return;
    }
    const pending = this.waves.some(w => !w.spawned);
    if (this.def.special === 'disable_escape' && this.prize && this.prize.alive && !this.prize.disabled) {
      hud.setObjective(`${this.def.name} — disable the Lamprey's ENGINES before it escapes (${left} hostiles)`);
    } else {
      hud.setObjective(`${this.def.name} — destroy all hostiles (${left}${pending ? '+' : ''} remaining)`);
    }
  }

  checkSecondary() {
    const players = this.world.ships.filter(s => s.isPlayer);
    switch (this.def.secondary) {
      case 'flagHull75': {
        const flag = players[0];
        return flag && flag.alive && flag.hull >= flag.hullMax * 0.75;
      }
      case 'noDeviceLost':
        return this.lostShips.length === 0 && !this.deviceWasLost;
      case 'prizeIntact':
        return !!(this.prize && this.prize.alive && this.prize.disabled &&
          this.prize.hull >= this.prize.hullMax * 0.5);
      case 'noShipLost':
        return this.lostShips.length === 0;
      case 'bossGenFirst':
        return this.bossGenFirst;
      default: return false;
    }
  }

  // ---- per-frame ----

  update(dt) {
    if (this.paused) {
      // tactical pause: sim frozen, but markers track orders issued meanwhile
      this.world.updateMarkers(0);
      return;
    }
    dt *= this.timeScale;
    this.elapsed += dt;

    // skirmish: endless escalating waves, with a partial repair between them
    if (this.skirmish) {
      const hostiles = this.world.ships.some(s => !s.isPlayer && s.alive && !s.disabled);
      if (!hostiles) {
        this._waveGap = (this._waveGap || 0) - dt;
        if (this.waveNum === 0 || this._waveGap <= 0) {
          this.waveNum++;
          if (this.waveNum > 1) {
            for (const p of this.world.playerShips()) {
              p.hull = Math.min(p.hullMax, p.hull + p.hullMax * 0.12);
              for (const d of Object.values(p.devices)) d.hp = Math.max(d.hp, d.max * 0.5);
              for (const w of p.weapons) { if (w.ammo !== Infinity) w.ammo = w.def.ammo; }
            }
            hud.toast(`WAVE ${this.waveNum} INBOUND — hulls patched, magazines restocked`, 3200);
          }
          this.spawnWave({ ships: skirmishWave(this.waveNum), delay: 0 });
          this._waveGap = 0;
        }
      } else {
        this._waveGap = 8;
      }
    }

    // wave triggers
    const anyAlive = this.world.ships.some(s => !s.isPlayer && s.alive && !s.disabled);
    for (const w of this.waves) {
      if (w.spawned) continue;
      if (w.afterCleared) {
        const before = this.waves.slice(0, this.waves.indexOf(w));
        if (before.every(x => x.spawned) && !anyAlive) this.spawnWave(w);
      } else if (this.elapsed >= (w.delay || 0)) {
        this.spawnWave(w);
      }
    }

    updateAI(this.world, dt);
    this.world.update(dt, camera.position);

    // track state for secondaries
    if (!this.deviceWasLost) {
      for (const s of this.world.ships) {
        if (!s.isPlayer) continue;
        if (['engines', 'shieldGen', 'sensors'].some(k => s.devices[k].hp <= 0) ||
            s.weapons.some(w => w.hp <= 0)) { this.deviceWasLost = true; break; }
      }
    }
    if (this.boss && this.boss.alive && this._bossGenAtHalf === undefined) {
      if (this.boss.devices.shieldGen.hp <= 0) {
        this._bossGenAtHalf = this.boss.hull >= this.boss.hullMax * 0.5;
        this.bossGenFirst = this._bossGenAtHalf;
      } else if (this.boss.hull < this.boss.hullMax * 0.5) {
        this._bossGenAtHalf = false;
      }
    }

    // ---- end conditions ----
    if (!this.over) {
      const playersLeft = this.world.playerShips().length;
      const allSpawned = this.waves.every(w => w.spawned);
      const hostilesLeft = this.world.ships.some(s => !s.isPlayer && s.alive && !s.disabled);

      if (playersLeft === 0) {
        this.finish(false, this.skirmish
          ? `Fleet destroyed on wave ${this.waveNum}.` : 'All ships lost.');
      } else if (this.skirmish) {
        // skirmish runs until the fleet dies
      } else if (this.def.special === 'disable_escape' && this.prize && this.prize.alive &&
                 !this.prize.disabled && this.prize.pos.length() > this.def.escapeRadius) {
        this.finish(false, 'The Lamprey escaped into the Drift with the datacore.');
      } else if (allSpawned && !hostilesLeft) {
        this.finish(true);
      }
    } else {
      this.overTimer -= dt;
      if (this.overTimer <= 0) this.conclude();
    }
  }

  finish(won, failReason) {
    if (this.over) return;
    this.over = true;
    this.overTimer = won ? 2.2 : 2.6;
    this.result = { won, failReason };
    hud.toast(won ? 'AREA SECURE' : (failReason || 'MISSION FAILED'), 4000);
  }

  conclude() {
    const res = {
      won: this.result.won,
      failReason: this.result.failReason,
      missionDef: this.def,
      secondaryMet: this.result.won && this.checkSecondary(),
      lostShips: this.lostShips,
      stats: this.stats,
      salvage: this.salvage,
      skirmish: this.skirmish,
      waveNum: this.waveNum,
      kills: this.kills,
      score: this.salvage + this.kills * 10 + Math.max(0, this.waveNum - 1) * 25
    };
    endMission(res);
  }

  dispose() {
    this.world.dispose();
  }
}

// --------------------------------------------------------- state changes ----

let fleetSnapshot = null;
let skirmishRun = null;

function currentMissionDef() {
  return MISSIONS[Math.min(campaign.missionIndex, MISSIONS.length - 1)];
}

function gotoMenu() {
  setBackdrop('home');
  campaign && saveCampaign();
  $('btn-continue').disabled = !loadCampaign();
  refreshResumeButton();
  showScreen('screen-menu');
  music.setTrack('adrift');
}

function refreshResumeButton() {
  const save = loadMissionSave();
  const btn = $('btn-resume');
  btn.classList.toggle('hidden', !save);
  if (save) {
    const def = save.skirmish ? { name: 'SKIRMISH' } : MISSIONS.find(m => m.id === save.missionId);
    btn.textContent = `RESUME — ${def ? def.name : 'BATTLE'}`;
  }
}

function gotoRefit() {
  saveCampaign();
  showScreen('screen-refit');
  music.setTrack('anchorage');
  renderRefit(campaign, {
    onLaunch: gotoBriefing,
    onMenu: gotoMenu,
    onSave: saveCampaign
  });
}

function gotoBriefing() {
  const m = currentMissionDef();
  $('brief-title').textContent = `MISSION ${Math.min(campaign.missionIndex + 1, MISSIONS.length)} — ${m.name}`;
  $('brief-sub').textContent = m.region.toUpperCase();
  $('brief-body').innerHTML =
    m.briefing.split('\n\n').map(p => `<p>${p}</p>`).join('') +
    `<h3 style="margin-top:10px">SECONDARY OBJECTIVE</h3><p class="dim">${m.secondaryText}</p>`;
  $('brief-fleet').innerHTML = campaign.fleet.map(r => {
    const def = SHIP_CLASSES[r.cls];
    const weapons = r.slots.filter(s => s.w).map(s => s.w).length;
    return `<p><b>${r.name}</b> — ${def.className}, ${weapons} weapons, hull ${r.hull}/${def.hull}</p>`;
  }).join('');
  showScreen('screen-brief');
  // painting a backdrop costs ~200ms, so build it while the player reads the
  // briefing rather than hitching the first frame of the mission
  requestAnimationFrame(() => getBackdrop(m.backdrop || 'verge'));
  music.setTrack('verge');
  $('btn-launch').onclick = launchMission;
  $('btn-brief-back').onclick = gotoRefit;
}

function launchMission() {
  // Unspent points are lost at launch — the Nexus rule.
  campaign.points = 0;
  fleetSnapshot = JSON.parse(JSON.stringify(campaign.fleet));
  saveCampaign();
  for (const s of SCREENS) $(s).classList.add('hidden');
  clearMissionSave();
  mission = new MissionRun(currentMissionDef(), campaign);
  mission.initUI();
  if (campaign.missionIndex === 0 && !campaign.tutorialSeen) {
    campaign.tutorialSeen = true;
    saveCampaign();
    mission.tutorial = new Tutorial(mission, hud);
  }
  setBackdrop(currentMissionDef().backdrop || 'verge');
  music.setTrack(currentMissionDef().music || 'signal');
  audio.startAmbience();
}

/** rebuild an interrupted battle from its save */
function resumeMission() {
  const save = loadMissionSave();
  if (!save) { gotoMenu(); return; }
  const def = save.skirmish
    ? SKIRMISH_MISSION
    : MISSIONS.find(m => m.id === save.missionId);
  if (!def) { clearMissionSave(); gotoMenu(); return; }

  campaign = save.campaign;
  if (save.skirmish) skirmishRun = save.campaign;
  fleetSnapshot = save.fleetSnapshot;

  for (const s of SCREENS) $(s).classList.add('hidden');
  setBackdrop(def.backdrop || (save.skirmish ? 'drift' : 'verge'));
  mission = new MissionRun(def, campaign, { restore: true });
  mission.restoreFrom(save);
  mission.initUI();
  hud.setSpeed(`${mission.timeScale}×`);
  music.setTrack(def.music || 'signal');
  audio.startAmbience();
  hud.toast('BATTLE RESUMED', 2600);
}

// ------------------------------------------------------------- skirmish ----

const SKIRMISH_KEY = 'broadside_skirmish_best';

function skirmishBest() {
  try { return JSON.parse(localStorage.getItem(SKIRMISH_KEY)) || { wave: 0, score: 0 }; }
  catch (e) { return { wave: 0, score: 0 }; }
}

function startSkirmish() {
  clearMissionSave();
  skirmishRun = {
    missionIndex: 0,
    fleet: SKIRMISH_FLEET.map(([cls, name]) => makeShipRecord(cls, name)),
    inventory: [], points: 0, xp: 0,
    attrs: { combat: 0, engineering: 0, science: 0 },
    done: false, isSkirmish: true
  };
  for (const s of SCREENS) $(s).classList.add('hidden');
  mission = new MissionRun(SKIRMISH_MISSION, skirmishRun);
  mission.initUI();
  setBackdrop(['verge', 'drift', 'shoal', 'anchorage'][(Math.random() * 4) | 0]);
  // no briefing, no orders phase: skirmish starts weapons-free
  for (const p of mission.world.playerShips()) p.behavior = 'aggressive';
  hud.refreshBehavior();
  music.setTrack('broadside');
  audio.startAmbience();
  hud.toast('SKIRMISH — hold as long as you can', 3400);
}

function endMission(res) {
  clearMissionSave();
  if (res.skirmish) {
    const best = skirmishBest();
    const isBest = res.score > best.score;
    if (isBest) {
      try { localStorage.setItem(SKIRMISH_KEY, JSON.stringify({ wave: res.waveNum, score: res.score })); }
      catch (e) { /* private mode */ }
    }
    mission.dispose();
    mission = null;
    skirmishRun = null;
    audio.stopAmbience();
    music.setTrack('dirge');
    showScreen('screen-debrief');
    renderSkirmishDebrief(res, isBest ? { wave: res.waveNum, score: res.score } : best, isBest, gotoMenu);
    return;
  }
  // fold surviving ship state back into records / restore snapshot on failure
  if (res.won) {
    const survivors = mission.world.ships.filter(s => s.isPlayer && s.alive);
    campaign.fleet = survivors.map(s => s.syncRecord());
    if (campaign.missionIndex < MISSIONS.length) campaign.missionIndex++;
    if (campaign.missionIndex >= MISSIONS.length) campaign.done = true;
  } else {
    campaign.fleet = fleetSnapshot;
  }
  mission.dispose();
  mission = null;
  audio.stopAmbience();
  music.setTrack(res.won ? 'homecoming' : 'dirge');
  saveCampaign();
  showScreen('screen-debrief');
  renderDebrief(campaign, res, () => {
    saveCampaign();
    gotoRefit();
  });
}

// ------------------------------------------------------------ menu wiring ----

$('btn-newgame').addEventListener('click', () => {
  campaign = newCampaign();
  saveCampaign();
  gotoRefit();
});
$('btn-continue').addEventListener('click', () => {
  campaign = loadCampaign() || newCampaign();
  gotoRefit();
});
$('btn-resume').addEventListener('click', resumeMission);
$('btn-skirmish').addEventListener('click', startSkirmish);
$('btn-howto').addEventListener('click', () => $('howto').classList.toggle('hidden'));
$('btn-continue').disabled = !campaign;
refreshResumeButton();

// ------------------------------------------------------------------ audio ----

// browsers only allow audio after a user gesture — arm it on every pointerdown
document.addEventListener('pointerdown', () => audio.ensure(), { capture: true });
// soft UI tick for every button press
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('button')) audio.play('ui');
}, { capture: true });

function syncSoundButtons() {
  $('btn-sound').classList.toggle('active', !audio.muted);
  $('btn-sound').textContent = audio.muted ? '♪̸' : '♪';
  $('btn-sound-menu').textContent = `SOUND: ${audio.muted ? 'OFF' : 'ON'}`;
}
function toggleSound() {
  audio.ensure();
  audio.setMuted(!audio.muted);
  syncSoundButtons();
}
for (const [bus, id] of [['music', 'vol-music'], ['sfx', 'vol-sfx']]) {
  const el = $(id), out = $(id + '-o');
  el.value = Math.round(audio.vol[bus] * 100);
  out.textContent = el.value;
  el.addEventListener('input', () => {
    out.textContent = el.value;
    audio.ensure();
    audio.setVolume(bus, el.value / 100);
  });
}

$('btn-sound').addEventListener('click', toggleSound);
$('btn-sound-menu').addEventListener('click', toggleSound);
syncSoundButtons();

// -------------------------------------------------------------- autosave ----
//
// A battle runs for minutes; on a phone that is long enough to be interrupted.
// Snapshot on every pause, whenever the tab is hidden or the page goes away,
// and on a slow heartbeat while fighting.

function autosave() {
  if (!mission || mission.over) return;
  saveMission(mission, campaign, { fleetSnapshot });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
window.addEventListener('pagehide', autosave);
window.addEventListener('beforeunload', autosave);

// ------------------------------------------------------------------ loop ----

const clock = new THREE.Clock();
let hudAccum = 0;
let autosaveAccum = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (mission) {
    mission.update(dt);
    input.updateCamera(dt);
    hudAccum += dt;
    if (hudAccum > 0.1) {
      hudAccum = 0;
      hud.update();
      if (mission && !mission.paused) mission.updateObjectiveText();
      if (mission && mission.tutorial) mission.tutorial.update(performance.now());
      autosaveAccum += 0.1 * 10;
      if (autosaveAccum > 20) { autosaveAccum = 0; autosave(); }
    }
  } else {
    // idle menu camera drift
    const t = performance.now() * 0.00004;
    camera.position.set(Math.sin(t) * 900, 260, Math.cos(t) * 900);
    camera.lookAt(0, 0, 0);
  }
  bloom.render(scene, camera);
  if (audio.ready) audio.setListener(camera);
}
frame();

showScreen('screen-menu');
music.setTrack('adrift');   // queued until the first user gesture unlocks audio

// installable / offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* file:// or blocked */ });
  });
}

// debug / test handle
window.BS = {
  get mission() { return mission; },
  get campaign() { return campaign; },
  audio, music, bloom, setBackdrop, renderer,
  autosave, resumeMission, hasMissionSave, clearMissionSave, loadMissionSave
};
