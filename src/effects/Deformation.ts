import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MATERIALS } from "../materials/Materials";
import { meshScaling, type ObjectFactory, type SandboxObject } from "../objects/ObjectFactory";

interface Squash {
  obj: SandboxObject;
  /** Local axis being compressed. */
  axis: "x" | "y" | "z";
  /** Compression, 0..MAX (fraction of the length along the axis). */
  amount: number;
  /** Rate of change of `amount`, 1/s. */
  rate: number;
}

const MAX_SQUASH = 0.45;
/** Spring that brings the shape back: natural frequency (rad/s) and damping ratio. */
const OMEGA = 34;
const ZETA = 0.28;

/** Compression produced by an impact of `deltaV` (m/s) on a material with the given squash factor. */
export function squashAmount(squashFactor: number, deltaV: number): number {
  return Math.min(MAX_SQUASH, (squashFactor * deltaV) / 16);
}

/**
 * VISUAL deformation: soft materials (rubber, elastic, plastic) squash along the impact
 * direction and spring back. Only the drawn mesh is scaled, keeping its volume; the
 * collision shape and the simulation are unchanged. The size of the squash comes from the
 * measured impact (velocity change), so harder hits deform more.
 */
export class Deformation {
  private readonly active = new Map<number, Squash>();

  constructor(factory: ObjectFactory) {
    factory.onRemoved.push((o) => this.active.delete(o.id));
    factory.onRebuilt.push((o) => this.active.delete(o.id));
  }

  get count(): number {
    return this.active.size;
  }

  /** Report an impact on an object. `direction` is the world-space direction of the net impulse. */
  impact(obj: SandboxObject, deltaV: number, direction: Vector3): void {
    const factor = MATERIALS[obj.materialId].squash;
    if (factor <= 0) return;
    const amount = squashAmount(factor, deltaV);
    if (amount < 0.01) return;
    // Local axis closest to the impact direction
    const local = direction.rotateByQuaternionToRef(Quaternion.Inverse(obj.mesh.rotationQuaternion ?? Quaternion.Identity()), new Vector3());
    const ax = Math.abs(local.x);
    const ay = Math.abs(local.y);
    const az = Math.abs(local.z);
    const axis = ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
    const current = this.active.get(obj.id);
    if (current && current.amount >= amount) return;
    this.active.set(obj.id, { obj, axis, amount, rate: 0 });
  }

  /** Advance the recovery springs and apply the squash to the meshes. */
  update(dt: number): void {
    if (this.active.size === 0 || dt <= 0) return;
    const step = Math.min(dt, 1 / 30);
    for (const [id, s] of this.active) {
      // Damped spring towards zero compression (semi-implicit Euler)
      s.rate += (-OMEGA * OMEGA * s.amount - 2 * ZETA * OMEGA * s.rate) * step;
      s.amount += s.rate * step;
      const base = meshScaling(s.obj.kind, s.obj.size);
      if (Math.abs(s.amount) < 0.004 && Math.abs(s.rate) < 0.15) {
        s.obj.mesh.scaling.copyFrom(base);
        this.active.delete(id);
        continue;
      }
      // Compress along the axis and widen the other two so the volume stays the same.
      const along = 1 - Math.max(-MAX_SQUASH, Math.min(MAX_SQUASH, s.amount));
      const across = 1 / Math.sqrt(along);
      base.x *= s.axis === "x" ? along : across;
      base.y *= s.axis === "y" ? along : across;
      base.z *= s.axis === "z" ? along : across;
      s.obj.mesh.scaling.copyFrom(base);
    }
  }
}
