import "@babylonjs/core/Particles/particleSystemComponent";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { BlastWave } from "../effects/Explosions";

export type BurstKind = "dust" | "sparks" | "fire" | "smoke" | "splash";

interface Pooled {
  system: ParticleSystem;
  busyUntil: number;
}

const POOL_PER_KIND = 4;
const CAPACITY = 160;
const MAX_RINGS = 4;

/**
 * VISUAL effects only: particle bursts (dust, sparks, fire, smoke, splashes) and the
 * shock ring of a blast. Nothing here affects the simulation.
 *
 * Particle systems are pooled per kind and reused. `budget` (0..1) scales every burst
 * and is lowered automatically when the frame rate drops, so effects are the first
 * thing to give way under load.
 */
export class Effects {
  /** 0..1 multiplier on particle counts (graphics quality x frame-rate headroom). */
  budget = 1;
  /** Particles alive across all systems, for the HUD. */
  activeParticles = 0;

  private readonly texture: DynamicTexture;
  private readonly pools = new Map<BurstKind, Pooled[]>();
  private readonly rings: Mesh[] = [];
  private readonly ringMaterials: StandardMaterial[] = [];

  constructor(private readonly scene: Scene) {
    const size = 64;
    this.texture = new DynamicTexture("tex-particle", { width: size, height: size }, scene, false);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.texture.update();
    this.texture.hasAlpha = true;

    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new StandardMaterial(`mat-shock-${i}`, scene);
      mat.emissiveColor = new Color3(1, 0.82, 0.6);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = 0;
      const ring = CreateSphere(`shock-${i}`, { diameter: 2, segments: 24 }, scene);
      ring.material = mat;
      ring.isPickable = false;
      ring.setEnabled(false);
      this.rings.push(ring);
      this.ringMaterials.push(mat);
    }
  }

  /**
   * Emits a burst. `count` is the particle count at full budget. Bursts are dropped when
   * every pooled system of that kind is still busy.
   */
  burst(kind: BurstKind, position: Vector3, count: number, color?: Color3, scale = 1): void {
    const n = Math.round(Math.min(CAPACITY, count) * this.budget);
    if (n < 1) return;
    const now = performance.now();
    let pool = this.pools.get(kind);
    if (!pool) this.pools.set(kind, (pool = []));
    let slot = pool.find((p) => p.busyUntil <= now);
    if (!slot) {
      if (pool.length >= POOL_PER_KIND) return;
      slot = { system: this.create(kind), busyUntil: 0 };
      pool.push(slot);
    }
    const ps = slot.system;
    (ps.emitter as Vector3).copyFrom(position);
    if (color) {
      ps.color1 = new Color4(color.r, color.g, color.b, kind === "dust" ? 0.55 : 1);
      ps.color2 = new Color4(color.r * 0.8, color.g * 0.8, color.b * 0.8, kind === "dust" ? 0.4 : 1);
    }
    const base = BASE_SIZE[kind];
    ps.minSize = base[0] * scale;
    ps.maxSize = base[1] * scale;
    ps.manualEmitCount = n;
    if (!ps.isStarted()) ps.start();
    slot.busyUntil = now + ps.maxLifeTime * 1000 + 120;
  }

  /** Fire, smoke and dust for a detonation. */
  explosion(wave: BlastWave): void {
    const scale = Math.sqrt(wave.radius / 10);
    this.burst("fire", wave.center, 70, undefined, scale);
    this.burst("smoke", wave.center, 40, undefined, scale);
    this.burst("sparks", wave.center, 50, undefined, scale);
  }

  /** Call every frame. `timeScale` slows or freezes particles with the simulation. */
  update(waves: readonly BlastWave[], timeScale: number): void {
    let alive = 0;
    for (const pool of this.pools.values()) {
      for (const p of pool) {
        p.system.updateSpeed = 0.0166 * timeScale;
        alive += p.system.getActiveCount();
      }
    }
    this.activeParticles = alive;

    for (let i = 0; i < MAX_RINGS; i++) {
      const wave = waves[i];
      const ring = this.rings[i];
      if (!wave || wave.front <= 0.05) {
        if (ring.isEnabled()) ring.setEnabled(false);
        continue;
      }
      if (!ring.isEnabled()) ring.setEnabled(true);
      ring.position.copyFrom(wave.center);
      ring.scaling.setAll(wave.front);
      this.ringMaterials[i].alpha = 0.28 * Math.max(0, 1 - wave.front / wave.radius);
    }
  }

  private create(kind: BurstKind): ParticleSystem {
    const ps = new ParticleSystem(`fx-${kind}-${this.pools.get(kind)?.length ?? 0}`, CAPACITY, this.scene);
    ps.particleTexture = this.texture;
    ps.emitter = new Vector3();
    ps.emitRate = 0;
    ps.updateSpeed = 0.0166;
    switch (kind) {
      case "dust":
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.createSphereEmitter(0.25, 1);
        ps.color1 = new Color4(0.6, 0.6, 0.6, 0.55);
        ps.color2 = new Color4(0.45, 0.45, 0.45, 0.4);
        ps.colorDead = new Color4(0.4, 0.4, 0.4, 0);
        ps.minLifeTime = 0.6;
        ps.maxLifeTime = 1.5;
        ps.minEmitPower = 0.6;
        ps.maxEmitPower = 2.6;
        ps.gravity = new Vector3(0, -1.2, 0);
        ps.addSizeGradient(0, 0.6);
        ps.addSizeGradient(1, 2.2);
        ps.addDragGradient(0, 0.3);
        break;
      case "sparks":
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.createSphereEmitter(0.08, 1);
        ps.color1 = new Color4(1, 0.85, 0.5, 1);
        ps.color2 = new Color4(1, 0.55, 0.2, 1);
        ps.colorDead = new Color4(0.6, 0.1, 0, 0);
        ps.minLifeTime = 0.25;
        ps.maxLifeTime = 0.7;
        ps.minEmitPower = 4;
        ps.maxEmitPower = 11;
        ps.gravity = new Vector3(0, -9.81, 0);
        break;
      case "fire":
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.createSphereEmitter(0.4, 1);
        ps.color1 = new Color4(1, 0.75, 0.35, 0.9);
        ps.color2 = new Color4(1, 0.4, 0.1, 0.8);
        ps.colorDead = new Color4(0.25, 0.05, 0, 0);
        ps.minLifeTime = 0.18;
        ps.maxLifeTime = 0.5;
        ps.minEmitPower = 3;
        ps.maxEmitPower = 9;
        ps.addSizeGradient(0, 0.5);
        ps.addSizeGradient(1, 1.8);
        break;
      case "smoke":
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.createSphereEmitter(0.6, 1);
        ps.color1 = new Color4(0.16, 0.15, 0.15, 0.6);
        ps.color2 = new Color4(0.08, 0.08, 0.09, 0.5);
        ps.colorDead = new Color4(0.05, 0.05, 0.05, 0);
        ps.minLifeTime = 1.6;
        ps.maxLifeTime = 3.2;
        ps.minEmitPower = 0.8;
        ps.maxEmitPower = 3;
        ps.gravity = new Vector3(0, 1.1, 0); // buoyant plume
        ps.addSizeGradient(0, 0.5);
        ps.addSizeGradient(1, 2.6);
        ps.addDragGradient(0, 0.5);
        break;
      case "splash":
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.createConeEmitter(0.35, 1.1);
        ps.color1 = new Color4(0.55, 0.8, 1, 0.8);
        ps.color2 = new Color4(0.8, 0.93, 1, 0.7);
        ps.colorDead = new Color4(0.4, 0.6, 0.9, 0);
        ps.minLifeTime = 0.4;
        ps.maxLifeTime = 0.9;
        ps.minEmitPower = 2;
        ps.maxEmitPower = 5.5;
        ps.gravity = new Vector3(0, -9.81, 0);
        break;
    }
    return ps;
  }
}

/** [min, max] particle size in metres at scale 1. */
const BASE_SIZE: Record<BurstKind, [number, number]> = {
  dust: [0.25, 0.6],
  sparks: [0.03, 0.08],
  fire: [0.5, 1.3],
  smoke: [0.8, 1.8],
  splash: [0.05, 0.14],
};
