import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { fractureCells, seededRandom, splitBox } from "../src/destruction/Fracture";
import { breakThreshold } from "../src/destruction/Destruction";
import { DestructionArena } from "../src/environments/DestructionArena";
import { MATERIALS } from "../src/materials/Materials";
import { ForceTool } from "../src/tools/ForceTool";
import { createLab, simulate } from "./helpers";

const volume = (s: Vector3) => s.x * s.y * s.z;

describe("fracture geometry", () => {
  it("box fragments tile the box exactly, stay inside it and respect the minimum edge", () => {
    const size = new Vector3(1.2, 0.8, 0.5);
    const cells = splitBox(size, 9, new Vector3(0.6, 0, 0), seededRandom(7), 0.09);
    expect(cells.length).toBe(9);
    expect(cells.reduce((s, c) => s + volume(c.size), 0)).toBeCloseTo(volume(size), 6);
    for (const c of cells) {
      for (const axis of ["x", "y", "z"] as const) {
        expect(Math.abs(c.center[axis]) + c.size[axis] / 2).toBeLessThanOrEqual(size[axis] / 2 + 1e-9);
        expect(c.size[axis]).toBeGreaterThanOrEqual(0.09 - 1e-9);
      }
    }
    // No two cells overlap
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        const overlap = (["x", "y", "z"] as const).every((k) => Math.abs(a.center[k] - b.center[k]) < (a.size[k] + b.size[k]) / 2 - 1e-9);
        expect(overlap).toBe(false);
      }
    }
  });

  it("is deterministic for a seed and makes smaller pieces near the impact", () => {
    const size = new Vector3(2, 2, 0.2);
    const a = splitBox(size, 12, new Vector3(1, 1, 0), seededRandom(3), 0.09);
    const b = splitBox(size, 12, new Vector3(1, 1, 0), seededRandom(3), 0.09);
    expect(a.map((c) => c.center.asArray())).toEqual(b.map((c) => c.center.asArray()));
    const impact = new Vector3(1, 1, 0);
    const sorted = [...a].sort((p, q) => Vector3.Distance(p.center, impact) - Vector3.Distance(q.center, impact));
    const near = sorted.slice(0, 4).reduce((s, c) => s + volume(c.size), 0) / 4;
    const far = sorted.slice(-4).reduce((s, c) => s + volume(c.size), 0) / 4;
    expect(near).toBeLessThan(far);
  });

  it("stops splitting when pieces would be thinner than the minimum edge", () => {
    expect(splitBox(new Vector3(0.2, 0.1, 0.1), 20, null, seededRandom(1), 0.09).length).toBe(2);
  });

  it("sphere and cylinder fragments have their centres inside the shape", () => {
    const sphere = fractureCells("sphere", new Vector3(1, 1, 1), 8, null, seededRandom(5), 0.09);
    expect(sphere.length).toBeGreaterThanOrEqual(4);
    for (const c of sphere) expect(c.center.length()).toBeLessThanOrEqual(0.5);
    const cyl = fractureCells("cylinder", new Vector3(0.8, 1.5, 0.8), 8, null, seededRandom(5), 0.09);
    for (const c of cyl) expect(Math.hypot(c.center.x, c.center.z)).toBeLessThanOrEqual(0.4);
  });
});

describe("impact fracture", () => {
  it("glass survives a short drop and shatters from a high one, conserving mass", async () => {
    const lab = await createLab();
    const low = lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(-3, 0.6, 15) })!;
    const high = lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(3, 7, 15) })!;
    const mass = high.props.mass;
    const before = lab.factory.count;
    simulate(lab.world, 2.5);
    expect(lab.factory.fromBody(low.body)).toBe(low); // intact
    const fragments = lab.factory.debris();
    expect(fragments.length).toBeGreaterThanOrEqual(4);
    expect(lab.factory.count).toBe(before - 1 + fragments.length);
    expect(fragments.reduce((s, f) => s + f.props.mass, 0)).toBeCloseTo(mass, 1);
    expect(fragments.reduce((s, f) => s + f.body.getMassProperties().mass!, 0)).toBeCloseTo(mass, 1);
    for (const f of fragments) {
      expect(f.materialId).toBe("glass");
      expect(f.generation).toBeGreaterThanOrEqual(1);
    }
    expect(lab.destruction.stats.fractures).toBeGreaterThanOrEqual(1);
    lab.dispose();
  });

  it("fragments start with the parent's momentum (scatter is momentum-neutral)", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const obj = lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(1, 1, 1), position: new Vector3(0, 5, 10), linearVelocity: new Vector3(3, 0, -1), props: { linearDamping: 0 } })!;
    lab.world.step(1 / 60);
    const p0 = obj.body.getLinearVelocity().scale(obj.props.mass);
    lab.destruction.registerImpact(obj, obj.props.mass * 30, new Vector3(0.5, 5, 10));
    lab.destruction.process();
    const fragments = lab.factory.debris();
    expect(fragments.length).toBeGreaterThan(3);
    const p1 = fragments.reduce((s, f) => s.addInPlace(f.body.getLinearVelocity().scale(f.props.mass)), Vector3.Zero());
    expect(p1.x / p0.x).toBeCloseTo(1, 2);
    expect(p1.z / p0.z).toBeCloseTo(1, 2);
    expect(Math.abs(p1.y)).toBeLessThan(Math.abs(p0.x) * 0.01);
    // and they do scatter: velocities differ between fragments
    const speeds = fragments.map((f) => f.body.getLinearVelocity().subtract(new Vector3(3, 0, -1)).length());
    expect(Math.max(...speeds)).toBeGreaterThan(1);
    lab.dispose();
  });

  it("rubber and elastic never break; steel survives a 10 m drop", async () => {
    const lab = await createLab();
    for (const [i, material] of (["rubber", "elastic", "steel"] as const).entries()) {
      lab.factory.spawn({ kind: "sphere", material, position: new Vector3(-3 + i * 3, 10, 15) });
    }
    simulate(lab.world, 3);
    expect(lab.factory.debris().length).toBe(0);
    expect(lab.factory.count).toBe(3);
    lab.dispose();
  });

  it("intensity changes the outcome of the same drop", async () => {
    const drop = async (level: number) => {
      const lab = await createLab();
      lab.destruction.setLevel(level);
      lab.factory.spawn({ kind: "box", material: "concrete", position: new Vector3(0, 4, 15) });
      simulate(lab.world, 2);
      const n = lab.factory.debris().length;
      lab.dispose();
      return n;
    };
    expect(await drop(0)).toBe(0); // off
    expect(await drop(2)).toBe(0); // normal: a 4 m drop does not break concrete
    expect(await drop(3)).toBeGreaterThan(1); // high: it does
  });

  it("thresholds account for hardness, size, generation and intensity", async () => {
    const lab = await createLab();
    const glass = lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(0, 1, 15) })!;
    const base = MATERIALS.glass.breakSpeed!;
    expect(breakThreshold(glass, MATERIALS.glass.hardness, 1)).toBeCloseTo(base, 6);
    expect(breakThreshold(glass, MATERIALS.rubber.hardness, 1)).toBeCloseTo(base * CONFIG.destruction.softerFactor, 6);
    expect(breakThreshold(glass, 9, 1)).toBeCloseTo(base * CONFIG.destruction.harderFactor, 6);
    expect(breakThreshold(glass, 5.5, 2)).toBeCloseTo(base / 2, 6);
    expect(breakThreshold(glass, 5.5, 0)).toBeNull();
    const chip = lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(0.1, 0.1, 0.1), position: new Vector3(2, 1, 15) })!;
    expect(breakThreshold(chip, 5, 1)).toBeNull();
    const deep = lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(4, 1, 15), generation: CONFIG.destruction.maxGeneration })!;
    expect(breakThreshold(deep, 5, 1)).toBeNull();
    const rubber = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(6, 1, 15) })!;
    expect(breakThreshold(rubber, 5, 1)).toBeNull();
    lab.dispose();
  });

  it("stays within the object limit by recycling the oldest debris", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const max = CONFIG.limits.maxObjects;
    // Fill to the limit with old debris-flagged filler, leaving one slot for the victim.
    for (let i = 0; i < max - 1; i++) {
      lab.factory.spawn({ kind: "box", material: "rubber", size: new Vector3(0.2, 0.2, 0.2), position: new Vector3((i % 30) * 0.5 - 7, 2 + Math.floor(i / 30) * 0.5, -10), generation: 1 });
    }
    const victim = lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(1, 1, 1), position: new Vector3(0, 5, 10) })!;
    expect(lab.factory.atLimit).toBe(true);
    lab.destruction.registerImpact(victim, victim.props.mass * 40, null);
    lab.destruction.process();
    expect(lab.factory.count).toBeLessThanOrEqual(max);
    expect(lab.factory.debris().filter((f) => f.materialId === "glass").length).toBeGreaterThan(3);
    lab.dispose();
  });

  it("a force-tool strike can shatter glass but not rubber", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const tool = new ForceTool(lab.world, lab.factory, lab.destruction);
    tool.adjustLevel(100); // 25 kN -> 6250 N s
    lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(-2, 3, 10) });
    lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(2, 3, 10) });
    lab.world.step(1 / 60);
    tool.strike(new Vector3(-2, 3, 16), new Vector3(0, 0, -1));
    tool.strike(new Vector3(2, 3, 16), new Vector3(0, 0, -1));
    lab.world.step(1 / 60);
    expect(lab.factory.debris().length).toBeGreaterThan(2);
    expect([...lab.factory.all].filter((o) => o.materialId === "rubber").length).toBe(1);
    lab.dispose();
  });
});

describe("impact measurement", () => {
  it("net contact impulse / mass equals the measured velocity change (floor and body-body)", async () => {
    const lab = await createLab();
    lab.destruction.setLevel(0); // measure only
    const ball = lab.factory.spawn({ kind: "sphere", material: "rubber", position: new Vector3(0, 3, 15), props: { linearDamping: 0 } })!;
    let checked = 0;
    for (let i = 0; i < 90; i++) {
      const v0 = ball.body.getLinearVelocity();
      const dt = lab.world.step(1 / 60);
      const dv = lab.destruction.lastDeltaV(ball);
      if (dv > 2) {
        // velocity change not explained by gravity
        const measured = ball.body.getLinearVelocity().subtract(v0).subtract(new Vector3(0, -9.81 * dt, 0)).length();
        expect(dv / measured).toBeGreaterThan(0.9);
        expect(dv / measured).toBeLessThan(1.1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);

    // Head-on collision of two bodies in zero g
    lab.world.setGravity(new Vector3(0, 0, 0));
    const a = lab.factory.spawn({ kind: "sphere", material: "steel", position: new Vector3(-2, 6, 10), linearVelocity: new Vector3(5, 0, 0), props: { linearDamping: 0 } })!;
    const b = lab.factory.spawn({ kind: "sphere", material: "rubber", position: new Vector3(2, 6, 10), linearVelocity: new Vector3(-5, 0, 0), props: { linearDamping: 0 } })!;
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const va = a.body.getLinearVelocity();
      const vb = b.body.getLinearVelocity();
      lab.world.step(1 / 60);
      if (lab.destruction.lastDeltaV(b) > 1) {
        expect(lab.destruction.lastDeltaV(a) / a.body.getLinearVelocity().subtract(va).length()).toBeCloseTo(1, 1);
        expect(lab.destruction.lastDeltaV(b) / b.body.getLinearVelocity().subtract(vb).length()).toBeCloseTo(1, 1);
        // equal and opposite impulses: the light body changes velocity more
        expect(lab.destruction.lastDeltaV(b)).toBeGreaterThan(lab.destruction.lastDeltaV(a) * 3);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
    lab.dispose();
  });

  it("a loaded stack at rest sees almost no impact, even with heavy blocks on light ones and large steps", async () => {
    const lab = await createLab();
    const blocks = [];
    for (let i = 0; i < 7; i++) {
      blocks.push(lab.factory.spawn({ kind: "box", size: new Vector3(0.9, 0.45, 0.9), material: i % 2 === 0 ? "concrete" : "glass", position: new Vector3(0, 0.225 + i * 0.455, 12) })!);
    }
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      lab.world.step(1 / 30);
      if (i > 20) for (const blk of blocks) worst = Math.max(worst, lab.destruction.lastDeltaV(blk));
    }
    expect(worst).toBeLessThan(1);
    expect(lab.destruction.stats.fractures).toBe(0);
    expect(lab.factory.debris().length).toBe(0);
    lab.dispose();
  });
});

describe("structural bonds", () => {
  it("a weld breaks from a hard enough impact and holds for a light one", async () => {
    const lab = await createLab();
    lab.world.setGravity(new Vector3(0, 0, 0));
    const a = lab.factory.spawn({ kind: "box", material: "concrete", position: new Vector3(0, 3, 10) })!;
    const b = lab.factory.spawn({ kind: "box", material: "concrete", position: new Vector3(0.6, 3, 10) })!;
    const joint = lab.joints.create("weld", a, b.body, b, new Vector3(0.3, 3, 10), Vector3.Up())!;
    expect(joint.breakSpeed).toBeCloseTo(MATERIALS.concrete.breakSpeed! * CONFIG.destruction.bondFactor, 6);
    lab.destruction.registerImpact(a, a.props.mass * (joint.breakSpeed! * 0.8), null);
    expect(lab.joints.all.length).toBe(1);
    lab.destruction.registerImpact(a, a.props.mass * (joint.breakSpeed! * 1.2), null);
    expect(lab.joints.all.length).toBe(0);
    expect(lab.destruction.stats.bondsBroken).toBe(1);
    expect(lab.factory.debris().length).toBe(0); // bond broke, bricks did not
    lab.dispose();
  });

  it("welds between unbreakable materials never break; hinges are not bonds", async () => {
    const lab = await createLab();
    const a = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(0, 3, 10) })!;
    const b = lab.factory.spawn({ kind: "box", material: "elastic", position: new Vector3(0.6, 3, 10) })!;
    const c = lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(1.2, 3, 10) })!;
    expect(lab.joints.create("weld", a, b.body, b, new Vector3(0.3, 3, 10), Vector3.Up())!.breakSpeed).toBeNull();
    expect(lab.joints.create("hinge", b, c.body, c, new Vector3(0.9, 3, 10), Vector3.Up())!.breakSpeed).toBeNull();
    lab.dispose();
  });
});

describe("destruction arena", () => {
  it("the wall stands bonded, then the wrecking ball breaks bonds and bricks", async () => {
    const lab = await createLab(true, new DestructionArena());
    const w = DestructionArena.WALL;
    const bricks = [...lab.factory.all].filter((o) => o.materialId === "concrete");
    expect(bricks.length).toBe(w.columns * w.rows);
    const welds = lab.joints.all.filter((j) => j.kind === "weld").length;
    expect(welds).toBe(w.rows * (w.columns - 1) + (w.rows - 1) * w.columns + 3); // wall bonds + 3 glass panes
    const ball = [...lab.factory.all].find((o) => o.materialId === "steel" && o.size.x > 1)!;

    // Before the ball arrives the wall has not moved.
    simulate(lab.world, 0.8);
    const top = bricks[bricks.length - 1];
    expect(top.mesh.position.y).toBeCloseTo(w.brick.y / 2 + (w.rows - 1) * w.pitch.y, 1);
    expect(lab.destruction.stats.bondsBroken).toBe(0);

    let minBallY = Infinity;
    simulate(lab.world, 4, () => (minBallY = Math.min(minBallY, ball.mesh.position.y)));
    const b = DestructionArena.BALL;
    expect(minBallY).toBeLessThan(b.pivot.y - b.rope + 0.6); // swung through the bottom of its arc
    expect(Vector3.Distance(ball.mesh.position, b.pivot)).toBeCloseTo(b.rope, 0); // still on its joint
    expect(lab.destruction.stats.bondsBroken).toBeGreaterThan(5);
    expect(lab.destruction.stats.fractures).toBeGreaterThan(0);
    expect(lab.factory.debris().length).toBeGreaterThan(4);
    expect(lab.factory.count).toBeLessThanOrEqual(CONFIG.limits.maxObjects);
    lab.dispose();
  });
});

describe("destruction under pressure (object budget)", () => {
  it("survives many objects breaking at once when the budget forces evictions", async () => {
    const lab = await createLab();
    // Fill the room with glass well above the floor, so a great many break in the same step
    // and the debris budget has to evict fragments while other objects are still queued.
    for (let i = 0; i < 40; i++) {
      lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3((i % 8) * 0.9 - 3.6, 6 + Math.floor(i / 8) * 0.9, 15 + (i % 3)) });
    }
    // This threw before: a queued object could be evicted as debris by an earlier fracture
    // in the same batch, and then be fractured through a disposed Havok body.
    expect(() => simulate(lab.world, 4)).not.toThrow();
    expect(lab.factory.count).toBeLessThanOrEqual(CONFIG.limits.maxObjects);
    expect(lab.destruction.stats.fractures).toBeGreaterThan(0);
    // Everything still in the factory must be usable, not a shell around a freed body.
    for (const o of [...lab.factory.all]) {
      expect(lab.factory.has(o)).toBe(true);
      expect(() => o.body.getLinearVelocity()).not.toThrow();
    }
    lab.dispose();
  });

  it("does not fracture an object that another fracture evicted in the same batch", async () => {
    const lab = await createLab();
    // CONFIG is read-only to the application; a test may narrow a limit to reach a branch.
    const limits = CONFIG.limits as { maxObjects: number };
    const realLimit = limits.maxObjects;
    try {
      // Squeeze the object budget so breaking one object has to evict debris to make room.
      limits.maxObjects = lab.factory.count + 12;
      const big = lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(1.4, 1.4, 1.4), position: new Vector3(-2, 1, 15) })!;
      // Fragments from an earlier break: these are what the budget evicts first.
      const debris = [];
      for (let i = 0; i < 8; i++) {
        debris.push(lab.factory.spawn({ kind: "box", material: "glass", size: new Vector3(0.3, 0.3, 0.3), position: new Vector3(i * 0.4, 1, 17), generation: 1 })!);
      }
      // Both the big object and a piece of debris are queued to break in the same batch.
      lab.destruction.registerImpact(big, big.props.mass * 80, null);
      for (const d of debris) lab.destruction.registerImpact(d, d.props.mass * 80, null);
      // Before the fix this threw: the big object's fracture evicted debris that was still
      // queued, and the queue then fractured it through a freed Havok body.
      expect(() => lab.destruction.process()).not.toThrow();
      for (const o of [...lab.factory.all]) expect(() => o.body.getLinearVelocity()).not.toThrow();
      expect(lab.factory.count).toBeLessThanOrEqual(CONFIG.limits.maxObjects);
    } finally {
      limits.maxObjects = realLimit;
      lab.dispose();
    }
  });

  it("ignores a contact recorded for an object that was removed before the step ended", async () => {
    const lab = await createLab();
    const a = lab.factory.spawn({ kind: "box", material: "concrete", position: new Vector3(0, 3, 15) })!;
    simulate(lab.world, 0.9); // let it land and register contacts
    lab.factory.remove(a);
    expect(() => lab.destruction.process()).not.toThrow();
    lab.dispose();
  });
});
