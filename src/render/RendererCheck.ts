import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { Scene } from "@babylonjs/core/scene";

export type RendererVerdict = "ok" | "blank" | "unavailable";

/**
 * Checks that the renderer is actually producing an image.
 *
 * WebGPU is new enough that it can initialise, report success, and then present nothing:
 * a lost device, a driver that refuses the swap chain, a compositor that drops the canvas.
 * Everything looks healthy from JavaScript and the person sees a black screen. The only
 * honest test is to look at pixels.
 *
 * The scene is drawn once into a small off-screen target rather than reading the canvas
 * back: a presented canvas often reads back black (the buffer has already been swapped),
 * which would condemn a renderer that is working perfectly well. An off-screen target is
 * owned by us until we read it, and it exercises the same device, pipeline and shaders.
 *
 * A real frame of the laboratory is never uniformly black, so "blank" means the renderer
 * is not working here. Any error gives "unavailable": absence of the check is not evidence
 * of failure, and a renderer is never condemned on a check that could not run.
 */
export async function verifyRendersFrames(scene: Scene): Promise<RendererVerdict> {
  if (!scene.activeCamera) return "unavailable";
  let target: RenderTargetTexture | null = null;
  try {
    target = new RenderTargetTexture("renderer-check", 64, scene, { generateMipMaps: false, generateDepthBuffer: true });
    target.renderList = null; // every mesh in the scene
    target.activeCamera = scene.activeCamera;
    target.clearColor = scene.clearColor.clone();
    target.render();
    const view = await target.readPixels();
    if (!view || view.byteLength === 0) return "unavailable";
    const pixels = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // One pixel that is not black is enough: the device is putting out an image.
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 4 || pixels[i + 1] > 4 || pixels[i + 2] > 4) return "ok";
    }
    return "blank";
  } catch {
    return "unavailable";
  } finally {
    target?.dispose();
  }
}
