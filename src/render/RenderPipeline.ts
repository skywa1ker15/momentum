import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import type { QualitySettings } from "../core/config";
import type { LabEnvironment } from "../environments/Environment";

/** Post-processing, glow and image-based reflections. All of this is visual only. */
export class RenderPipeline {
  private readonly pipeline: DefaultRenderingPipeline;
  private glow: GlowLayer | null = null;
  private probe: ReflectionProbe | null = null;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
  ) {
    scene.clearColor = new Color4(0.01, 0.012, 0.018, 1);
    scene.fogMode = 2; // Scene.FOGMODE_EXP2
    scene.fogDensity = 0.008;

    this.pipeline = new DefaultRenderingPipeline("momentum-pipeline", true, scene, [camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomThreshold = 0.82;
    this.pipeline.bloomWeight = 0.28;
    this.pipeline.bloomKernel = 56;
    this.pipeline.bloomScale = 0.5;
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.35;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.6;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
  }

  /** Renders the static environment once into a cube map used for PBR reflections. */
  bakeReflections(env: LabEnvironment): void {
    this.probe?.dispose();
    const probe = new ReflectionProbe("env-probe", 256, this.scene, true, true);
    probe.position.copyFrom(env.center);
    probe.position.y = 2.2;
    for (const m of env.staticMeshes) probe.renderList?.push(m);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.scene.environmentTexture = probe.cubeTexture;
    this.scene.environmentIntensity = 0.9;
    this.probe = probe;
    // The first capture can happen before every shader is compiled; capture again once the scene is ready.
    this.scene.executeWhenReady(() => {
      if (this.probe === probe) probe.cubeTexture.resetRefreshCounter();
    });
  }

  applyQuality(q: QualitySettings): void {
    this.pipeline.bloomEnabled = q.bloom;
    this.pipeline.samples = q.msaaSamples;
    if (q.glow && !this.glow) {
      this.glow = new GlowLayer("glow", this.scene, { mainTextureRatio: 0.5, blurKernelSize: 32 });
      this.glow.intensity = 0.45;
    } else if (!q.glow && this.glow) {
      this.glow.dispose();
      this.glow = null;
    }
  }
}
