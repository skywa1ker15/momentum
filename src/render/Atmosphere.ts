import "@babylonjs/core/Particles/particleSystemComponent";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { LabEnvironment } from "../environments/Environment";
import type { Lighting } from "./Lighting";

const UP = Vector3.Up();

/**
 * Ambient atmosphere: airborne dust that drifts through the room, hazy shafts under the
 * accent lights, and a very slow breathing of the light intensity.
 *
 * All of it is decoration. Nothing here is read by the simulation, nothing collides, and
 * every part can be switched off (or scaled down) without changing an experiment's result.
 * The dust follows the camera so a fixed, small particle count covers wherever the player is.
 */
export class Atmosphere {
  /** 0 = off, 1 = full particle count. Driven by the graphics preset and the frame rate. */
  private density = 1;
  private readonly dust: ParticleSystem;
  private readonly texture: DynamicTexture;
  private readonly shafts: Mesh[] = [];
  private readonly shaftMaterial: StandardMaterial;
  private readonly shaftFade: DynamicTexture;
  private readonly baseIntensities: number[] = [];
  private time = 0;
  private readonly emitterCentre = new Vector3();

  constructor(
    scene: Scene,
    env: LabEnvironment,
    private readonly lighting: Lighting,
  ) {
    const size = 32;
    this.texture = new DynamicTexture("tex-dust", { width: size, height: size }, scene, false);
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.texture.update();
    this.texture.hasAlpha = true;

    const dust = new ParticleSystem("fx-dust", 420, scene);
    dust.particleTexture = this.texture;
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    // A tall box around the player: motes are born anywhere in it and drift slowly.
    dust.createBoxEmitter(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(-9, -1.5, -9), new Vector3(9, 7, 9));
    dust.minSize = 0.012;
    dust.maxSize = 0.045;
    dust.minLifeTime = 6;
    dust.maxLifeTime = 14;
    dust.minEmitPower = 0.015;
    dust.maxEmitPower = 0.09;
    dust.emitRate = 70;
    dust.gravity = new Vector3(0, -0.015, 0);
    dust.updateSpeed = 0.012;
    dust.isLocal = false;
    this.dust = dust;

    // A beam with a constant alpha ends in a hard disc at the lamp and a hard ellipse where
    // it meets the floor. This gradient fades it out at both ends so it reads as haze.
    this.shaftFade = new DynamicTexture("tex-shaft-fade", { width: 4, height: 64 }, scene, false);
    const fctx = this.shaftFade.getContext() as unknown as CanvasRenderingContext2D;
    const grad = fctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.18, "rgba(190,190,190,1)");
    grad.addColorStop(0.55, "rgba(120,120,120,1)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    fctx.fillStyle = grad;
    fctx.fillRect(0, 0, 4, 64);
    this.shaftFade.update();

    this.shaftMaterial = new StandardMaterial("mat-light-shaft", scene);
    this.shaftMaterial.disableLighting = true;
    this.shaftMaterial.emissiveColor = Color3.White();
    this.shaftMaterial.alphaMode = Constants.ALPHA_ADD;
    this.shaftMaterial.alpha = 0.07;
    this.shaftMaterial.backFaceCulling = false;
    this.shaftMaterial.emissiveTexture = this.shaftFade;
    this.shaftMaterial.disableDepthWrite = true;

    for (let i = 0; i < 2; i++) {
      // Narrow at the lamp, wide at the floor: the shape a spot beam cuts through haze.
      const cone = CreateCylinder(`fx-shaft-${i}`, { height: 1, diameterTop: 0.5, diameterBottom: 7.5, tessellation: 22, cap: 0 }, scene);
      cone.material = this.shaftMaterial;
      cone.isPickable = false;
      cone.doNotSyncBoundingInfo = true;
      cone.rotationQuaternion = Quaternion.Identity();
      cone.renderingGroupId = 0;
      cone.alwaysSelectAsActiveMesh = true;
      this.shafts.push(cone);
    }

    this.applyEnvironment(env);
  }

  /** Re-tints and re-aims everything for a new room. */
  applyEnvironment(env: LabEnvironment): void {
    const tint = env.lightRig.spotColor;
    const c = new Color4(tint.r, tint.g, tint.b, 1);
    this.dust.color1 = new Color4(c.r, c.g, c.b, 0.3);
    this.dust.color2 = new Color4(1, 1, 1, 0.16);
    this.dust.colorDead = new Color4(c.r, c.g, c.b, 0);
    this.shaftMaterial.emissiveColor = tint.scale(0.85);
    this.emitterCentre.copyFrom(env.center);

    env.lightRig.spots.forEach((spot, i) => {
      const cone = this.shafts[i];
      if (!cone) return;
      // Stretch the cone from the lamp down to roughly the floor, and point it along the beam.
      const length = Math.max(3, spot.position.y - 0.6);
      cone.scaling.set(1, length, 1);
      const dir = spot.direction.normalizeToNew();
      cone.position.copyFrom(spot.position).addInPlace(dir.scale(length / 2));
      // The cylinder's axis is +Y; rotate +Y onto the beam direction (the beam points down, so -Y).
      const axis = Vector3.Cross(UP, dir.scale(-1));
      const dot = Math.min(1, Math.max(-1, Vector3.Dot(UP, dir.scale(-1))));
      if (axis.lengthSquared() < 1e-8) {
        Quaternion.RotationAxisToRef(UP, dot > 0 ? 0 : Math.PI, cone.rotationQuaternion!);
      } else {
        Quaternion.RotationAxisToRef(axis.normalize(), Math.acos(dot), cone.rotationQuaternion!);
      }
    });

    this.baseIntensities.length = 0;
    for (const s of this.lighting.spotLights) this.baseIntensities.push(s.intensity);
    this.setDensity(this.density);
  }

  /**
   * 0 switches the atmosphere off entirely (low graphics preset or a sagging frame rate);
   * 1 is the full effect. In between scales the particle count and the haze.
   */
  setDensity(density: number): void {
    this.density = Math.min(1, Math.max(0, density));
    const on = this.density > 0.01;
    this.dust.emitRate = 70 * this.density;
    this.shaftMaterial.alpha = 0.07 * this.density;
    for (const s of this.shafts) s.setEnabled(on);
    if (on && !this.dust.isStarted()) this.dust.start();
    else if (!on && this.dust.isStarted()) this.dust.stop(true);
  }

  /** Keeps the dust around the viewer and breathes the accent lights. `dt` is real seconds. */
  update(dt: number, eye: Vector3): void {
    if (this.density <= 0.01) return;
    this.time += dt;
    // Follow the camera horizontally only, so motes do not visibly slide when the player jumps.
    const emitter = this.dust.emitter as Vector3;
    if (emitter instanceof Vector3) emitter.set(eye.x, this.emitterCentre.y, eye.z);
    // ±4% over about 11 seconds: enough to feel alive, not enough to read as flicker.
    const lights = this.lighting.spotLights;
    for (let i = 0; i < lights.length; i++) {
      const base = this.baseIntensities[i];
      if (base === undefined) continue;
      lights[i].intensity = base * (1 + 0.04 * Math.sin(this.time * 0.57 + i * 1.9));
    }
  }

  dispose(): void {
    this.dust.dispose();
    for (const s of this.shafts) s.dispose();
    this.shaftMaterial.dispose();
    this.shaftFade.dispose();
    this.texture.dispose();
  }
}
