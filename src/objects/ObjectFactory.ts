import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsMotionType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";
import type { MaterialLibrary } from "../render/MaterialLibrary";
import { DEFAULT_MATERIAL, MATERIALS, type MaterialId } from "../materials/Materials";

export type PrimitiveKind = "box" | "sphere" | "cylinder";
export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ["box", "sphere", "cylinder"];

/** Editable physical properties. Every field maps directly onto a Havok body / shape setting. */
export interface PhysicalProps {
  /** kg */
  mass: number;
  friction: number;
  restitution: number;
  /** 1/s */
  linearDamping: number;
  /** 1/s */
  angularDamping: number;
  /** Multiplier on world gravity for this body. */
  gravityFactor: number;
  /** Static bodies do not move but still collide. */
  isStatic: boolean;
}

export const PROP_LIMITS = {
  mass: { min: 0.1, max: 20000 },
  friction: { min: 0, max: 2 },
  restitution: { min: 0, max: 1 },
  linearDamping: { min: 0, max: 5 },
  angularDamping: { min: 0, max: 5 },
  gravityFactor: { min: -2, max: 3 },
} as const;

/**
 * Sets a body's mass. Havok stores the inertia tensor per unit mass (for a solid sphere
 * 2/5 r^2), derived from the collision shape, so the rotational inertia I = m * unitInertia
 * follows the mass automatically and only the mass needs to be written.
 */
function setMass(body: PhysicsBody, mass: number): void {
  body.setMassProperties({ mass });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface SpawnOptions {
  kind: PrimitiveKind;
  position: Vector3;
  /** Box: edge lengths. Sphere: x = diameter. Cylinder: x = diameter, y = height. */
  size?: Vector3;
  material?: MaterialId;
  rotation?: Quaternion;
  linearVelocity?: Vector3;
  /** Overrides for the default physical properties. */
  props?: Partial<PhysicalProps>;
  /** 0 for ordinary objects; fragments carry their parent's generation + 1. */
  generation?: number;
}

export interface SandboxObject {
  id: number;
  kind: PrimitiveKind;
  mesh: InstancedMesh;
  aggregate: PhysicsAggregate;
  body: PhysicsBody;
  size: Vector3;
  materialId: MaterialId;
  /** How many fractures deep this object is (0 = not a fragment). */
  generation: number;
  /** Last values applied to the engine. Change them only through ObjectFactory.setProps. */
  props: PhysicalProps;
}

const DEFAULT_SIZE: Record<PrimitiveKind, Vector3> = {
  box: new Vector3(0.6, 0.6, 0.6),
  sphere: new Vector3(0.7, 0.7, 0.7),
  cylinder: new Vector3(0.5, 0.8, 0.5),
};

/** Mesh scaling that turns the unit source mesh into a primitive of the given size. */
export function meshScaling(kind: PrimitiveKind, size: Vector3): Vector3 {
  return kind === "sphere" ? new Vector3(size.x, size.x, size.x) : kind === "cylinder" ? new Vector3(size.x, size.y, size.x) : size.clone();
}

/** Size a primitive is spawned with when none is given. */
export function defaultSize(kind: PrimitiveKind): Vector3 {
  return DEFAULT_SIZE[kind];
}

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
 * Each (shape, material) pair has one hidden unit-sized source mesh; every object
 * is a GPU instance of it, scaled to size, with its own Havok body.
 */
export class ObjectFactory {
  readonly onSpawned: Array<(o: SandboxObject) => void> = [];
  readonly onRemoved: Array<(o: SandboxObject) => void> = [];
  /** Raised after an object's mesh and body were recreated (material change). Receives the old mesh. */
  readonly onRebuilt: Array<(o: SandboxObject, oldMesh: InstancedMesh) => void> = [];

  private readonly objects = new Map<number, SandboxObject>();
  private readonly sources = new Map<string, Mesh>();
  private nextId = 1;

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
    const materialId = opts.material ?? DEFAULT_MATERIAL;
    const id = this.nextId++;
    const { mesh, aggregate, props } = this.build(id, opts.kind, size, materialId, opts.position, opts.rotation ?? Quaternion.Identity());
    if (opts.linearVelocity) aggregate.body.setLinearVelocity(opts.linearVelocity);

    const obj: SandboxObject = { id, kind: opts.kind, mesh, aggregate, body: aggregate.body, size: size.clone(), materialId, generation: opts.generation ?? 0, props };
    if (opts.props) this.setProps(obj, opts.props);
    this.objects.set(id, obj);
    for (const cb of this.onSpawned) cb(obj);
    return obj;
  }

  /**
   * Changes an object's material: mass follows the new density, friction and restitution
   * take the preset values, other properties are kept. The mesh and body are recreated
   * in place with the same transform and velocities.
   */
  setMaterial(obj: SandboxObject, materialId: MaterialId): void {
    if (obj.materialId === materialId) return;
    const lin = obj.body.getLinearVelocity();
    const ang = obj.body.getAngularVelocity();
    const oldMesh = obj.mesh;
    const keep = { ...obj.props };
    const rotation = oldMesh.rotationQuaternion?.clone() ?? Quaternion.Identity();
    obj.aggregate.dispose();
    const built = this.build(obj.id, obj.kind, obj.size, materialId, oldMesh.position, rotation);
    obj.mesh = built.mesh;
    obj.aggregate = built.aggregate;
    obj.body = built.aggregate.body;
    obj.materialId = materialId;
    obj.props = built.props;
    this.setProps(obj, {
      linearDamping: keep.linearDamping,
      angularDamping: keep.angularDamping,
      gravityFactor: keep.gravityFactor,
      isStatic: keep.isStatic,
    });
    if (!keep.isStatic) {
      obj.body.setLinearVelocity(lin);
      obj.body.setAngularVelocity(ang);
    }
    for (const cb of this.onRebuilt) cb(obj, oldMesh);
    oldMesh.dispose();
  }

  private build(id: number, kind: PrimitiveKind, size: Vector3, materialId: MaterialId, position: Vector3, rotation: Quaternion) {
    const def = MATERIALS[materialId];
    const mesh = this.source(kind, materialId).createInstance(`obj-${id}-${kind}`);
    mesh.scaling.copyFrom(meshScaling(kind, size));
    mesh.position.copyFrom(position);
    mesh.rotationQuaternion = rotation.clone();
    mesh.metadata = { sandboxId: id };

    const mass = def.density * primitiveVolume(kind, size);
    const shape = kind === "box" ? PhysicsShapeType.BOX : kind === "sphere" ? PhysicsShapeType.SPHERE : PhysicsShapeType.CYLINDER;
    const aggregate = new PhysicsAggregate(mesh, shape, { mass, friction: def.friction, restitution: def.restitution }, this.scene);
    aggregate.body.setCollisionCallbackEnabled(true); // contact impulses feed the inspector and the destruction system
    const props: PhysicalProps = {
      mass,
      friction: def.friction,
      restitution: def.restitution,
      linearDamping: aggregate.body.getLinearDamping(),
      angularDamping: aggregate.body.getAngularDamping(),
      gravityFactor: 1,
      isStatic: false,
    };
    return { mesh, aggregate, props };
  }

  /** Applies property changes to the Havok body / shape. Values are clamped to PROP_LIMITS. */
  setProps(obj: SandboxObject, change: Partial<PhysicalProps>): void {
    const p = obj.props;
    const L = PROP_LIMITS;
    if (change.mass !== undefined) {
      p.mass = clamp(change.mass, L.mass.min, L.mass.max);
      setMass(obj.body, p.mass);
    }
    if (change.friction !== undefined || change.restitution !== undefined) {
      if (change.friction !== undefined) p.friction = clamp(change.friction, L.friction.min, L.friction.max);
      if (change.restitution !== undefined) p.restitution = clamp(change.restitution, L.restitution.min, L.restitution.max);
      obj.aggregate.shape.material = { friction: p.friction, restitution: p.restitution };
    }
    if (change.linearDamping !== undefined) {
      p.linearDamping = clamp(change.linearDamping, L.linearDamping.min, L.linearDamping.max);
      obj.body.setLinearDamping(p.linearDamping);
    }
    if (change.angularDamping !== undefined) {
      p.angularDamping = clamp(change.angularDamping, L.angularDamping.min, L.angularDamping.max);
      obj.body.setAngularDamping(p.angularDamping);
    }
    if (change.gravityFactor !== undefined) {
      p.gravityFactor = clamp(change.gravityFactor, L.gravityFactor.min, L.gravityFactor.max);
      obj.body.setGravityFactor(p.gravityFactor);
    }
    if (change.isStatic !== undefined && change.isStatic !== p.isStatic) {
      p.isStatic = change.isStatic;
      if (p.isStatic) {
        obj.body.setLinearVelocity(Vector3.Zero());
        obj.body.setAngularVelocity(Vector3.Zero());
      }
      obj.body.setMotionType(p.isStatic ? PhysicsMotionType.STATIC : PhysicsMotionType.DYNAMIC);
    }
    this.wake(obj);
  }

  /** Copies an object (shape, size, material, properties) at an offset. Null at the object limit. */
  duplicate(obj: SandboxObject, offset: Vector3): SandboxObject | null {
    return this.spawn({
      kind: obj.kind,
      size: obj.size,
      material: obj.materialId,
      position: obj.mesh.position.add(offset),
      rotation: obj.mesh.rotationQuaternion ?? undefined,
      props: obj.props,
    });
  }

  /** Brings a sleeping body back into the simulation (needed after gravity or property changes). */
  wake(obj: SandboxObject): void {
    if (obj.props.isStatic) return;
    obj.body.applyImpulse(Vector3.ZeroReadOnly as Vector3, obj.mesh.position);
  }

  wakeAll(): void {
    for (const obj of this.objects.values()) this.wake(obj);
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

  get debrisCount(): number {
    let n = 0;
    for (const o of this.objects.values()) if (o.generation > 0) n++;
    return n;
  }

  /** Fragments, oldest first. */
  debris(): SandboxObject[] {
    return [...this.objects.values()].filter((o) => o.generation > 0);
  }

  /** Removes objects that have left the world in any direction. Returns how many were removed. */
  cullOutOfBounds(): number {
    const L = CONFIG.limits;
    let removed = 0;
    for (const obj of [...this.objects.values()]) {
      const p = obj.mesh.position;
      if (p.y < L.killPlaneY || p.y > L.worldCeiling || Math.abs(p.x) > L.worldRadius || Math.abs(p.z) > L.worldRadius || !Number.isFinite(p.x + p.y + p.z)) {
        this.remove(obj);
        removed++;
      }
    }
    return removed;
  }

  private source(kind: PrimitiveKind, materialId: MaterialId): Mesh {
    const key = `${kind}:${materialId}`;
    let mesh = this.sources.get(key);
    if (!mesh) {
      const name = `src-${key}`;
      mesh =
        kind === "box"
          ? CreateBox(name, { size: 1 }, this.scene)
          : kind === "sphere"
            ? CreateSphere(name, { diameter: 1, segments: 24 }, this.scene)
            : CreateCylinder(name, { diameter: 1, height: 1, tessellation: 32 }, this.scene);
      mesh.material = this.materials.solids[materialId];
      mesh.receiveShadows = true;
      mesh.isVisible = false; // instances still render
      mesh.isPickable = false;
      this.sources.set(key, mesh);
    }
    return mesh;
  }
}
