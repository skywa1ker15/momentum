import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import { JOINT_KINDS, type Joint, type JointKind, type JointManager } from "../construction/Joints";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

export type LinkResult = { status: "first"; object: SandboxObject } | { status: "joined"; joint: Joint } | { status: "cancelled" } | { status: "none" } | { status: "limit" };

/**
 * Joins bodies in two clicks: first an object, then another object or the static world.
 * The joint is created at the second point clicked; hinge and motor axes follow the
 * surface normal there (an axle through that point, perpendicular to the surface).
 */
export class LinkTool {
  kindIndex = 0;
  /** First body picked, waiting for the second click. */
  pending: SandboxObject | null = null;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
    private readonly joints: JointManager,
  ) {
    const drop = (o: SandboxObject) => {
      if (this.pending === o) this.pending = null;
    };
    factory.onRemoved.push(drop);
    factory.onRebuilt.push(drop);
  }

  get kind(): JointKind {
    return JOINT_KINDS[this.kindIndex];
  }

  cycleKind(steps: number): void {
    const n = JOINT_KINDS.length;
    this.kindIndex = (((this.kindIndex + steps) % n) + n) % n;
  }

  cancel(): void {
    this.pending = null;
  }

  click(eye: Vector3, dir: Vector3): LinkResult {
    const hit = this.world.raycast(eye, eye.add(dir.scale(CONFIG.force.reach)));
    if (!hit) return { status: "none" };
    const obj = this.factory.fromBody(hit.body);
    if (!this.pending) {
      if (!obj) return { status: "none" };
      this.pending = obj;
      return { status: "first", object: obj };
    }
    const a = this.pending;
    this.pending = null;
    if (obj === a) return { status: "cancelled" };
    const joint = this.joints.create(this.kind, a, hit.body, obj, hit.point, hit.normal);
    return joint ? { status: "joined", joint } : { status: "limit" };
  }

  /** Cancels a pending link, or removes all joints on the aimed object. Returns the number removed. */
  removeAimed(eye: Vector3, dir: Vector3): number {
    if (this.pending) {
      this.pending = null;
      return 0;
    }
    const hit = this.world.raycast(eye, eye.add(dir.scale(CONFIG.force.reach)));
    const obj = hit ? this.factory.fromBody(hit.body) : null;
    return obj ? this.joints.removeFor(obj) : 0;
  }
}
