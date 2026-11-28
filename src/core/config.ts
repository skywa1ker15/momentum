/** Central tuning values. Systems read from here instead of hard-coding numbers. */
export const CONFIG = {
  physics: {
    /** Standard gravity, m/s^2 along -Y. */
    gravity: -9.81,
    /** Fixed simulation step used by the frame loop (seconds). */
    fixedStep: 1 / 60,
    /** Most fixed steps taken in one frame; below 60 / maxSubSteps FPS the simulation falls behind real time. */
    maxSubSteps: 4,
    /** Largest single step PhysicsWorld.step() will take (seconds). */
    maxStep: 1 / 30,
    timeScales: [0.1, 0.25, 0.5, 1, 2] as readonly number[],
  },
  limits: {
    /** Hard cap on player-spawned / dynamic sandbox objects. */
    maxObjects: 350,
    /** Objects that fall out of the world below this height are removed. */
    killPlaneY: -30,
    /** Objects further than this from the room's centre horizontally, or above this height, are removed. */
    worldRadius: 70,
    worldCeiling: 90,
    /** Objects smaller than this volume (m^3) do not cast shadows. */
    shadowMinVolume: 0.004,
    /** Parked mesh/body pairs kept per shape+material, ready to be reused. */
    poolPerKind: 40,
    /** Parked pairs kept in total. Each costs a little memory and nothing per frame. */
    poolTotal: 220,
  },
  player: {
    capsuleHeight: 1.8,
    capsuleRadius: 0.35,
    eyeOffset: 0.72,
    walkSpeed: 5,
    sprintSpeed: 8.5,
    airSpeed: 5,
    jumpHeight: 1.1,
    mouseSensitivity: 0.0022,
    /** Mass the character uses when pushing dynamic bodies (kg). */
    mass: 80,
  },
  interaction: {
    reach: 7,
    holdDistance: 2.6,
    holdDistanceMin: 1.4,
    holdDistanceMax: 6,
    /** How quickly a held body closes the gap to the hold point (1/s). */
    holdStiffness: 14,
    holdMaxSpeed: 18,
    /** Bodies heavier than this lag behind the hold point proportionally (kg). */
    carryStrengthMass: 400,
    /** Throwing gives the object this speed (m/s)... */
    throwSpeed: 16,
    /** ...unless that would take more than this impulse (N*s): heavy objects are thrown more slowly. */
    throwImpulse: 2500,
    spawnDistance: 2.6,
    /** Radians of held-object rotation per pixel of mouse movement. */
    turnSpeed: 0.006,
  },
  force: {
    /** Selectable force magnitudes, N. */
    magnitudes: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as readonly number[],
    defaultLevel: 4,
    /** An impulse strike equals the selected force acting for this long (s). */
    impulseDuration: 0.25,
    reach: 30,
  },
  fields: {
    maxFields: 8,
    /** Selectable point-field strengths, m^3/s^2 (acceleration at 1 m). */
    strengths: [20, 60, 150, 400] as readonly number[],
    defaultMu: 60,
    /** Reach of a point field, m. */
    radius: 9,
    /** Distance below which the inverse-square law is capped, m. */
    minDistance: 0.75,
    zoneHalfExtents: [2.5, 3.5, 2.5] as readonly [number, number, number],
    /** Gravity magnitude inside a placed zone, m/s^2. */
    zoneGravity: 9.81,
  },
  joints: {
    maxJoints: 160,
    /** rad/s */
    defaultMotorSpeed: 4,
    maxMotorSpeed: 20,
    /** N m */
    motorMaxTorque: 20000,
    /** Slider travel either side of where it was created, m. */
    sliderTravel: 1.5,
    /** Spring natural frequency (Hz) and damping ratio, relative to the lighter body it joins. */
    springFrequency: 2.5,
    springDampingRatio: 0.15,
    /**
     * Havok's spring stiffness is in N/m (measured: frequency and amplitude match the ideal spring),
     * but its damping parameter is not N s/m: it damps several times harder. This factor was
     * calibrated by measurement so the configured damping ratio gives a lightly damped oscillation.
     */
    springDampingScale: 1 / 6,
  },
  explosion: {
    /** [name, impulse per unit area at 1 m (N s / m^2), reach (m)] */
    levels: [
      ["Small", 2500, 6],
      ["Medium", 9000, 10],
      ["Large", 30000, 16],
    ] as ReadonlyArray<readonly [string, number, number]>,
    defaultLevel: 1,
    /** Speed of the pressure front, m/s. Impulses are applied when the front reaches each body. */
    waveSpeed: 120,
    /** Closest distance used in the 1/r^2 law, m. */
    minDistance: 0.6,
    /** Share of the blast that reaches a body hidden behind another object. */
    shieldedFactor: 0.3,
    maxActiveWaves: 6,
  },
  water: {
    maxVolumes: 3,
    /** kg/m^3 */
    density: 1000,
    dragCoefficient: 1.0,
    /** Angular velocity lost per second when fully submerged (1/s). */
    angularDrag: 2.5,
    halfExtents: [3, 1.2, 3] as readonly [number, number, number],
  },
  destruction: {
    /** Selectable intensity levels. Break thresholds are divided by the multiplier; 0 disables destruction. */
    levels: [
      ["Off", 0],
      ["Low", 0.5],
      ["Normal", 1],
      ["High", 2],
    ] as ReadonlyArray<readonly [string, number]>,
    defaultLevel: 2,
    /** Fragments per fracture at normal intensity for an object of about 0.2 m^3. */
    basePieces: 7,
    maxPieces: 16,
    /** Fragments are never cut thinner than this (m). */
    minEdge: 0.09,
    /** Objects smaller than this volume (m^3), or already this many generations deep, do not fracture again. */
    minVolume: 0.012,
    maxGeneration: 2,
    /** Welded bonds break at this fraction of the weaker material's breakSpeed. */
    bondFactor: 0.5,
    /** Share of the impact's velocity change that becomes outward scatter of the fragments (modelled, momentum-neutral). */
    scatter: 0.3,
    /** Threshold multipliers when the other body is harder / softer than the object hit. */
    harderFactor: 0.8,
    softerFactor: 1.25,
    /** Hardness assumed for the room's floor, walls and fixtures (Mohs). */
    worldHardness: 6,
  },
  gravity: {
    min: -25,
    max: 25,
    presets: [
      ["Earth", -9.81],
      ["Moon", -1.62],
      ["Zero", 0],
      ["Reverse", 9.81],
    ] as ReadonlyArray<readonly [string, number]>,
  },
} as const;

export type QualityLevel = "low" | "medium" | "high";

export interface QualitySettings {
  /** Share of the display's native (physical) resolution to render at, before the height cap. */
  renderScale: number;
  /** Rendered height is capped at this many physical pixels. */
  maxRenderHeight: number;
  shadowMapSize: number;
  msaaSamples: number;
  bloom: boolean;
  glow: boolean;
  /** Frames between shadow-map redraws. 1 = every frame. */
  shadowRefresh: number;
  /** Film grain and lens fringing: two extra full-screen passes. Off on low. */
  filmic: boolean;
  /** Screen-space ambient occlusion: contact shadows where surfaces meet. Costs a depth pass. */
  ssao: boolean;
  /** Per-object motion blur. Costs a velocity pass; only worth it with frames to spare. */
  motionBlur: boolean;
}

/**
 * Presets are estimates for an RTX 2050-class GPU and have not been measured on one.
 * Dynamic resolution (see App) lowers the render scale further when the frame rate drops.
 */
export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { renderScale: 0.7, maxRenderHeight: 900, shadowMapSize: 1024, msaaSamples: 1, bloom: false, glow: false, shadowRefresh: 2, filmic: false, ssao: false, motionBlur: false },
  medium: { renderScale: 1, maxRenderHeight: 1080, shadowMapSize: 2048, msaaSamples: 1, bloom: true, glow: true, shadowRefresh: 1, filmic: true, ssao: false, motionBlur: false },
  high: { renderScale: 1, maxRenderHeight: 1440, shadowMapSize: 4096, msaaSamples: 2, bloom: true, glow: true, shadowRefresh: 1, filmic: true, ssao: true, motionBlur: true },
};

export const DYNAMIC_RESOLUTION = {
  /** Lowest extra scale dynamic resolution may apply on top of the preset. */
  minScale: 0.6,
  step: 0.1,
  /** Lower the scale after this long below `lowFps`; raise it after this long above `highFps` (seconds). */
  lowFps: 48,
  highFps: 57,
  lowerAfter: 1.5,
  raiseAfter: 4,
};

export const QUALITY_ORDER: readonly QualityLevel[] = ["low", "medium", "high"];
