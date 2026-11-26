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

export interface ContactEvent {
  a: PhysicsBody;
  b: PhysicsBody;
  /** Contact impulse magnitude, N s. */
  impulse: number;
  point: Vector3 | null;
  /** Contact normal, pointing from `a` towards `b`. The impulse on `a` is -normal * impulse, on `b` +normal * impulse. */
  normal: Vector3 | null;
}

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
  /** Contacts with a non-zero impulse between bodies that have collision callbacks enabled. Fired during the step. */
  readonly onContact = new Observable<ContactEvent>();
  paused = false;
  timeScale = 1;
  /** Simulated seconds elapsed since creation. */
  simTime = 0;

  /** Fraction (0..1) of a fixed step by which rendering is ahead of the last simulated state. */
  alpha = 1;
  /** Fixed steps taken by the last advance() call. */
  lastSteps = 0;

  private accumulator = 0;
  private readonly engine: PhysicsEngine;
  private readonly rayResult = new PhysicsRaycastResult();
  /** Reused for every contact notification to avoid per-contact allocations. Do not retain it. */
  private readonly contact: ContactEvent = { a: null as unknown as PhysicsBody, b: null as unknown as PhysicsBody, impulse: 0, point: null, normal: null };

  constructor(
    readonly scene: Scene,
    havokInstance: unknown,
  ) {
    const plugin = new HavokPlugin(true, havokInstance);
    scene.enablePhysics(new Vector3(0, CONFIG.physics.gravity, 0), plugin);
    scene.physicsEnabled = false; // we step manually in step()
    this.engine = scene.getPhysicsEngine() as PhysicsEngine;
    plugin.onCollisionObservable.add((ev) => {
      if (ev.impulse <= 0) return;
      const c = this.contact;
      c.a = ev.collider;
      c.b = ev.collidedAgainst;
      c.impulse = ev.impulse;
      c.point = ev.point;
      c.normal = ev.normal;
      this.onContact.notifyObservers(c);
    });
  }

  /**
   * Frame entry point: advances the simulation by real time using FIXED steps.
   *
   * Real time (x time scale) is accumulated and consumed in steps of exactly
   * CONFIG.physics.fixedStep, so behaviour does not depend on the frame rate and the
   * simulation keeps real-time pace down to fixedStep * maxSubSteps per frame (15 FPS).
   * Below that, the excess is dropped rather than queued. `alpha` is the leftover fraction
   * of a step, used to interpolate rendering between the last two simulated states.
   * Returns simulated seconds.
   */
  advance(realDelta: number): number {
    this.lastSteps = 0;
    if (this.paused || realDelta <= 0) return 0;
    const h = CONFIG.physics.fixedStep;
    const max = CONFIG.physics.maxSubSteps;
    this.accumulator = Math.min(this.accumulator + realDelta * this.timeScale, h * max);
    while (this.accumulator >= h - 1e-9 && this.lastSteps < max) {
      this.accumulator = Math.max(0, this.accumulator - h);
      this.onBeforeStep.notifyObservers(h);
      this.engine._step(h);
      this.simTime += h;
      this.onAfterStep.notifyObservers(h);
      this.lastSteps++;
    }
    this.alpha = this.accumulator / h;
    return this.lastSteps * h;
  }

  /**
   * Advances by exactly one step of the given size (clamped, x time scale). Used by tests and
   * tools that need direct control; the app's frame loop uses advance().
   */
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
