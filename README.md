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
| PWR | Power sliders: WEAPONS / SHIELDS / ENGINES / SENSORS |
| FOCUSED / AGGRESSIVE / DEFENSIVE | Behaviour: fire only at the assigned target / auto-acquire / return fire only |

Move orders show a pulsing marker (with a plane-projection line for off-plane
targets) until the ship arrives.

## The kill chain

- **Anti-shield (energy)** — Energy Shells, Plasma Arcs: collapse deflectors, useless against hull.
- **Anti-hull (destructive)** — Railguns, Heavy Lasers: wreck bare hull, mostly absorbed by shields. Torpedoes bleed ~50% through.
- **Anti-device (tactical)** — Scalpel Lasers, Needle Beams: disable engines, shield generators, sensors and weapon mounts once the shield is down. Disruptor Missiles are the exception: they short devices *through* an active shield.

Shield regeneration pauses for a few seconds whenever the shield takes damage, so
sustained anti-shield fire wins; trickle fire doesn't.

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

Five missions (intercept, sweep, a disable-don't-destroy chase that teaches
subsystem targeting, a defensive wave battle, and the Hierophant). After each
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
src/hud.js      combat DOM HUD
src/refit.js    debrief + spaceport screens, economy
src/meshes.js   procedural ship meshes, starfield, glow sprites
src/main.js     campaign state machine, mission runner, render loop
```

## Design decisions (deviations & interpretations)

- The click+drag altitude gesture is implemented as *press → drag → release*
  (plane point on press, altitude while dragging, commit on release) — one fluid
  motion suits touch better than two separate clicks.
- Behaviour modes: Aggressive / Defensive / Focused (Custom omitted).
- Support craft (fighters, bombers, gunboats, boarding) are out of scope for this
  version; the anti-device layer covers their tactical role. Natural next step.
- Weapon "swapping between missions" is free; buying new weapons costs points.
  Ammo replenishes free between missions.
- Slow projectiles aim at the *intercept point*, not the target's current
  position — they render as velocity-aligned tracers so leading fire reads as
  aimed, not misfired.
