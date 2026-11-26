import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { DestructionSystem } from "../destruction/Destruction";

export interface BlastWave {
  center: Vector3;
  /** N s / m^2 at 1 m */
  strength: number;
  radius: number;
  startTime: number;
  /** Current radius of the pressure front, m. */
  front: number;
  readonly reached: Set<number>;
}

/** Area an object presents to a blast, m^2 (orientation-averaged). */
export function presentedArea(obj: SandboxObject): number {
  const s = obj.size;
  switch (obj.kind) {
    case "sphere":
      return (Math.PI * s.x * s.x) / 4;
    case "cylinder":
      // mean of the side-on (d x h) and end-on (pi d^2 / 4) views, weighted 2:1
      return (2 * s.x * s.y + (Math.PI * s.x * s.x) / 4) / 3;
    default:
      return (s.x * s.y + s.y * s.z + s.z * s.x) / 3;
  }
}

/**
 * Impulse per unit area (N s / m^2) delivered by a blast at distance r:
 * inverse-square from the centre, tapering linearly to zero at the blast radius.
 */
export function blastImpulsePerArea(strength: number, radius: number, r: number): number {
  if (r >= radius) return 0;
  const rc = Math.max(r, CONFIG.explosion.minDistance);
  return (strength / (rc * rc)) * (1 - r / radius);
}

/**
 * Explosions as an expanding pressure front.
 *
 * Simulated: when the front reaches a body it receives an impulse J = i(r) * A along the
 * line from the blast centre, through the engine, where A is the area the body presents.
 * Light, large objects are thrown further than small dense ones. Bodies behind static
 * geometry are protected; bodies behind other objects get a reduced share. The same
 * impulse is reported to the destruction system, so blasts break things.
 * The flash, fire, smoke and shock ring drawn for a blast are visual only.
 */
export class ExplosionSystem {
  onDetonate: ((wave: BlastWave) => void) | null = null;
  level: number = CONFIG.explosion.defaultLevel;
  readonly waves: BlastWave[] = [];

  constructor(
    private readonly world: PhysicsWorld,
    private readonly factory: ObjectFactory,
    private readonly destruction: DestructionSystem | null,
  ) {
    world.onBeforeStep.add(() => this.advance());
  }

  get levelName(): string {
    return CONFIG.explosion.levels[this.level][0];
  }

  adjustLevel(steps: number): void {
    this.level = Math.min(CONFIG.explosion.levels.length - 1, Math.max(0, this.level + steps));
  }

  /** Starts a blast at `center`. Returns null when too many are already in progress. */
  detonate(center: Vector3, level: number = this.level): BlastWave | null {
    if (this.waves.length >= CONFIG.explosion.maxActiveWaves) return null;
    const [, strength, radius] = CONFIG.explosion.levels[level];
    const wave: BlastWave = { center: center.clone(), strength, radius, startTime: this.world.simTime, front: 0, reached: new Set() };
    this.waves.push(wave);
    this.onDetonate?.(wave);
    return wave;
  }

  clear(): void {
    this.waves.length = 0;
  }

  private advance(): void {
    if (this.waves.length === 0) return;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i];
      wave.front = (this.world.simTime - wave.startTime) * CONFIG.explosion.waveSpeed;
      // Snapshot: applying a blast can fracture objects, which changes the factory's set.
      for (const obj of [...this.factory.all]) {
        if (wave.reached.has(obj.id) || obj.props.isStatic) continue;
        const com = obj.body.getObjectCenterWorld();
        const r = Vector3.Distance(com, wave.center);
        if (r > wave.front || r > wave.radius) continue;
        wave.reached.add(obj.id);
        this.hit(wave, obj, com, r);
      }
      if (wave.front >= wave.radius) this.waves.splice(i, 1);
    }
  }

  private hit(wave: BlastWave, obj: SandboxObject, com: Vector3, r: number): void {
    let impulse = blastImpulsePerArea(wave.strength, wave.radius, r) * presentedArea(obj);
    if (impulse <= 0) return;
    const dir = r > 1e-3 ? com.subtract(wave.center).scaleInPlace(1 / r) : Vector3.Up();

    // Line of sight from the blast centre
    const hit = this.world.raycast(wave.center, com);
    if (hit && hit.body !== obj.body) {
      const blocker = this.factory.fromBody(hit.body);
      if (!blocker) return; // behind a wall or the floor
      impulse *= CONFIG.explosion.shieldedFactor;
    }
    obj.body.applyImpulse(dir.scale(impulse), com);
    this.destruction?.registerImpact(obj, impulse, hit && hit.body === obj.body ? hit.point : com, 10);
  }
}
