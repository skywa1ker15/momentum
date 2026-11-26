import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { LabEnvironment } from "../environments/Environment";

/** Key/fill lighting for an enclosed lab, with one shadow-casting key light. Re-rigged when the environment changes. */
export class Lighting {
  readonly key: DirectionalLight;
  private readonly spots: SpotLight[] = [];
  private shadows: ShadowGenerator;
  private shadowMapSize: number;

  constructor(scene: Scene, env: LabEnvironment, shadowMapSize: number) {
    const fill = new HemisphericLight("light-fill", new Vector3(0, 1, 0), scene);
    fill.intensity = 0.95;
    fill.diffuse = new Color3(0.72, 0.82, 1.0);
    fill.groundColor = new Color3(0.16, 0.18, 0.24);
    fill.specular = Color3.Black();

    this.key = new DirectionalLight("light-key", new Vector3(-0.35, -1, 0.25).normalize(), scene);
    this.key.intensity = 3.2;
    this.key.diffuse = new Color3(0.93, 0.96, 1.0);
    this.key.autoUpdateExtends = false;
    this.key.orthoLeft = -30;
    this.key.orthoRight = 30;
    this.key.orthoTop = 34;
    this.key.orthoBottom = -34;
    this.key.shadowMinZ = 1;
    this.key.shadowMaxZ = 44;

    for (let i = 0; i < 2; i++) {
      const spot = new SpotLight(`light-spot-${i}`, Vector3.Zero(), Vector3.Down(), 1.15, 6, scene);
      spot.intensity = 150;
      spot.range = 24;
      this.spots.push(spot);
    }

    this.shadowMapSize = shadowMapSize;
    this.shadows = this.createShadows([]);
    this.applyEnvironment(env);
  }

  /** The accent spot lights, for effects that modulate them. */
  get spotLights(): readonly SpotLight[] {
    return this.spots;
  }

  /** Positions the lights for an environment and resets shadow casters to its static casters. */
  applyEnvironment(env: LabEnvironment): void {
    this.key.position = env.center.add(new Vector3(8, 16, -6));
    env.lightRig.spots.forEach((s, i) => {
      this.spots[i].position.copyFrom(s.position);
      this.spots[i].direction.copyFrom(s.direction);
      this.spots[i].diffuse = env.lightRig.spotColor;
    });
    this.shadows.dispose();
    this.shadows = this.createShadows(env.shadowCasters);
  }

  addCaster(mesh: AbstractMesh): void {
    this.shadows.addShadowCaster(mesh, false);
  }

  removeCaster(mesh: AbstractMesh): void {
    this.shadows.removeShadowCaster(mesh, false);
  }

  setShadowMapSize(size: number): void {
    if (this.shadowMapSize === size) return;
    this.shadowMapSize = size;
    const casters = this.shadows.getShadowMap()?.renderList?.slice() ?? [];
    this.shadows.dispose();
    this.shadows = this.createShadows(casters);
  }

  private createShadows(casters: AbstractMesh[]): ShadowGenerator {
    const gen = new ShadowGenerator(this.shadowMapSize, this.key);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    gen.bias = 0.0015;
    gen.normalBias = 0.02;
    gen.darkness = 0.15;
    for (const m of casters) gen.addShadowCaster(m, false);
    return gen;
  }
}
