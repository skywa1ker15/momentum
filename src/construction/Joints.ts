import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Physics6DoFConstraint } from "@babylonjs/core/Physics/v2/physicsConstraint";
import { PhysicsConstraintAxis, PhysicsConstraintMotorType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";
import { MATERIALS } from "../materials/Materials";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";

export type JointKind = "weld" | "hinge" | "ball" | "motor" | "slider" | "spring";
export const JOINT_KINDS: readonly JointKind[] = ["weld", "hinge", "ball", "motor", "slider", "spring"];

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
  /** Pivot in B's body frame. Equals the same world point as localPivotA except for springs, whose two ends differ. */
  localPivotB: Vector3;
  /** Springs only: rest length (m) and stiffness (N/m). */
  spring: { restLength: number; stiffness: number; damping: number } | null;
  /** Hinge / motor axis in A's body frame. */
  localAxisA: Vector3;
  /** Motor target, rad/s (motor joints only). */
  motorSpeed: number;
  /** Welds only: the bond breaks when an impact changes either body's velocity by more than this (m/s). Null = unbreakable. */
  breakSpeed: number | null;
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

/** Strength of a welded bond: a fraction of the weaker breakable material's impact strength. */
export function bondStrength(a: SandboxObject, b: SandboxObject | null): number | null {
  const sa = MATERIALS[a.materialId].breakSpeed;
  const sb = b ? MATERIALS[b.materialId].breakSpeed : null;
  const weakest = sa === null ? sb : sb === null ? sa : Math.min(sa, sb);
  return weakest === null ? null : weakest * CONFIG.destruction.bondFactor;
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
 *  slider - translation along one axis only, within a travel limit (a piston)
 *  spring - a damped spring holding two points at their original distance
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
   * Joins `a` to `bBody` at the world-space `pivot`. `axis` (world space) is the hinge, motor or
   * slider axis. For a spring, `anchorA` is the end on `a` and `pivot` the end on `bBody`.
   * Returns null at the joint limit or when both sides are the same body.
   */
  create(kind: JointKind, a: SandboxObject, bBody: PhysicsBody, b: SandboxObject | null, pivot: Vector3, axis: Vector3, anchorA: Vector3 = pivot): Joint | null {
    if (this.atLimit || a.body === bBody) return null;
    const n = axis.lengthSquared() > 1e-6 ? axis.normalizeToNew() : Vector3.Up();
    const perp = perpendicular(n);
    const pointA = kind === "spring" ? anchorA : pivot;
    const localPivotA = toLocalPoint(a.body, pointA);
    const localPivotB = toLocalPoint(bBody, pivot);

    let limits: Array<{ axis: PhysicsConstraintAxis; minLimit?: number; maxLimit?: number; stiffness?: number; damping?: number }>;
    let spring: Joint["spring"] = null;
    if (kind === "spring") {
      const restLength = Math.max(0.05, Vector3.Distance(pointA, pivot));
      // Tuned to the lighter side: natural frequency and damping ratio from config.
      const mass = b ? Math.min(a.props.mass, b.props.mass) : a.props.mass;
      const omega = 2 * Math.PI * CONFIG.joints.springFrequency;
      const stiffness = mass * omega * omega;
      const damping = 2 * CONFIG.joints.springDampingRatio * Math.sqrt(stiffness * mass) * CONFIG.joints.springDampingScale;
      spring = { restLength, stiffness, damping };
      limits = [{ axis: PhysicsConstraintAxis.LINEAR_DISTANCE, minLimit: restLength, maxLimit: restLength, stiffness, damping }];
    } else if (kind === "slider") {
      const travel = CONFIG.joints.sliderTravel;
      limits = [
        { axis: PhysicsConstraintAxis.LINEAR_X, minLimit: -travel, maxLimit: travel },
        { axis: PhysicsConstraintAxis.LINEAR_Y, minLimit: 0, maxLimit: 0 },
        { axis: PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
        ...ANGULAR.map((ax) => ({ axis: ax, minLimit: 0, maxLimit: 0 })),
      ];
    } else {
      limits = [
        ...LINEAR.map((ax) => ({ axis: ax, minLimit: 0, maxLimit: 0 })),
        // The constraint's X axis is the hinge axis. Weld locks it too; ball frees all three.
        ...ANGULAR.filter((ax) => (kind === "weld" ? true : kind === "ball" ? false : ax !== PhysicsConstraintAxis.ANGULAR_X)).map((ax) => ({ axis: ax, minLimit: 0, maxLimit: 0 })),
      ];
    }

    const constraint = new Physics6DoFConstraint(
      {
        pivotA: localPivotA,
        pivotB: localPivotB,
        axisA: toLocalDir(a.body, n),
        axisB: toLocalDir(bBody, n),
        perpAxisA: toLocalDir(a.body, perp),
        perpAxisB: toLocalDir(bBody, perp),
        // Springs leave their bodies free to collide; rigid joints would fight their own contact.
        collision: kind === "spring",
      },
      limits,
      this.scene,
    );
    a.body.addConstraint(bBody, constraint);

    const joint: Joint = {
      id: this.nextId++,
      kind,
      a,
      bBody,
      b,
      constraint,
      localPivotA,
      localPivotB,
      spring,
      localAxisA: toLocalDir(a.body, n),
      motorSpeed: 0,
      breakSpeed: kind === "weld" ? bondStrength(a, b) : null,
    };
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

  /** World position of the joint's end on body B (differs from the pivot on A only for springs). */
  pivotWorldB(joint: Joint, out: Vector3): Vector3 {
    return joint.localPivotB.rotateByQuaternionToRef(bodyRotation(joint.bBody), out).addInPlace(joint.bBody.transformNode.position);
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
      const anchorA = old.localPivotA.rotateByQuaternionToRef(rot, new Vector3()).addInPlace(old.a.mesh.position);
      const axis = old.localAxisA.rotateByQuaternionToRef(rot, new Vector3());
      this.joints.splice(this.joints.indexOf(old), 1);
      old.constraint.dispose();
      const bBody = old.b ? old.b.body : old.bBody;
      // The rebuilt side keeps its transform, so B's stored local pivot still maps to the right world point.
      const pivot = old.kind === "spring" ? old.localPivotB.rotateByQuaternionToRef(bodyRotation(bBody), new Vector3()).addInPlace(bBody.transformNode.position) : anchorA;
      const fresh = this.create(old.kind, old.a, bBody, old.b, pivot, axis, anchorA);
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
