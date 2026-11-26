import { createEngine } from "./render/EngineFactory";
import { loadHavok } from "./physics/loadHavok";
import { App } from "./core/App";
import { loadSettings, saveSettings } from "./core/Settings";
import { showFatalError } from "./ui/Hud";

const bootScreen = () => document.getElementById("boot");
/**
 * Updates the loading screen. `progress` (0..1) drives a real bar rather than a
 * looping one, so the wait has an end in sight; it eases to 100% as the stages pass.
 */
function bootStatus(text: string, progress?: number): void {
  const el = document.getElementById("boot-status");
  if (el) el.textContent = text;
  const bar = document.getElementById("boot-bar");
  if (bar && progress !== undefined) {
    bar.classList.add("determinate");
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }
}

/** Fades the loading screen out instead of cutting it, so the lab appears rather than blinks in. */
function hideBootScreen(): void {
  const el = bootScreen();
  if (!el) return;
  el.classList.add("done");
  const remove = () => el.remove();
  el.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, 600); // in case the transition never fires (reduced motion, hidden tab)
}

/** WebGPU is experimental: if it was chosen and anything goes wrong, go back to WebGL 2 for the next start. */
function revertRenderer(): void {
  const s = loadSettings();
  if (s.renderer === "webgpu") saveSettings({ ...s, renderer: "webgl2" });
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui-root") as HTMLElement;
  try {
    bootStatus("Starting renderer and physics engine", 0.12);
    const preferred = loadSettings().renderer;
    const [{ engine, backend, fallbackReason }, havok] = await Promise.all([createEngine(canvas, preferred), loadHavok()]);
    if (fallbackReason) {
      console.info(`[MOMENTUM] Using WebGL 2 (${fallbackReason}).`);
      revertRenderer();
    }
    engine.onContextLostObservable.add(() => {
      engine.stopRenderLoop();
      if (backend === "WebGPU") revertRenderer();
      showFatalError(uiRoot, "Graphics device lost", "The browser lost its connection to the GPU. Reload the page to continue.");
    });
    bootStatus("Building the laboratory", 0.55);
    await new Promise((r) => requestAnimationFrame(r)); // let the status text paint before the heavy work
    const app = new App(engine, backend, canvas, uiRoot, havok);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
      (window as unknown as { __momentum: App }).__momentum = app;
    }
    app.start();
    bootStatus("Ready", 1);
    hideBootScreen();
  } catch (err) {
    console.error("[MOMENTUM] start-up failed", err);
    revertRenderer();
    bootScreen()?.remove();
    showFatalError(uiRoot, "Unable to start", err instanceof Error ? err.message : String(err));
  }
}

void boot();
