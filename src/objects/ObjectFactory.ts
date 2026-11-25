import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";
import type { MaterialLibrary } from "../render/MaterialLibrary";

export type PrimitiveKind = "box" | "sphere" | "cylinder";
export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ["box", "sphere", "cylinder"];

/** Phase 1 uses one generic solid. Per-material properties arrive with the material laboratory (Phase 3). */
const DEFAULT_SOLID = { density: 450, friction: 0.6, restitution: 0.25 };

export interface SpawnOptions {
  kind: PrimitiveKind;
  position: Vector3;
  /** Box: edge lengths. Sphere: x = diameter. Cylinder: x = diameter, y = height. */
  size?: Vector3;
  colorIndex?: number;
  rotation?: Quaternion;
  linearVelocity?: Vector3;
}

export interface SandboxObject {
  id: number;
  kind: PrimitiveKind;
  mesh: InstancedMesh;
  aggregate: PhysicsAggregate;
  body: PhysicsBody;
  mass: number;
}

const DEFAULT_SIZE: Record<PrimitiveKind, Vector3> = {
  box: new Vector3(0.6, 0.6, 0.6),
  sphere: new Vector3(0.7, 0.7, 0.7),
  cylinder: new Vector3(0.5, 0.8, 0.5),
};

export function primitiveVolume(kind: PrimitiveKind, size: Vector3): number {
  switch (kind) {
    case "box":
      return size.x * size.y * size.z;
    case "sphere":
      return (Math.PI / 6) * size.x ** 3;
    case "cylinder":
      return Math.PI * (size.x / 2) ** 2 * size.y;
  }
}

/**
 * Creates and tracks dynamic sandbox objects.
 * Each (shape, colour) pair has one hidden unit-sized source mesh; every object
 * is a GPU instance of it, scaled to size, with its own Havok body.
 */
export class ObjectFactory {
  readonly onSpawned: Array<(o: SandboxObject) => void> = [];
  readonly onRemoved: Array<(o: SandboxObject) => void> = [];

  private readonly objects = new Map<number, SandboxObject>();
  private readonly sources = new Map<string, Mesh>();
  private nextId = 1;
  private nextColor = 0;

  constructor(
    private readonly scene: Scene,
    private readonly materials: MaterialLibrary,
  ) {}

  get count(): number {
    return this.objects.size;
  }

  get all(): IterableIterator<SandboxObject> {
    return this.objects.values();
  }

  get atLimit(): boolean {
    return this.objects.size >= CONFIG.limits.maxObjects;
  }

  /** Returns null when the object limit has been reached. */
  spawn(opts: SpawnOptions): SandboxObject | null {
    if (this.atLimit) return null;
    const size = opts.size ?? DEFAULT_SIZE[opts.kind];
    const colorIndex = (opts.colorIndex ?? this.nextColor++) % this.materials.props.length;
    const id = this.nextId++;

    const mesh = this.source(opts.kind, colorIndex).createInstance(`obj-${id}-${opts.kind}`);
    mesh.scaling.copyFrom(opts.kind === "sphere" ? new Vector3(size.x, size.x, size.x) : opts.kind === "cylinder" ? new Vector3(size.x, size.y, size.x) : size);
    mesh.position.copyFrom(opts.position);
    mesh.rotationQuaternion = opts.rotation?.clone() ?? Quaternion.Identity();
    mesh.metadata = { sandboxId: id };

    const mass = DEFAULT_SOLID.density * primitiveVolume(opts.kind, size);
    const shape =
      opts.kind === "box" ? PhysicsShapeType.BOX : opts.kind === "sphere" ? PhysicsShapeType.SPHERE : PhysicsShapeType.CYLINDER;
    const aggregate = new PhysicsAggregate(
      mesh,
      shape,
      { mass, friction: DEFAULT_SOLID.friction, restitution: DEFAULT_SOLID.restitution },
      this.scene,
    );
    if (opts.linearVelocity) aggregate.body.setLinearVelocity(opts.linearVelocity);

    const obj: SandboxObject = { id, kind: opts.kind, mesh, aggregate, body: aggregate.body, mass };
    this.objects.set(id, obj);
    for (const cb of this.onSpawned) cb(obj);
    return obj;
  }

  remove(obj: SandboxObject): void {
    if (!this.objects.delete(obj.id)) return;
    for (const cb of this.onRemoved) cb(obj);
    obj.aggregate.dispose();
    obj.mesh.dispose();
  }

  clear(): void {
    for (const obj of [...this.objects.values()]) this.remove(obj);
  }

  fromBody(body: PhysicsBody): SandboxObject | null {
    const id = body.transformNode?.metadata?.sandboxId as number | undefined;
    return id === undefined ? null : (this.objects.get(id) ?? null);
  }

  /** Removes objects that have fallen out of the world. Returns how many were removed. */
  cullOutOfBounds(): number {
    let removed = 0;
    for (const obj of [...this.objects.values()]) {
      if (obj.mesh.position.y < CONFIG.limits.killPlaneY) {
        this.remove(obj);
        removed++;
      }
    }
    return removed;
  }

  private source(kind: PrimitiveKind, colorIndex: number): Mesh {
    const key = `${kind}:${colorIndex}`;
    let mesh = this.sources.get(key);
    if (!mesh) {
      const name = `src-${key}`;
      mesh =
        kind === "box"
          ? CreateBox(name, { size: 1 }, this.scene)
          : kind === "sphere"
            ? CreateSphere(name, { diameter: 1, segments: 24 }, this.scene)
            : CreateCylinder(name, { diameter: 1, height: 1, tessellation: 32 }, this.scene);
      mesh.material = this.materials.props[colorIndex];
      mesh.receiveShadows = true;
      mesh.isVisible = false; // instances still render
      mesh.isPickable = false;
      this.sources.set(key, mesh);
    }
    return mesh;
  }
}
