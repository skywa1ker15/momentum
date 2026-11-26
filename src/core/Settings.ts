import { QUALITY_ORDER, type QualityLevel } from "./config";

export interface Settings {
  quality: QualityLevel;
  /** Multiplier on the base mouse sensitivity (0.3 .. 3). */
  sensitivity: number;
  /** Vertical field of view in degrees (55 .. 100). */
  fov: number;
  invertY: boolean;
  /** Master volume, 0 .. 1. */
  volume: number;
  /** Lower the render resolution automatically when the frame rate drops. */
  dynamicResolution: boolean;
  /** Shake the camera on nearby blasts. Off by default when the system asks for reduced motion. */
  cameraShake: boolean;
  /** Renderer to use on the next start. WebGPU is experimental and falls back to WebGL 2. */
  renderer: "webgl2" | "webgpu";
  /** Getting-started checklist dismissed or completed. */
  hintsDone: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: "medium",
  sensitivity: 1,
  fov: 64,
  invertY: false,
  volume: 0.6,
  dynamicResolution: true,
  cameraShake: !prefersReducedMotion(),
  renderer: "webgl2",
  hintsDone: false,
};

const KEY = "momentum.settings";
const LEGACY_QUALITY_KEY = "momentum.quality";

const clamp = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Coerces arbitrary data into valid settings; anything missing or malformed takes its default. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    quality: (QUALITY_ORDER as readonly unknown[]).includes(r.quality) ? (r.quality as QualityLevel) : d.quality,
    sensitivity: clamp(r.sensitivity, 0.3, 3, d.sensitivity),
    fov: clamp(r.fov, 55, 100, d.fov),
    invertY: typeof r.invertY === "boolean" ? r.invertY : d.invertY,
    volume: clamp(r.volume, 0, 1, d.volume),
    dynamicResolution: typeof r.dynamicResolution === "boolean" ? r.dynamicResolution : d.dynamicResolution,
    cameraShake: typeof r.cameraShake === "boolean" ? r.cameraShake : d.cameraShake,
    renderer: r.renderer === "webgpu" ? "webgpu" : "webgl2",
    hintsDone: typeof r.hintsDone === "boolean" ? r.hintsDone : d.hintsDone,
  };
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return sanitizeSettings(JSON.parse(stored));
    // Carry over the quality choice saved by earlier versions.
    return sanitizeSettings({ quality: localStorage.getItem(LEGACY_QUALITY_KEY) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
