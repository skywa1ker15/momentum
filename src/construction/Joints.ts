import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Physics6DoFConstraint } from "@babylonjs/core/Physics/v2/physicsConstraint";
import { PhysicsConstraintAxis, PhysicsConstraintMotorType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";

export type JointKind = "weld" | "hinge" | "ball" | "motor";
export const JOINT_KINDS: readonly JointKind[] = ["weld", "hinge", "ball", "motor"];

export interface Joint {
  id: number;
  kind: JointKind;
  a: SandboxObject;
  /** The other body: another sandbox object or static world geometry. */
  bBody: PhysicsBody;
  b: SandboxObject | null;
  constraint: Physics6DoFConstraint;
  /** Pivot in A's body frame, used to draw the joint marker and to rebuild the joint. */
  localPivotA: Vector3;
  /** Hinge / motor axis in A's body frame. */
  localAxisA: Vector3;
  /** Motor target, rad/s (motor joints only). */
  motorSpeed: number;
}

const LINEAR = [PhysicsConstraintAxis.LINEAR_X, PhysicsConstraintAxis.LINEAR_Y, PhysicsConstraintAxis.LINEAR_Z];
const ANGULAR = [PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintAxis.ANGULAR_Y, PhysicsConstraintAxis.ANGULAR_Z];

function bodyRotation(body: PhysicsBody): Quaternion {
  return body.transformNode.rotationQuaternion ?? Quaternion.FromEulerVector(body.transformNode.rotation);
}

function toLocalPoint(body: PhysicsBody, world: Vector3): Vector3 {
  const q = Quaternion.Inverse(bodyRotation(body));
  return world.subtract(body.transformNode.position).rotateByQuaternionToRef(q, new Vector3());
}

function toLocalDir(body: PhysicsBody, world: Vector3): Vector3 {
  return world.rotateByQuaternionToRef(Quaternion.Inverse(bodyRotation(body)), new Vector3()).normalize();
}

/** Any unit vector perpendicular to `v`. */
function perpendicular(v: Vector3): Vector3 {
  const ref = Math.abs(v.y) < 0.9 ? Vector3.Up() : Vector3.Right();
  return Vector3.Cross(v, ref).normalize();
}

/**
 * Havok constraints between objects (or between an object and the static world).
 *  weld  - all six degrees of freedom locked
 *  hinge - rotation about one axis only
 *  ball  - free rotation about a point
 *  motor - a hinge driven towards a target angular velocity with limited torque
 */
export class JointManager {
  readonly onChange: Array<() => void> = [];
  private readonly joints: Joint[] = [];
  private nextId = 1;

  constructor(
    private readonly scene: Scene,
    factory: ObjectFactory,
  ) {
    factory.onRemoved.push((o) => this.removeFor(o));
    // A rebuilt object (material change) has a new body: recreate its joints on the new body.
    factory.onRebuilt.push((o) => this.rebuildFor(o));
  }

  get all(): readonly Joint[] {
    return this.joints;
  }

  get atLimit(): boolean {
    return this.joints.length >= CONFIG.joints.maxJoints;
  }

  jointsOf(obj: SandboxObject): Joint[] {
    return this.joints.filter((j) => j.a === obj || j.b === obj);
  }

  /**
   * Joins `a` to `bBody` at the world-space `pivot`. `axis` (world space) is the hinge / motor axis.
   * Returns null at the joint limit or when both sides are the same body.
   */
  create(kind: JointKind, a: SandboxObject, bBody: PhysicsBody, b: SandboxObject | null, pivot: Vector3, axis: Vector3): Joint | null {
    if (this.atLimit || a.body === bBody) return null;
    const n = axis.lengthSquared() > 1e-6 ? axis.normalizeToNew() : Vector3.Up();
    const perp = perpendicular(n);
    const localPivotA = toLocalPoint(a.body, pivot);

    const constraint = new Physics6DoFConstraint(
      {
        pivotA: localPivotA,
        pivotB: toLocalPoint(bBody, pivot),
        axisA: toLocalDir(a.body, n),
        axisB: toLocalDir(bBody, n),
        perpAxisA: toLocalDir(a.body, perp),
        perpAxisB: toLocalDir(bBody, perp),
        collision: false,
      },
      [
        ...LINEAR.map((axis) => ({ axis, minLimit: 0, maxLimit: 0 })),
        // The constraint's X axis is the hinge axis. Weld locks it too; ball frees all three.
        ...ANGULAR.filter((ax) => (kind === "weld" ? true : kind === "ball" ? false : ax !== PhysicsConstraintAxis.ANGULAR_X)).map((axis) => ({ axis, minLimit: 0, maxLimit: 0 })),
      ],
      this.scene,
    );
    a.body.addConstraint(bBody, constraint);

    const joint: Joint = { id: this.nextId++, kind, a, bBody, b, constraint, localPivotA, localAxisA: toLocalDir(a.body, n), motorSpeed: 0 };
    this.joints.push(joint);
    if (kind === "motor") this.setMotorSpeed(joint, CONFIG.joints.defaultMotorSpeed);
    this.changed();
    return joint;
  }

  /** Target angular velocity for a motor joint, rad/s. */
  setMotorSpeed(joint: Joint, speed: number): void {
    if (joint.kind !== "motor") return;
    const s = Math.min(CONFIG.joints.maxMotorSpeed, Math.max(-CONFIG.joints.maxMotorSpeed, speed));
    joint.motorSpeed = s;
    const c = joint.constraint;
    c.setAxisMotorType(PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
    c.setAxisMotorTarget(PhysicsConstraintAxis.ANGULAR_X, s);
    c.setAxisMotorMaxForce(PhysicsConstraintAxis.ANGULAR_X, CONFIG.joints.motorMaxTorque);
    joint.a.body.applyImpulse(Vector3.ZeroReadOnly as Vector3, joint.a.mesh.position); // wake
  }

  /** World position of a joint's pivot (follows body A). */
  pivotWorld(joint: Joint, out: Vector3): Vector3 {
    return joint.localPivotA.rotateByQuaternionToRef(bodyRotation(joint.a.body), out).addInPlace(joint.a.mesh.position);
  }

  remove(joint: Joint): void {
    const i = this.joints.indexOf(joint);
    if (i === -1) return;
    this.joints.splice(i, 1);
    joint.constraint.dispose();
    this.changed();
  }

  /** Removes every joint touching the object. Returns how many were removed. */
  removeFor(obj: SandboxObject): number {
    const mine = this.jointsOf(obj);
    for (const j of mine) {
      this.joints.splice(this.joints.indexOf(j), 1);
      j.constraint.dispose();
    }
    if (mine.length) this.changed();
    return mine.length;
  }

  /** Recreates every joint touching `obj` at the same place, after the object's body was replaced. */
  private rebuildFor(obj: SandboxObject): void {
    for (const old of this.jointsOf(obj)) {
      const rot = bodyRotation(old.a.body);
      const pivot = old.localPivotA.rotateByQuaternionToRef(rot, new Vector3()).addInPlace(old.a.mesh.position);
      const axis = old.localAxisA.rotateByQuaternionToRef(rot, new Vector3());
      this.joints.splice(this.joints.indexOf(old), 1);
      old.constraint.dispose();
      const bBody = old.b ? old.b.body : old.bBody;
      const fresh = this.create(old.kind, old.a, bBody, old.b, pivot, axis);
      if (fresh && old.kind === "motor") this.setMotorSpeed(fresh, old.motorSpeed);
    }
    this.changed();
  }

  clear(): void {
    if (this.joints.length === 0) return;
    for (const j of this.joints) j.constraint.dispose();
    this.joints.length = 0;
    this.changed();
  }

  private changed(): void {
    for (const cb of this.onChange) cb();
  }
}
