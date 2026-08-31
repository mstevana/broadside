# Credits

## Nebula photography

The deep-space backdrops are built from real astronomical imagery released by
NASA and its partners. Under
[NASA's media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
this material is generally not copyrighted and may be used for any purpose,
with credit requested. Credit is given below and in the game's CREDITS screen.

Each image was cropped, resized to 512×512 and brightness-limited so that it
sits below the game's bloom threshold; no other alteration was made. Sources
were retrieved from the [NASA Image and Video Library](https://images.nasa.gov).

| File | Subject | Credit | Instrument |
|---|---|---|---|
| `assets/nebula/carina.jpg` | The "Cosmic Cliffs" of NGC 3324, Carina Nebula | NASA, ESA, CSA, STScI | JWST NIRCam (2022) |
| `assets/nebula/southernring.jpg` | Southern Ring Nebula (NGC 3132), NIRCam panel | NASA, ESA, CSA, STScI | JWST NIRCam (2022) |
| `assets/nebula/crab.jpg` | Crab Nebula (M1) | NASA / ESA / JPL / Arizona State Univ. | Hubble WFPC2 (2005) |
| `assets/nebula/helix.jpg` | Helix Nebula (NGC 7293) | NASA / JPL-Caltech | GALEX / Spitzer (2012) |
| `assets/nebula/eagle.jpg` | Eagle Nebula (M16) | NASA / JPL-Caltech | WISE (2022) |
| `assets/nebula/tarantula.jpg` | Tarantula Nebula (30 Doradus) | NASA / JPL-Caltech / Cornell University and University of Leiden | Spitzer (2004) |

NASA does not endorse this game. Use of NASA imagery does not imply any such
endorsement, and no NASA insignia or logo is used anywhere in the project.

## Everything else

All other content in Broadside is generated procedurally at runtime and ships
with no asset files:

- ship hulls, weapon mounts, hull plating, chitin carapace and nameplate decals
  (`src/meshes.js`, `src/textures.js`)
- nebula cloud layers, dust lanes, star fields and planets that surround the
  photographic plates (`src/backdrop.js`)
- every sound effect and all eight music tracks, synthesized live with the Web
  Audio API (`src/audio.js`, `src/music.js`)

## Libraries

- [three.js](https://threejs.org) r160 — MIT licence, vendored in `vendor/`.
