import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { CONFIG } from "../core/config";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

/** Impulse (N s) for a throw: enough for throwSpeed, capped so heavy objects are thrown more slowly. */
export function throwImpulse(mass: number): number {
  return Math.min(CONFIG.interaction.throwImpulse, mass * CONFIG.interaction.throwSpeed);
}

/**
 * Grab / carry / throw / push.
 * A held body stays fully dynamic: each step its velocity is driven towards the
 * hold point, so it still collides with and pushes other bodies. Heavy bodies
 * lag behind in proportion to their mass. Throwing applies a real impulse sized
 * for a fixed throw speed, capped so heavy objects leave more slowly.
 */
export class GrabTool {
  held: SandboxObject | null = null;
  holdDistance: number = CONFIG.interaction.holdDistance;

  private readonly holdPoint = new Vector3();
  /** Angular velocity requested for the held object this step (rad/s), or null to damp its spin. */
  private spin: Vector3 | null = null;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
  ) {
    world.onBeforeStep.add(() => this.drive());
    const drop = (o: SandboxObject) => {
      if (this.held === o) this.held = null;
    };
    factory.onRemoved.push(drop);
    factory.onRebuilt.push(drop);
  }

  /** Object under the crosshair within reach, if any. */
  target(eye: Vector3, dir: Vector3): SandboxObject | null {
    const hit = this.world.raycast(eye, eye.add(dir.scale(CONFIG.interaction.reach)));
    if (!hit) return null;
    if (hit.body.getMotionType() !== PhysicsMotionType.DYNAMIC) return null;
    return this.factory.fromBody(hit.body);
  }

  tryGrab(eye: Vector3, dir: Vector3): boolean {
    const obj = this.target(eye, dir);
    if (!obj) return false;
    this.held = obj;
    const c = CONFIG.interaction;
    this.holdDistance = Math.min(c.holdDistanceMax, Math.max(c.holdDistanceMin, Vector3.Distance(eye, obj.mesh.position)));
    this.setHoldPoint(eye, dir);
    return true;
  }

  release(): void {
    this.held = null;
  }

  adjustDistance(steps: number): void {
    const c = CONFIG.interaction;
    this.holdDistance = Math.min(c.holdDistanceMax, Math.max(c.holdDistanceMin, this.holdDistance - steps * 0.35));
  }

  /** Turns the held object: the engine is asked for this angular velocity (world space, rad/s) on the next step. */
  rotate(angularVelocity: Vector3): void {
    if (this.held) this.spin = angularVelocity.clone();
  }

  /** Call every frame while holding so the hold point follows the view. */
  setHoldPoint(eye: Vector3, dir: Vector3): void {
    eye.addToRef(dir.scale(this.holdDistance), this.holdPoint);
  }

  /** Throws the held object, or pushes the targeted one. Returns the object affected. */
  throwOrPush(eye: Vector3, dir: Vector3): SandboxObject | null {
    const obj = this.held ?? this.target(eye, dir);
    if (!obj) return null;
    this.held = null;
    obj.body.applyImpulse(dir.scale(throwImpulse(obj.props.mass)), obj.body.getObjectCenterWorld());
    return obj;
  }

  private drive(): void {
    const obj = this.held;
    if (!obj) return;
    const c = CONFIG.interaction;
    const toTarget = this.holdPoint.subtract(obj.body.getObjectCenterWorld());
    const strength = Math.min(1, c.carryStrengthMass / obj.props.mass);
    const vel = toTarget.scale(c.holdStiffness * strength);
    const speed = vel.length();
    if (speed > c.holdMaxSpeed) vel.scaleInPlace(c.holdMaxSpeed / speed);
    obj.body.setLinearVelocity(vel);
    obj.body.setAngularVelocity(this.spin ?? obj.body.getAngularVelocity().scale(0.8));
    this.spin = null;
  }
}
