import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";

export interface RayHit {
  body: PhysicsBody;
  point: Vector3;
  normal: Vector3;
  distance: number;
}

/**
 * Owns the Havok world and is the only place that advances the simulation.
 * Babylon's automatic per-frame stepping is switched off so that pause,
 * time scale and step clamping are controlled here.
 */
export class PhysicsWorld {
  readonly onBeforeStep = new Observable<number>();
  readonly onAfterStep = new Observable<number>();
  paused = false;
  timeScale = 1;
  /** Simulated seconds elapsed since creation. */
  simTime = 0;

  private readonly engine: PhysicsEngine;
  private readonly rayResult = new PhysicsRaycastResult();

  constructor(
    readonly scene: Scene,
    havokInstance: unknown,
  ) {
    const plugin = new HavokPlugin(true, havokInstance);
    scene.enablePhysics(new Vector3(0, CONFIG.physics.gravity, 0), plugin);
    scene.physicsEnabled = false; // we step manually in step()
    this.engine = scene.getPhysicsEngine() as PhysicsEngine;
  }

  /** Advance by a real-time delta (seconds). Applies pause, clamping and time scale. Returns simulated seconds. */
  step(realDelta: number): number {
    if (this.paused || realDelta <= 0) return 0;
    const dt = Math.min(realDelta, CONFIG.physics.maxStep) * this.timeScale;
    if (dt <= 0) return 0;
    this.onBeforeStep.notifyObservers(dt);
    this.engine._step(dt);
    this.simTime += dt;
    this.onAfterStep.notifyObservers(dt);
    return dt;
  }

  get gravity(): Vector3 {
    return this.engine.gravity;
  }

  setGravity(g: Vector3): void {
    this.engine.setGravity(g);
  }

  get bodyCount(): number {
    return this.engine.getBodies().length;
  }

  /** Engine raycast against collision geometry. */
  raycast(from: Vector3, to: Vector3): RayHit | null {
    this.engine.raycastToRef(from, to, this.rayResult);
    const r = this.rayResult;
    if (!r.hasHit || !r.body) return null;
    return {
      body: r.body,
      point: r.hitPointWorld.clone(),
      normal: r.hitNormalWorld.clone(),
      distance: Vector3.Distance(from, r.hitPointWorld),
    };
  }
}
