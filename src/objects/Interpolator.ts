import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ObjectFactory, SandboxObject } from "./ObjectFactory";

interface Track {
  prevP: Vector3;
  prevQ: Quaternion;
  currP: Vector3;
  currQ: Quaternion;
  moving: boolean;
}

/**
 * Render interpolation for fixed-step physics (visual only).
 *
 * The simulation advances in fixed steps while frames arrive at any rate, so each frame
 * the meshes are drawn between the last two simulated states. Before the next step,
 * restore() puts every mesh back on its exact simulated transform, so game logic and
 * tools never read interpolated values.
 */
export class Interpolator {
  private readonly tracks = new Map<number, Track>();

  constructor(private readonly factory: ObjectFactory) {
    factory.onRemoved.push((o) => this.tracks.delete(o.id));
  }

  /** Call at the start of a frame: meshes back to their true simulated transforms. */
  restore(): void {
    for (const obj of this.factory.all) {
      const t = this.tracks.get(obj.id);
      if (!t?.moving) continue;
      obj.mesh.position.copyFrom(t.currP);
      obj.mesh.rotationQuaternion?.copyFrom(t.currQ);
    }
  }

  /** Call after every fixed step: records the new simulated state. */
  capture(): void {
    for (const obj of this.factory.all) {
      const q = obj.mesh.rotationQuaternion;
      if (!q) continue;
      const t = this.tracks.get(obj.id);
      if (!t) {
        this.tracks.set(obj.id, { prevP: obj.mesh.position.clone(), prevQ: q.clone(), currP: obj.mesh.position.clone(), currQ: q.clone(), moving: false });
        continue;
      }
      t.prevP.copyFrom(t.currP);
      t.prevQ.copyFrom(t.currQ);
      t.currP.copyFrom(obj.mesh.position);
      t.currQ.copyFrom(q);
      t.moving = !t.prevP.equalsWithEpsilon(t.currP, 1e-6) || !t.prevQ.equalsWithEpsilon(t.currQ, 1e-6);
    }
  }

  /** Call before rendering: draws each moving mesh `alpha` of the way from the previous state to the current one. */
  apply(alpha: number): void {
    if (alpha >= 1) return;
    for (const obj of this.factory.all) {
      const t = this.tracks.get(obj.id);
      if (!t?.moving) continue;
      Vector3.LerpToRef(t.prevP, t.currP, alpha, obj.mesh.position);
      if (obj.mesh.rotationQuaternion) Quaternion.SlerpToRef(t.prevQ, t.currQ, alpha, obj.mesh.rotationQuaternion);
    }
  }

  /** True simulated position of an object (its mesh may currently be drawn interpolated). */
  simulatedPosition(obj: SandboxObject): Vector3 {
    return this.tracks.get(obj.id)?.currP ?? obj.mesh.position;
  }
}
