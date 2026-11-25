import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialLibrary } from "../render/MaterialLibrary";
import type { ObjectFactory } from "../objects/ObjectFactory";

export interface EnvironmentContext {
  scene: Scene;
  materials: MaterialLibrary;
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
  /** Static meshes that should cast shadows. */
  readonly shadowCasters: AbstractMesh[];
  /** Static meshes rendered into the reflection probe. */
  readonly staticMeshes: AbstractMesh[];
  build(ctx: EnvironmentContext): void;
  /** Spawns the dynamic props for a fresh experiment. Called on load and on reset. */
  populate(factory: ObjectFactory): void;
}
