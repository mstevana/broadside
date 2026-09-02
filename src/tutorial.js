// ============================================================================
// BROADSIDE — contextual tutorial for the first mission.
//
// A queue of steps; each has a prompt, a completion predicate evaluated
// against the live mission, and an optional gate that delays it until the
// situation is right. Steps never block play — a player who already knows
// what to do simply satisfies them and moves on.
// ============================================================================

const STEPS = [
  {
    id: 'move',
    text: 'TAP open space to order a move. PRESS AND DRAG up or down to set altitude before releasing.',
    done: (m) => m._tutMoved
  },
  {
    id: 'contact',
    text: 'Hostiles are beyond sensor range. Close the distance — unconfirmed contacts pulse red and cannot be fired on.',
    gate: (m) => !m.world.ships.some(s => !s.isPlayer && s.alive && s.detected),
    done: (m) => m.world.ships.some(s => !s.isPlayer && s.alive && s.detected)
  },
  {
    id: 'target',
    text: 'Contact confirmed. Ships fire on what comes into range by themselves — TAP the enemy, or its card on the right, to focus the selection on one hull.',
    done: (m) => m.selection.some(s => s.target && s.target.alive)
  },
  {
    id: 'shield',
    text: 'Its deflector is up. Energy weapons (E-SHELL) collapse shields; the RAILGUN is wasted on them — watch for ABSORBED.',
    done: (m) => {
      const t = m.selection[0] && m.selection[0].target;
      return t && !t.shieldUp;
    }
  },
  {
    id: 'hull',
    text: 'SHIELD DOWN. Now the RAILGUN bites. Tap a weapon to hold fire across the selection, LONG-PRESS to bind it to this target.',
    done: (m) => m.world.ships.some(s => !s.isPlayer && !s.alive)
  },
  {
    id: 'power',
    text: 'Kill confirmed. Tap PWR to shift reactor output — weapons for rate of fire, engines to close, sensors to see further.',
    done: (m) => m._tutPower
  },
  {
    id: 'speed',
    text: 'Use ❚❚ to pause and issue orders, or 1× to compress time while ships close. Finish the engagement, Commander.',
    done: (m) => m._tutSpeed || m.over
  }
];

export class Tutorial {
  constructor(mission, hud) {
    this.mission = mission;
    this.hud = hud;
    this.queue = STEPS.slice();
    this.current = null;
    this.holdUntil = 0;
    this.done = false;
  }

  /** advance the script; called a few times a second */
  update(now) {
    if (this.done) return;
    const m = this.mission;

    if (this.current) {
      if (this.current.done(m)) {
        this.current = null;
        this.holdUntil = now + 900;      // small beat between steps
      } else {
        return;
      }
    }
    if (now < this.holdUntil) return;

    while (this.queue.length) {
      const step = this.queue[0];
      if (step.gate && !step.gate(m)) {
        // not applicable yet — if it is already satisfied, drop it
        if (step.done(m)) { this.queue.shift(); continue; }
        return;
      }
      this.queue.shift();
      if (step.done(m)) continue;        // player got there first
      this.current = step;
      this.hud.tutorial(step.text);
      return;
    }
    this.done = true;
    this.hud.tutorial(null);
  }
}
