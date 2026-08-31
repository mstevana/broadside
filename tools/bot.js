// ============================================================================
// BROADSIDE — headless "bot commander" used for balance playtesting.
//
// Plays the way a competent human would rather than leaving ships on
// auto: concentrates the fleet on one target at a time, cracks the shield
// before switching to hull weapons, focuses subsystems once the deflector is
// down, manages reactor power, launches wings, and keeps the fleet at a
// sensible standoff range. Injected into the page by the playtest harness.
// ============================================================================

export function makeBot(BS) {
  let tick = 0;

  const hostiles = (m) => m.world.ships.filter(
    s => !s.isPlayer && s.alive && !s.disabled && s.detected);

  /** the fleet's shared kill priority: finish wounded things, else nearest */
  function pickFocus(m) {
    const list = hostiles(m);
    if (!list.length) return null;
    const fleet = m.world.playerShips();
    if (!fleet.length) return null;
    const centre = fleet.reduce((a, s) => a.add(s.pos.clone()),
      new (fleet[0].pos.constructor)()).divideScalar(fleet.length);
    let best = null, bestScore = Infinity;
    for (const e of list) {
      const frac = (e.hull / e.hullMax) * 0.6 + (e.shield / e.shieldMax) * 0.4;
      // prefer nearly-dead ships, then close ones; leech ships are a priority
      const score = frac * 2200 + centre.distanceTo(e.pos)
        + (e.def.id === 'vx_lamprey' ? -900 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  return {
    /** called a few times a second of sim time */
    update(m) {
      tick++;
      const focus = pickFocus(m);
      const fleet = m.world.playerShips();

      for (const s of fleet) {
        // ---- orders ----
        s.behavior = 'aggressive';
        s.target = focus;

        if (focus) {
          // subsystem discipline: once the shield is down, kill the drives,
          // then the generator, so it can neither run nor re-raise the field
          if (!focus.shieldUp) {
            s.focusDevice = focus.devices.engines.hp > 0 ? 'engines'
              : (focus.devices.shieldGen.hp > 0 ? 'shieldGen' : null);
          } else {
            s.focusDevice = null;
          }

          // ---- weapon discipline ----
          // don't waste hull-breakers on an intact deflector, and don't hold
          // anti-shield guns once it is down
          for (const w of s.weapons) {
            if (w.hp <= 0 || w.def.craft) continue;
            const role = w.def.role;
            if (w.def.pd) { w.enabled = true; continue; }
            if (role === 'shield') w.enabled = focus.shieldUp;
            else if (role === 'hull') w.enabled = !focus.shieldUp || (w.def.bleed || 0) >= 0.4;
            else w.enabled = true;
          }

          // ---- power ----
          if (s.shield < s.shieldMax * 0.25) {
            s.sliders.wep = 0.8; s.sliders.shd = 1.8; s.sliders.eng = 1.0; s.sliders.sen = 0.6;
          } else {
            s.sliders.wep = 1.7; s.sliders.shd = 1.0; s.sliders.eng = 0.9; s.sliders.sen = 0.7;
          }
        } else {
          for (const w of s.weapons) if (w.hp > 0 && !w.def.craft) w.enabled = true;
          s.sliders.wep = 1.0; s.sliders.shd = 1.0; s.sliders.eng = 1.4; s.sliders.sen = 1.4;
        }

        // ---- wings: launch when something is in reach, recall when clear ----
        for (const sq of s.squadrons) {
          if (focus && !sq.launched && sq.operable &&
              s.pos.distanceTo(focus.pos) < 1600) sq.launch(m.world);
          else if (!focus && sq.state === 'launched') sq.recall();
        }
      }
    }
  };
}
