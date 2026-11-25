import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { CONFIG } from "../core/config";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

/**
 * Applies a continuous force, or a single impulse, at the point on the body under the crosshair.
 * Both go through the engine (applyForce / applyImpulse), so off-centre application produces torque.
 */
export class ForceTool {
  /** Index into CONFIG.force.magnitudes. */
  level: number = CONFIG.force.defaultLevel;
  /** Object currently being pushed by the continuous force, if any. */
  target: SandboxObject | null = null;

  private readonly localPoint = new Vector3();
  private readonly direction = new Vector3(0, 0, 1);

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
  ) {
    world.onBeforeStep.add(() => this.apply());
    factory.onRemoved.push((o) => {
      if (this.target === o) this.target = null;
    });
  }

  /** Force magnitude, N. */
  get force(): number {
    return CONFIG.force.magnitudes[this.level];
  }

  /** Impulse magnitude, N s: the selected force acting for CONFIG.force.impulseDuration seconds. */
  get impulse(): number {
    return this.force * CONFIG.force.impulseDuration;
  }

  adjustLevel(steps: number): void {
    this.level = Math.min(CONFIG.force.magnitudes.length - 1, Math.max(0, this.level + steps));
  }

  /** Starts a continuous force at the hit point. Returns false when nothing dynamic is under the crosshair. */
  begin(eye: Vector3, dir: Vector3): boolean {
    const hit = this.pick(eye, dir);
    if (!hit) return false;
    this.target = hit.obj;
    // Store the application point in the body's rotated frame so it stays attached as the body turns.
    const q = Quaternion.Inverse(hit.obj.mesh.rotationQuaternion ?? Quaternion.Identity());
    hit.point.subtract(hit.obj.mesh.position).rotateByQuaternionToRef(q, this.localPoint);
    this.direction.copyFrom(dir);
    return true;
  }

  setDirection(dir: Vector3): void {
    this.direction.copyFrom(dir);
  }

  end(): void {
    this.target = null;
  }

  /** Applies one impulse at the hit point. Returns the object hit. */
  strike(eye: Vector3, dir: Vector3): SandboxObject | null {
    const hit = this.pick(eye, dir);
    if (!hit) return null;
    hit.obj.body.applyImpulse(dir.scale(this.impulse), hit.point);
    return hit.obj;
  }

  /** World-space application point of the active force (for the vector overlay). */
  applicationPoint(): Vector3 | null {
    const obj = this.target;
    if (!obj) return null;
    const q = obj.mesh.rotationQuaternion ?? Quaternion.Identity();
    return this.localPoint.rotateByQuaternionToRef(q, new Vector3()).addInPlace(obj.mesh.position);
  }

  get forceDirection(): Vector3 {
    return this.direction;
  }

  private pick(eye: Vector3, dir: Vector3): { obj: SandboxObject; point: Vector3 } | null {
    const hit = this.world.raycast(eye, eye.add(dir.scale(CONFIG.force.reach)));
    if (!hit || hit.body.getMotionType() !== PhysicsMotionType.DYNAMIC) return null;
    const obj = this.factory.fromBody(hit.body);
    return obj ? { obj, point: hit.point } : null;
  }

  private apply(): void {
    const point = this.applicationPoint();
    if (!point || !this.target) return;
    this.target.body.applyForce(this.direction.scale(this.force), point);
  }
}
