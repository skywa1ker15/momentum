import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { GravityField, GravityFields, PointField, ZoneField } from "../fields/GravityFields";
import type { JointManager } from "../construction/Joints";
import type { WaterVolume, WaterVolumes } from "../fluids/WaterVolumes";
import type { MaterialLibrary } from "./MaterialLibrary";

const ATTRACT = new Color3(0.35, 0.85, 1);
const REPEL = new Color3(1, 0.62, 0.25);
const ZONE = new Color3(0.68, 0.5, 1);

function circle(center: Vector3, radius: number, axis: 0 | 1 | 2, segments = 48): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    pts.push(center.add(axis === 0 ? new Vector3(0, c, s) : axis === 1 ? new Vector3(c, 0, s) : new Vector3(c, s, 0)));
  }
  return pts;
}

/**
 * Markers for gravity fields and joints. Visual only: they show where the simulated
 * fields and constraints are, and are rebuilt whenever those change.
 */
export class FieldVisuals {
  private meshes: AbstractMesh[] = [];
  private readonly zoneMaterial: StandardMaterial;
  private readonly waterMaterial: StandardMaterial;
  private readonly surfaceMaterial: StandardMaterial;
  private waterMeshes: AbstractMesh[] = [];
  private readonly tmpB = new Vector3();
  private readonly coolMarker: StandardMaterial;
  private readonly warmMarker: StandardMaterial;
  private readonly jointMarkers: AbstractMesh[] = [];
  private readonly jointSource;
  private readonly motorSource;
  private readonly tmp = new Vector3();
  /** Cable drawn from a joint's pivot to its body when the pivot is far from the body (pendulums). Index-aligned with joints. */
  private readonly cables: (AbstractMesh | null)[] = [];
  private readonly cableSource;

  constructor(
    private readonly scene: Scene,
    private readonly fields: GravityFields,
    private readonly joints: JointManager,
    _materials: MaterialLibrary,
    private readonly water?: WaterVolumes,
  ) {
    this.waterMaterial = new StandardMaterial("mat-water-volume", scene);
    this.waterMaterial.emissiveColor = new Color3(0.12, 0.38, 0.62);
    this.waterMaterial.disableLighting = true;
    this.waterMaterial.alpha = 0.22;
    this.waterMaterial.backFaceCulling = false;
    this.surfaceMaterial = new StandardMaterial("mat-water-surface", scene);
    this.surfaceMaterial.emissiveColor = new Color3(0.3, 0.62, 0.85);
    this.surfaceMaterial.disableLighting = true;
    this.surfaceMaterial.alpha = 0.3;
    this.surfaceMaterial.backFaceCulling = false;
    water?.onChange.push(() => this.rebuildWater());
    // Marker colours stay under the bloom threshold so markers read as indicators, not light sources.
    const marker = (name: string, color: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.emissiveColor = color;
      m.disableLighting = true;
      return m;
    };
    this.coolMarker = marker("mat-marker-cool", new Color3(0.2, 0.62, 0.78));
    this.warmMarker = marker("mat-marker-warm", new Color3(0.78, 0.46, 0.16));
    this.zoneMaterial = new StandardMaterial("mat-zone-volume", scene);
    this.zoneMaterial.emissiveColor = ZONE;
    this.zoneMaterial.disableLighting = true;
    this.zoneMaterial.alpha = 0.06;
    this.zoneMaterial.backFaceCulling = false;

    this.jointSource = CreateSphere("joint-marker", { diameter: 0.11, segments: 10 }, scene);
    this.jointSource.material = this.warmMarker;
    this.jointSource.isVisible = false;
    this.motorSource = CreateSphere("motor-marker", { diameter: 0.15, segments: 10 }, scene);
    this.motorSource.material = this.coolMarker;
    this.motorSource.isVisible = false;

    this.cableSource = CreateCylinder("joint-cable", { diameter: 0.05, height: 1, tessellation: 8 }, scene);
    this.cableSource.material = _materials.structure;
    this.cableSource.isVisible = false;

    fields.onChange.push(() => this.rebuildFields());
    joints.onChange.push(() => this.rebuildJoints());
  }

  /** Call every frame: joint markers follow their bodies. */
  update(): void {
    const all = this.joints.all;
    for (let i = 0; i < all.length; i++) {
      this.joints.pivotWorld(all[i], this.tmp);
      this.jointMarkers[i]?.position.copyFrom(this.tmp);
      const cable = this.cables[i];
      if (cable) {
        // Pendulum cables run from the pivot to the body; springs run between their two ends.
        const end = all[i].kind === "spring" ? this.joints.pivotWorldB(all[i], this.tmpB) : all[i].a.mesh.position;
        const span = end.subtract(this.tmp);
        if (span.lengthSquared() < 1e-6) continue;
        const length = span.length();
        cable.position.copyFrom(this.tmp).addInPlace(span.scale(0.5));
        cable.scaling.y = length;
        cable.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, span.scaleInPlace(1 / length), cable.rotationQuaternion ?? new Quaternion());
      }
    }
  }

  private rebuildJoints(): void {
    for (const m of this.jointMarkers) m.dispose();
    for (const c of this.cables) c?.dispose();
    this.jointMarkers.length = 0;
    this.cables.length = 0;
    for (const j of this.joints.all) {
      const m = (j.kind === "motor" ? this.motorSource : this.jointSource).createInstance(`joint-${j.id}`);
      m.isPickable = false;
      if (j.kind === "spring") m.scaling.setAll(0.6);
      this.jointMarkers.push(m);
      let cable: AbstractMesh | null = null;
      if (j.kind === "spring" || j.localPivotA.length() > 1.5) {
        cable = this.cableSource.createInstance(`joint-cable-${j.id}`);
        cable.isPickable = false;
      }
      this.cables.push(cable);
    }
    this.update();
  }

  private rebuildWater(): void {
    for (const m of this.waterMeshes) m.dispose();
    this.waterMeshes = [];
    for (const w of this.water?.all ?? []) this.buildWater(w);
  }

  private buildWater(w: WaterVolume): void {
    const h = w.halfExtents;
    const body = CreateBox(`water-volume-${w.id}`, { width: h.x * 2, height: h.y * 2, depth: h.z * 2 }, this.scene);
    body.position.copyFrom(w.position);
    body.material = this.waterMaterial;
    const surface = CreateBox(`water-surface-${w.id}`, { width: h.x * 2, height: 0.02, depth: h.z * 2 }, this.scene);
    surface.position.set(w.position.x, w.position.y + h.y, w.position.z);
    surface.material = this.surfaceMaterial;
    const c = w.position;
    const corner = (sx: number, sy: number, sz: number) => new Vector3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z);
    const lines: Vector3[][] = [];
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        lines.push([corner(-1, a, b), corner(1, a, b)], [corner(a, -1, b), corner(a, 1, b)], [corner(a, b, -1), corner(a, b, 1)]);
      }
    }
    const frame = CreateLineSystem(`water-frame-${w.id}`, { lines }, this.scene);
    frame.color = new Color3(0.45, 0.75, 1);
    frame.alpha = 0.7;
    for (const m of [body, surface, frame]) {
      m.isPickable = false;
      this.waterMeshes.push(m);
    }
  }

  private rebuildFields(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    for (const f of this.fields.all) {
      if (f.kind === "zone") this.buildZone(f);
      else this.buildPoint(f);
    }
  }

  private track<T extends AbstractMesh>(mesh: T, _field: GravityField): T {
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }

  private buildPoint(f: PointField): void {
    const attract = f.kind === "attractor";
    const core = this.track(CreateSphere(`field-core-${f.id}`, { diameter: 0.36, segments: 16 }, this.scene), f);
    core.position.copyFrom(f.position);
    core.material = attract ? this.coolMarker : this.warmMarker;
    // Inner ring scales with strength, outer rings show the reach.
    const inner = Math.min(2.5, 0.45 + Math.sqrt(Math.abs(f.mu)) * 0.06);
    const lines = [circle(f.position, inner, 0), circle(f.position, inner, 1), circle(f.position, inner, 2), circle(f.position, f.radius, 1, 96)];
    const rings = this.track(CreateLineSystem(`field-rings-${f.id}`, { lines }, this.scene), f);
    rings.color = attract ? ATTRACT : REPEL;
    rings.alpha = 0.7;
  }

  private buildZone(f: ZoneField): void {
    const h = f.halfExtents;
    const box = this.track(CreateBox(`zone-volume-${f.id}`, { width: h.x * 2, height: h.y * 2, depth: h.z * 2 }, this.scene), f);
    box.position.copyFrom(f.position);
    box.material = this.zoneMaterial;

    const c = f.position;
    const corner = (sx: number, sy: number, sz: number) => new Vector3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z);
    const lines: Vector3[][] = [];
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        lines.push([corner(-1, a, b), corner(1, a, b)], [corner(a, -1, b), corner(a, 1, b)], [corner(a, b, -1), corner(a, b, 1)]);
      }
    }
    // Arrows showing the zone's gravity direction
    const g = f.gravity.lengthSquared() > 1e-6 ? f.gravity.normalizeToNew() : Vector3.Down();
    const side = Math.abs(g.y) > 0.9 ? Vector3.Right() : Vector3.Up();
    const u = Vector3.Cross(g, side).normalize();
    const v = Vector3.Cross(g, u);
    const reach = Math.abs(Vector3.Dot(g, h));
    const spread = Math.abs(Vector3.Dot(u, h)) * 0.5;
    const spreadV = Math.abs(Vector3.Dot(v, h)) * 0.5;
    for (const [du, dv] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const mid = c.add(u.scale(du * spread)).add(v.scale(dv * spreadV));
      const tail = mid.subtract(g.scale(reach * 0.45));
      const tip = mid.add(g.scale(reach * 0.45));
      const back = tip.subtract(g.scale(0.35));
      lines.push([tail, tip], [tip, back.add(u.scale(0.16))], [tip, back.subtract(u.scale(0.16))]);
    }
    const frame = this.track(CreateLineSystem(`zone-frame-${f.id}`, { lines }, this.scene), f);
    frame.color = ZONE;
    frame.alpha = 0.75;
  }
}
