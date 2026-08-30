// ============================================================================
// BROADSIDE — camera + touch/mouse input
//
// One finger / left mouse:
//   tap on enemy        -> designate target
//   tap on own ship     -> select it
//   tap on open space   -> move selected ships (horizontal plane of selection)
//   press + drag        -> move gesture: press point fixes the plane point,
//                          vertical drag sets +/- altitude, release commits
// Two fingers: orbit; pinch: zoom.  Mouse: right-drag orbit, wheel zoom.
// ============================================================================

import * as THREE from 'three';

const TAP_MS = 260;
const TAP_PX = 12;
const ALT_PER_PX = 3.2;       // world units of altitude per pixel of vertical drag

export class InputController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   * @param {object} cb  { getWorld, getSelection, onSelectShip, onTargetShip, onMoveCommand, onTapNothing }
   */
  constructor(camera, dom, cb) {
    this.camera = camera;
    this.dom = dom;
    this.cb = cb;

    // orbit state
    this.focus = new THREE.Vector3();       // point the camera looks at
    this.followShip = null;                 // ship whose position drives focus
    this.follow = true;
    this.yaw = Math.PI * 0.15;
    this.pitch = 0.45;
    this.dist = 360;
    this.minDist = 120;
    this.maxDist = 4200;

    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // gesture state
    this.pointers = new Map();              // pointerId -> {x,y,sx,sy,t}
    this.gesture = null;                    // null | 'move' | 'orbit' | 'pinch'
    this.moveGesture = null;                // {planePoint, altitude}
    this.pinchDist = 0;

    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', e => this.onDown(e));
    dom.addEventListener('pointermove', e => this.onMove(e));
    dom.addEventListener('pointerup', e => this.onUp(e));
    dom.addEventListener('pointercancel', e => this.onUp(e));
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
  }

  // ------------------------------------------------------------- camera ----

  setFollow(ship) { this.followShip = ship; }

  zoomBy(f) { this.dist = THREE.MathUtils.clamp(this.dist * f, this.minDist, this.maxDist); }

  updateCamera(dt) {
    if (this.follow && this.followShip && this.followShip.alive) {
      this.focus.lerp(this.followShip.pos, Math.min(1, dt * 3));
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.45);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.camera.position.set(
      this.focus.x + this.dist * cp * sy,
      this.focus.y + this.dist * sp,
      this.focus.z + this.dist * cp * cy
    );
    this.camera.lookAt(this.focus);
  }

  // ------------------------------------------------------------ pointers ----

  onDown(e) {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button });

    if (this.pointers.size === 2) {
      // second finger cancels any move gesture -> orbit/pinch
      this.cancelMoveGesture();
      this.gesture = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    } else if (this.pointers.size === 1) {
      if (e.button === 2) {
        this.gesture = 'orbit';
      } else {
        this.gesture = 'pending';    // becomes tap or move-drag
      }
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (this.gesture === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const nd = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.zoomBy(this.pinchDist / Math.max(1, nd));
      this.pinchDist = nd;
      // two-finger drag also orbits (average movement)
      this.yaw -= dx * 0.0025;
      this.pitch += dy * 0.0025;
      return;
    }

    if (this.gesture === 'orbit') {
      this.yaw -= dx * 0.005;
      this.pitch += dy * 0.005;
      return;
    }

    if (this.gesture === 'pending') {
      const totalDx = e.clientX - p.sx, totalDy = e.clientY - p.sy;
      if (Math.hypot(totalDx, totalDy) > TAP_PX) {
        // exceeds tap slop -> begin move gesture from the press point
        this.beginMoveGesture(p.sx, p.sy);
      }
    }

    if (this.gesture === 'move' && this.moveGesture) {
      const totalDy = e.clientY - p.sy;
      this.moveGesture.altitude = -totalDy * ALT_PER_PX;
      this.updateGhost();
    }
  }

  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;

    if (this.gesture === 'pinch') {
      if (this.pointers.size < 2) this.gesture = this.pointers.size === 1 ? 'orbit' : null;
      return;
    }
    if (this.gesture === 'orbit') { if (this.pointers.size === 0) this.gesture = null; return; }

    if (this.gesture === 'move' && this.moveGesture) {
      const mg = this.moveGesture;
      const point = mg.planePoint.clone();
      point.y += mg.altitude;
      this.cancelMoveGesture();
      this.gesture = null;
      this.cb.onMoveCommand(point);
      return;
    }

    if (this.gesture === 'pending') {
      this.gesture = null;
      const dt = performance.now() - p.t;
      if (dt <= TAP_MS * 2.2) this.handleTap(p.sx, p.sy);
    }
  }

  // ---------------------------------------------------------------- taps ----

  handleTap(x, y) {
    const world = this.cb.getWorld();
    if (!world) return;
    const hit = this.pickShip(x, y, world);
    if (hit) {
      if (hit.isPlayer) this.cb.onSelectShip(hit);
      else this.cb.onTargetShip(hit);
      return;
    }
    // tap on open space => horizontal move at the selection's altitude
    const point = this.pickPlane(x, y);
    if (point) this.cb.onMoveCommand(point);
    else if (this.cb.onTapNothing) this.cb.onTapNothing();
  }

  // ------------------------------------------------------- move gesture ----

  beginMoveGesture(sx, sy) {
    const point = this.pickPlane(sx, sy);
    if (!point) { this.gesture = 'orbit'; return; }   // no plane hit: orbit instead
    this.gesture = 'move';
    this.moveGesture = { planePoint: point, altitude: 0 };
    this.updateGhost();
  }

  updateGhost() {
    const world = this.cb.getWorld();
    if (!world || !this.moveGesture) return;
    const sel = this.cb.getSelection();
    const from = sel.length ? sel[0].pos : null;
    world.showGhost(this.moveGesture.planePoint, this.moveGesture.altitude, from);
  }

  cancelMoveGesture() {
    if (this.moveGesture) {
      const world = this.cb.getWorld();
      if (world) world.hideGhost();
      this.moveGesture = null;
    }
    if (this.gesture === 'move') this.gesture = null;
  }

  // ------------------------------------------------------------- picking ----

  setRayFrom(x, y) {
    const r = this.dom.getBoundingClientRect();
    const nx = ((x - r.left) / r.width) * 2 - 1;
    const ny = -((y - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
  }

  pickShip(x, y, world) {
    this.setRayFrom(x, y);
    // sphere test against ship bounds — forgiving for touch
    let best = null, bd = Infinity;
    const sphere = new THREE.Sphere();
    for (const s of world.ships) {
      if (!s.alive) continue;
      sphere.set(s.pos, Math.max(24, s.def.size * 1.35));
      const hitPoint = new THREE.Vector3();
      if (this.ray.ray.intersectSphere(sphere, hitPoint)) {
        const d = hitPoint.distanceTo(this.camera.position);
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  }

  /** intersect the horizontal plane at the selection's mean altitude */
  pickPlane(x, y) {
    this.setRayFrom(x, y);
    const sel = this.cb.getSelection();
    let planeY = 0;
    if (sel.length) {
      planeY = sel.reduce((a, s) => a + s.pos.y, 0) / sel.length;
    }
    this.plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    const out = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(this.plane, out);
    return hit ? out : null;
  }
}
