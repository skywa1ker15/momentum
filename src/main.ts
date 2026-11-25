import { createEngine } from "./render/EngineFactory";
import { loadHavok } from "./physics/loadHavok";
import { App } from "./core/App";
import { showFatalError } from "./ui/Hud";

async function boot(): Promise<void> {
  const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui-root") as HTMLElement;
  try {
    const [{ engine, backend, fallbackReason }, havok] = await Promise.all([createEngine(canvas), loadHavok()]);
    if (fallbackReason) console.info(`[MOMENTUM] Using WebGL 2 (${fallbackReason}).`);
    engine.onContextLostObservable.add(() => {
      engine.stopRenderLoop();
      showFatalError(uiRoot, "Graphics device lost", "The browser lost its connection to the GPU. Reload the page to continue.");
    });
    const app = new App(engine, backend, canvas, uiRoot, havok);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
      (window as unknown as { __momentum: App }).__momentum = app;
    }
    app.start();
  } catch (err) {
    console.error("[MOMENTUM] start-up failed", err);
    showFatalError(uiRoot, "Unable to start", err instanceof Error ? err.message : String(err));
  }
}

void boot();
