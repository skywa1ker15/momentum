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

/** Key/fill lighting for an enclosed lab, with one shadow-casting key light. */
export class Lighting {
  readonly key: DirectionalLight;
  private shadows: ShadowGenerator;

  constructor(
    scene: Scene,
    private readonly env: LabEnvironment,
    shadowMapSize: number,
  ) {
    const fill = new HemisphericLight("light-fill", new Vector3(0, 1, 0), scene);
    fill.intensity = 0.95;
    fill.diffuse = new Color3(0.72, 0.82, 1.0);
    fill.groundColor = new Color3(0.16, 0.18, 0.24);
    fill.specular = Color3.Black();

    this.key = new DirectionalLight("light-key", new Vector3(-0.35, -1, 0.25).normalize(), scene);
    this.key.position = env.center.add(new Vector3(8, 14, -6));
    this.key.intensity = 3.2;
    this.key.diffuse = new Color3(0.93, 0.96, 1.0);
    this.key.autoUpdateExtends = false;
    this.key.orthoLeft = -30;
    this.key.orthoRight = 30;
    this.key.orthoTop = 34;
    this.key.orthoBottom = -34;
    this.key.shadowMinZ = 1;
    this.key.shadowMaxZ = 40;

    for (const [x, z] of [[-7, -6], [7, -6]] as const) {
      const spot = new SpotLight(`light-spot-${x}`, new Vector3(x, 10.5, z), new Vector3(-x * 0.09, -1, 0).normalize(), 1.15, 6, scene);
      spot.intensity = 150;
      spot.diffuse = new Color3(0.6, 0.9, 1.0);
      spot.range = 22;
    }

    this.shadows = this.createShadows(shadowMapSize);
  }

  addCaster(mesh: AbstractMesh): void {
    this.shadows.addShadowCaster(mesh, false);
  }

  removeCaster(mesh: AbstractMesh): void {
    this.shadows.removeShadowCaster(mesh, false);
  }

  setShadowMapSize(size: number): void {
    if (this.shadows.getShadowMap()?.getSize().width === size) return;
    const casters = this.shadows.getShadowMap()?.renderList?.slice() ?? [];
    this.shadows.dispose();
    this.shadows = this.createShadows(size, casters);
  }

  private createShadows(size: number, casters?: AbstractMesh[]): ShadowGenerator {
    const gen = new ShadowGenerator(size, this.key);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    gen.bias = 0.0015;
    gen.normalBias = 0.02;
    gen.darkness = 0.15;
    for (const m of casters ?? this.env.shadowCasters) gen.addShadowCaster(m, false);
    return gen;
  }
}
