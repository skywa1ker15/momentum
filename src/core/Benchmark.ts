import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG, type QualityLevel } from "./config";

/** What the benchmark needs from the application. Keeps the two testable apart. */
export interface BenchmarkHost {
  quality: QualityLevel;
  readonly rendererName: string;
  /** Loads an environment and repopulates it. */
  loadEnvironment(id: string): void;
  /** Spawns one box at a position. Returns false when the object limit stops it. */
  spawnProbe(position: Vector3): boolean;
  /** Sets off a blast of the given strength level at a point. */
  detonateAt(point: Vector3, level?: number): void;
  /** Number of physics bodies in the world. */
  readonly bodyCount: number;
  /** Render resolution actually in use, as a fraction of the window. */
  readonly renderScale: number;
}

export interface StageResult {
  name: string;
  /** What the stage is meant to stress, for the report. */
  what: string;
  avgFps: number;
  /** Frame rate at the 1% worst frames: the number stutter is felt at. */
  lowFps: number;
  worstFrameMs: number;
  frames: number;
  bodies: number;
}

export interface BenchmarkResult {
  quality: QualityLevel;
  renderer: string;
  renderScale: number;
  windowSize: string;
  devicePixelRatio: number;
  stages: StageResult[];
  /** Average across the loaded stages, which is what the preset should be judged on. */
  overallAvgFps: number;
  overallLowFps: number;
  /** The preset this machine should probably use, from the measurements. */
  recommended: QualityLevel;
  gpu: string;
}

interface Stage {
  name: string;
  what: string;
  /** Seconds of frames to record after `setUp` has run and the settle time has passed. */
  seconds: number;
  /** Time to let the scene settle before recording starts. */
  settle: number;
  setUp: (host: BenchmarkHost) => void;
  /** Called every recorded frame, for stages that keep adding load. */
  during?: (host: BenchmarkHost, elapsed: number) => void;
}

const CENTRE = new Vector3(0, 0.8, 0);
/** Index of the largest blast in CONFIG.explosion.levels. The stages want the heaviest load. */
const LARGE_BLAST = CONFIG.explosion.levels.length - 1;

/**
 * A fixed sequence of scenes, run the same way every time, so one machine can be
 * compared with another (or with itself after a change). Each stage is something the
 * laboratory actually does rather than a synthetic loop: standing still, a room full of
 * objects, a blast, and a wall being broken.
 */
const STAGES: Stage[] = [
  {
    name: "Idle",
    what: "empty room, nothing moving",
    seconds: 3,
    settle: 1,
    setUp: (h) => h.loadEnvironment("test-chamber"),
  },
  {
    name: "Loaded",
    what: "150 extra objects, all settling",
    seconds: 5,
    settle: 1.5,
    setUp: (h) => {
      // A block of boxes above the floor: they fall, collide and come to rest.
      let n = 0;
      for (let y = 0; y < 6 && n < 150; y++) {
        for (let x = -2; x <= 2 && n < 150; x++) {
          for (let z = -2; z <= 2 && n < 150; z++) {
            if (!h.spawnProbe(new Vector3(x * 0.8, 1.2 + y * 0.8, z * 0.8 - 2))) return;
            n++;
          }
        }
      }
    },
  },
  {
    name: "Blast",
    what: "that pile thrown by a large blast",
    seconds: 5,
    settle: 0,
    setUp: (h) => h.detonateAt(new Vector3(0, 0.6, -2), LARGE_BLAST),
  },
  {
    name: "Destruction",
    what: "arena wall broken into fragments",
    seconds: 6,
    settle: 2,
    setUp: (h) => h.loadEnvironment("destruction-arena"),
    during: (h, t) => {
      // Three blasts spread through the stage, so fragments are still being made while recording.
      if (t > 0.5 && t < 0.6) h.detonateAt(CENTRE, LARGE_BLAST);
      if (t > 2.5 && t < 2.6) h.detonateAt(new Vector3(2, 1, 0), LARGE_BLAST);
      if (t > 4 && t < 4.1) h.detonateAt(new Vector3(-2, 1, 1), LARGE_BLAST);
    },
  },
];

/** Frame rate at the 1% worst frames (at least one frame). */
function onePercentLow(frameTimes: number[]): number {
  if (frameTimes.length === 0) return 0;
  const sorted = [...frameTimes].sort((a, b) => b - a);
  const take = Math.max(1, Math.round(sorted.length * 0.01));
  let total = 0;
  for (let i = 0; i < take; i++) total += sorted[i];
  return 1000 / (total / take);
}

/**
 * Runs the stages and reports frame rates.
 *
 * It is driven by the application's own tick, one call per rendered frame, so it measures
 * the real loop rather than a loop of its own. Nothing here changes the simulation: it
 * spawns objects and sets off blasts exactly as a person would.
 */
export class Benchmark {
  /** Null when idle. Read by the HUD to show progress. */
  private state: { stage: number; phase: "settling" | "recording"; elapsed: number; frames: number[] } | null = null;
  private results: StageResult[] = [];
  private onDone: ((r: BenchmarkResult) => void) | null = null;
  private restoreQuality: QualityLevel | null = null;

  constructor(private readonly host: BenchmarkHost) {}

  get running(): boolean {
    return this.state !== null;
  }

  /** "Blast 3/4 · 2.1 s", or null when not running. */
  get progress(): string | null {
    const s = this.state;
    if (!s) return null;
    const stage = STAGES[s.stage];
    return `${stage.name} ${s.stage + 1}/${STAGES.length} · ${s.phase === "settling" ? "settling" : `${s.elapsed.toFixed(1)} s`}`;
  }

  /** Total seconds the run takes, so the interface can say how long to wait. */
  static get duration(): number {
    return STAGES.reduce((t, s) => t + s.seconds + s.settle, 0);
  }

  start(onDone: (r: BenchmarkResult) => void): void {
    if (this.state) return;
    this.onDone = onDone;
    this.results = [];
    this.restoreQuality = this.host.quality;
    this.beginStage(0);
  }

  cancel(): void {
    this.state = null;
    this.onDone = null;
  }

  private beginStage(index: number): void {
    const stage = STAGES[index];
    this.state = { stage: index, phase: stage.settle > 0 ? "settling" : "recording", elapsed: 0, frames: [] };
    stage.setUp(this.host);
  }

  /**
   * One call per rendered frame. `frameMs` is the wall-clock time that frame took,
   * which is what the person actually experiences, including the browser's own work.
   */
  update(frameMs: number): void {
    const s = this.state;
    if (!s) return;
    const stage = STAGES[s.stage];
    const dt = Math.min(frameMs, 250) / 1000; // a huge frame (a tab switch) must not skip a stage
    s.elapsed += dt;

    if (s.phase === "settling") {
      if (s.elapsed >= stage.settle) {
        s.phase = "recording";
        s.elapsed = 0;
      }
      return;
    }

    s.frames.push(frameMs);
    stage.during?.(this.host, s.elapsed);
    if (s.elapsed < stage.seconds) return;

    const total = s.frames.reduce((a, b) => a + b, 0);
    this.results.push({
      name: stage.name,
      what: stage.what,
      avgFps: s.frames.length / (total / 1000),
      lowFps: onePercentLow(s.frames),
      worstFrameMs: Math.max(...s.frames),
      frames: s.frames.length,
      bodies: this.host.bodyCount,
    });

    if (s.stage + 1 < STAGES.length) this.beginStage(s.stage + 1);
    else this.finish();
  }

  private finish(): void {
    const stages = this.results;
    this.state = null;
    // The idle stage says little about whether a preset is sustainable: judge on the loaded ones.
    const loaded = stages.slice(1);
    const avg = loaded.reduce((t, s) => t + s.avgFps, 0) / Math.max(1, loaded.length);
    const low = Math.min(...loaded.map((s) => s.lowFps));
    const result: BenchmarkResult = {
      quality: this.restoreQuality ?? this.host.quality,
      renderer: this.host.rendererName,
      renderScale: this.host.renderScale,
      windowSize: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      devicePixelRatio: window.devicePixelRatio,
      stages,
      overallAvgFps: avg,
      overallLowFps: low,
      recommended: recommendQuality(this.restoreQuality ?? this.host.quality, avg, low),
      gpu: describeGpu(),
    };
    const done = this.onDone;
    this.onDone = null;
    done?.(result);
  }
}

/**
 * Which preset this machine should use, given how the one it just ran performed.
 *
 * The target is 60 FPS with the 1% low above 45, i.e. smooth with no felt stutter. A
 * machine comfortably above that can afford the preset above; one below 45 average
 * should drop. Only ever one step, because a single run is weak evidence.
 */
export function recommendQuality(ran: QualityLevel, avgFps: number, lowFps: number): QualityLevel {
  const up: Record<QualityLevel, QualityLevel> = { low: "medium", medium: "high", high: "high" };
  const down: Record<QualityLevel, QualityLevel> = { low: "low", medium: "low", high: "medium" };
  if (avgFps >= 85 && lowFps >= 55) return up[ran];
  if (avgFps < 45 || lowFps < 28) return down[ran];
  return ran;
}

/** The GPU string the browser is willing to give, for the report. "unknown" is fine. */
export function describeGpu(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "unknown";
    const ext = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    const value = ext ? (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return typeof value === "string" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

/** The result as plain text, for the person to copy into a message. */
export function formatBenchmark(r: BenchmarkResult): string {
  const lines = [
    `MOMENTUM benchmark`,
    `preset ${r.quality} · ${r.renderer} · ${r.windowSize} @ ${r.devicePixelRatio}x · render scale ${r.renderScale.toFixed(2)}`,
    `gpu: ${r.gpu}`,
    "",
  ];
  for (const s of r.stages) {
    lines.push(`${s.name.padEnd(12)} ${s.avgFps.toFixed(0).padStart(4)} fps avg  ${s.lowFps.toFixed(0).padStart(4)} fps 1% low  worst ${s.worstFrameMs.toFixed(0)} ms  ${s.bodies} bodies`);
  }
  lines.push("", `under load: ${r.overallAvgFps.toFixed(0)} fps average, ${r.overallLowFps.toFixed(0)} fps 1% low`, `suggested preset: ${r.recommended}`);
  return lines.join("\n");
}
