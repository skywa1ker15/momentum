/** Central tuning values. Systems read from here instead of hard-coding numbers. */
export const CONFIG = {
  physics: {
    /** Standard gravity, m/s^2 along -Y. */
    gravity: -9.81,
    /** Largest simulation step taken in one frame (seconds). Keeps the solver stable on frame hitches. */
    maxStep: 1 / 30,
    timeScales: [0.1, 0.25, 0.5, 1, 2] as readonly number[],
  },
  limits: {
    /** Hard cap on player-spawned / dynamic sandbox objects. */
    maxObjects: 250,
    /** Objects that fall out of the world below this height are removed. */
    killPlaneY: -30,
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
    /** Impulse (N*s) applied when throwing or pushing. */
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
    maxJoints: 64,
    /** rad/s */
    defaultMotorSpeed: 4,
    maxMotorSpeed: 20,
    /** N m */
    motorMaxTorque: 20000,
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
  /** Upper bound on rendered pixels per CSS pixel (capped by the display's devicePixelRatio). */
  pixelRatio: number;
  shadowMapSize: number;
  msaaSamples: number;
  bloom: boolean;
  glow: boolean;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { pixelRatio: 0.67, shadowMapSize: 1024, msaaSamples: 1, bloom: false, glow: false },
  medium: { pixelRatio: 1, shadowMapSize: 2048, msaaSamples: 1, bloom: true, glow: true },
  high: { pixelRatio: 2, shadowMapSize: 4096, msaaSamples: 4, bloom: true, glow: true },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ["low", "medium", "high"];
