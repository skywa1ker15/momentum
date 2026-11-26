import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import "@babylonjs/core/Rendering/boundingBoxRenderer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import type { MotionBlurPostProcess } from "@babylonjs/core/PostProcesses/motionBlurPostProcess";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import type { QualitySettings } from "../core/config";
import type { LabEnvironment } from "../environments/Environment";

/** Post-processing, glow and image-based reflections. All of this is visual only. */
export class RenderPipeline {
  private readonly pipeline: DefaultRenderingPipeline;
  private glow: GlowLayer | null = null;
  private probe: ReflectionProbe | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private motionBlur: MotionBlurPostProcess | null = null;
  /** Bumped whenever quality changes, so an import that lands late is discarded. */
  private qualityEpoch = 0;
  private readonly camera: Camera;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
  ) {
    this.camera = camera;
    scene.clearColor = new Color4(0.01, 0.012, 0.018, 1);
    scene.fogMode = 2; // Scene.FOGMODE_EXP2
    scene.fogDensity = 0.008;

    // Selection outline (bounding box of the inspected object)
    const bbox = scene.getBoundingBoxRenderer();
    bbox.frontColor = new Color3(0.35, 0.85, 1);
    bbox.showBackLines = false;

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

    // A light sharpen recovers the micro-detail that FXAA and any upscaling soften.
    this.pipeline.sharpenEnabled = true;
    this.pipeline.sharpen.edgeAmount = 0.22;
    this.pipeline.sharpen.colorAmount = 1;
    // Barely-there grain and edge fringing: they break up flat gradients and read as a lens
    // rather than a render. One full-screen pass each, so they are off on the low preset.
    this.pipeline.grain.intensity = 3.5;
    this.pipeline.grain.animated = true;
    this.pipeline.chromaticAberration.aberrationAmount = 2.2;
    this.pipeline.chromaticAberration.radialIntensity = 0.65;
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
    this.pipeline.grainEnabled = q.filmic;
    this.pipeline.chromaticAberrationEnabled = q.filmic;
    this.qualityEpoch++;
    void this.setAmbientOcclusion(q.ssao, this.qualityEpoch);
    void this.setMotionBlur(q.motionBlur, this.qualityEpoch);
    if (q.glow && !this.glow) {
      this.glow = new GlowLayer("glow", this.scene, { mainTextureRatio: 0.5, blurKernelSize: 32 });
      this.glow.intensity = 0.45;
    } else if (!q.glow && this.glow) {
      this.glow.dispose();
      this.glow = null;
    }
  }

  /**
   * Contact darkening where surfaces meet, which is what makes a stack of boxes read as
   * resting on the floor rather than floating above it. Needs float render targets; when the
   * device cannot do them it is skipped silently and the scene just looks flatter.
   */
  private async setAmbientOcclusion(on: boolean, epoch: number): Promise<void> {
    if (on === (this.ssao !== null)) return;
    if (!on) {
      this.ssao?.dispose();
      this.ssao = null;
      return;
    }
    try {
      // Loaded on demand: only someone running the high preset downloads this code.
      const { SSAO2RenderingPipeline } = await import("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline");
      if (epoch !== this.qualityEpoch || this.scene.isDisposed) return;
      const ssao = new SSAO2RenderingPipeline("momentum-ssao", this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [this.camera], false);
      if (!SSAO2RenderingPipeline.IsSupported) {
        ssao.dispose();
        return;
      }
      ssao.radius = 1.1;
      ssao.totalStrength = 0.9;
      ssao.samples = 12;
      ssao.maxZ = 40;
      ssao.expensiveBlur = false;
      ssao.base = 0.05;
      this.ssao = ssao;
    } catch {
      this.ssao = null; // unsupported on this device: carry on without it
    }
  }

  /**
   * Camera-motion blur (not per-object): quick turns and sprints smear slightly, which hides
   * the stepping you would otherwise see on a fast pan. Kept low so nothing reads as smeared.
   */
  private async setMotionBlur(on: boolean, epoch: number): Promise<void> {
    if (on === (this.motionBlur !== null)) return;
    if (!on) {
      this.motionBlur?.dispose();
      this.motionBlur = null;
      return;
    }
    try {
      const { MotionBlurPostProcess } = await import("@babylonjs/core/PostProcesses/motionBlurPostProcess");
      if (epoch !== this.qualityEpoch || this.scene.isDisposed) return;
      const mb = new MotionBlurPostProcess("momentum-motion-blur", this.scene, 1, this.camera);
      mb.motionStrength = 0.35;
      mb.motionBlurSamples = 10;
      mb.isObjectBased = false; // screen-space from the camera matrix: no velocity pass needed
      this.motionBlur = mb;
    } catch {
      this.motionBlur = null;
    }
  }
}
