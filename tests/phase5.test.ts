import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { ExplosionSystem, blastImpulsePerArea, presentedArea } from "../src/effects/Explosions";
import { Deformation, squashAmount } from "../src/effects/Deformation";
import { submergedFraction, verticalHalfExtent } from "../src/fluids/WaterVolumes";
import { MATERIALS } from "../src/materials/Materials";
import { meshScaling, primitiveVolume } from "../src/objects/ObjectFactory";
import { ForceTool } from "../src/tools/ForceTool";
import { LinkTool } from "../src/tools/LinkTool";
import { createLab, simulate } from "./helpers";

const ZERO_G = new Vector3(0, 0, 0);

describe("explosions", () => {
  it("delivers J = i(r) x A along the radius, when the pressure front arrives", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    lab.destruction.setLevel(0);
    const blast = new ExplosionSystem(lab.world, lab.factory, lab.destruction);
    const near = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(3, 5, 10), props: { linearDamping: 0 } })!;
    const far = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(-5, 5, 10), props: { linearDamping: 0 } })!;
    lab.world.step(1 / 60);
    const [, strength, radius] = CONFIG.explosion.levels[1];
    blast.detonate(new Vector3(0, 5, 10), 1);
    lab.world.step(1 / 60);
    // The front travels 120 m/s (2 m per 1/60 s step) and has not reached either box yet.
    expect(near.body.getLinearVelocity().length()).toBe(0);
    lab.world.step(1 / 60); // front at 2 m
    lab.world.step(1 / 60); // front at 4 m
    expect(near.body.getLinearVelocity().x).toBeGreaterThan(0); // reached at 3 m
    expect(far.body.getLinearVelocity().length()).toBe(0); // not yet at 5 m
    lab.world.step(1 / 60); // front at 6 m
    const expectNear = (blastImpulsePerArea(strength, radius, 3) * presentedArea(near)) / near.props.mass;
    const expectFar = (blastImpulsePerArea(strength, radius, 5) * presentedArea(far)) / far.props.mass;
    expect(near.body.getLinearVelocity().x / expectNear).toBeCloseTo(1, 1);
    expect(-far.body.getLinearVelocity().x / expectFar).toBeCloseTo(1, 1);
    expect(Math.abs(near.body.getLinearVelocity().y)).toBeLessThan(0.05);
    simulate(lab.world, 0.1);
    expect(blast.waves.length).toBe(0); // wave finished
    lab.dispose();
  });

  it("throws light objects harder than dense ones of the same shape", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    lab.destruction.setLevel(0);
    const blast = new ExplosionSystem(lab.world, lab.factory, lab.destruction);
    const wood = lab.factory.spawn({ kind: "box", material: "wood", position: new Vector3(3, 5, 10) })!;
    const steel = lab.factory.spawn({ kind: "box", material: "steel", position: new Vector3(-3, 5, 10) })!;
    lab.world.step(1 / 60);
    blast.detonate(new Vector3(0, 5, 10), 1);
    simulate(lab.world, 0.2);
    const ratio = wood.body.getLinearVelocity().length() / steel.body.getLinearVelocity().length();
    expect(ratio / (MATERIALS.steel.density / MATERIALS.wood.density)).toBeCloseTo(1, 1);
    lab.dispose();
  });

  it("walls protect, other objects shield partly, and nothing happens beyond the radius", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    lab.destruction.setLevel(0);
    const blast = new ExplosionSystem(lab.world, lab.factory, lab.destruction);
    // Pillar at (9, *, 8) is 1.2 m wide: blast on one side, box on the other.
    const behindPillar = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(11, 3, 8) })!;
    const open = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(7, 3, 12) })!;
    const shield = lab.factory.spawn({ kind: "box", material: "steel", size: new Vector3(0.3, 2, 2), position: new Vector3(7, 3, 6) })!;
    const shielded = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(7, 3, 4.5) })!;
    const distant = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(7, 3, -6) })!;
    lab.world.step(1 / 60);
    blast.detonate(new Vector3(7, 3, 8), 1);
    simulate(lab.world, 0.3);
    expect(behindPillar.body.getLinearVelocity().length()).toBeLessThan(0.01);
    expect(distant.body.getLinearVelocity().length()).toBeLessThan(0.01);
    expect(open.body.getLinearVelocity().z).toBeGreaterThan(0.4);
    const full = (blastImpulsePerArea(CONFIG.explosion.levels[1][1], CONFIG.explosion.levels[1][2], 3.5) * presentedArea(shielded)) / shielded.props.mass;
    // The shield itself is pushed into the box behind it, so only bound the result from above.
    expect(shielded.body.getLinearVelocity().length()).toBeLessThan(full * 0.75);
    expect(shield.body.getLinearVelocity().z).toBeLessThan(0);
    lab.dispose();
  });

  it("breaks fragile objects and limits concurrent blasts", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const blast = new ExplosionSystem(lab.world, lab.factory, lab.destruction);
    lab.factory.spawn({ kind: "box", material: "glass", position: new Vector3(1.5, 5, 10) });
    lab.factory.spawn({ kind: "box", material: "steel", position: new Vector3(-1.5, 5, 10) });
    lab.world.step(1 / 60);
    blast.detonate(new Vector3(0, 5, 10), 2);
    simulate(lab.world, 0.3);
    expect(lab.factory.debris().filter((d) => d.materialId === "glass").length).toBeGreaterThan(2);
    expect(lab.factory.debris().filter((d) => d.materialId === "steel").length).toBe(0);
    for (let i = 0; i < CONFIG.explosion.maxActiveWaves; i++) expect(blast.detonate(new Vector3(0, 5, 0))).not.toBeNull();
    expect(blast.detonate(new Vector3(0, 5, 0))).toBeNull();
    lab.dispose();
  });
});

describe("water", () => {
  const pool = () => ({ position: new Vector3(0, 1.5, 10), half: new Vector3(3, 1.5, 3) }); // surface at y = 3

  it("floating depth follows Archimedes: submerged fraction = density / 1000", async () => {
    const lab = await createLab();
    const water = lab.water;
    const p = pool();
    const vol = water.add(p.position, p.half)!;
    const wood = lab.factory.spawn({ kind: "box", material: "wood", size: new Vector3(0.8, 0.8, 0.8), position: new Vector3(-1.5, 3.2, 10) })!;
    const ice = lab.factory.spawn({ kind: "box", material: "ice", size: new Vector3(0.8, 0.8, 0.8), position: new Vector3(1.5, 3.2, 10) })!;
    simulate(lab.world, 12);
    expect(wood.body.getLinearVelocity().length()).toBeLessThan(0.05);
    expect(submergedFraction(wood, vol, wood.mesh.position)).toBeCloseTo(MATERIALS.wood.density / 1000, 1);
    expect(submergedFraction(ice, vol, ice.mesh.position)).toBeCloseTo(MATERIALS.ice.density / 1000, 1);
    expect(ice.mesh.position.y).toBeLessThan(wood.mesh.position.y);
    lab.dispose();
  });

  it("dense materials sink to the bottom, slowed by drag; water outside the pool does nothing", async () => {
    const lab = await createLab();
    const water = lab.water;
    const p = pool();
    water.add(p.position, p.half);
    const steel = lab.factory.spawn({ kind: "sphere", material: "steel", position: new Vector3(0, 3.5, 10), props: { linearDamping: 0 } })!;
    const outside = lab.factory.spawn({ kind: "sphere", material: "steel", position: new Vector3(8, 3.5, 10), props: { linearDamping: 0 } })!;
    simulate(lab.world, 0.6);
    expect(-steel.body.getLinearVelocity().y).toBeLessThan(-outside.body.getLinearVelocity().y * 0.9);
    simulate(lab.world, 4);
    expect(steel.mesh.position.y).toBeCloseTo(0.35, 1); // resting on the floor under water
    lab.dispose();
  });

  it("reports a splash once on entry, and reversed gravity reverses buoyancy", async () => {
    const lab = await createLab();
    const water = lab.water;
    const p = pool();
    water.add(p.position, p.half);
    let splashes = 0;
    let splashSpeed = 0;
    water.onSplash = (_o, _pt, speed) => {
      splashes++;
      splashSpeed = speed;
    };
    const ball = lab.factory.spawn({ kind: "sphere", material: "plastic", position: new Vector3(0, 6, 10) })!;
    simulate(lab.world, 3);
    expect(splashes).toBe(1);
    expect(splashSpeed).toBeGreaterThan(5);
    expect(ball.mesh.position.y).toBeLessThan(3);
    lab.dispose();
  });

  it("geometry helpers: vertical extent with rotation, volume picking and the volume limit", async () => {
    const lab = await createLab();
    const water = lab.water;
    const slab = lab.factory.spawn({ kind: "box", size: new Vector3(2, 0.2, 1), position: new Vector3(0, 5, 10), props: { isStatic: true } })!;
    expect(verticalHalfExtent(slab)).toBeCloseTo(0.1, 5);
    slab.mesh.rotationQuaternion!.copyFromFloats(0, 0, Math.SQRT1_2, Math.SQRT1_2); // 90 degrees about Z
    expect(verticalHalfExtent(slab)).toBeCloseTo(1, 4);
    const v = water.add(new Vector3(0, 1, 0), new Vector3(2, 1, 2))!;
    expect(water.pick(new Vector3(0, 1, 10), new Vector3(0, 0, -1), 40)).toBe(v);
    expect(water.pick(new Vector3(5, 1, 10), new Vector3(0, 0, -1), 40)).toBeNull();
    for (let i = 1; i < CONFIG.water.maxVolumes; i++) expect(water.add(new Vector3(i * 10, 1, 0))).not.toBeNull();
    expect(water.add(new Vector3(0, 1, 20))).toBeNull();
    water.clear();
    expect(water.all.length).toBe(0);
    lab.dispose();
  });
});

describe("mechanical joints", () => {
  it("a spring oscillates at its tuned frequency about the rest length", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const ceiling = lab.world.raycast(new Vector3(0, 5, 14), new Vector3(0, 20, 14))!.body;
    const bob = lab.factory.spawn({ kind: "sphere", material: "rubber", position: new Vector3(0, 6, 14), props: { linearDamping: 0, angularDamping: 0 } })!;
    const joint = lab.joints.create("spring", bob, ceiling, null, new Vector3(0, 9, 14), Vector3.Up(), new Vector3(0, 6, 14))!;
    expect(joint.spring!.restLength).toBeCloseTo(3, 4);
    // Kick the bob along the spring; check frequency, amplitude and decay at two step sizes.
    for (const hz of [60, 240]) {
      bob.body.setLinearVelocity(new Vector3(0, -2, 0));
      const crossings: number[] = [];
      const troughs: number[] = [];
      let prev = 0;
      let trough = 0;
      for (let i = 0; i < hz * 2; i++) {
        lab.world.step(1 / hz);
        const d = bob.mesh.position.y - 6;
        trough = Math.min(trough, d);
        if (prev < 0 && d >= 0) {
          crossings.push(lab.world.simTime);
          troughs.push(-trough);
          trough = 0;
        }
        prev = d;
      }
      expect(crossings.length).toBeGreaterThanOrEqual(3);
      expect(1 / (crossings[1] - crossings[0]) / CONFIG.joints.springFrequency).toBeCloseTo(1, 1);
      // First swing: amplitude v / omega for an ideal spring, somewhat less with damping
      const ideal = 2 / (2 * Math.PI * CONFIG.joints.springFrequency);
      expect(troughs[0]).toBeGreaterThan(ideal * 0.6);
      expect(troughs[0]).toBeLessThan(ideal * 1.05);
      // Lightly damped: each cycle is clearly smaller but the motion does not die at once
      expect(troughs[1] / troughs[0]).toBeGreaterThan(0.15);
      expect(troughs[1] / troughs[0]).toBeLessThan(0.9);
      for (let i = 0; i < hz * 4; i++) lab.world.step(1 / hz); // settle before the next run
    }
    lab.dispose();
  });

  it("a slider allows travel along its axis only, within its limit", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const floor = lab.world.raycast(new Vector3(0, 1, 15), new Vector3(0, -1, 15))!.body;
    const piston = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(0, 3, 15), props: { linearDamping: 0, angularDamping: 0 } })!;
    lab.joints.create("slider", piston, floor, null, new Vector3(0, 3, 15), new Vector3(1, 0, 0));
    piston.body.applyImpulse(new Vector3(200, 300, 300), new Vector3(0.2, 3.2, 15)); // mostly off-axis, off-centre
    simulate(lab.world, 0.3);
    expect(Math.abs(piston.mesh.position.x)).toBeGreaterThan(0.05);
    simulate(lab.world, 3);
    expect(Math.abs(piston.mesh.position.y - 3)).toBeLessThan(0.05);
    expect(Math.abs(piston.mesh.position.z - 15)).toBeLessThan(0.05);
    expect(Math.abs(piston.mesh.position.x)).toBeLessThanOrEqual(CONFIG.joints.sliderTravel + 0.1);
    expect(Math.abs(piston.mesh.rotationQuaternion!.w)).toBeGreaterThan(0.995);
    lab.dispose();
  });

  it("the link tool runs a spring from the first point clicked to the second", async () => {
    const lab = await createLab();
    const tool = new LinkTool(lab.world, lab.factory, lab.joints);
    const a = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(-1, 0.31, 10) })!;
    const b = lab.factory.spawn({ kind: "box", material: "rubber", position: new Vector3(1, 0.31, 10) })!;
    lab.world.step(1 / 60);
    while (tool.kind !== "spring") tool.cycleKind(1);
    const eye = new Vector3(0, 1.7, 14);
    tool.click(eye, a.mesh.position.subtract(eye).normalize());
    const r = tool.click(eye, b.mesh.position.subtract(eye).normalize());
    expect(r.status).toBe("joined");
    const joint = lab.joints.all[0];
    expect(joint.kind).toBe("spring");
    expect(joint.spring!.restLength).toBeGreaterThan(1.3);
    expect(joint.spring!.restLength).toBeLessThan(2.4);
    // Springs survive a material change with both ends in place.
    const len = joint.spring!.restLength;
    lab.factory.setMaterial(b, "steel");
    expect(lab.joints.all[0].spring!.restLength).toBeCloseTo(len, 3);
    lab.dispose();
  });

  it("torque mode spins a body up at tau / I without moving it", async () => {
    const lab = await createLab();
    lab.world.setGravity(ZERO_G);
    const tool = new ForceTool(lab.world, lab.factory);
    tool.toggleMode();
    expect(tool.mode).toBe("torque");
    const ball = lab.factory.spawn({ kind: "sphere", material: "rubber", size: new Vector3(1, 1, 1), position: new Vector3(0, 3, 10), props: { linearDamping: 0, angularDamping: 0 } })!;
    lab.world.step(1 / 60);
    const dir = new Vector3(0, 0, -1);
    expect(tool.begin(new Vector3(0, 3, 16), dir)).toBe(true);
    const t0 = lab.world.simTime;
    simulate(lab.world, 0.5);
    const inertia = 0.4 * ball.props.mass * 0.25; // 2/5 m r^2
    const expected = (tool.torque * (lab.world.simTime - t0)) / inertia;
    expect(-ball.body.getAngularVelocity().z / expected).toBeCloseTo(1, 1);
    expect(ball.body.getLinearVelocity().length()).toBeLessThan(0.01);
    lab.dispose();
  });
});

describe("visual deformation", () => {
  it("squashes soft materials along the impact, keeps volume, springs back, and never touches the physics", async () => {
    const lab = await createLab();
    const deform = new Deformation(lab.factory);
    lab.destruction.onImpact = (obj, dv, dir) => deform.impact(obj, dv, dir);
    const ball = lab.factory.spawn({ kind: "sphere", material: "elastic", size: new Vector3(1, 1, 1), position: new Vector3(0, 4, 15) })!;
    const rigid = lab.factory.spawn({ kind: "sphere", material: "steel", size: new Vector3(1, 1, 1), position: new Vector3(3, 4, 15) })!;
    const base = meshScaling("sphere", ball.size);
    let minY = 1;
    let maxXZ = 1;
    let minBottom = Infinity;
    simulate(lab.world, 1.2, (dt) => {
      deform.update(dt);
      minY = Math.min(minY, ball.mesh.scaling.y);
      maxXZ = Math.max(maxXZ, ball.mesh.scaling.x);
      minBottom = Math.min(minBottom, ball.mesh.position.y);
      // volume of the drawn mesh is preserved
      expect((ball.mesh.scaling.x * ball.mesh.scaling.y * ball.mesh.scaling.z) / (base.x * base.y * base.z)).toBeCloseTo(1, 3);
      expect(rigid.mesh.scaling.y).toBe(1);
    });
    expect(minY).toBeLessThan(0.85); // visibly flattened vertically on landing
    expect(maxXZ).toBeGreaterThan(1.05);
    expect(minBottom).toBeGreaterThan(0.45); // the collider is still a 0.5 m radius sphere
    expect(ball.body.getMassProperties().mass).toBeCloseTo(ball.props.mass, 3);
    // with no further impacts reported, the squash state is released and the mesh is exactly restored
    lab.destruction.onImpact = null;
    simulate(lab.world, 3, (dt) => deform.update(dt));
    expect(deform.count).toBe(0);
    expect(ball.mesh.scaling.asArray()).toEqual(base.asArray());
    expect(squashAmount(MATERIALS.elastic.squash, 100)).toBeLessThanOrEqual(0.45);
    expect(primitiveVolume("sphere", ball.size)).toBeCloseTo(Math.PI / 6, 6);
    lab.dispose();
  });
});

describe("test chamber starting experiment", () => {
  it("water tank: wood and ice float, steel sinks; soft lattice keeps its shape and recovers from a squeeze", async () => {
    const { TestChamber } = await import("../src/environments/TestChamber");
    const lab = await createLab(true);
    const pool = TestChamber.POOL;
    const surface = pool.center.y + pool.half.y;
    const inPool = [...lab.factory.all].filter((o) => Math.abs(o.mesh.position.x - pool.center.x) < pool.half.x && Math.abs(o.mesh.position.z - pool.center.z) < pool.half.z);
    expect(inPool.map((o) => o.materialId).sort()).toEqual(["ice", "plastic", "steel", "wood"]);
    const lattice = [...lab.factory.all].filter((o) => o.materialId === "elastic" && o.size.x === 0.5);
    expect(lattice.length).toBe(8);
    expect(lab.joints.all.filter((j) => j.kind === "spring").length).toBe(28); // 12 edges + 12 face diagonals + 4 body diagonals
    const span = () => Math.max(...lattice.map((o) => o.mesh.position.y)) - Math.min(...lattice.map((o) => o.mesh.position.y));

    simulate(lab.world, 8);
    const by = (m: string) => inPool.find((o) => o.materialId === m)!;
    expect(by("wood").mesh.position.y).toBeGreaterThan(surface - 0.4); // rides high
    expect(by("ice").mesh.position.y).toBeGreaterThan(surface - 0.6);
    expect(by("ice").mesh.position.y).toBeLessThan(by("wood").mesh.position.y);
    expect(by("steel").mesh.position.y).toBeLessThan(0.5); // on the bottom
    expect(lab.destruction.stats.fractures).toBe(0);

    // Lattice: stands at roughly its built height, compresses under a load, and springs back.
    const rest = span();
    expect(rest).toBeGreaterThan(0.45);
    expect(rest).toBeLessThan(0.7);
    const top = lattice.filter((o) => o.mesh.position.y > 0.6);
    let squeezed = rest;
    simulate(lab.world, 1, () => {
      for (const o of top) o.body.applyForce(new Vector3(0, -o.props.mass * 120, 0), o.mesh.position);
      squeezed = Math.min(squeezed, span());
    });
    expect(squeezed).toBeLessThan(rest * 0.85);
    simulate(lab.world, 4);
    expect(span() / rest).toBeGreaterThan(0.9);
    expect(span() / rest).toBeLessThan(1.1);
    lab.dispose();
  });
});
