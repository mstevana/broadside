// ============================================================================
// BROADSIDE — entry point: renderer, campaign state machine, mission runner.
// ============================================================================

import * as THREE from 'three';
import { MISSIONS, SHIP_CLASSES, makeShipRecord } from './data.js';
import { Ship } from './ship.js';
import { World } from './world.js';
import { updateAI } from './ai.js';
import { InputController } from './input.js';
import { HUD } from './hud.js';
import { renderDebrief, renderRefit, commanderMods, closeModal } from './refit.js';
import { makeStarfield } from './meshes.js';

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
    return p && p.target && p.target.alive ? p.target : null;
  },
  onSelectShip: (ship) => mission && mission.select(ship),
  onFocusDevice: (key) => mission && mission.setFocusDevice(key),
  onBehavior: (mode) => mission && mission.setBehavior(mode),
  onStop: () => mission && mission.allStop(),
  onPause: () => mission && mission.togglePause(),
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
  constructor(missionDef, campaign) {
    this.def = missionDef;
    this.campaign = campaign;
    this.world = new World(scene);
    this.selection = [];
    this.paused = false;
    this.over = false;
    this.overTimer = 0;
    this.result = null;
    this.elapsed = 0;
    this.lostShips = [];
    this.deviceWasLost = false;
    this.bossGenFirst = false;
    this.prize = null;
    this.boss = null;

    const mods = commanderMods(campaign);

    // player fleet, line abreast, bows toward +Z
    const n = campaign.fleet.length;
    campaign.fleet.forEach((rec, i) => {
      const ship = new Ship(rec, { commanderMods: mods });
      const x = (i - (n - 1) / 2) * 160;
      this.world.addShip(ship, new THREE.Vector3(x, 0, -1300), new THREE.Vector3(x, 0, 0));
    });

    // waves
    this.waves = missionDef.waves.map(w => ({ ...w, spawned: false }));

    this.world.onMessage = (t) => hud.toast(t);
    this.world.onShipKilled = (ship) => this.onShipKilled(ship);
    this.world.onShipDisabled = (ship) => {
      hud.toast(`${ship.name} DISABLED — objective secured`);
    };
  }

  /** call after the global `mission` reference is assigned (HUD reads it) */
  initUI() {
    hud.show();
    hud.buildShipBar();
    this.select(this.world.playerShips()[0]);
    hud.setPaused(false);
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
      if (spec.flee) ship.fleePoint = new THREE.Vector3(spec.flee[0], spec.flee[1], spec.flee[2]);
      if (spec.boss) this.boss = ship;
    }
    if (w.delay !== 0 || w.afterCleared) hud.toast('NEW CONTACTS ON SENSORS');
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
    input.setFollow(this.selection[0] || null);
    hud.refreshBehavior();
  }

  setTarget(enemy) {
    if (!enemy || enemy.faction === 'human') return;
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
    }
  }

  allStop() {
    for (const s of this.selection) s.moveTarget = null;
    hud.toast('ALL STOP');
  }

  togglePause() {
    this.paused = !this.paused;
    hud.setPaused(this.paused);
  }

  // ---- events ----

  onShipKilled(ship) {
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
    if (this.paused) return;
    this.elapsed += dt;

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
        this.finish(false, 'All ships lost.');
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
      lostShips: this.lostShips
    };
    endMission(res);
  }

  dispose() {
    this.world.dispose();
  }
}

// --------------------------------------------------------- state changes ----

let fleetSnapshot = null;

function currentMissionDef() {
  return MISSIONS[Math.min(campaign.missionIndex, MISSIONS.length - 1)];
}

function gotoMenu() {
  campaign && saveCampaign();
  $('btn-continue').disabled = !loadCampaign();
  showScreen('screen-menu');
}

function gotoRefit() {
  saveCampaign();
  showScreen('screen-refit');
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
  $('btn-launch').onclick = launchMission;
  $('btn-brief-back').onclick = gotoRefit;
}

function launchMission() {
  // Unspent points are lost at launch — the Nexus rule.
  campaign.points = 0;
  fleetSnapshot = JSON.parse(JSON.stringify(campaign.fleet));
  saveCampaign();
  for (const s of SCREENS) $(s).classList.add('hidden');
  mission = new MissionRun(currentMissionDef(), campaign);
  mission.initUI();
}

function endMission(res) {
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
$('btn-howto').addEventListener('click', () => $('howto').classList.toggle('hidden'));
$('btn-continue').disabled = !campaign;

// ------------------------------------------------------------------ loop ----

const clock = new THREE.Clock();
let hudAccum = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (mission) {
    mission.update(dt);
    input.updateCamera(dt);
    hudAccum += dt;
    if (hudAccum > 0.1) { hudAccum = 0; hud.update(); if (mission && !mission.paused) mission.updateObjectiveText(); }
  } else {
    // idle menu camera drift
    const t = performance.now() * 0.00004;
    camera.position.set(Math.sin(t) * 900, 260, Math.cos(t) * 900);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
}
frame();

showScreen('screen-menu');

// debug / test handle
window.BS = {
  get mission() { return mission; },
  get campaign() { return campaign; }
};
