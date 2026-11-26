import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import { primitiveVolume, type ObjectFactory, type SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

/** A box of water. The surface is the top face. */
export interface WaterVolume {
  kind: "water";
  id: number;
  position: Vector3;
  halfExtents: Vector3;
  /** kg/m^3 */
  density: number;
}

const tmpM = new Matrix();

/** Half of the object's extent along world Y for its current orientation, m. */
export function verticalHalfExtent(obj: SandboxObject): number {
  if (obj.kind === "sphere") return obj.size.x / 2;
  (obj.mesh.rotationQuaternion ?? Quaternion.Identity()).toRotationMatrix(tmpM);
  const m = tmpM.m;
  // Second row of the rotation matrix: how much each local axis points along world Y.
  const ux = Math.abs(m[1]);
  const uy = Math.abs(m[5]);
  const uz = Math.abs(m[9]);
  if (obj.kind === "box") return (ux * obj.size.x + uy * obj.size.y + uz * obj.size.z) / 2;
  // cylinder: axis along local Y, plus the tilted disc
  return (uy * obj.size.y + Math.sqrt(Math.max(0, 1 - uy * uy)) * obj.size.x) / 2;
}

/** Fraction (0..1) of the object below the surface of `water`, from its vertical extent. */
export function submergedFraction(obj: SandboxObject, water: WaterVolume, center: Vector3): number {
  const h = water.halfExtents;
  const c = water.position;
  if (Math.abs(center.x - c.x) > h.x || Math.abs(center.z - c.z) > h.z) return 0;
  const half = verticalHalfExtent(obj);
  const bottom = center.y - half;
  const surface = c.y + h.y;
  const floor = c.y - h.y;
  if (bottom >= surface || center.y + half <= floor) return 0;
  return Math.min(1, (surface - bottom) / (2 * half));
}

/**
 * Water as a buoyancy and drag volume (simulated forces, applied through the engine):
 *   buoyancy  F = -rho_water * V_submerged * g          (Archimedes), applied at the centre of the submerged part
 *   drag      F = -1/2 * rho_water * Cd * A * |v| v     scaled by the submerged fraction
 * Whether an object floats therefore follows from its material density against 1000 kg/m^3.
 * This is not a free-flowing liquid: the water does not slosh, pour or get displaced.
 */
export class WaterVolumes {
  readonly onChange: Array<() => void> = [];
  /** Raised when an object enters the water: object, entry point on the surface, speed. */
  onSplash: ((obj: SandboxObject, point: Vector3, speed: number) => void) | null = null;

  private readonly volumes: WaterVolume[] = [];
  private readonly wet = new Set<number>();
  private nextId = 1;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
  ) {
    world.onBeforeStep.add((dt) => this.apply(dt));
    factory.onRemoved.push((o) => this.wet.delete(o.id));
  }

  get all(): readonly WaterVolume[] {
    return this.volumes;
  }

  get atLimit(): boolean {
    return this.volumes.length >= CONFIG.water.maxVolumes;
  }

  add(position: Vector3, halfExtents: Vector3 = new Vector3(...CONFIG.water.halfExtents), density: number = CONFIG.water.density): WaterVolume | null {
    if (this.atLimit) return null;
    const v: WaterVolume = { kind: "water", id: this.nextId++, position: position.clone(), halfExtents: halfExtents.clone(), density };
    this.volumes.push(v);
    this.changed();
    return v;
  }

  remove(volume: WaterVolume): void {
    const i = this.volumes.indexOf(volume);
    if (i === -1) return;
    this.volumes.splice(i, 1);
    this.changed();
  }

  clear(): void {
    if (this.volumes.length === 0) return;
    this.volumes.length = 0;
    this.wet.clear();
    this.changed();
  }

  /** Volume whose box the ray enters first, within `maxDistance`. */
  pick(origin: Vector3, dir: Vector3, maxDistance: number): WaterVolume | null {
    let best: WaterVolume | null = null;
    let bestT = maxDistance;
    for (const v of this.volumes) {
      let tMin = 0;
      let tMax = bestT;
      let hit = true;
      for (const k of ["x", "y", "z"] as const) {
        const lo = v.position[k] - v.halfExtents[k];
        const hi = v.position[k] + v.halfExtents[k];
        if (Math.abs(dir[k]) < 1e-9) {
          if (origin[k] < lo || origin[k] > hi) hit = false;
          continue;
        }
        const t1 = (lo - origin[k]) / dir[k];
        const t2 = (hi - origin[k]) / dir[k];
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (hit && tMin <= tMax && tMin < bestT) {
        best = v;
        bestT = tMin;
      }
    }
    return best;
  }

  private apply(dt: number): void {
    if (this.volumes.length === 0) return;
    const gravity = this.world.gravity;
    for (const obj of this.factory.all) {
      if (obj.props.isStatic) continue;
      const center = obj.body.getObjectCenterWorld();
      let wetNow = false;
      for (const water of this.volumes) {
        const fraction = submergedFraction(obj, water, center);
        if (fraction <= 0) continue;
        wetNow = true;
        const velocity = obj.body.getLinearVelocity();
        if (!this.wet.has(obj.id)) {
          this.onSplash?.(obj, new Vector3(center.x, water.position.y + water.halfExtents.y, center.z), velocity.length());
        }
        const volume = primitiveVolume(obj.kind, obj.size);
        const half = verticalHalfExtent(obj);

        // Buoyancy at the centre of the submerged slab: gives a righting torque when tilted or partly immersed.
        const buoyancy = gravity.scale(-water.density * volume * fraction);
        const depthCentre = center.y - half + fraction * half; // midpoint of the immersed height
        obj.body.applyForce(buoyancy, new Vector3(center.x, depthCentre, center.z));

        // Quadratic drag, limited so one step can never reverse the motion.
        const speed = velocity.length();
        if (speed > 1e-4) {
          const area = Math.cbrt(volume) ** 2;
          let drag = 0.5 * water.density * CONFIG.water.dragCoefficient * area * speed * speed * fraction;
          drag = Math.min(drag, (obj.props.mass * speed) / dt);
          obj.body.applyForce(velocity.scale(-drag / speed), center);
        }
        const spin = obj.body.getAngularVelocity();
        if (spin.lengthSquared() > 1e-8) {
          obj.body.setAngularVelocity(spin.scale(Math.max(0, 1 - CONFIG.water.angularDrag * fraction * dt)));
        }
      }
      if (wetNow) this.wet.add(obj.id);
      else this.wet.delete(obj.id);
    }
  }

  private changed(): void {
    this.factory.wakeAll();
    for (const cb of this.onChange) cb();
  }
}
