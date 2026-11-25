import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { primitiveVolume } from "../src/objects/ObjectFactory";
import { createLab, simulate } from "./helpers";

describe("physics world", () => {
  it("free fall matches g*t^2/2 and the sphere comes to rest on the floor", async () => {
    const lab = await createLab();
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(3, 6, 3), size: new Vector3(0.7, 0.7, 0.7) })!;
    simulate(lab.world, 0.5);
    const expected = 6 - 0.5 * 9.81 * lab.world.simTime ** 2;
    expect(ball.mesh.position.y).toBeGreaterThan(expected - 0.15);
    expect(ball.mesh.position.y).toBeLessThan(expected + 0.15);
    simulate(lab.world, 4);
    expect(ball.mesh.position.y).toBeCloseTo(0.35, 1);
    expect(ball.body.getLinearVelocity().length()).toBeLessThan(0.05);
    lab.dispose();
  });

  it("pause freezes the simulation and time scale slows it", async () => {
    const lab = await createLab();
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(0, 5, 3) })!;
    lab.world.paused = true;
    simulate(lab.world, 1);
    expect(box.mesh.position.y).toBe(5);
    expect(lab.world.simTime).toBe(0);
    lab.world.paused = false;
    lab.world.timeScale = 0.25;
    simulate(lab.world, 1);
    expect(lab.world.simTime).toBeCloseTo(0.25, 1);
    expect(box.mesh.position.y).toBeGreaterThan(4.5);
    expect(box.mesh.position.y).toBeLessThan(4.9);
    lab.dispose();
  });

  it("clamps oversized frame deltas", async () => {
    const lab = await createLab();
    expect(lab.world.step(1)).toBeCloseTo(CONFIG.physics.maxStep, 6);
    lab.dispose();
  });

  it("mass is density times volume", async () => {
    const lab = await createLab();
    const size = new Vector3(1, 0.5, 2);
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, 3), size })!;
    expect(primitiveVolume("box", size)).toBeCloseTo(1, 6);
    expect(box.body.getMassProperties().mass).toBeCloseTo(box.mass, 3);
    expect(primitiveVolume("sphere", new Vector3(1, 1, 1))).toBeCloseTo(Math.PI / 6, 6);
    lab.dispose();
  });

  it("walls contain a fast projectile", async () => {
    const lab = await createLab();
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 2, 0), linearVelocity: new Vector3(40, 0, 0) })!;
    simulate(lab.world, 3);
    expect(Math.abs(ball.mesh.position.x)).toBeLessThan(18);
    lab.dispose();
  });

  it("spheres roll down the inclined plane; the crate pyramid stays standing", async () => {
    const lab = await createLab(true);
    const spheres = [...lab.factory.all].filter((o) => o.kind === "sphere");
    const crates = [...lab.factory.all].filter((o) => o.kind === "box" && o.mesh.position.z === -6);
    const startZ = spheres.map((s) => s.mesh.position.z);
    const top = crates.reduce((a, b) => (a.mesh.position.y > b.mesh.position.y ? a : b));
    const topY = top.mesh.position.y;
    simulate(lab.world, 5);
    spheres.forEach((s, i) => expect(s.mesh.position.z).toBeGreaterThan(startZ[i] + 5));
    expect(top.mesh.position.y).toBeCloseTo(topY, 1);
    lab.dispose();
  });
});

describe("object management", () => {
  it("enforces the object limit and removes bodies on delete", async () => {
    const lab = await createLab();
    const staticBodies = lab.world.bodyCount;
    for (let i = 0; i < CONFIG.limits.maxObjects; i++) {
      expect(lab.factory.spawn({ kind: "box", position: new Vector3((i % 20) - 10, 1 + Math.floor(i / 20), 15) })).not.toBeNull();
    }
    expect(lab.factory.spawn({ kind: "box", position: new Vector3(0, 9, 0) })).toBeNull();
    expect(lab.world.bodyCount).toBe(staticBodies + CONFIG.limits.maxObjects);
    lab.factory.clear();
    expect(lab.factory.count).toBe(0);
    expect(lab.world.bodyCount).toBe(staticBodies);
    lab.dispose();
  });

  it("culls objects that leave the world", async () => {
    const lab = await createLab();
    lab.factory.spawn({ kind: "box", position: new Vector3(0, CONFIG.limits.killPlaneY - 5, 200) });
    expect(lab.factory.cullOutOfBounds()).toBe(1);
    expect(lab.factory.count).toBe(0);
    lab.dispose();
  });
});
