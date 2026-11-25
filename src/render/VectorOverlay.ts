import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const HEAD = 0.18;

/** One arrow drawn as line segments (shaft + four head strokes). Visual aid only. */
class Arrow {
  private mesh: LinesMesh;
  private readonly lines: Vector3[][] = Array.from({ length: 5 }, () => [new Vector3(), new Vector3()]);

  constructor(name: string, color: Color3, scene: Scene) {
    this.mesh = CreateLineSystem(name, { lines: this.lines, updatable: true }, scene);
    this.mesh.color = color;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.setEnabled(false);
  }

  hide(): void {
    if (this.mesh.isEnabled()) this.mesh.setEnabled(false);
  }

  /** Draws from `origin` along `vector` (already scaled to metres). Hidden when too short to read. */
  show(origin: Vector3, vector: Vector3): void {
    const len = vector.length();
    if (len < 0.05) {
      this.hide();
      return;
    }
    const tip = origin.add(vector);
    const dir = vector.scale(1 / len);
    const side = Math.abs(dir.y) > 0.95 ? Vector3.Cross(dir, Vector3.Right()) : Vector3.Cross(dir, Vector3.Up());
    side.normalize();
    const up = Vector3.Cross(dir, side);
    const head = Math.min(HEAD, len * 0.4);
    const back = tip.subtract(dir.scale(head));
    this.lines[0][0].copyFrom(origin);
    this.lines[0][1].copyFrom(tip);
    [side, side.scale(-1), up, up.scale(-1)].forEach((offset, i) => {
      this.lines[i + 1][0].copyFrom(tip);
      back.addToRef(offset.scale(head * 0.5), this.lines[i + 1][1]);
    });
    this.mesh = CreateLineSystem(this.mesh.name, { lines: this.lines, instance: this.mesh });
    if (!this.mesh.isEnabled()) this.mesh.setEnabled(true);
  }
}

/**
 * Scientific-visualisation overlay: velocity of the selected object and the force being applied.
 * Purely visual; the values it draws come from the physics engine.
 */
export class VectorOverlay {
  /** Metres drawn per m/s of velocity. */
  static readonly VELOCITY_SCALE = 0.25;
  static readonly MAX_LENGTH = 4;

  private readonly velocity: Arrow;
  private readonly force: Arrow;

  constructor(scene: Scene) {
    this.velocity = new Arrow("overlay-velocity", new Color3(0.35, 0.85, 1), scene);
    this.force = new Arrow("overlay-force", new Color3(1, 0.69, 0.34), scene);
  }

  setVelocity(origin: Vector3 | null, velocity?: Vector3): void {
    if (!origin || !velocity) return this.velocity.hide();
    const v = velocity.scale(VectorOverlay.VELOCITY_SCALE);
    const len = v.length();
    if (len > VectorOverlay.MAX_LENGTH) v.scaleInPlace(VectorOverlay.MAX_LENGTH / len);
    this.velocity.show(origin, v);
  }

  /** `fraction` is the force as a 0..1 share of the tool's maximum, used for the arrow length. */
  setForce(point: Vector3 | null, direction?: Vector3, fraction = 1): void {
    if (!point || !direction) return this.force.hide();
    // The arrow ends at the application point, like a push.
    const v = direction.scale(0.6 + 1.9 * fraction);
    this.force.show(point.subtract(v), v);
  }
}
