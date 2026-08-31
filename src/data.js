// ============================================================================
// BROADSIDE — static game data: weapons, ship classes, missions, progression
// ============================================================================
//
// Damage model (the "kill chain"):
//   dmg.shield  — applied while the target's deflector is up. Energy weapons
//                 excel here but do nothing once the shield is down.
//   dmg.hull    — applied when the shield is down. While the shield is up only
//                 `bleed` fraction leaks through (torpedoes bleed a lot).
//   dmg.device  — applied to a targeted subsystem, only when the shield is
//                 down (unless empThroughShields).
//
// Power model:
//   The reactor output is split between WEAPONS / SHIELDS / ENGINES / SENSORS
//   according to the player's sliders. The weapons share refills the reserve
//   cell; every shot spends `energy` from the cell. A charged weapon with an
//   empty cell holds fire — that is the overload penalty.

export const WEAPONS = {
  // ------------------------------------------------------------- LASERS ----
  pulse_laser: {
    id: 'pulse_laser', name: 'Pulse Laser', short: 'PULSE', type: 'laser', role: 'multi',
    dmg: { shield: 6, hull: 9, device: 3 }, bleed: 0.1,
    range: 950, charge: 2.2, energy: 5, ammo: null, arc: 300,
    color: 0xff5a5a, cost: 25,
    desc: 'Light general-purpose laser. Fast cycle, low drain. Never great, never useless.'
  },
  heavy_laser: {
    id: 'heavy_laser', name: 'Heavy Laser', short: 'HVY LAS', type: 'laser', role: 'hull',
    dmg: { shield: 4, hull: 46, device: 8 }, bleed: 0.05,
    range: 1450, charge: 6.5, energy: 24, ammo: null, arc: 140,
    color: 0xff8035, cost: 55,
    desc: 'Long-range hull cutter. Almost fully absorbed by shields — crack them first. Narrow forward arc.'
  },
  precision_laser: {
    id: 'precision_laser', name: 'Scalpel Laser', short: 'SCALPEL', type: 'laser', role: 'device',
    dmg: { shield: 2, hull: 5, device: 26 }, bleed: 0.05,
    range: 1250, charge: 5.0, energy: 16, ammo: null, arc: 240,
    color: 0xb07cff, cost: 45,
    desc: 'Surgical anti-device beam. Disables engines, generators and mounts without wrecking the prize. Needs the shield down.'
  },
  pd_laser: {
    id: 'pd_laser', name: 'PD Laser Grid', short: 'PD GRID', type: 'laser', role: 'pd',
    dmg: { shield: 1, hull: 2, device: 1 }, bleed: 0.2,
    range: 420, charge: 0.7, energy: 2, ammo: null, arc: 360, pd: true, pdKill: 0.8,
    color: 0x4dd47a, cost: 20,
    desc: 'Point-defence laser grid. Automatically burns down incoming missiles and torpedoes. Nearly harmless to ships.'
  },
  // --------------------------------------------------------------- GUNS ----
  railgun: {
    id: 'railgun', name: 'Railgun', short: 'RAIL', type: 'gun', role: 'hull',
    dmg: { shield: 5, hull: 58, device: 6 }, bleed: 0.08,
    range: 1650, charge: 7.5, energy: 20, ammo: null, arc: 100, projSpeed: 900,
    color: 0xffd27c, cost: 60,
    desc: 'Spinal hypervelocity slug. Devastating against bare hull, shrugged off by deflectors. Narrow arc — point the bow.'
  },
  autocannon: {
    id: 'autocannon', name: 'Flak Autocannon', short: 'FLAK', type: 'gun', role: 'pd',
    dmg: { shield: 3, hull: 8, device: 2 }, bleed: 0.3,
    range: 520, charge: 1.1, energy: 3, ammo: null, arc: 360, projSpeed: 700,
    pd: true, pdKill: 0.55,
    color: 0xffb545, cost: 30,
    desc: 'Rapid flak battery. Doubles as point-defence and a close-range hull shredder. Short reach.'
  },
  energy_shell: {
    id: 'energy_shell', name: 'Energy Shell', short: 'E-SHELL', type: 'gun', role: 'shield',
    dmg: { shield: 70, hull: 0, device: 0 }, bleed: 0,
    range: 1800, charge: 8.0, energy: 24, ammo: null, arc: 220, projSpeed: 380, prox: 80,
    color: 0x35c8ff, cost: 65,
    desc: 'Slow-moving charge that collapses deflector fields from extreme range. Zero effect on hull or devices.'
  },
  // ------------------------------------------------------------ MISSILES ----
  torpedo: {
    id: 'torpedo', name: 'Plasma Torpedo', short: 'TORP', type: 'missile', role: 'hull',
    dmg: { shield: 12, hull: 85, device: 10 }, bleed: 0.5,
    range: 2100, charge: 11.0, energy: 6, ammo: 8, arc: 360,
    missile: { speed: 260, turn: 1.4, hp: 8 },
    color: 0xff7c5a, cost: 70,
    desc: 'Heavy seeker warhead; half its blast bleeds through shields. Slow, and point-defence can kill it. 8 rounds per mission.'
  },
  swarm_missiles: {
    id: 'swarm_missiles', name: 'Swarm Rack', short: 'SWARM', type: 'missile', role: 'multi',
    dmg: { shield: 4, hull: 9, device: 4 }, bleed: 0.35,
    range: 1500, charge: 7.0, energy: 5, ammo: 6, salvo: 6, arc: 360,
    missile: { speed: 340, turn: 2.6, hp: 2 },
    color: 0xffa0e0, cost: 45,
    desc: 'Six light seekers per salvo — saturates point-defence through sheer numbers. 6 salvos per mission.'
  },
  disruptor_missile: {
    id: 'disruptor_missile', name: 'Disruptor Missile', short: 'DISRPT', type: 'missile', role: 'device',
    dmg: { shield: 26, hull: 4, device: 22 }, bleed: 1.0, empThroughShields: true,
    range: 1700, charge: 9.0, energy: 6, ammo: 6, arc: 360,
    missile: { speed: 300, turn: 1.8, hp: 4 },
    color: 0xb07cff, cost: 55,
    desc: 'EM warhead that shorts devices straight through an active shield — the only way to reach subsystems early. 6 rounds.'
  },

  // ------------------------------------------- SUPPORT CRAFT (hangar-only) ----
  // Wings launch from hangar mounts, fly inside the target's shield envelope
  // (their strikes ignore deflectors) and can be shot down by point-defence.
  // Lost craft are rebuilt free between missions.
  fighter_wing: {
    id: 'fighter_wing', name: 'Interceptor Wing', short: 'INTCPT', type: 'craft', role: 'pd',
    count: 4, craft: { speed: 210, hp: 14, dmg: { hull: 3, device: 1 }, fireCycle: 1.6 },
    escortRadius: 380, cost: 50, color: 0x8fd8ff,
    desc: '4 interceptors. Escort screen: they burn down incoming missiles and enemy craft near the carrier, and worry hulls in close.'
  },
  bomber_wing: {
    id: 'bomber_wing', name: 'Bomber Wing', short: 'BOMBER', type: 'craft', role: 'device',
    count: 3, craft: { speed: 160, hp: 20, dmg: { hull: 5, device: 6 }, fireCycle: 2.4 },
    cost: 65, color: 0xffc27c,
    desc: '3 heavy bombers. Slip inside the deflector and torch subsystems directly — shields are no protection. Flak eats them.'
  },
  gunboat_wing: {
    id: 'gunboat_wing', name: 'Gunboat Wing', short: 'GUNBOAT', type: 'craft', role: 'device',
    count: 2, craft: { speed: 140, hp: 42, dmg: { hull: 4, device: 9 }, fireCycle: 2.2, targetMounts: true },
    cost: 60, color: 0xc8e87c,
    desc: '2 armoured gunboats. Hunt weapon mounts — point-defence grids first — opening the way for bombers and missiles.'
  },

  // ------------------------------------------------ VESSARI (enemy-only) ----
  v_drone_wing: {
    id: 'v_drone_wing', name: 'Drone Swarm', short: 'DRONES', type: 'craft', role: 'device',
    count: 5, craft: { speed: 190, hp: 8, dmg: { hull: 3, device: 3 }, fireCycle: 1.8 },
    cost: 0, enemyOnly: true, color: 0x59ffc8,
    desc: 'Living attack drones.'
  },
  v_plasma_arc: {
    id: 'v_plasma_arc', name: 'Plasma Arc', short: 'P-ARC', type: 'laser', role: 'shield',
    dmg: { shield: 24, hull: 2, device: 0 }, bleed: 0.05,
    range: 1400, charge: 6.0, energy: 18, ammo: null, arc: 260,
    color: 0x59ffc8, cost: 0, enemyOnly: true,
    desc: 'Vessari shield-stripping arc.'
  },
  v_spine_cannon: {
    id: 'v_spine_cannon', name: 'Spine Cannon', short: 'SPINE', type: 'gun', role: 'hull',
    dmg: { shield: 4, hull: 26, device: 5 }, bleed: 0.1,
    range: 1250, charge: 5.5, energy: 14, ammo: null, arc: 160, projSpeed: 750,
    color: 0xc8ff59, cost: 0, enemyOnly: true,
    desc: 'Crystallised bone slugs.'
  },
  v_needle_beam: {
    id: 'v_needle_beam', name: 'Needle Beam', short: 'NEEDLE', type: 'laser', role: 'device',
    dmg: { shield: 2, hull: 4, device: 18 }, bleed: 0.05,
    range: 1100, charge: 4.5, energy: 12, ammo: null, arc: 280,
    color: 0xff59d8, cost: 0, enemyOnly: true,
    desc: 'Vessari anti-device needle.'
  },
  v_spore_swarm: {
    id: 'v_spore_swarm', name: 'Spore Swarm', short: 'SPORE', type: 'missile', role: 'multi',
    dmg: { shield: 5, hull: 8, device: 3 }, bleed: 0.35,
    range: 1400, charge: 8.0, energy: 5, ammo: 10, salvo: 4, arc: 360,
    missile: { speed: 300, turn: 2.4, hp: 2 },
    color: 0x59ffc8, cost: 0, enemyOnly: true,
    desc: 'Living seeker spores.'
  },
  v_leech_beam: {
    id: 'v_leech_beam', name: 'Leech Beam', short: 'LEECH', type: 'laser', role: 'shield',
    dmg: { shield: 40, hull: 0, device: 0 }, bleed: 0, leech: true,
    range: 900, charge: 7.0, energy: 16, ammo: null, arc: 300,
    color: 0x9dff59, cost: 0, enemyOnly: true,
    desc: 'Drains enemy deflectors to refill its own.'
  }
};

// Weapons purchasable at the spaceport, in shop display order.
export const SHOP_WEAPONS = [
  'pulse_laser', 'pd_laser', 'autocannon', 'precision_laser', 'heavy_laser',
  'railgun', 'energy_shell', 'swarm_missiles', 'disruptor_missile', 'torpedo'
];
// Wings purchasable for hangar mounts.
export const SHOP_CRAFT = ['fighter_wing', 'bomber_wing', 'gunboat_wing'];

// ============================================================================
// Ship classes
// slots: local-space mount points; dir is the arc centre in the ship's frame
// (+Z is the bow). Devices are the non-weapon subsystems.
// ============================================================================

export const SHIP_CLASSES = {
  // ------------------------------------------------------------- HUMANS ----
  hc_falchion: {
    id: 'hc_falchion', name: 'Falchion', className: 'Heavy Corvette', faction: 'human',
    role: 'Flagship (early)',
    desc: 'First ship you command. Spinning habitat ring amidships. Agile, but thin plating.',
    hull: 460, shield: 320, shieldRegen: 8,
    speed: 66, accel: 13, turn: 0.55,
    reactor: 16, reserve: 110, sensors: 1700,
    size: 26,
    slots: [
      { pos: [ 7, 2, 10],  dir: [ 0.5, 0, 0.87] },
      { pos: [-7, 2, 10],  dir: [-0.5, 0, 0.87] },
      { pos: [ 0, 4, -2],  dir: [ 0, 0.3, 1] },
      { pos: [ 0, -3, -8], dir: [ 0, -0.3, -1] }
    ],
    devices: { engines: 120, shieldGen: 100, sensors: 70 },
    traits: {}, cost: 0, unlockAfter: -1,
    defaultLoadout: ['energy_shell', 'pulse_laser', 'railgun', 'pd_laser']
  },
  dd_sabre: {
    id: 'dd_sabre', name: 'Sabre', className: 'Destroyer', faction: 'human',
    role: 'Fast attack / scanner',
    desc: 'Sprint-and-scan destroyer. Long sensor reach makes it the natural torpedo boat.',
    hull: 560, shield: 310, shieldRegen: 7,
    speed: 78, accel: 15, turn: 0.5,
    reactor: 22, reserve: 130, sensors: 2600,
    size: 32,
    slots: [
      { pos: [ 0, 3, 14],  dir: [0, 0, 1] },
      { pos: [ 6, 2, 0],   dir: [ 0.8, 0, 0.6] },
      { pos: [-6, 2, 0],   dir: [-0.8, 0, 0.6] },
      { pos: [ 0, -3, -10], dir: [0, -0.4, -0.9] }
    ],
    devices: { engines: 150, shieldGen: 120, sensors: 110 },
    traits: { sensorMult: 1.15 }, cost: 160, unlockAfter: 0,
    defaultLoadout: ['torpedo', 'pulse_laser', 'pulse_laser', 'pd_laser']
  },
  dd_rapier: {
    id: 'dd_rapier', name: 'Rapier', className: 'Destroyer', faction: 'human',
    role: 'Anti-subsystem',
    desc: 'Fire-control refit tuned for device targeting. Heavy lasers and scalpels hit 35% harder on subsystems.',
    hull: 600, shield: 330, shieldRegen: 7,
    speed: 70, accel: 13, turn: 0.48,
    reactor: 24, reserve: 140, sensors: 2100,
    size: 33,
    slots: [
      { pos: [ 0, 3, 14],  dir: [0, 0, 1] },
      { pos: [ 5, 3, 4],   dir: [ 0.6, 0.2, 0.8] },
      { pos: [-5, 3, 4],   dir: [-0.6, 0.2, 0.8] },
      { pos: [ 0, -3, -10], dir: [0, -0.4, -0.9] }
    ],
    devices: { engines: 150, shieldGen: 130, sensors: 100 },
    traits: { deviceDmgMult: 1.35 }, cost: 200, unlockAfter: 1,
    defaultLoadout: ['precision_laser', 'precision_laser', 'pulse_laser', 'pd_laser']
  },
  cr_bulwark: {
    id: 'cr_bulwark', name: 'Bulwark', className: 'Cruiser', faction: 'human',
    role: 'Anti-shield support',
    desc: 'Oversized capacitor banks: +25% shield damage and faster energy-weapon cycling. The fleet\'s can opener.',
    hull: 920, shield: 520, shieldRegen: 9,
    speed: 52, accel: 9, turn: 0.34,
    reactor: 34, reserve: 190, sensors: 1900,
    size: 44,
    slots: [
      { pos: [ 8, 4, 12],  dir: [ 0.5, 0, 0.87] },
      { pos: [-8, 4, 12],  dir: [-0.5, 0, 0.87] },
      { pos: [ 10, 3, -6], dir: [ 0.9, 0, 0.3] },
      { pos: [-10, 3, -6], dir: [-0.9, 0, 0.3] },
      { pos: [ 0, 6, 0],   dir: [0, 0.5, 0.6] },
      { pos: [ 0, -4, -2], dir: [0, -1, 0], hangar: true }
    ],
    devices: { engines: 190, shieldGen: 170, sensors: 110 },
    traits: { shieldDmgMult: 1.25, energyChargeMult: 0.85 }, cost: 320, unlockAfter: 2,
    defaultLoadout: ['energy_shell', 'energy_shell', 'pulse_laser', 'autocannon', 'pd_laser', 'bomber_wing']
  },
  cr_warhammer: {
    id: 'cr_warhammer', name: 'Warhammer', className: 'Cruiser', faction: 'human',
    role: 'Flagship (late)',
    desc: 'Line cruiser and late-campaign flagship. Six mounts and the biggest human reactor in the sector.',
    hull: 1250, shield: 640, shieldRegen: 10,
    speed: 48, accel: 8, turn: 0.3,
    reactor: 42, reserve: 240, sensors: 2100,
    size: 52,
    slots: [
      { pos: [ 9, 4, 18],  dir: [ 0.4, 0, 0.9] },
      { pos: [-9, 4, 18],  dir: [-0.4, 0, 0.9] },
      { pos: [ 0, 6, 8],   dir: [0, 0.3, 1] },
      { pos: [ 12, 3, -8], dir: [ 0.9, 0, 0.2] },
      { pos: [-12, 3, -8], dir: [-0.9, 0, 0.2] },
      { pos: [ 0, -5, -4], dir: [0, -0.6, 0.4] },
      { pos: [ 0, -5, 8],  dir: [0, -1, 0], hangar: true }
    ],
    devices: { engines: 220, shieldGen: 200, sensors: 130 },
    traits: {}, cost: 480, unlockAfter: 3,
    defaultLoadout: ['railgun', 'railgun', 'energy_shell', 'heavy_laser', 'autocannon', 'pd_laser', 'fighter_wing']
  },

  // ------------------------------------------------------------ VESSARI ----
  // Doctrine: faster ships, stronger & faster-regenerating shields; the trade
  // is thinner hulls and fragile subsystems. Their small hulls carry no PD.
  vx_stinger: {
    id: 'vx_stinger', name: 'Stinger', className: 'Drone Corvette', faction: 'vessari',
    role: 'Skirmisher',
    desc: 'Fast bio-drone. Shield outclasses its mass; the husk under it is paper.',
    hull: 240, shield: 240, shieldRegen: 8,
    speed: 84, accel: 18, turn: 0.7,
    reactor: 15, reserve: 90, sensors: 1500,
    size: 22,
    slots: [
      { pos: [0, 2, 8],  dir: [0, 0, 1] },
      { pos: [0, -2, 0], dir: [0, 0, 1] }
    ],
    devices: { engines: 70, shieldGen: 60, sensors: 40 },
    salvage: 30,
    traits: {}, cost: 0, unlockAfter: 99, enemy: true,
    defaultLoadout: ['v_plasma_arc', 'v_spine_cannon'],
    aiRange: 700
  },
  vx_mantis: {
    id: 'vx_mantis', name: 'Mantis', className: 'Strike Destroyer', faction: 'vessari',
    role: 'Fast attack',
    desc: 'Raider destroyer. Closes fast, strips shields, spits spines.',
    hull: 380, shield: 460, shieldRegen: 9,
    speed: 80, accel: 15, turn: 0.55,
    reactor: 22, reserve: 120, sensors: 1900,
    size: 30,
    slots: [
      { pos: [ 4, 2, 10], dir: [ 0.3, 0, 0.95] },
      { pos: [-4, 2, 10], dir: [-0.3, 0, 0.95] },
      { pos: [0, 3, -4],  dir: [0, 0.3, 1] }
    ],
    devices: { engines: 90, shieldGen: 80, sensors: 60 },
    salvage: 45,
    traits: {}, cost: 0, unlockAfter: 99, enemy: true,
    defaultLoadout: ['v_plasma_arc', 'v_spine_cannon', 'v_spore_swarm'],
    aiRange: 800
  },
  vx_lamprey: {
    id: 'vx_lamprey', name: 'Lamprey', className: 'Leech Destroyer', faction: 'vessari',
    role: 'Shield drain / support',
    desc: 'Latches onto deflectors and drinks them dry, feeding its own shield. Slow for a Vessari hull.',
    hull: 360, shield: 520, shieldRegen: 12,
    speed: 60, accel: 11, turn: 0.5,
    reactor: 24, reserve: 130, sensors: 1800,
    size: 31,
    slots: [
      { pos: [0, 2, 12],  dir: [0, 0, 1] },
      { pos: [ 5, 0, 0],  dir: [ 0.7, 0, 0.7] },
      { pos: [-5, 0, 0],  dir: [-0.7, 0, 0.7] }
    ],
    devices: { engines: 90, shieldGen: 100, sensors: 60 },
    salvage: 55,
    traits: {}, cost: 0, unlockAfter: 99, enemy: true,
    defaultLoadout: ['v_leech_beam', 'v_needle_beam', 'v_plasma_arc'],
    aiRange: 600
  },
  vx_basilisk: {
    id: 'vx_basilisk', name: 'Basilisk', className: 'War Cruiser', faction: 'vessari',
    role: 'Line combatant',
    desc: 'The Shoal\'s answer to a human cruiser: twice the shield, two-thirds the bone.',
    hull: 680, shield: 880, shieldRegen: 11,
    speed: 56, accel: 9, turn: 0.36,
    reactor: 34, reserve: 180, sensors: 2100,
    size: 44,
    slots: [
      { pos: [ 7, 3, 14], dir: [ 0.4, 0, 0.9] },
      { pos: [-7, 3, 14], dir: [-0.4, 0, 0.9] },
      { pos: [0, 5, 2],   dir: [0, 0.3, 1] },
      { pos: [ 9, -2, -6], dir: [ 0.9, 0, 0.2] },
      { pos: [-9, -2, -6], dir: [-0.9, 0, 0.2] }
    ],
    devices: { engines: 130, shieldGen: 140, sensors: 80 },
    salvage: 80,
    traits: {}, cost: 0, unlockAfter: 99, enemy: true,
    defaultLoadout: ['v_plasma_arc', 'v_plasma_arc', 'v_spine_cannon', 'v_spine_cannon', 'v_spore_swarm'],
    aiRange: 900
  },
  vx_hierophant: {
    id: 'vx_hierophant', name: 'Hierophant', className: 'Battleship', faction: 'vessari',
    role: 'Shoal flagship',
    desc: 'A cathedral of chitin. Its deflector regenerates faster than most fleets can burn it.',
    hull: 1500, shield: 1250, shieldRegen: 16,
    speed: 40, accel: 6, turn: 0.22,
    reactor: 52, reserve: 280, sensors: 2400,
    size: 62,
    slots: [
      { pos: [ 9, 4, 20],  dir: [ 0.4, 0, 0.9] },
      { pos: [-9, 4, 20],  dir: [-0.4, 0, 0.9] },
      { pos: [0, 7, 8],    dir: [0, 0.3, 1] },
      { pos: [ 12, 0, -4], dir: [ 0.9, 0, 0.2] },
      { pos: [-12, 0, -4], dir: [-0.9, 0, 0.2] },
      { pos: [0, -6, 4],   dir: [0, -0.7, 0.4] },
      { pos: [0, 5, -14],  dir: [0, 0.5, -0.8] },
      { pos: [0, -4, 16],  dir: [0, -1, 0], hangar: true }
    ],
    devices: { engines: 200, shieldGen: 220, sensors: 110 },
    salvage: 150,
    traits: {}, cost: 0, unlockAfter: 99, enemy: true,
    defaultLoadout: ['v_plasma_arc', 'v_plasma_arc', 'v_spine_cannon', 'v_spine_cannon',
                     'v_needle_beam', 'v_spore_swarm', 'v_leech_beam', 'v_drone_wing'],
    aiRange: 1000
  }
};

export const SHOP_SHIPS = ['dd_sabre', 'dd_rapier', 'cr_bulwark', 'cr_warhammer'];
export const MAX_FLEET = 4;

// ============================================================================
// Campaign missions
// waves: delay (s) or afterCleared (spawn once every previous enemy is dead).
// ============================================================================

export const MISSIONS = [
  {
    id: 'm1', name: 'FIRST BLOOD', region: 'Cordell Verge — picket line',
    briefing: 'Two Vessari drone corvettes crossed the picket line an hour ago. Your Falchion is the only hull in range. '
      + 'Intercept and destroy them.\n\nRemember your kill chain, Commander: energy shells to crack the deflector, then the railgun. '
      + 'The pulse laser fills the gaps. Keep the PD grid live — the Shoal loves seekers.',
    secondaryText: 'Finish the engagement with the Falchion above 75% hull.',
    waves: [
      { delay: 0, ships: [ { cls: 'vx_stinger', at: [900, 0, 1100] } ] },
      { delay: 55, ships: [ { cls: 'vx_stinger', at: [-1100, 60, 1300] } ] }
    ],
    music: 'signal',
    basePoints: 130, secondaryPoints: 45, xp: 110, secondaryXp: 50,
    secondary: 'flagHull75'
  },
  {
    id: 'm2', name: 'THE SILENT RELAY', region: 'Relay KX-9 — comms shadow',
    briefing: 'Relay KX-9 went dark. Sensors read a Vessari strike group loitering in its shadow: a Mantis destroyer with drone escort. '
      + 'Sweep the grid and destroy all contacts.\n\nThe Mantis will close fast and strip shields. Use altitude — the Shoal\'s corvettes turn '
      + 'poorly out of plane.',
    secondaryText: 'End the mission with no subsystem destroyed on any of your ships.',
    waves: [
      { delay: 0, ships: [ { cls: 'vx_stinger', at: [-1100, 0, 1200] }, { cls: 'vx_stinger', at: [-800, -80, 1500] } ] },
      { delay: 50, ships: [ { cls: 'vx_mantis', at: [-1500, 120, 900] } ] }
    ],
    music: 'signal',
    basePoints: 160, secondaryPoints: 50, xp: 130, secondaryXp: 55,
    secondary: 'noDeviceLost'
  },
  {
    id: 'm3', name: 'CUT THE TENDON', region: 'Meridian Drift — pursuit',
    briefing: 'A Lamprey leech-ship is fleeing toward the Drift with a captured datacore. Fleet Intelligence wants it INTACT.\n\n'
      + 'Run it down and destroy its ENGINES — tap the ENGINES chip on the target panel to focus fire. Its shield must be down before '
      + 'beams can reach devices; disruptor missiles punch through shields if you brought them. If it escapes the Drift edge, we lose the core. '
      + 'Its escort will try to buy it time.',
    secondaryText: 'Disable the Lamprey with its hull above 50% (do not wreck the prize).',
    waves: [
      { delay: 0, ships: [
        { cls: 'vx_lamprey', at: [0, 0, 1600], objective: 'disable', flee: [0, 0, 9000] },
        { cls: 'vx_stinger', at: [-350, 0, 1400] }, { cls: 'vx_stinger', at: [350, 40, 1400] }
      ] }
    ],
    music: 'broadside',
    basePoints: 190, secondaryPoints: 60, xp: 150, secondaryXp: 65,
    secondary: 'prizeIntact', special: 'disable_escape', escapeRadius: 7800
  },
  {
    id: 'm4', name: 'BREAKWATER', region: 'Anchorage 7 — outer wall',
    briefing: 'The Shoal is probing Anchorage 7 in waves. Hold the water. Destroy every attacker.\n\n'
      + 'Expect a leech-ship in the second wave and a Basilisk war cruiser behind it. Watch your reserve cell — sustained fire through '
      + 'three waves will starve an unmanaged reactor.',
    secondaryText: 'Every ship in your fleet survives.',
    waves: [
      { delay: 0, ships: [ { cls: 'vx_stinger', at: [1200, 0, 900] }, { cls: 'vx_stinger', at: [900, -60, 1300] }, { cls: 'vx_mantis', at: [1500, 80, 600] } ] },
      { afterCleared: true, ships: [ { cls: 'vx_mantis', at: [-1300, 0, 1000] }, { cls: 'vx_lamprey', at: [-1000, 100, 1400] } ] },
      { afterCleared: true, ships: [ { cls: 'vx_basilisk', at: [0, -120, 1900] }, { cls: 'vx_stinger', at: [400, 0, 1700] } ] }
    ],
    music: 'broadside',
    basePoints: 230, secondaryPoints: 70, xp: 180, secondaryXp: 70,
    secondary: 'noShipLost'
  },
  {
    id: 'm5', name: 'BROADSIDE', region: 'Cordell Deep — the Shoal',
    briefing: 'We found the Hierophant. Kill it and the Shoal breaks.\n\nIts deflector regenerates faster than any single ship can burn it — '
      + 'mass your energy weapons, or use disruptors to gut the shield generator through the field. It repairs engines first: cripple the '
      + 'drives, then take the generator while its crews are distracted. Good hunting, Commander.',
    secondaryText: 'Destroy the Hierophant\'s shield generator before its hull falls below 50%.',
    waves: [
      { delay: 0, ships: [ { cls: 'vx_mantis', at: [700, 0, 1500] }, { cls: 'vx_mantis', at: [-700, 60, 1500] } ] },
      { delay: 40, ships: [ { cls: 'vx_hierophant', at: [0, 0, 2300], boss: true }, { cls: 'vx_stinger', at: [300, -60, 2100] }, { cls: 'vx_stinger', at: [-300, 60, 2100] } ] }
    ],
    music: 'leviathan',
    basePoints: 300, secondaryPoints: 90, xp: 240, secondaryXp: 90,
    secondary: 'bossGenFirst'
  }
];

// ============================================================================
// Progression
// ============================================================================

export const ATTRS = {
  combat:      { name: 'COMBAT',      desc: '+6% weapon damage per level' },
  engineering: { name: 'ENGINEERING', desc: '+20 resource points per mission per level' },
  science:     { name: 'SCIENCE',     desc: '+10% sensor range, +6% device-hit accuracy per level' }
};

export const XP_LEVELS = [0, 150, 360, 640, 1000, 1450, 2000];

export function levelForXp(xp) {
  let lvl = 0;
  for (let i = 0; i < XP_LEVELS.length; i++) if (xp >= XP_LEVELS[i]) lvl = i;
  return lvl;
}

export const REPAIR = {
  hullPerPoint: 12,        // hull hp restored per resource point
  deviceRestoreCost: 25    // flat cost to rebuild a destroyed device/mount
};

export function makeShipRecord(clsId, name) {
  const def = SHIP_CLASSES[clsId];
  return {
    cls: clsId,
    name: name || def.name,
    hull: def.hull,
    devices: { engines: def.devices.engines, shieldGen: def.devices.shieldGen, sensors: def.devices.sensors },
    // one entry per slot: { w: weaponId|null, hp: mountHp }
    slots: def.slots.map((s, i) => ({
      w: def.defaultLoadout ? (def.defaultLoadout[i] ?? null) : null,
      hp: MOUNT_HP
    }))
  };
}

export const MOUNT_HP = 70;

export const HUMAN_SHIP_NAMES = [
  'UES Falchion', 'UES Sabre', 'UES Rapier', 'UES Bulwark', 'UES Warhammer',
  'UES Talwar', 'UES Estoc', 'UES Claymore', 'UES Glaive', 'UES Partisan'
];

// ============================================================================
// Skirmish — endless escalating waves, outside the campaign.
// ============================================================================

export const SKIRMISH_FLEET = [
  ['hc_falchion', 'UES Falchion'],
  ['dd_sabre',    'UES Sabre'],
  ['cr_bulwark',  'UES Bulwark']
];

/** roster for skirmish wave n (1-based): escalating mix of Vessari hulls */
export function skirmishWave(n) {
  const ships = [];
  const add = (cls, count) => { for (let i = 0; i < count; i++) ships.push(cls); };
  add('vx_stinger', 1 + Math.floor(n / 2));
  if (n >= 2) add('vx_mantis', Math.min(3, Math.floor(n / 2)));
  if (n >= 4) add('vx_lamprey', Math.min(2, Math.floor((n - 2) / 3)));
  if (n >= 5) add('vx_basilisk', Math.min(3, Math.floor((n - 3) / 2)));
  if (n >= 8 && n % 4 === 0) add('vx_hierophant', 1);
  // ring them around the arena at mixed altitudes
  return ships.map((cls, i) => {
    const a = (i / ships.length) * Math.PI * 2 + n;
    const r = 1900 + (i % 3) * 260;
    return { cls, at: [Math.sin(a) * r, ((i % 3) - 1) * 160, Math.cos(a) * r + 400] };
  });
}

export const SKIRMISH_MISSION = {
  id: 'skirmish', name: 'SKIRMISH', region: 'Unregistered deep — free engagement',
  briefing: 'No orders, no extraction, no reinforcements. Wave after wave until the fleet is gone.\n\n'
    + 'Every hull you destroy or capture is scored. Repairs between waves are automatic but partial — '
    + 'husband your ships and your reserve cell.',
  secondaryText: 'Survive as long as possible.',
  waves: [], skirmish: true,
  basePoints: 0, secondaryPoints: 0, xp: 0, secondaryXp: 0,
  music: 'broadside'
};
