import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import { MATERIALS } from "../materials/Materials";
import { primitiveVolume, type ObjectFactory, type SandboxObject } from "../objects/ObjectFactory";
import type { JointManager } from "../construction/Joints";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { fractureCells, seededRandom } from "./Fracture";

/** Contact impulses a body received during the current step. */
interface StepImpact {
  obj: SandboxObject;
  /** Vector sum of all contact impulses on the body, N s. */
  net: Vector3;
  /** Largest single contact, used as the impact point. */
  peak: number;
  point: Vector3 | null;
  hardness: number;
}

interface PendingFracture {
  obj: SandboxObject;
  /** Velocity change the impact imposed, m/s. */
  deltaV: number;
  point: Vector3 | null;
}

export interface DestructionStats {
  fractures: number;
  bondsBroken: number;
}

/**
 * Break threshold for an object hit by something of the given hardness, in m/s of
 * impact velocity change. Null when the object cannot break (material, size, generation, intensity off).
 */
export function breakThreshold(obj: SandboxObject, otherHardness: number, intensity: number): number | null {
  if (intensity <= 0) return null;
  const def = MATERIALS[obj.materialId];
  if (def.breakSpeed === null) return null;
  if (obj.generation >= CONFIG.destruction.maxGeneration) return null;
  if (primitiveVolume(obj.kind, obj.size) < CONFIG.destruction.minVolume) return null;
  const c = CONFIG.destruction;
  const hardness = otherHardness > def.hardness ? c.harderFactor : otherHardness < def.hardness ? c.softerFactor : 1;
  return (def.breakSpeed * hardness) / intensity;
}

/**
 * Impact-based destruction.
 *
 * Each step, the contact impulses the engine reports are summed as vectors per body and
 * converted to the velocity change they imposed (net impulse / mass). When that exceeds the material's impact strength the
 * object is replaced, after the step, by fragments that tile its volume: mass is
 * conserved, and each fragment starts with the parent's rigid-body velocity at its
 * position. A modelled, momentum-neutral scatter is added on top. Welded bonds break
 * the same way at a lower threshold, releasing pieces of a structure.
 */
export class DestructionSystem {
  readonly stats: DestructionStats = { fractures: 0, bondsBroken: 0 };
  onFracture: ((parent: SandboxObject, fragments: SandboxObject[], point: Vector3) => void) | null = null;
  /** Index into CONFIG.destruction.levels. */
  level: number = CONFIG.destruction.defaultLevel;

  private readonly pending = new Map<number, PendingFracture>();
  private readonly contacts = new Map<number, StepImpact>();
  private readonly lastDeltaVs = new Map<number, number>();
  private readonly rng: () => number;

  constructor(
    world: PhysicsWorld,
    private readonly factory: ObjectFactory,
    private readonly joints: JointManager,
    seed = 0x5eed,
  ) {
    this.rng = seededRandom(seed);
    world.onContact.add((ev) => {
      const a = this.factory.fromBody(ev.a);
      const b = this.factory.fromBody(ev.b);
      const w = CONFIG.destruction.worldHardness;
      if (!ev.normal) return;
      if (a) this.accumulate(a, ev.normal, -ev.impulse, ev.point, b ? MATERIALS[b.materialId].hardness : w);
      if (b) this.accumulate(b, ev.normal, ev.impulse, ev.point, a ? MATERIALS[a.materialId].hardness : w);
    });
    world.onAfterStep.add(() => this.process());
    factory.onRemoved.push((o) => {
      this.pending.delete(o.id);
      this.contacts.delete(o.id);
    });
  }

  get intensity(): number {
    return CONFIG.destruction.levels[this.level][1];
  }

  get levelName(): string {
    return CONFIG.destruction.levels[this.level][0];
  }

  setLevel(level: number): void {
    this.level = Math.min(CONFIG.destruction.levels.length - 1, Math.max(0, level));
  }

  /**
   * Adds one contact point's impulse to the body's net contact impulse for this step.
   *
   * The net (vector) impulse divided by mass is the velocity change the contacts imposed.
   * Summing vectors matters: a block resting in a stack is pushed up from below and down
   * from above, which cancels to its own weight x dt however heavy the load, whereas a
   * genuine impact leaves a large net impulse.
   */
  private accumulate(obj: SandboxObject, normal: Vector3, signedImpulse: number, point: Vector3 | null, hardness: number): void {
    let entry = this.contacts.get(obj.id);
    if (!entry) {
      entry = { obj, net: Vector3.Zero(), peak: 0, point, hardness };
      this.contacts.set(obj.id, entry);
    }
    entry.net.addInPlace(normal.scale(signedImpulse));
    entry.hardness = Math.max(entry.hardness, hardness);
    const magnitude = Math.abs(signedImpulse);
    if (magnitude > entry.peak) {
      entry.peak = magnitude;
      entry.point = point;
    }
  }

  /** Velocity change (m/s) that contacts imposed on the object in the last processed step. */
  lastDeltaV(obj: SandboxObject): number {
    return this.lastDeltaVs.get(obj.id) ?? 0;
  }

  /**
   * Reports one impact of `impulse` (N s) on an object: the step's summed contacts, or a
   * direct hit from a tool. Bonds break immediately; fracture is queued for process().
   */
  registerImpact(obj: SandboxObject, impulse: number, point: Vector3 | null, otherHardness: number = CONFIG.destruction.worldHardness): void {
    const intensity = this.intensity;
    if (intensity <= 0 || obj.props.isStatic) return;
    const deltaV = impulse / obj.props.mass;
    if (deltaV < 1) return; // resting and sliding contacts

    for (const joint of this.joints.jointsOf(obj)) {
      if (joint.breakSpeed !== null && deltaV > joint.breakSpeed / intensity) {
        this.joints.remove(joint);
        this.stats.bondsBroken++;
      }
    }

    const threshold = breakThreshold(obj, otherHardness, intensity);
    if (threshold === null || deltaV <= threshold) return;
    const queued = this.pending.get(obj.id);
    if (!queued || deltaV > queued.deltaV) this.pending.set(obj.id, { obj, deltaV, point: point?.clone() ?? null });
  }

  /** Judges the step's contacts, then fractures everything queued. */
  process(): void {
    this.lastDeltaVs.clear();
    if (this.contacts.size > 0) {
      const impacts = [...this.contacts.values()];
      this.contacts.clear();
      for (const c of impacts) {
        const impulse = c.net.length();
        this.lastDeltaVs.set(c.obj.id, impulse / c.obj.props.mass);
        this.registerImpact(c.obj, impulse, c.point, c.hardness);
      }
    }
    if (this.pending.size === 0) return;
    const queue = [...this.pending.values()];
    this.pending.clear();
    for (const p of queue) this.fracture(p);
  }

  private fracture({ obj, deltaV, point }: PendingFracture): void {
    const c = CONFIG.destruction;
    const volume = primitiveVolume(obj.kind, obj.size);
    // More pieces for bigger objects, harder hits and higher intensity.
    let pieces = Math.round(c.basePieces * Math.cbrt(volume / 0.2) * Math.sqrt(this.intensity) * (obj.generation === 0 ? 1 : 0.6));
    pieces = Math.min(c.maxPieces, Math.max(2, pieces));

    // Object budget: drop the oldest debris first, then settle for fewer pieces.
    let room = CONFIG.limits.maxObjects - (this.factory.count - 1);
    if (room < pieces) {
      for (const d of this.factory.debris()) {
        if (room >= pieces) break;
        if (d === obj) continue;
        this.factory.remove(d);
        room++;
      }
    }
    pieces = Math.min(pieces, room);
    if (pieces < 2) return;

    const rotation = obj.mesh.rotationQuaternion?.clone() ?? Quaternion.Identity();
    const origin = obj.mesh.position.clone();
    const linear = obj.body.getLinearVelocity();
    const angular = obj.body.getAngularVelocity();
    const impact = point ?? origin;
    const impactLocal = impact.subtract(origin).rotateByQuaternionToRef(Quaternion.Inverse(rotation), new Vector3());

    const cells = fractureCells(obj.kind, obj.size, pieces, impactLocal, this.rng, c.minEdge);
    const totalVolume = cells.reduce((sum, cell) => sum + cell.size.x * cell.size.y * cell.size.z, 0);
    const parentMass = obj.props.mass;
    const { materialId, generation, props } = obj;

    // Modelled scatter: outward from the impact point, strongest close to it, then made momentum-neutral.
    const offsets = cells.map((cell) => cell.center.rotateByQuaternionToRef(rotation, new Vector3()));
    const masses = cells.map((cell) => (parentMass * cell.size.x * cell.size.y * cell.size.z) / totalVolume);
    const reach = Math.max(obj.size.x, obj.size.y, obj.size.z);
    const scatter = offsets.map((offset) => {
      const away = origin.add(offset).subtractInPlace(impact);
      const dist = away.length();
      if (dist < 1e-4) return Vector3.Zero();
      return away.scaleInPlace((c.scatter * deltaV) / (dist * (1 + dist / reach)));
    });
    const drift = Vector3.Zero();
    scatter.forEach((s, i) => drift.addInPlace(s.scale(masses[i])));
    drift.scaleInPlace(1 / parentMass);

    this.factory.remove(obj);
    const fragments: SandboxObject[] = [];
    cells.forEach((cell, i) => {
      const velocity = linear.add(Vector3.Cross(angular, offsets[i])).addInPlace(scatter[i]).subtractInPlace(drift);
      const fragment = this.factory.spawn({
        kind: "box",
        size: cell.size.scale(0.97), // small gap so fragments do not start interpenetrating
        material: materialId,
        position: origin.add(offsets[i]),
        rotation,
        linearVelocity: velocity,
        generation: generation + 1,
        props: { mass: masses[i], linearDamping: props.linearDamping, angularDamping: props.angularDamping, gravityFactor: props.gravityFactor },
      });
      if (fragment) {
        fragment.body.setAngularVelocity(angular);
        fragments.push(fragment);
      }
    });
    this.stats.fractures++;
    this.onFracture?.(obj, fragments, impact);
  }
}
