import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import type { ObjectFactory } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

export type FieldKind = "attractor" | "repulsor" | "zone";
export const FIELD_KINDS: readonly FieldKind[] = ["attractor", "repulsor", "zone"];

interface FieldBase {
  id: number;
  position: Vector3;
}

/** Inverse-square point field. Acceleration a = mu / r^2 towards (mu > 0) or away from (mu < 0) the centre. */
export interface PointField extends FieldBase {
  kind: "attractor" | "repulsor";
  /** m^3/s^2. Sign gives direction. */
  mu: number;
  /** Bodies further than this are unaffected (m). */
  radius: number;
}

/** Axis-aligned box in which gravity is replaced by `gravity`. */
export interface ZoneField extends FieldBase {
  kind: "zone";
  halfExtents: Vector3;
  /** m/s^2 */
  gravity: Vector3;
}

export type GravityField = PointField | ZoneField;

/** Acceleration of an inverse-square point field at `point`. Distance is clamped so the centre is not singular. */
export function pointFieldAcceleration(field: PointField, point: Vector3, out: Vector3): Vector3 {
  field.position.subtractToRef(point, out);
  const r = out.length();
  if (r > field.radius || r < 1e-6) return out.setAll(0);
  const rc = Math.max(r, CONFIG.fields.minDistance);
  return out.scaleInPlace(field.mu / (rc * rc * r));
}

export function zoneContains(zone: ZoneField, p: Vector3): boolean {
  const h = zone.halfExtents;
  const c = zone.position;
  return Math.abs(p.x - c.x) <= h.x && Math.abs(p.y - c.y) <= h.y && Math.abs(p.z - c.z) <= h.z;
}

/**
 * Local gravity fields. Each physics step every dynamic object receives the summed
 * field force F = m * a through the engine (applyForce at the centre of mass).
 * Inside a zone, the object's share of world gravity is cancelled and replaced by
 * the zone's gravity. The player is not affected by fields.
 */
export class GravityFields {
  readonly onChange: Array<() => void> = [];
  private readonly fields: GravityField[] = [];
  private nextId = 1;
  private readonly acc = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
  ) {
    world.onBeforeStep.add(() => this.apply());
  }

  get all(): readonly GravityField[] {
    return this.fields;
  }

  get atLimit(): boolean {
    return this.fields.length >= CONFIG.fields.maxFields;
  }

  addPoint(kind: "attractor" | "repulsor", position: Vector3, strength: number = CONFIG.fields.defaultMu, radius: number = CONFIG.fields.radius): PointField | null {
    if (this.atLimit) return null;
    const field: PointField = { id: this.nextId++, kind, position: position.clone(), mu: kind === "attractor" ? Math.abs(strength) : -Math.abs(strength), radius };
    this.fields.push(field);
    this.changed();
    return field;
  }

  addZone(position: Vector3, gravity: Vector3, halfExtents: Vector3 = new Vector3(...CONFIG.fields.zoneHalfExtents)): ZoneField | null {
    if (this.atLimit) return null;
    const field: ZoneField = { id: this.nextId++, kind: "zone", position: position.clone(), gravity: gravity.clone(), halfExtents: halfExtents.clone() };
    this.fields.push(field);
    this.changed();
    return field;
  }

  remove(field: GravityField): void {
    const i = this.fields.indexOf(field);
    if (i === -1) return;
    this.fields.splice(i, 1);
    this.changed();
  }

  clear(): void {
    if (this.fields.length === 0) return;
    this.fields.length = 0;
    this.changed();
  }

  /** Field whose centre lies closest to the ray, within `tolerance` metres of it. */
  pick(origin: Vector3, dir: Vector3, maxDistance: number, tolerance = 0.6): GravityField | null {
    let best: GravityField | null = null;
    let bestT = Infinity;
    for (const f of this.fields) {
      const t = Vector3.Dot(f.position.subtract(origin), dir);
      if (t < 0 || t > maxDistance) continue;
      const closest = origin.add(dir.scale(t));
      if (Vector3.Distance(closest, f.position) <= tolerance && t < bestT) {
        best = f;
        bestT = t;
      }
    }
    return best;
  }

  /** Net field acceleration at a point for a body with the given gravity factor (world gravity itself excluded). */
  accelerationAt(point: Vector3, gravityFactor: number, out: Vector3): Vector3 {
    out.setAll(0);
    for (const f of this.fields) {
      if (f.kind === "zone") {
        if (!zoneContains(f, point)) continue;
        // Replace world gravity: add the zone's gravity and cancel what the engine applies.
        out.addInPlace(f.gravity).subtractInPlace(this.world.gravity.scale(gravityFactor));
      } else {
        out.addInPlace(pointFieldAcceleration(f, point, this.tmp));
      }
    }
    return out;
  }

  private apply(): void {
    if (this.fields.length === 0) return;
    for (const obj of this.factory.all) {
      if (obj.props.isStatic) continue;
      const com = obj.body.getObjectCenterWorld();
      this.accelerationAt(com, obj.props.gravityFactor, this.acc);
      if (this.acc.lengthSquared() < 1e-8) continue;
      obj.body.applyForce(this.acc.scaleInPlace(obj.props.mass), com);
    }
  }

  private changed(): void {
    this.factory.wakeAll();
    for (const cb of this.onChange) cb();
  }
}
