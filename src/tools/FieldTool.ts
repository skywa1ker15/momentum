import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import { FIELD_KINDS, type FieldKind, type GravityField, type GravityFields } from "../fields/GravityFields";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

const PLACE_REACH = 14;
const FREE_DISTANCE = 5;

/** Snaps a direction to the nearest world axis. */
export function nearestAxis(dir: Vector3): Vector3 {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ay >= ax && ay >= az) return new Vector3(0, Math.sign(dir.y), 0);
  return ax >= az ? new Vector3(Math.sign(dir.x), 0, 0) : new Vector3(0, 0, Math.sign(dir.z));
}

/** Places and removes gravity fields. */
export class FieldTool {
  kindIndex = 0;
  strengthIndex: number = CONFIG.fields.strengths.indexOf(CONFIG.fields.defaultMu);

  constructor(
    private readonly world: PhysicsWorld,
    private readonly fields: GravityFields,
  ) {}

  get kind(): FieldKind {
    return FIELD_KINDS[this.kindIndex];
  }

  /** Point-field strength, m^3/s^2. */
  get strength(): number {
    return CONFIG.fields.strengths[this.strengthIndex];
  }

  cycleKind(steps: number): void {
    const n = FIELD_KINDS.length;
    this.kindIndex = (((this.kindIndex + steps) % n) + n) % n;
  }

  cycleStrength(): void {
    this.strengthIndex = (this.strengthIndex + 1) % CONFIG.fields.strengths.length;
  }

  /**
   * Places the selected field where the player is aiming: one metre off the surface hit,
   * or a few metres ahead in free space. A zone's gravity points along the view direction,
   * snapped to the nearest world axis. Returns null at the field limit.
   */
  place(eye: Vector3, dir: Vector3): GravityField | null {
    const hit = this.world.raycast(eye, eye.add(dir.scale(PLACE_REACH)));
    const point = hit ? hit.point.add(hit.normal.scale(1)) : eye.add(dir.scale(FREE_DISTANCE));
    if (this.kind === "zone") {
      const half = new Vector3(...CONFIG.fields.zoneHalfExtents);
      const base = hit ? hit.point : point;
      // Sit the box on the surface that was hit (or centre it in free space).
      const center = hit ? base.add(hit.normal.scale(Math.abs(Vector3.Dot(hit.normal, half)))) : base;
      return this.fields.addZone(center, nearestAxis(dir).scale(CONFIG.fields.zoneGravity), half);
    }
    return this.fields.addPoint(this.kind, point, this.strength);
  }

  /** Removes the field whose marker is under the crosshair. */
  removeAimed(eye: Vector3, dir: Vector3): boolean {
    const f = this.fields.pick(eye, dir, 40, 0.7);
    if (!f) return false;
    this.fields.remove(f);
    return true;
  }
}
