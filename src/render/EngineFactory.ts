import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type RenderBackend = "WebGPU" | "WebGL2";

export interface EngineHandle {
  engine: AbstractEngine;
  backend: RenderBackend;
  /** Set when WebGPU was attempted and the app fell back. */
  fallbackReason?: string;
}

/**
 * Creates the rendering engine.
 *
 * WebGL 2 is the default because it is the path verified by the automated browser run.
 * `?renderer=webgpu` opts in to WebGPU (falling back to WebGL 2 if unavailable or if
 * initialisation fails). WebGPU becomes the default once it has been verified on real
 * GPU hardware - see docs/DEVLOG.md.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineHandle> {
  const requested = new URLSearchParams(location.search).get("renderer");
  let fallbackReason: string | undefined;

  if (requested === "webgpu" && !("gpu" in navigator)) {
    fallbackReason = "this browser has no WebGPU support";
  } else if (requested === "webgpu") {
    try {
      const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          powerPreference: "high-performance",
          adaptToDeviceRatio: false,
        });
        await engine.initAsync();
        return { engine, backend: "WebGPU" };
      }
      fallbackReason = "WebGPU adapter unavailable";
    } catch (err) {
      fallbackReason = `WebGPU init failed: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[MOMENTUM]", fallbackReason);
    }
  }

  const { Engine } = await import("@babylonjs/core/Engines/engine");
  const engine = new Engine(canvas, true, {
    stencil: true,
    powerPreference: "high-performance",
    adaptToDeviceRatio: false,
  });
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error("This browser supports neither WebGPU nor WebGL 2.");
  }
  return { engine, backend: "WebGL2", fallbackReason };
}
