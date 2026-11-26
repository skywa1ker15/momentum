import { Vector3 } from "@babylonjs/core/Maths/math.vector";

const DIP_STIFFNESS = 170;
const DIP_DAMPING = 2 * Math.sqrt(DIP_STIFFNESS) * 0.72;
/** Hard limit on the landing dip, metres. Well under eye height. */
const MAX_DIP = 0.22;


/**
 * Camera motion that is purely visual: the physics body never moves because of it.
 *
 * Three effects, all driven by the body's own state so they stay in step with what
 * the simulation is doing:
 *  - a walk cycle that bobs the eye up/down and side to side with the stride,
 *  - a dip and recovery when the body lands, scaled by how hard it hit,
 *  - a small roll into the direction of a strafe, like leaning into a turn.
 *
 * Everything is critically damped or sinusoidal, so there are no sudden jumps.
 */
export class ViewMotion {
  /** Master switch: off reproduces the old rigid camera exactly. */
  enabled = true;

  /** Metres of vertical travel at walking pace (doubles at a sprint). */
  bobAmplitude = 0.035;
  /** Strides per second at walking pace. */
  bobFrequency = 1.95;
  /** Radians of roll at full sideways input. */
  rollAmount = 0.028;

  /** Current eye offset in view space: x = right, y = up, z = forward. */
  readonly offset = new Vector3();
  /** Current roll about the view axis, radians. */
  roll = 0;

  private phase = 0;
  /** Downward dip from a landing, metres (positive = eye lowered), and its velocity. */
  private dip = 0;
  private dipVelocity = 0;
  private rollTarget = 0;
  private wasGrounded = true;
  private lastFallSpeed = 0;

  /**
   * @param dt           real seconds since the last frame
   * @param planarSpeed  horizontal speed of the body, m/s
   * @param verticalSpeed signed vertical speed of the body, m/s (negative = falling)
   * @param grounded     is the body supported this frame
   * @param strafe       -1..1 sideways input
   * @param sprinting    is the body sprinting
   */
  update(dt: number, planarSpeed: number, verticalSpeed: number, grounded: boolean, strafe: number, sprinting: boolean): void {
    if (!this.enabled) {
      this.offset.setAll(0);
      this.roll = 0;
      this.phase = 0;
      this.dip = 0;
      this.dipVelocity = 0;
      return;
    }
    dt = Math.min(Math.max(dt, 0), 0.1);

    // Remember how fast we were falling: on the landing frame the velocity has already been cancelled.
    if (!grounded && verticalSpeed < 0) this.lastFallSpeed = -verticalSpeed;

    // --- landing dip: a spring that is kicked on touchdown ------------------
    if (grounded && !this.wasGrounded) {
      const impact = Math.min(1, this.lastFallSpeed / 9);
      this.dipVelocity += 0.16 + 0.5 * impact;
    }
    if (grounded) this.lastFallSpeed = 0;
    this.wasGrounded = grounded;
    // Stiff spring, close to critically damped: a quick give and a smooth return.
    // Integrated in small fixed sub-steps: this spring's period is ~0.5 s, and a single
    // explicit step at a long frame time (a 10 FPS frame, say) would diverge instead of
    // settling. Sub-stepping keeps it stable at any frame rate, and the clamp below is a
    // last line of defence so a bad number can never throw the camera out of the head.
    const sub = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(sub, remaining);
      remaining -= h;
      this.dipVelocity += (-DIP_STIFFNESS * this.dip - DIP_DAMPING * this.dipVelocity) * h;
      this.dip += this.dipVelocity * h;
    }
    this.dip = Math.min(MAX_DIP, Math.max(-MAX_DIP, this.dip));
    if (!Number.isFinite(this.dip)) {
      this.dip = 0;
      this.dipVelocity = 0;
    }

    // --- walk cycle ---------------------------------------------------------
    // Advance the phase with distance travelled, so the bob matches the stride rather than the clock.
    const walkFraction = Math.min(1, planarSpeed / 4.2);
    const moving = grounded && walkFraction > 0.08;
    if (moving) this.phase = (this.phase + dt * this.bobFrequency * (sprinting ? 1.35 : 1) * Math.PI * 2 * walkFraction) % (Math.PI * 2);
    // Ease the bob in and out so starting and stopping does not snap.
    const weight = this.approach(this.bobWeight, moving ? walkFraction : 0, dt, moving ? 7 : 5);
    this.bobWeight = weight;
    const amp = this.bobAmplitude * (sprinting ? 1.7 : 1) * weight;
    // The vertical bob runs at twice the stride rate (one dip per footfall), the lateral sway once.
    this.offset.y = -Math.abs(Math.sin(this.phase)) * amp - this.dip;
    this.offset.x = Math.sin(this.phase * 0.5) * amp * 0.85;
    this.offset.z = 0;

    // --- strafe roll --------------------------------------------------------
    this.rollTarget = grounded ? -strafe * this.rollAmount * walkFraction : 0;
    this.roll = this.approach(this.roll, this.rollTarget, dt, 6);
  }

  private bobWeight = 0;

  /** Exponential approach: frame-rate independent and never overshoots. */
  private approach(current: number, target: number, dt: number, rate: number): number {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
  }
}
