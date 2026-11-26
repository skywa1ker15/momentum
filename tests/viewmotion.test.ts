import { describe, expect, it } from "vitest";
import { ViewMotion } from "../src/player/ViewMotion";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/core/Settings";
import { QUALITY, QUALITY_ORDER } from "../src/core/config";

interface RunArgs {
  speed: number;
  vy?: number;
  grounded?: boolean;
  strafe?: number;
  sprint?: boolean;
}

/** Runs `seconds` of updates at `fps` and reports the extremes of the vertical eye offset. */
function run(m: ViewMotion, seconds: number, fps: number, args: RunArgs) {
  const dt = 1 / fps;
  let min = 0;
  let max = 0;
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i++) {
    m.update(dt, args.speed, args.vy ?? 0, args.grounded ?? true, args.strafe ?? 0, args.sprint ?? false);
    min = Math.min(min, m.offset.y);
    max = Math.max(max, m.offset.y);
  }
  return { min, max, travel: max - min };
}

describe("view motion (visual camera movement)", () => {
  it("does nothing at all when disabled", () => {
    const m = new ViewMotion();
    m.enabled = false;
    run(m, 3, 60, { speed: 4 });
    expect(m.offset.x).toBe(0);
    expect(m.offset.y).toBe(0);
    expect(m.roll).toBe(0);
  });

  it("bobs the view while walking and settles back when standing still", () => {
    const m = new ViewMotion();
    const walking = run(m, 3, 60, { speed: 4 });
    expect(walking.travel).toBeGreaterThan(0.01);
    run(m, 2, 60, { speed: 0 });
    expect(Math.abs(m.offset.y)).toBeLessThan(0.002);
    expect(Math.abs(m.offset.x)).toBeLessThan(0.002);
  });

  it("bobs further at a sprint than at a walk", () => {
    const walk = run(new ViewMotion(), 4, 60, { speed: 4 });
    const sprint = run(new ViewMotion(), 4, 60, { speed: 4, sprint: true });
    expect(sprint.travel).toBeGreaterThan(walk.travel * 1.3);
  });

  it("stays within a few centimetres, so the view never leaves the head", () => {
    const m = new ViewMotion();
    const r = run(m, 6, 60, { speed: 6, sprint: true, strafe: 1 });
    expect(Math.abs(r.min)).toBeLessThan(0.2);
    expect(Math.abs(r.max)).toBeLessThan(0.2);
  });

  it("stays bounded at low frame rates, where a naive spring would diverge", () => {
    // 6 to 20 FPS: long frames. The landing spring must settle, not oscillate away.
    for (const fps of [6, 8, 10, 15, 20]) {
      const m = new ViewMotion();
      for (let i = 0; i < 10; i++) m.update(1 / fps, 0, -10, false, 0, false); // falling
      let worst = 0;
      for (let i = 0; i < 200; i++) {
        m.update(1 / fps, 4, 0, true, 1, true); // land, then keep walking
        worst = Math.max(worst, Math.abs(m.offset.y), Math.abs(m.offset.x));
        expect(Number.isFinite(m.offset.y)).toBe(true);
      }
      expect(worst, `at ${fps} FPS`).toBeLessThan(0.35);
      // And it must come to rest rather than ringing for ever.
      for (let i = 0; i < 200; i++) m.update(1 / fps, 0, 0, true, 0, false);
      expect(Math.abs(m.offset.y), `at ${fps} FPS`).toBeLessThan(0.01);
    }
  });

  it("gives the same bob depth at 30 and 144 FPS", () => {
    const slow = run(new ViewMotion(), 4, 30, { speed: 4 });
    const fast = run(new ViewMotion(), 4, 144, { speed: 4 });
    expect(Math.abs(slow.travel - fast.travel)).toBeLessThan(slow.travel * 0.2);
  });

  it("dips the view on landing, in proportion to the fall, then recovers", () => {
    const soft = new ViewMotion();
    const hard = new ViewMotion();
    // Fall, then touch down.
    for (let i = 0; i < 30; i++) soft.update(1 / 60, 0, -3, false, 0, false);
    for (let i = 0; i < 30; i++) hard.update(1 / 60, 0, -12, false, 0, false);
    let softDip = 0;
    let hardDip = 0;
    for (let i = 0; i < 20; i++) {
      soft.update(1 / 60, 0, 0, true, 0, false);
      hard.update(1 / 60, 0, 0, true, 0, false);
      softDip = Math.min(softDip, soft.offset.y);
      hardDip = Math.min(hardDip, hard.offset.y);
    }
    expect(hardDip).toBeLessThan(softDip);
    expect(hardDip).toBeLessThan(-0.005);
    // And it comes back: a dip that stayed would be a camera stuck in the floor.
    for (let i = 0; i < 120; i++) hard.update(1 / 60, 0, 0, true, 0, false);
    expect(Math.abs(hard.offset.y)).toBeLessThan(0.003);
  });

  it("rolls into a strafe and unrolls when the input stops", () => {
    const m = new ViewMotion();
    run(m, 1.5, 60, { speed: 4, strafe: 1 });
    const rolled = m.roll;
    expect(Math.abs(rolled)).toBeGreaterThan(0.005);
    run(m, 1.5, 60, { speed: 4, strafe: -1 });
    expect(Math.sign(m.roll)).toBe(-Math.sign(rolled));
    run(m, 2, 60, { speed: 4, strafe: 0 });
    expect(Math.abs(m.roll)).toBeLessThan(0.002);
  });
});

describe("settings and quality presets for the new visuals", () => {
  it("has a head-movement setting that survives a round trip and rejects rubbish", () => {
    expect(typeof DEFAULT_SETTINGS.viewMotion).toBe("boolean");
    expect(sanitizeSettings({ viewMotion: false }).viewMotion).toBe(false);
    expect(sanitizeSettings({ viewMotion: "yes" }).viewMotion).toBe(DEFAULT_SETTINGS.viewMotion);
  });

  it("keeps the costly effects off below the high preset", () => {
    expect(QUALITY.low.filmic).toBe(false);
    expect(QUALITY.medium.filmic).toBe(true);
    expect(QUALITY.low.ssao).toBe(false);
    expect(QUALITY.low.motionBlur).toBe(false);
    expect(QUALITY.medium.ssao).toBe(false);
    expect(QUALITY.medium.motionBlur).toBe(false);
    expect(QUALITY.high.ssao).toBe(true);
    expect(QUALITY.high.motionBlur).toBe(true);
  });

  it("never lowers quality as the preset rises", () => {
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      const lower = QUALITY[QUALITY_ORDER[i - 1]];
      const higher = QUALITY[QUALITY_ORDER[i]];
      expect(higher.shadowMapSize).toBeGreaterThanOrEqual(lower.shadowMapSize);
      expect(higher.maxRenderHeight).toBeGreaterThanOrEqual(lower.maxRenderHeight);
      expect(higher.renderScale).toBeGreaterThanOrEqual(lower.renderScale);
    }
  });
});
