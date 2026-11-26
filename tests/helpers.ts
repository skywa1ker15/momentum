import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import HavokPhysics from "@babylonjs/havok";
import { PhysicsWorld } from "../src/physics/PhysicsWorld";
import { MaterialLibrary } from "../src/render/MaterialLibrary";
import { ObjectFactory } from "../src/objects/ObjectFactory";
import { TestChamber } from "../src/environments/TestChamber";
import type { LabEnvironment } from "../src/environments/Environment";
import { JointManager } from "../src/construction/Joints";
import { DestructionSystem } from "../src/destruction/Destruction";
import { GravityFields } from "../src/fields/GravityFields";

let havok: unknown;

/** Headless lab: real Havok WASM + Babylon NullEngine (no GPU). */
export async function createLab(populate = false, env: LabEnvironment = new TestChamber()) {
  if (!havok) {
    const wasmPath = createRequire(import.meta.url).resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm");
    havok = await HavokPhysics({ wasmBinary: new Uint8Array(readFileSync(wasmPath)).buffer });
  }
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = new PhysicsWorld(scene, havok);
  const materials = new MaterialLibrary(scene);
  env.build({ scene, materials });
  const factory = new ObjectFactory(scene, materials);
  const fields = new GravityFields(world, factory);
  const joints = new JointManager(scene, factory);
  const destruction = new DestructionSystem(world, factory, joints);
  if (populate) env.populate({ factory, fields, joints });
  return { engine, scene, world, materials, env, factory, fields, joints, destruction, dispose: () => { scene.dispose(); engine.dispose(); } };
}

export function simulate(world: PhysicsWorld, seconds: number, each?: (dt: number) => void): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    each?.(dt);
    world.step(dt);
  }
}
