import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { PROP_LIMITS } from "../src/objects/ObjectFactory";
import { readState } from "../src/objects/ObjectState";
import { ForceTool } from "../src/tools/ForceTool";
import { Selection } from "../src/tools/Selection";
import { createLab, simulate } from "./helpers";

const ZERO_G = new Vector3(0, 0, 0);

describe("physical properties", () => {
  it("mass edits reach the engine; inertia per unit mass matches the shape", async () => {
    const lab = await createLab();
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 3, 3), size: new Vector3(1, 1, 1) })!;
    lab.factory.setProps(ball, { mass: 10 });
    const mp = ball.body.getMassProperties();
    expect(mp.mass).toBeCloseTo(10, 4);
    // Havok reports inertia per unit mass. Solid sphere: 2/5 r^2 = 0.4 * 0.25 = 0.1
    expect(mp.inertia!.x).toBeCloseTo(0.1, 3);
    expect(mp.inertia!.y).toBeCloseTo(0.1, 3);
    // Solid cube: a^2 / 6
    const cube = lab.factory.spawn({ kind: "box", position: new Vector3(3, 3, 3), size: new Vector3(0.6, 0.6, 0.6) })!;
    expect(cube.body.getMassProperties().inertia!.x).toBeCloseTo(0.36 / 6, 3);
    lab.factory.setProps(ball, { mass: 1e9 });
    expect(ball.props.mass).toBe(PROP_LIMITS.mass.max);
    lab.dispose();
  });

  it("friction changes how far a sliding box travels", async () => {
    const lab = await createLab();
    const slide = (friction: number, x: number) => {
      const box = lab.factory.spawn({ kind: "box", position: new Vector3(x, 0.3, 14), props: { friction }, linearVelocity: new Vector3(0, 0, -6) })!;
      return box;
    };
    const grippy = slide(1.2, -3);
    const slick = slide(0.02, 3);
    simulate(lab.world, 3);
    const dGrippy = 14 - grippy.mesh.position.z;
    const dSlick = 14 - slick.mesh.position.z;
    expect(dSlick).toBeGreaterThan(dGrippy * 2);
    lab.dispose();
  });

  it("restitution changes rebound height", async () => {
    const lab = await createLab();
    const peakAfterBounce = (restitution: number, x: number) => {
      const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(x, 4, 15), props: { restitution } })!;
      let hitFloor = false;
      let peak = 0;
      simulate(lab.world, 2.5, () => {
        if (ball.mesh.position.y < 0.45) hitFloor = true;
        else if (hitFloor) peak = Math.max(peak, ball.mesh.position.y);
      });
      return peak;
    };
    const dead = peakAfterBounce(0, -3);
    const lively = peakAfterBounce(1, 3);
    expect(lively).toBeGreaterThan(1.5);
    expect(dead).toBeLessThan(0.6);
    lab.dispose();
  });

  it("gravity factor 0 floats, -1 rises; static bodies hold still and can be released", async () => {
    const lab = await createLab();
    const floaty = lab.factory.spawn({ kind: "box", position: new Vector3(-3, 4, 15), props: { gravityFactor: 0 } })!;
    const riser = lab.factory.spawn({ kind: "box", position: new Vector3(0, 4, 15), props: { gravityFactor: -1 } })!;
    const pinned = lab.factory.spawn({ kind: "box", position: new Vector3(3, 4, 15), props: { isStatic: true } })!;
    simulate(lab.world, 0.5);
    expect(floaty.mesh.position.y).toBeCloseTo(4, 3);
    expect(riser.mesh.position.y).toBeGreaterThan(4.8);
    expect(pinned.mesh.position.y).toBeCloseTo(4, 5);
    lab.factory.setProps(pinned, { isStatic: false });
    simulate(lab.world, 0.5);
    expect(pinned.mesh.position.y).toBeLessThan(3.2);
    lab.dispose();
  });

  it("linear damping slows a drifting body", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const free = lab.factory.spawn({ kind: "box", position: new Vector3(-3, 4, 15), linearVelocity: new Vector3(0, 0, -4), props: { linearDamping: 0 } })!;
    const damped = lab.factory.spawn({ kind: "box", position: new Vector3(3, 4, 15), linearVelocity: new Vector3(0, 0, -4), props: { linearDamping: 2 } })!;
    simulate(lab.world, 1);
    expect(free.body.getLinearVelocity().length()).toBeCloseTo(4, 1);
    expect(damped.body.getLinearVelocity().length()).toBeLessThan(1);
    lab.dispose();
  });

  it("changing world gravity wakes bodies that were asleep", async () => {
    const lab = await createLab();
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(0, 0.31, 15) })!;
    simulate(lab.world, 6); // long enough to fall asleep
    const restY = box.mesh.position.y;
    lab.world.setGravity(new Vector3(0, 9.81, 0));
    lab.factory.wakeAll();
    simulate(lab.world, 1);
    expect(box.mesh.position.y).toBeGreaterThan(restY + 2);
    lab.dispose();
  });

  it("duplicate copies shape, size and properties", async () => {
    const lab = await createLab();
    const src = lab.factory.spawn({ kind: "cylinder", position: new Vector3(0, 2, 15), size: new Vector3(0.4, 1.2, 0.4), props: { mass: 33, friction: 0.1, restitution: 0.8, gravityFactor: 0.5 } })!;
    const copy = lab.factory.duplicate(src, new Vector3(1, 0, 0))!;
    expect(copy.kind).toBe("cylinder");
    expect(copy.size.equals(src.size)).toBe(true);
    expect(copy.props).toEqual(src.props);
    expect(copy.props).not.toBe(src.props);
    expect(copy.body.getMassProperties().mass).toBeCloseTo(33, 4);
    expect(copy.body.getGravityFactor()).toBeCloseTo(0.5, 5);
    expect(copy.mesh.position.x).toBeCloseTo(1, 5);
    lab.dispose();
  });
});

describe("object state", () => {
  it("momentum is m*v and kinetic energy gained in a fall equals m*g*h", async () => {
    const lab = await createLab();
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 8, 15), props: { linearDamping: 0 } })!;
    const m = ball.props.mass;
    simulate(lab.world, 1);
    const s = readState(ball);
    expect(s.momentum / (m * s.speed)).toBeCloseTo(1, 4);
    const drop = 8 - ball.mesh.position.y;
    const potentialLost = m * 9.81 * drop;
    expect(s.kineticLinear / potentialLost).toBeGreaterThan(0.96);
    expect(s.kineticLinear / potentialLost).toBeLessThan(1.04);
    expect(s.kineticRotational).toBeCloseTo(0, 3);
    lab.dispose();
  });

  it("a sphere rolling without slipping has rotational energy 2/5 of its translational energy", async () => {
    const lab = await createLab();
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 0.351, 16), linearVelocity: new Vector3(0, 0, -5), props: { friction: 1, linearDamping: 0, angularDamping: 0 } })!;
    simulate(lab.world, 2.5);
    const s = readState(ball);
    expect(s.speed).toBeGreaterThan(1);
    expect(s.kineticRotational / s.kineticLinear).toBeGreaterThan(0.36);
    expect(s.kineticRotational / s.kineticLinear).toBeLessThan(0.44);
    lab.dispose();
  });
});

describe("force tool", () => {
  it("a constant force gives v = F t / m", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const tool = new ForceTool(lab.world, lab.factory);
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(0, 3, 10), props: { linearDamping: 0, angularDamping: 0 } })!;
    lab.world.step(1 / 60);
    const eye = new Vector3(0, 3, 16);
    const dir = new Vector3(0, 0, -1);
    expect(tool.begin(eye, dir)).toBe(true);
    const t0 = lab.world.simTime;
    simulate(lab.world, 1);
    const expected = (tool.force * (lab.world.simTime - t0)) / box.props.mass;
    expect(-box.body.getLinearVelocity().z).toBeGreaterThan(expected * 0.97);
    expect(-box.body.getLinearVelocity().z).toBeLessThan(expected * 1.03);
    tool.end();
    const v = box.body.getLinearVelocity().z;
    simulate(lab.world, 0.5);
    expect(box.body.getLinearVelocity().z).toBeCloseTo(v, 3);
    lab.dispose();
  });

  it("an off-centre impulse produces spin; a centred one does not", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const tool = new ForceTool(lab.world, lab.factory);
    const centred = lab.factory.spawn({ kind: "box", position: new Vector3(-3, 3, 10), props: { angularDamping: 0, linearDamping: 0 } })!;
    const offset = lab.factory.spawn({ kind: "box", position: new Vector3(3, 3, 10), props: { angularDamping: 0, linearDamping: 0 } })!;
    lab.world.step(1 / 60);
    const dir = new Vector3(0, 0, -1);
    expect(tool.strike(new Vector3(-3, 3, 16), dir)).toBe(centred);
    expect(tool.strike(new Vector3(3.25, 3, 16), dir)).toBe(offset);
    lab.world.step(1 / 60);
    expect(centred.body.getAngularVelocity().length()).toBeLessThan(0.01);
    expect(offset.body.getAngularVelocity().length()).toBeGreaterThan(0.5);
    // Both receive the same linear momentum: J = m v
    expect((-centred.body.getLinearVelocity().z * centred.props.mass) / tool.impulse).toBeCloseTo(1, 2);
    expect((-offset.body.getLinearVelocity().z * offset.props.mass) / tool.impulse).toBeCloseTo(1, 2);
    lab.dispose();
  });

  it("ignores static geometry and clamps its level", async () => {
    const lab = await createLab();
    const tool = new ForceTool(lab.world, lab.factory);
    expect(tool.begin(new Vector3(0, 2, 10), new Vector3(0, -1, 0))).toBe(false);
    tool.adjustLevel(100);
    expect(tool.force).toBe(CONFIG.force.magnitudes.at(-1));
    tool.adjustLevel(-100);
    expect(tool.force).toBe(CONFIG.force.magnitudes[0]);
    lab.dispose();
  });
});

describe("selection", () => {
  it("reports contact impulses for the selected body only and clears on delete", async () => {
    const lab = await createLab();
    const sel = new Selection(lab.factory);
    const ball = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 4, 15) })!;
    sel.select(ball);
    expect(ball.mesh.showBoundingBox).toBe(true);
    simulate(lab.world, 1.5);
    expect(sel.contacts).toBeGreaterThan(0);
    // Landing at v = sqrt(2 g h): the contact impulse is at least m v
    const vImpact = Math.sqrt(2 * 9.81 * (4 - 0.35));
    expect(sel.peakImpact).toBeGreaterThan(ball.props.mass * vImpact * 0.8);
    lab.factory.remove(ball);
    expect(sel.current).toBeNull();
    lab.dispose();
  });
});
