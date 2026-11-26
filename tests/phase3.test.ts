import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { MATERIALS, MATERIAL_ORDER } from "../src/materials/Materials";
import { primitiveVolume } from "../src/objects/ObjectFactory";
import { GravityFields } from "../src/fields/GravityFields";
import { createLab, simulate } from "./helpers";

const ZERO_G = new Vector3(0, 0, 0);

describe("materials", () => {
  it("every preset sets mass = density x volume, friction and restitution on the engine", async () => {
    const lab = await createLab();
    const size = new Vector3(0.5, 0.5, 0.5);
    MATERIAL_ORDER.forEach((id, i) => {
      const def = MATERIALS[id];
      const o = lab.factory.spawn({ kind: "box", size, material: id, position: new Vector3(-8 + i * 2, 1, 15) })!;
      expect(o.body.getMassProperties().mass).toBeCloseTo(def.density * primitiveVolume("box", size), 1);
      expect(o.aggregate.shape.material.friction).toBeCloseTo(def.friction, 5);
      expect(o.aggregate.shape.material.restitution).toBeCloseTo(def.restitution, 5);
    });
    expect(MATERIALS.steel.density).toBeGreaterThan(MATERIALS.concrete.density);
    lab.dispose();
  });

  it("ice slides much further than rubber", async () => {
    const lab = await createLab();
    const v = new Vector3(0, 0, -5);
    const ice = lab.factory.spawn({ kind: "box", material: "ice", position: new Vector3(-3, 0.3, 16), linearVelocity: v })!;
    const rubber = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(3, 0.3, 16), linearVelocity: v })!;
    simulate(lab.world, 3);
    expect(16 - ice.mesh.position.z).toBeGreaterThan((16 - rubber.mesh.position.z) * 3);
    lab.dispose();
  });

  it("an elastic ball rebounds far higher than a concrete one", async () => {
    const lab = await createLab();
    const peak = (material: "elastic" | "concrete", x: number) => {
      const b = lab.factory.spawn({ kind: "sphere", material, position: new Vector3(x, 4, 15) })!;
      let hit = false;
      let top = 0;
      simulate(lab.world, 2.5, () => {
        if (b.mesh.position.y < 0.45) hit = true;
        else if (hit) top = Math.max(top, b.mesh.position.y);
      });
      return top;
    };
    expect(peak("elastic", -3)).toBeGreaterThan(peak("concrete", 3) * 2.5);
    lab.dispose();
  });

  it("changing material in place keeps identity, transform and motion, and updates mass", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const o = lab.factory.spawn({ kind: "sphere", material: "wood", position: new Vector3(1, 3, 12), linearVelocity: new Vector3(2, 0, 0), props: { gravityFactor: 0.5, linearDamping: 0 } })!;
    const bodies = lab.world.bodyCount;
    let rebuilt = 0;
    lab.factory.onRebuilt.push(() => rebuilt++);
    const id = o.id;
    lab.factory.setMaterial(o, "steel");
    expect(rebuilt).toBe(1);
    expect(o.id).toBe(id);
    expect(lab.factory.fromBody(o.body)).toBe(o);
    expect(lab.world.bodyCount).toBe(bodies);
    expect(o.props.mass).toBeCloseTo(MATERIALS.steel.density * primitiveVolume("sphere", o.size), 1);
    expect(o.props.gravityFactor).toBe(0.5);
    expect(o.mesh.position.x).toBeCloseTo(1, 4);
    simulate(lab.world, 0.5);
    expect(o.body.getLinearVelocity().x).toBeCloseTo(2, 2);
    expect(o.mesh.position.x).toBeGreaterThan(1.9);
    lab.dispose();
  });
});

describe("gravity fields", () => {
  it("an attractor accelerates a body at mu / r^2 and a repulsor pushes it away", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const fields = new GravityFields(lab.world, lab.factory);
    const body = lab.factory.spawn({ kind: "sphere", position: new Vector3(4, 5, 10), props: { linearDamping: 0 } })!;
    const field = fields.addPoint("attractor", new Vector3(0, 5, 10), 60)!;
    simulate(lab.world, 0.2);
    // r = 4 m: a = 60 / 16 = 3.75 m/s^2 -> v = a t (r barely changes in 0.2 s)
    const expected = 3.75 * lab.world.simTime;
    expect(-body.body.getLinearVelocity().x).toBeGreaterThan(expected * 0.95);
    expect(-body.body.getLinearVelocity().x).toBeLessThan(expected * 1.1);
    fields.remove(field);
    body.body.setLinearVelocity(Vector3.Zero());
    fields.addPoint("repulsor", new Vector3(0, 5, 10), 60);
    simulate(lab.world, 0.2);
    expect(body.body.getLinearVelocity().x).toBeGreaterThan(0.5);
    lab.dispose();
  });

  it("has no effect outside its radius and wakes sleeping bodies inside it", async () => {
    const lab = await createLab();
    const fields = new GravityFields(lab.world, lab.factory);
    const near = lab.factory.spawn({ kind: "box", position: new Vector3(0, 0.31, 12) })!;
    const far = lab.factory.spawn({ kind: "box", position: new Vector3(0, 0.31, -20) })!;
    simulate(lab.world, 6); // both asleep on the floor
    const farZ = far.mesh.position.z;
    fields.addPoint("attractor", new Vector3(0, 4, 12), 400, 9);
    simulate(lab.world, 1.5);
    expect(near.mesh.position.y).toBeGreaterThan(1); // lifted off the floor: 400 / 3.7^2 = 29 m/s^2 > g
    expect(far.mesh.position.z).toBeCloseTo(farZ, 3);
    lab.dispose();
  });

  it("a zone replaces world gravity inside it only", async () => {
    const lab = await createLab();
    const fields = new GravityFields(lab.world, lab.factory);
    fields.addZone(new Vector3(0, 3.5, 12), new Vector3(0, 9.81, 0), new Vector3(2.5, 3.5, 2.5));
    const inside = lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, 12), props: { linearDamping: 0 } })!;
    const outside = lab.factory.spawn({ kind: "box", position: new Vector3(6, 2, 12), props: { linearDamping: 0 } })!;
    simulate(lab.world, 0.3);
    const t = lab.world.simTime;
    expect(inside.body.getLinearVelocity().y).toBeCloseTo(9.81 * t, 0);
    expect(outside.body.getLinearVelocity().y).toBeCloseTo(-9.81 * t, 0);
    lab.dispose();
  });

  it("enforces the field limit and picks fields along a ray", async () => {
    const lab = await createLab();
    const fields = new GravityFields(lab.world, lab.factory);
    for (let i = 0; i < CONFIG.fields.maxFields; i++) expect(fields.addPoint("attractor", new Vector3(i * 2 - 8, 3, 0))).not.toBeNull();
    expect(fields.addPoint("attractor", new Vector3(0, 9, 0))).toBeNull();
    const target = fields.all[4];
    expect(fields.pick(new Vector3(target.position.x, 3, 10), new Vector3(0, 0, -1), 30)).toBe(target);
    expect(fields.pick(new Vector3(target.position.x, 8, 10), new Vector3(0, 0, -1), 30)).toBeNull();
    fields.clear();
    expect(fields.all.length).toBe(0);
    lab.dispose();
  });
});

describe("joints", () => {
  const worldBodyBelow = (lab: Awaited<ReturnType<typeof createLab>>) => lab.world.raycast(new Vector3(0, 1, 15), new Vector3(0, -1, 15))!.body;

  it("weld keeps two bodies rigidly together", async () => {
    const lab = await createLab();
    const joints = lab.joints;
    // Rubber: its welds are unbreakable, so this isolates the constraint from the destruction system.
    const a = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(0, 5, 14) })!;
    const b = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(0.6, 5, 14) })!;
    expect(joints.create("weld", a, b.body, b, new Vector3(0.3, 5, 14), Vector3.Up())).not.toBeNull();
    b.body.applyImpulse(new Vector3(0, 0, 300), b.mesh.position); // off-centre for the pair: spins it
    simulate(lab.world, 3);
    expect(Vector3.Distance(a.mesh.position, b.mesh.position)).toBeCloseTo(0.6, 1);
    const rel = a.mesh.rotationQuaternion!.multiply(b.mesh.rotationQuaternion!.conjugate());
    expect(Math.abs(rel.w)).toBeGreaterThan(0.995);
    lab.dispose();
  });

  it("hinge to the world lets a body swing about the pivot without drifting", async () => {
    const lab = await createLab();
    const joints = lab.joints;
    const ceiling = lab.world.raycast(new Vector3(0, 5, 14), new Vector3(0, 20, 14))!.body;
    const pivot = new Vector3(0, 6, 14);
    const arm = lab.factory.spawn({ kind: "box", size: new Vector3(2, 0.2, 0.2), position: new Vector3(1, 6, 14), props: { angularDamping: 0, linearDamping: 0 } })!;
    joints.create("hinge", arm, ceiling, null, pivot, new Vector3(0, 0, 1));
    let minY = 6;
    let maxZ = 0;
    simulate(lab.world, 2, () => {
      minY = Math.min(minY, arm.mesh.position.y);
      maxZ = Math.max(maxZ, Math.abs(arm.mesh.position.z - 14));
      expect(Vector3.Distance(arm.mesh.position, pivot)).toBeLessThan(1.08);
      expect(Vector3.Distance(arm.mesh.position, pivot)).toBeGreaterThan(0.92);
    });
    expect(minY).toBeLessThan(5.2); // swung down like a pendulum
    expect(maxZ).toBeLessThan(0.05); // stayed in the hinge plane
    lab.dispose();
  });

  it("ball joint holds the pivot but allows swinging in any direction", async () => {
    const lab = await createLab();
    const joints = lab.joints;
    const ceiling = lab.world.raycast(new Vector3(0, 5, 14), new Vector3(0, 20, 14))!.body;
    const pivot = new Vector3(0, 6, 14);
    const bob = lab.factory.spawn({ kind: "sphere", position: new Vector3(0, 4.5, 14), props: { angularDamping: 0, linearDamping: 0 } })!;
    joints.create("ball", bob, ceiling, null, pivot, Vector3.Up());
    bob.body.applyImpulse(new Vector3(150, 0, 150), bob.mesh.position);
    let maxX = 0;
    let maxZ = 0;
    simulate(lab.world, 2, () => {
      maxX = Math.max(maxX, Math.abs(bob.mesh.position.x));
      maxZ = Math.max(maxZ, Math.abs(bob.mesh.position.z - 14));
      expect(Vector3.Distance(bob.mesh.position, pivot)).toBeCloseTo(1.5, 0);
    });
    expect(maxX).toBeGreaterThan(0.3);
    expect(maxZ).toBeGreaterThan(0.3);
    lab.dispose();
  });

  it("motor drives a wheel to its target angular speed and follows speed changes", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const joints = lab.joints;
    const floor = worldBodyBelow(lab);
    const wheel = lab.factory.spawn({ kind: "cylinder", size: new Vector3(1, 0.3, 1), position: new Vector3(0, 3, 15), props: { angularDamping: 0 } })!;
    const joint = joints.create("motor", wheel, floor, null, new Vector3(0, 3, 15), Vector3.Up())!;
    simulate(lab.world, 2);
    expect(Math.abs(wheel.body.getAngularVelocity().y)).toBeCloseTo(CONFIG.joints.defaultMotorSpeed, 0);
    expect(Vector3.Distance(wheel.mesh.position, new Vector3(0, 3, 15))).toBeLessThan(0.05);
    const sign = Math.sign(wheel.body.getAngularVelocity().y);
    joints.setMotorSpeed(joint, -8);
    simulate(lab.world, 2);
    expect(wheel.body.getAngularVelocity().y * sign).toBeCloseTo(-8, 0);
    lab.dispose();
  });

  it("joints survive a material change and are removed with their objects", async () => {
    const lab = await createLab();
    const joints = lab.joints;
    const a = lab.factory.spawn({ kind: "box", position: new Vector3(0, 2, 14) })!;
    const b = lab.factory.spawn({ kind: "box", position: new Vector3(0.6, 2, 14) })!;
    const c = lab.factory.spawn({ kind: "box", position: new Vector3(1.2, 2, 14) })!;
    joints.create("weld", a, b.body, b, new Vector3(0.3, 2, 14), Vector3.Up());
    joints.create("ball", b, c.body, c, new Vector3(0.9, 2, 14), Vector3.Up());
    expect(joints.create("weld", a, a.body, a, a.mesh.position, Vector3.Up())).toBeNull();
    expect(joints.jointsOf(b).length).toBe(2);
    lab.factory.setMaterial(b, "steel"); // b is side B of the weld and side A of the ball joint
    expect(joints.all.length).toBe(2);
    expect(joints.jointsOf(b).length).toBe(2);
    simulate(lab.world, 2);
    expect(Vector3.Distance(a.mesh.position, b.mesh.position)).toBeCloseTo(0.6, 1); // weld still holds
    expect(Vector3.Distance(b.mesh.position, c.mesh.position)).toBeLessThan(0.75); // ball joint still holds
    lab.factory.remove(b);
    expect(joints.all.length).toBe(0);
    simulate(lab.world, 0.5); // no crash stepping after constraints were disposed
    lab.dispose();
  });
});
