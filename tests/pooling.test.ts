import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { createLab, simulate } from "./helpers";

describe("object pooling", () => {
  it("reuses parked bodies instead of making new ones", async () => {
    const lab = await createLab();
    const first = lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, 15) })!;
    expect(lab.factory.reuseCount).toBe(0);
    lab.factory.remove(first);
    expect(lab.factory.pooledCount).toBe(1);
    const second = lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, 15) })!;
    expect(lab.factory.reuseCount).toBe(1);
    expect(lab.factory.pooledCount).toBe(0);
    expect(second.id).not.toBe(first.id); // a reused body is still a new object
    lab.dispose();
  });

  it("gives a recycled object exactly the same physics as a fresh one", async () => {
    // Drop a box and record where it ends up. Then do it again, but first dirty a body
    // thoroughly and park it so the drop reuses it. Both runs advance the world by the
    // same amount and the dirty object is kept in empty air far from anything, so the
    // only difference between the runs is whether the box's body is new or recycled.
    const run = async (recycle: boolean) => {
      const lab = await createLab();
      if (recycle) {
        const dirty = lab.factory.spawn({ kind: "box", material: "steel", size: new Vector3(2, 0.3, 1.7), position: new Vector3(0, 60, 400) })!;
        lab.factory.setProps(dirty, { linearDamping: 4, angularDamping: 4, gravityFactor: -1.5, mass: 900 });
        dirty.body.setLinearVelocity(new Vector3(9, 4, -7));
        dirty.body.setAngularVelocity(new Vector3(5, 5, 5));
        simulate(lab.world, 0.3);
        lab.factory.remove(dirty);
        expect(lab.factory.pooledCount).toBe(1);
      } else {
        simulate(lab.world, 0.3); // keep both runs at the same point in world time
      }
      const box = lab.factory.spawn({ kind: "box", material: "steel", position: new Vector3(0, 4, 15) })!;
      if (recycle) expect(lab.factory.reuseCount).toBe(1);
      simulate(lab.world, 2.5);
      const p = box.mesh.position.clone();
      const v = box.body.getLinearVelocity().clone();
      const m = box.props.mass;
      lab.dispose();
      return { p, v, m };
    };
    const fresh = await run(false);
    const recycled = await run(true);
    expect(recycled.m).toBeCloseTo(fresh.m, 6);
    expect(recycled.p.x).toBeCloseTo(fresh.p.x, 5);
    expect(recycled.p.y).toBeCloseTo(fresh.p.y, 5);
    expect(recycled.p.z).toBeCloseTo(fresh.p.z, 5);
    expect(recycled.v.length()).toBeCloseTo(fresh.v.length(), 5);
  });

  it("keeps the pool within its limits and frees everything on clear", async () => {
    const lab = await createLab();
    const made = [];
    for (let i = 0; i < CONFIG.limits.poolPerKind + 25; i++) {
      made.push(lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 2 + i * 0.1, 15) })!);
    }
    for (const o of made) lab.factory.remove(o);
    expect(lab.factory.pooledCount).toBeLessThanOrEqual(CONFIG.limits.poolPerKind);
    const bodiesWithPool = lab.world.bodyCount;
    lab.factory.clear();
    expect(lab.factory.pooledCount).toBe(0);
    expect(lab.world.bodyCount).toBeLessThan(bodiesWithPool);
    lab.dispose();
  });

  it("recycles through a fracture, where it matters most", async () => {
    const lab = await createLab();
    // Break something to fill the pool with fragment-sized pairs, then break another.
    for (let round = 0; round < 2; round++) {
      lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(1, 1, 1), position: new Vector3(0, 7, 15) });
      simulate(lab.world, 2.2);
      for (const d of lab.factory.debris()) lab.factory.remove(d);
    }
    expect(lab.factory.reuseCount).toBeGreaterThan(0);
    for (const o of [...lab.factory.all]) expect(() => o.body.getLinearVelocity()).not.toThrow();
    lab.dispose();
  });
});

describe("level of detail", () => {
  it("gives curved shapes coarser copies for distance, and leaves boxes alone", async () => {
    const lab = await createLab();
    const sphere = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 2, 15) })!;
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(1, 2, 15) })!;
    const sphereSource = sphere.mesh.sourceMesh;
    // Babylon keeps the levels sorted farthest-first; read them near-to-far.
    const levels = [...sphereSource.getLODLevels()].sort((a, b) => a.distanceOrScreenCoverage - b.distanceOrScreenCoverage);
    expect(levels.length).toBeGreaterThan(0);
    // Each level must be cheaper than the one before it, or it is not a level of detail.
    let previous = sphereSource.getTotalVertices();
    for (const level of levels) {
      const vertices = level.mesh?.getTotalVertices() ?? 0;
      expect(vertices).toBeGreaterThan(0);
      expect(vertices).toBeLessThan(previous);
      previous = vertices;
    }
    expect(box.mesh.sourceMesh.getLODLevels().length).toBe(0);
    lab.dispose();
  });
});
