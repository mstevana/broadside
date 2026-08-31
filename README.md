# BROADSIDE

Mobile-first tactical capital-ship combat in the browser, built on **three.js**.
Inspired by *Nexus: The Jupiter Incident* (subsystem targeting, energy management,
the shield → hull → device kill chain, between-mission refits with use-it-or-lose-it
points) and *Homeworld* (full-3D movement orders on a horizontal plane with an
altitude gesture).

Battles are deliberately slow and heavy: capital ships arc through space under
semi-Newtonian movement, turn to bring weapon arcs to bear, and the real skill is
loadout planning, power distribution and subsystem targeting — not reflexes.

## Running

Static files, no build step. Serve the directory over HTTP (ES modules don't load
from `file://`):

```sh
npm start            # npx serve -l 8080 .
# or: python3 -m http.server 8080
```

Then open `http://localhost:8080`. Designed for iPhone/iPad (safe-area aware,
touch-first, pinch/orbit camera); works fine with mouse on desktop. three.js is
vendored in `vendor/`, so it also works fully offline.

## Controls

| Input | Action |
|---|---|
| Tap open space | Move selected ships — horizontal move at the selection's current altitude |
| Press + drag up/down | 3D move: the press point fixes the point on the horizontal plane, the drag sets ±altitude, release commits |
| Tap enemy ship | Designate target for selected ships |
| Tap own ship / left-bar card | Select ship (SELECT ALL selects the fleet) |
| Two-finger drag / pinch | Orbit / zoom camera (mouse: right-drag / wheel) |
| Subsystem chip on target panel | Focus precision fire on that device (shield must be down; disruptor missiles punch through) |
| Weapon buttons (bottom bar) | Toggle each weapon between firing and HOLD FIRE |
| **Long-press** a weapon button | Bind that weapon to the current target (per-weapon targeting); long-press again to release |
| Wing button (hangar mounts) | Launch the squadron; tap again to recall |
| ❚❚ | Tactical pause — the sim freezes but orders can still be issued |
| 1× / 2× / 4× | Time compression |
| **Long-press** open space | Queue another leg on the move order (dashed path shows the route) |
| LINE / COLUMN / ECHELON / SCREEN | Cycle fleet formation |
| PWR | Power sliders: WEAPONS / SHIELDS / ENGINES / SENSORS |
| FOCUSED / AGGRESSIVE / DEFENSIVE | Behaviour: fire only at the assigned target / auto-acquire / return fire only |

Move orders show a pulsing marker (with a plane-projection line for off-plane
targets) until the ship arrives. The selected ship also draws its weapon range
rings and firing-arc wedges, so you can see which mounts will actually bear.

## Formations and waypoints

Multi-ship move orders assign each hull a slot in the current formation,
oriented to the direction of travel, rather than preserving whatever spacing
the fleet drifted into:

- **Line abreast** — broadside on, every hull can bring side arcs to bear
- **Column** — narrow profile, spinal guns clear of each other
- **Echelon** — stepped back and out, nothing masks the ship behind it
- **Screen** — escorts ring the flagship at three altitudes, overlapping
  point-defence

Slot spacing scales with the size of the hulls involved. Long-pressing open
space appends a leg instead of replacing the order, so you can plot a route
around a threat axis; the remaining legs are drawn as a dashed chain.

## Sensors and fog of war

Enemies are invisible until one of your ships has them on sensors. Just beyond
that range they show as pulsing unconfirmed contacts that cannot be tapped or
fired at. Sensor reach depends on the hull, the SENSORS power slider, the
Science attribute, and whether the sensor array is still intact — which is what
makes the Sabre's scanner refit and sensor power allocation matter.

## The kill chain

- **Anti-shield (energy)** — Energy Shells, Plasma Arcs: collapse deflectors, useless against hull.
- **Anti-hull (destructive)** — Railguns, Heavy Lasers: wreck bare hull, mostly absorbed by shields. Torpedoes bleed ~50% through.
- **Anti-device (tactical)** — Scalpel Lasers, Needle Beams: disable engines, shield generators, sensors and weapon mounts once the shield is down. Disruptor Missiles are the exception: they short devices *through* an active shield.

Shield regeneration pauses for a few seconds whenever the shield takes damage, so
sustained anti-shield fire wins; trickle fire doesn't.

**Support craft** are the exception to all of the above: wings launched from a
hangar mount fly *inside* the enemy deflector envelope, so their strikes land on
hull and subsystems whether or not the shield is up. The counter is
point-defence — PD grids and flak batteries engage craft as well as missiles.
Interceptors screen the carrier, bombers torch subsystems, gunboats hunt weapon
mounts (point-defence first).

**Prize capture.** Strip a Vessari hull's engines and every gun mount and it
strikes its colours: it stops fighting, stops blocking the mission, and pays
salvage points at the debrief. Precision play with anti-device weapons pays
better than blowing everything up.

**Power is the real limit.** The reactor output is split across the four sliders;
the weapons share refills a reserve cell and every shot spends from it. Even a
top reactor sustains only ~3–4 weapons at full rate — overload and your charged
weapons hold fire waiting for energy. Crews auto-repair damaged devices (engines
first — knock out their drives, then take the shield generator while the repair
teams are busy). *Destroyed* devices can only be rebuilt at the spaceport.

## Fleets

**United Earth Navy** (playable): Falchion heavy corvette (starting flagship, spinning
habitat ring), Sabre fast-attack/scanner destroyer, Rapier anti-subsystem destroyer
(+35% device damage), Bulwark anti-shield cruiser (+25% shield damage, faster energy
weapons), Warhammer cruiser (late flagship, six mounts).

**The Vessari Shoal** (enemy): faster hulls with stronger, faster-regenerating
shields — but thin plating and fragile subsystems, and their light hulls carry no
point-defence (missiles hurt them). Stinger drone corvette, Mantis strike destroyer,
Lamprey leech destroyer (drains your shields to feed its own), Basilisk war cruiser,
Hierophant battleship.

## Campaign

Eight missions, only half of them elimination:

| # | Mission | Objective |
|---|---|---|
| 1 | First Blood | Intercept — the tutorial engagement |
| 2 | The Silent Relay | Sweep a comms shadow |
| 3 | Cut the Tendon | **Disable, don't destroy** — cripple a fleeing ship's drives |
| 4 | Breakwater | Hold against three waves |
| 5 | Long Haul | **Escort** an unarmed freighter to the jump point |
| 6 | Dead Reckoning | **Board** three derelicts in a sensor blackout, then get out |
| 7 | Hold the Wall | **Defend** a fixed station for four minutes |
| 8 | Broadside | Kill the Hierophant |

New objective types bring their own hulls: the unarmed Meridian freighter, the
immobile Anchorage 7 station, the Vessari Bastion gun-spire and inert Tomb-Hulk
derelicts. Allied hulls are human-faction (so the Shoal shoots them and they
shoot back) but are not player-commanded — `controllable` separates the two. After each
mission you get resource points for repairs, weapons and new hulls — **unspent
points are lost at launch**. Secondary objectives pay extra points and XP. XP
levels grant commander attribute points: **Combat** (+damage), **Engineering**
(+points per mission), **Science** (+sensor range, +device-hit accuracy). Losing
a mission restores the fleet to its pre-launch state; losing a ship on a *won*
mission strikes it from the registry permanently. Progress saves to
`localStorage`.

## Audio

Everything is synthesized live with the Web Audio API — no audio assets. Toggle
with the ♪ button (top bar in combat, SOUND on the main menu); the setting persists.

**Sound effects** are per-weapon (laser zaps, railgun cracks, energy-shell
whooshes, missile launches, point-defence ticks), plus shield impacts,
explosions sized to the blast, shield-down / device-destroyed alarms, new-contact
alerts, UI ticks and a low engine-room ambience during combat. Effects are
distance-attenuated and stereo-panned relative to the camera, share a generated
convolution reverb, and are rate-limited so big battles stay clean.

**Music** is a generative score in the spirit of Paul Ruskay's Homeworld
soundtrack — low drones, modal scales (phrygian/dorian/aeolian), sparse
duduk-like lead lines with delayed vibrato, slow pad swells, distant taikos and
heavy reverb. Melodies are random walks on each track's mode, so nothing ever
loops exactly. Eight tracks, switched by context with crossfades:

| Track | Mode | Where |
|---|---|---|
| *Adrift* | aeolian drone | main menu |
| *Cold Anchorage* | dorian | spaceport / refit |
| *The Verge* | phrygian | mission briefing |
| *Signal Fires* | aeolian, taikos | combat (missions 1–2) |
| *Broadsides* | harmonic minor, driving | combat (missions 3–4) |
| *Leviathan Choir* | phrygian, formant-filtered "choir" | the Hierophant |
| *Homecoming* | lydian | debrief, victory |
| *Dirge for the Fleet* | aeolian, tolling bells | debrief, defeat |

## The Vessari fight with your toolkit

The Shoal is not on a reduced ruleset — it uses the same systems the player
does:

- **Pack doctrine** — the fleet agrees on one focus target every few seconds,
  weighting wounded hulls, ships with their deflector already down, the
  anti-shield "can opener", carriers with wings in the air, and whichever hull
  has been hurting them most (a decaying threat memory fed by the damage
  stream).
- **Surgical targeting** — once a deflector drops the pack commits to a
  subsystem: drives on anything trying to leave, the shield generator on
  anything standing and fighting, and point-defence mounts first when it wants
  its spore swarms to land.
- **Weapon discipline** — arcs are held once a shield is down, hull guns while
  it is up (opening early as it nears collapse), device weapons only when they
  can actually reach a device.
- **Carriers** launch drone wings against a chosen target and recall
  interceptors to screen the carrier when missiles are inbound.
- **Withdrawal** — a mauled light hull disengages once; if the whole pack is
  losing badly the survivors break contact together, then turn and fight rather
  than kiting forever.
- **Power posture** follows the situation: shields when stripped, weapons when
  the victim's deflector is down.

## Interrupted battles

A capital-ship engagement runs for minutes, which on a phone is long enough to
be interrupted by a call or the OS evicting the tab. The live sim is serialized
to `localStorage` on every pause, whenever the tab is hidden or the page goes
away, and on a slow heartbeat during combat — ship positions, velocities and
facing, hull/shield/device damage, reactor charge, per-weapon charge, ammo,
hold-fire and bound targets, squadron state including craft in the air, orders,
wave progress and mission bookkeeping. **RESUME BATTLE** then appears on the
main menu.

Projectiles in flight and visual effects are deliberately dropped; a resumed
battle losing one volley mid-air is imperceptible and reproducing them isn't
worth the complexity.

## Skirmish

An endless escalating wave mode off the main menu with its own three-ship fleet,
independent of campaign progress. Waves mix in heavier Vessari hulls as they
climb, with a Hierophant every fourth wave from wave 8. Between waves the fleet
gets a partial hull patch, device restoration and a magazine restock. Scores
waves survived, hulls destroyed or captured, and salvage, with a persistent
personal best.

## Install / offline

The game ships a web app manifest and a service worker that precaches every
asset, so it installs to an iPhone/iPad home screen (fullscreen, landscape) and
runs with no network at all.

## Backdrop and bloom

Space is never empty. Each mission region gets its own **procedural deep-space
backdrop** — layered nebula banks, dust lanes, a graded star field and often a
planet with a terminator and atmospheric rim — painted from a seeded RNG onto
the six faces of a cube texture. One draw call, no assets. Nebula brightness is
tonally compressed to a ceiling well under the bloom threshold, so the backdrop
stays a backdrop instead of glowing. Regions are cached and prewarmed during the
briefing screen, since painting one costs ~200 ms.

**Bloom** is a small purpose-built composer (`src/bloom.js`) — bright-pass, two
separable Gaussian mips, additive composite — because three's `UnrealBloomPass`
lives in the addons we don't vendor. The threshold sits above lit hull plating,
so only genuinely emissive things glow: drive flares, weapon tracers and beams,
shield impacts, window strips and Vessari bioluminescence. It can be turned off
wholesale (`bloom.setEnabled(false)`) with no targets allocated.

## Procedural textures

There are no image assets — every map is drawn to a canvas at load time from a
seeded RNG, then uploaded as a three.js texture (~11 MB of VRAM for the whole
fleet, roughness maps at quarter resolution since they are low-frequency).

- **Hull plating** (three variants): irregular panels from recursive
  subdivision, each with its own tone, a recessed seam, rivet lines, inset
  access hatches, vent louvres and occasional hazard bands, plus grime washes
  and scratches. A height pass is Sobel-filtered into a **normal map**, so
  seams and rivets actually catch the light, and a **roughness map** varies the
  finish panel by panel.
- **Vessari carapace** (two scales): overlapping chitin scales in offset rows
  with raised centres and grooved rims, subsurface mottling and capillary
  veins. Hard chitin — ribs, fins, tendrils, mandibles — uses a separate
  striated bone map instead, since the scale map turns small cylinders into
  bubble wrap.
- **Brushed metal** for trim, and **per-class nameplates**: a painted, riveted
  plate carrying the pennant number, ship name, accent stripe and hazard
  chevrons (`CA-40 WARHAMMER`, `DD-207 SABRE`, …), fitted to a raised plate
  built into each hull so nothing clips the lettering.

UVs are **baked triplanar in ship-local space** at a fixed world-units-per-tile
rather than using each primitive's own 0–1 range — otherwise a 60 m armour belt
and a 2 m greeble would get the same number of plates. Every ship in the fleet
ends up with the same plate size, which is what makes them read as one navy.

Each class is built once into a prototype and cloned per ship, so twelve hulls
in a skirmish share one set of merged geometry and materials (only the
Vessari's pulsing veins get a per-ship material).

## Playtesting

The campaign is validated by an automated harness rather than by hand:

```sh
node tools/playtest.js 4              # 4 full campaigns, all five missions
node tools/playtest.js 3 --mission 5  # just the finale
node tools/playtest.js 2 --verbose    # per-mission fleet state
```

`tools/bot.js` is a bot commander that plays the way a competent human would —
concentrating the fleet on one target, cracking the shield before switching to
hull weapons, focusing engines then the shield generator once the deflector is
down, managing reactor power and launching wings — and the harness buys a
sensible refit between missions. It reports win rate, duration and fleet
attrition per mission, so a balance change can be checked in minutes instead of
by grinding five missions by hand.

This is how mission 3 was found to be **mathematically unwinnable**: the
Lamprey bolted at spawn 2 900 units ahead of the fleet and simply outran it,
every single run.

## Code layout

```
index.html      HUD/screen markup + all CSS
vendor/         three.js (pinned, vendored)
src/data.js     weapons, ship classes, missions, progression constants
src/ship.js     Ship entity: power, devices, weapons, semi-Newtonian movement
src/world.js    combat sim: fire resolution, projectiles/missiles/PD, damage, markers, effects
src/ai.js       Vessari behaviour (orbit-and-strip, leech hunting, flee logic)
src/input.js    touch/mouse gestures, orbit camera, move-with-altitude gesture
src/audio.js    Web Audio SFX engine: synthesis, spatialization, reverb, ambience
src/music.js    generative music engine + the eight track definitions
src/craft.js    support-craft squadrons: launch, strike runs, escort, recovery
src/tutorial.js contextual first-mission tutorial script
src/merge.js    tiny geometry merger (keeps each hull to a few draw calls)
src/textures.js procedural texture generation (plating, carapace, decals)
src/backdrop.js procedural nebula/planet cube-texture backdrops
src/bloom.js    self-contained bloom composer
src/persist.js  mid-mission save/resume serialization
src/formation.js fleet formation slot layouts
tools/bot.js    bot commander used for automated balance playtesting
tools/playtest.js  headless campaign playtest harness
sw.js           service worker (offline precache)
manifest.webmanifest, icons/  PWA install metadata
src/hud.js      combat DOM HUD
src/refit.js    debrief + spaceport screens, economy
src/meshes.js   procedural ship meshes, starfield, glow sprites
src/main.js     campaign state machine, mission runner, render loop
```

## Design decisions (deviations & interpretations)

- The click+drag altitude gesture is implemented as *press → drag → release*
  (plane point on press, altitude while dragging, commit on release) — one fluid
  motion suits touch better than two separate clicks.
- Behaviour modes: Aggressive / Defensive / Focused (Custom omitted). FOCUSED
  ships hold fire until you give them a target — that is deliberate, and the
  tutorial teaches it; skirmish starts weapons-free instead since it has no
  briefing.
- Ships are built procedurally from primitives and merged per material at
  authoring time: each capital ship is 2–6k triangles in ~8–13 draw calls, so
  the detail costs almost nothing on a phone.
- Radiator fins are ventral rather than on the flanks — partly because heat
  radiators plausibly deploy away from the crewed dorsal spine, and partly
  because the flanks are where the nameplates go.
- Support craft (fighters, bombers, gunboats, boarding) are out of scope for this
  version; the anti-device layer covers their tactical role. Natural next step.
- Weapon "swapping between missions" is free; buying new weapons costs points.
  Ammo replenishes free between missions.
- Slow projectiles aim at the *intercept point*, not the target's current
  position — they render as velocity-aligned tracers so leading fire reads as
  aimed, not misfired.
