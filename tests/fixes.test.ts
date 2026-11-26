import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { ENVIRONMENTS } from "../src/environments";
import { Interpolator } from "../src/objects/Interpolator";
import { boundingRadius, findSpawnPosition } from "../src/objects/SpawnPlacement";
import { defaultSize } from "../src/objects/ObjectFactory";
import { captureExperiment, restoreExperiment, validateExperiment, SAVE_LIMITS } from "../src/persistence/Experiment";
import { PlayerController } from "../src/player/PlayerController";
import { GrabTool, throwImpulse } from "../src/tools/GrabTool";
import { createLab, simulate } from "./helpers";

const idle = { forward: 0, strafe: 0, sprint: false, jump: false };
const sys = (lab: any) => ({ environmentId: lab.env.id, world: lab.world, factory: lab.factory, joints: lab.joints, fields: lab.fields, water: lab.water, destruction: lab.destruction, roomBody: (n: string) => lab.env.roomBody(n) });

describe("fixed-step frame loop (H1)", () => {
  it("keeps real-time pace from 15 to 240 FPS and gives identical results at any frame rate", async () => {
    const results: number[] = [];
    for (const fps of [15, 20, 30, 60, 144, 240]) {
      const lab = await createLab(true);
      const tower = [...lab.factory.all].filter((o) => o.mesh.position.x === 5.5);
      let sim = 0;
      for (let i = 0; i < fps * 5; i++) sim += lab.world.advance(1 / fps);
      expect(sim).toBeGreaterThan(4.9); // 5 real seconds -> 5 simulated seconds
      expect(sim).toBeLessThanOrEqual(5.0001);
      results.push(tower[tower.length - 1].mesh.position.y);
      lab.dispose();
    }
    // Every step is exactly 1/60 s, so the outcome does not depend on the frame rate.
    for (const y of results) expect(Math.abs(y - results[0])).toBeLessThan(1e-4);
  });

  it("falls behind only below 15 FPS, never queues a backlog, and honours pause and time scale", async () => {
    const lab = await createLab();
    let sim = 0;
    for (let i = 0; i < 10; i++) sim += lab.world.advance(1 / 10); // 10 FPS for one second
    expect(sim).toBeCloseTo(10 * CONFIG.physics.maxSubSteps * CONFIG.physics.fixedStep, 5); // 0.67 s, was 0.33 s
    expect(lab.world.lastSteps).toBe(CONFIG.physics.maxSubSteps);
    expect(lab.world.advance(1 / 60)).toBeLessThanOrEqual(2 * CONFIG.physics.fixedStep); // no backlog burst afterwards
    lab.world.paused = true;
    expect(lab.world.advance(1)).toBe(0);
    lab.world.paused = false;
    lab.world.timeScale = 0.1;
    let steps = 0;
    for (let i = 0; i < 600; i++) {
      lab.world.advance(1 / 60);
      steps += lab.world.lastSteps;
      expect(lab.world.alpha).toBeGreaterThanOrEqual(0);
      expect(lab.world.alpha).toBeLessThanOrEqual(1);
    }
    expect(steps).toBeGreaterThanOrEqual(59); // 10 s at 0.1x = 1 s = 60 steps
    expect(steps).toBeLessThanOrEqual(61);
    lab.dispose();
  });

  it("interpolation draws between simulated states and restores the exact state before the next step", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const interp = new Interpolator(lab.factory);
    lab.world.onAfterStep.add(() => interp.capture());
    const o = lab.factory.spawn({ kind: "sphere", material: "rubber", position: new Vector3(0, 5, 10), linearVelocity: new Vector3(6, 0, 0), props: { linearDamping: 0 } })!;
    lab.world.advance(1 / 60);
    lab.world.advance(1 / 60);
    const prevX = o.mesh.position.x - 6 / 60;
    const currX = o.mesh.position.x;
    interp.apply(0.25);
    expect(o.mesh.position.x).toBeCloseTo(prevX + 0.25 * (currX - prevX), 4);
    expect(interp.simulatedPosition(o).x).toBeCloseTo(currX, 6);
    interp.restore();
    expect(o.mesh.position.x).toBeCloseTo(currX, 6);
    // The physics body never saw the interpolated transform.
    lab.world.advance(1 / 60);
    expect(o.mesh.position.x).toBeCloseTo(currX + 6 / 60, 3);
    lab.dispose();
  });
});

describe("throwing (H2)", () => {
  it("throws at the configured speed whatever the mass, slower only for very heavy objects", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const grab = new GrabTool(lab.world, lab.factory);
    const dir = new Vector3(0, 0, -1);
    const cases = [
      ["plastic", 0.1],
      ["glass", 0.15],
      ["wood", 0.6],
      ["steel", 0.9],
    ] as const;
    for (const [i, [material, size]] of cases.entries()) {
      const o = lab.factory.spawn({ kind: "box", material, size: new Vector3(size, size, size), position: new Vector3(-6 + i * 4, 3, 10), props: { linearDamping: 0 } })!;
      lab.world.step(1 / 60);
      expect(grab.throwOrPush(new Vector3(-6 + i * 4, 3, 13), dir)).toBe(o);
      lab.world.step(1 / 60);
      const expected = Math.min(CONFIG.interaction.throwSpeed, CONFIG.interaction.throwImpulse / o.props.mass);
      expect(-o.body.getLinearVelocity().z / expected).toBeCloseTo(1, 1);
      expect(-o.body.getLinearVelocity().z).toBeLessThanOrEqual(CONFIG.interaction.throwSpeed * 1.02);
    }
    expect(throwImpulse(1.1) / 1.1).toBeCloseTo(16, 5); // the 1.1 kg chip that used to leave at 2,381 m/s
    lab.dispose();
  });
});

describe("spawn placement (M4, M5)", () => {
  it("looking straight down spawns clear of the player and neither is flung away", async () => {
    const lab = await createLab();
    const p = new PlayerController(lab.scene, new Vector3(0, 1, 12), 0);
    for (let i = 0; i < 60; i++) p.update(1 / 60, idle);
    const p0 = p.position.clone();
    p.pitch = Math.PI / 2 - 0.02;
    const size = defaultSize("box");
    const r = boundingRadius("box", size);
    const pos = findSpawnPosition(lab.world, p.eyePosition, p.viewDirection, p.position, r)!;
    expect(pos).not.toBeNull();
    expect(Math.hypot(pos.x - p0.x, pos.z - p0.z)).toBeGreaterThanOrEqual(CONFIG.player.capsuleRadius + r);
    expect(pos.y - r).toBeGreaterThanOrEqual(0);
    const o = lab.factory.spawn({ kind: "box", position: pos })!;
    let maxV = 0;
    simulate(lab.world, 1, (dt) => {
      p.update(dt, idle);
      maxV = Math.max(maxV, o.body.getLinearVelocity().length());
    });
    expect(maxV).toBeLessThan(4); // it just drops to the floor (was 15.7 m/s)
    expect(Vector3.Distance(p.position, p0)).toBeLessThan(0.03); // player not shoved (was 0.2 m)
    lab.dispose();
  });

  it("never spawns inside a wall; refuses when there is no room", async () => {
    const lab = await createLab();
    const r = boundingRadius("box", defaultSize("box"));
    // 1.5 m from the east wall (inner face x = 18), facing it
    const player = new Vector3(16.5, 1, 0);
    const eye = new Vector3(16.5, 1.72, 0);
    const pos = findSpawnPosition(lab.world, eye, new Vector3(1, 0, 0), player, r)!;
    expect(pos).not.toBeNull();
    expect(pos.x + r).toBeLessThanOrEqual(18);
    const o = lab.factory.spawn({ kind: "box", position: pos })!;
    lab.world.step(1 / 60);
    expect(o.body.getLinearVelocity().length()).toBeLessThan(0.5); // not ejected
    // Nose against the wall: no room between the player and the wall
    expect(findSpawnPosition(lab.world, new Vector3(17.5, 1.72, 0), new Vector3(1, 0, 0), new Vector3(17.5, 1, 0), r)).toBeNull();
    // Open space: placed spawnDistance ahead
    const free = findSpawnPosition(lab.world, new Vector3(0, 1.72, 14), new Vector3(0, 0, -1), new Vector3(0, 1, 14), r)!;
    expect(free.z).toBeCloseTo(14 - CONFIG.interaction.spawnDistance, 3);
    lab.dispose();
  });
});

describe("robustness (L1, L2, L10)", () => {
  it("clamps extreme values in a save instead of loading them", async () => {
    const lab = await createLab();
    lab.factory.spawn({ kind: "box", position: new Vector3(0, 1, 10) });
    const d = JSON.parse(JSON.stringify(captureExperiment(sys(lab))));
    d.objects[0].position = [1e7, 1, 0];
    d.objects[0].linearVelocity = [1e9, 0, 0];
    d.objects[0].angularVelocity = [0, 1e6, 0];
    d.objects[0].rotation = [0, 0, 0, 0];
    d.fields.push({ kind: "attractor", position: [0, 3, 10], mu: 1e12, radius: 5000 });
    d.water.push({ position: [0, 1, 0], halfExtents: [1e6, 1, 1], density: -5 });
    d.player = { position: [1e9, 2, 3], yaw: 1, pitch: 99 };
    d.tool = "blast";
    const v = validateExperiment(d, ENVIRONMENTS.map((e) => e.id));
    expect(v.objects[0].position[0]).toBe(SAVE_LIMITS.position);
    expect(Math.hypot(...v.objects[0].linearVelocity)).toBeCloseTo(SAVE_LIMITS.speed, 5);
    expect(Math.hypot(...v.objects[0].angularVelocity)).toBeCloseTo(SAVE_LIMITS.spin, 5);
    expect(v.objects[0].rotation).toEqual([0, 0, 0, 1]);
    const f = v.fields[0];
    expect(f.kind === "attractor" && f.mu).toBe(SAVE_LIMITS.mu);
    expect(f.kind === "attractor" && f.radius).toBe(SAVE_LIMITS.fieldRadius);
    expect(v.water[0].halfExtents[0]).toBe(SAVE_LIMITS.extent);
    expect(v.water[0].density).toBe(1);
    expect(v.player).toEqual({ position: [SAVE_LIMITS.position, 2, 3], yaw: 1, pitch: 1.55 });
    expect(v.tool).toBe("blast");
    const dst = await createLab();
    restoreExperiment(v, sys(dst));
    simulate(dst.world, 0.5);
    lab.dispose();
    dst.dispose();
  });

  it("removes objects that leave the world in any direction", async () => {
    const lab = await createLab();
    const L = CONFIG.limits;
    lab.factory.spawn({ kind: "box", position: new Vector3(L.worldRadius + 5, 2, 0), props: { isStatic: true } });
    lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, -L.worldRadius - 5), props: { isStatic: true } });
    lab.factory.spawn({ kind: "box", position: new Vector3(0, L.worldCeiling + 5, 0), props: { isStatic: true } });
    lab.factory.spawn({ kind: "box", position: new Vector3(0, L.killPlaneY - 5, 0), props: { isStatic: true } });
    const keep = lab.factory.spawn({ kind: "box", position: new Vector3(10, 2, 10), props: { isStatic: true } })!;
    expect(lab.factory.cullOutOfBounds()).toBe(4);
    expect([...lab.factory.all]).toEqual([keep]);
    lab.dispose();
  });
});
