import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Material } from "@babylonjs/core/Materials/material";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";
import type { MaterialLibrary } from "../render/MaterialLibrary";
import type { ObjectFactory } from "../objects/ObjectFactory";
import type { GravityFields } from "../fields/GravityFields";
import type { JointManager } from "../construction/Joints";
import type { WaterVolumes } from "../fluids/WaterVolumes";
import type { SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";

export interface EnvironmentContext {
  scene: Scene;
  materials: MaterialLibrary;
}

/** Systems an environment may use to set up its starting experiment. */
export interface PopulateContext {
  factory: ObjectFactory;
  fields: GravityFields;
  joints: JointManager;
  water: WaterVolumes;
}

export interface LightRig {
  /** Two accent spot lights: position and aim direction. */
  spots: [{ position: Vector3; direction: Vector3 }, { position: Vector3; direction: Vector3 }];
  spotColor: Color3;
  fogColor: Color3;
}

/** A self-contained interactive space: static geometry + colliders, plus the props an experiment starts with. */
export interface LabEnvironment {
  readonly id: string;
  readonly name: string;
  readonly spawnPoint: Vector3;
  /** Initial facing, radians about +Y (0 looks down +Z). */
  readonly spawnYaw: number;
  /** Centre of the space, used for the reflection probe and key light. */
  readonly center: Vector3;
  /** World gravity this environment starts with (vertical, m/s^2). */
  readonly gravityY: number;
  readonly lightRig: LightRig;
  /** Static meshes that should cast shadows. */
  readonly shadowCasters: AbstractMesh[];
  /** Static meshes rendered into the reflection probe. */
  readonly staticMeshes: AbstractMesh[];
  build(ctx: EnvironmentContext): void;
  /** Spawns the dynamic props, fields and joints for a fresh experiment. Called on load and on reset. */
  populate(ctx: PopulateContext): void;
  /** Room collider with the given mesh name, or null. Used to reattach saved joints to the room. */
  roomBody(name: string): PhysicsBody | null;
  /** Removes all static geometry and colliders. */
  dispose(): void;
}

export interface BlockOptions {
  rotationX?: number;
  rotationY?: number;
  collider?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  friction?: number;
}

/** Shared construction helpers and clean-up for environments built from static boxes. */
export abstract class BaseEnvironment implements LabEnvironment {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly spawnPoint: Vector3;
  abstract readonly spawnYaw: number;
  abstract readonly center: Vector3;
  abstract readonly lightRig: LightRig;
  readonly gravityY: number = CONFIG.physics.gravity;
  readonly shadowCasters: AbstractMesh[] = [];
  readonly staticMeshes: AbstractMesh[] = [];

  protected scene!: Scene;
  private readonly aggregates: PhysicsAggregate[] = [];
  private readonly bodies = new Map<string, PhysicsBody>();
  private readonly sources: Mesh[] = [];

  abstract build(ctx: EnvironmentContext): void;
  abstract populate(ctx: PopulateContext): void;

  dispose(): void {
    for (const a of this.aggregates) a.dispose();
    for (const m of this.staticMeshes) m.dispose();
    for (const m of this.sources) m.dispose();
    this.aggregates.length = 0;
    this.bodies.clear();
    this.staticMeshes.length = 0;
    this.sources.length = 0;
    this.shadowCasters.length = 0;
  }

  /** Static box with an optional box collider. */
  protected block(name: string, size: Vector3, position: Vector3, material: Material, opts: BlockOptions = {}): Mesh {
    const mesh = CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(position);
    mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(opts.rotationY ?? 0, opts.rotationX ?? 0, 0);
    mesh.material = material;
    mesh.receiveShadows = opts.receiveShadow ?? true;
    if (opts.collider ?? true) {
      const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0, friction: opts.friction ?? 0.6, restitution: 0.1 }, this.scene);
      this.aggregates.push(aggregate);
      this.bodies.set(name, aggregate.body);
    }
    if (opts.castShadow) this.shadowCasters.push(mesh);
    this.finishStatic(mesh);
    return mesh;
  }

  /**
   * Simulated soft body: an n x n x n lattice of elastic spheres joined by springs along
   * edges and diagonals. It deforms and recovers through the engine's constraints.
   */
  protected softLattice({ factory, joints }: PopulateContext, origin: Vector3, n = 2, spacing = 0.62, diameter = 0.5): SandboxObject[] {
    const nodes: (SandboxObject | null)[] = [];
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        for (let z = 0; z < n; z++) {
          nodes.push(
            factory.spawn({
              kind: "sphere",
              material: "elastic",
              size: new Vector3(diameter, diameter, diameter),
              position: origin.add(new Vector3(x * spacing, y * spacing, z * spacing)),
              props: { angularDamping: 0.6 },
            }),
          );
        }
      }
    }
    const reach = spacing * Math.sqrt(3) + 1e-3; // neighbours up to the body diagonal
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b || Vector3.Distance(a.mesh.position, b.mesh.position) > reach) continue;
        joints.create("spring", a, b.body, b, b.mesh.position, Vector3.Up(), a.mesh.position);
      }
    }
    return nodes.filter((o): o is SandboxObject => o !== null);
  }

  roomBody(name: string): PhysicsBody | null {
    return this.bodies.get(name) ?? null;
  }

  /** Static body of a block created by this environment, for joints to the room. */
  protected bodyOf(name: string): PhysicsBody {
    const body = this.bodies.get(name);
    if (!body) throw new Error(`Environment ${this.id} has no collider named "${name}"`);
    return body;
  }

  /** Registers a hidden mesh that only serves as the source of GPU instances. */
  protected instanceSource(mesh: Mesh): Mesh {
    mesh.isVisible = false;
    mesh.isPickable = false;
    this.sources.push(mesh);
    return mesh;
  }

  /** Marks a mesh as static scenery: frozen transform, tracked for the probe and for dispose. */
  protected finishStatic(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    this.staticMeshes.push(mesh);
  }
}
