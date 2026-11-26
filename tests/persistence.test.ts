import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/core/Settings";
import { ENVIRONMENTS } from "../src/environments";
import { ConstructionZone } from "../src/environments/ConstructionZone";
import { captureExperiment, restoreExperiment, validateExperiment, SAVE_VERSION, type ExperimentSystems } from "../src/persistence/Experiment";
import { createLab, simulate } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;
const ENV_IDS = ENVIRONMENTS.map((e) => e.id);
const systems = (lab: Lab): ExperimentSystems => ({
  environmentId: lab.env.id,
  world: lab.world,
  factory: lab.factory,
  joints: lab.joints,
  fields: lab.fields,
  water: lab.water,
  destruction: lab.destruction,
  roomBody: (name) => lab.env.roomBody(name),
});

describe("experiment save and load", () => {
  it("round-trips objects, properties, motion, joints, fields and water through JSON", async () => {
    const src = await createLab();
    src.world.setGravity(new Vector3(0, -3, 0));
    src.destruction.setLevel(1);
    const a = src.factory.spawn({ kind: "box", material: "steel", size: new Vector3(1, 0.4, 0.6), position: new Vector3(1, 3, 10), linearVelocity: new Vector3(2, 0, -1), props: { friction: 0.11, gravityFactor: 0.5 } })!;
    const b = src.factory.spawn({ kind: "sphere", material: "rubber", position: new Vector3(2.2, 3, 10) })!;
    const c = src.factory.spawn({ kind: "cylinder", material: "glass", position: new Vector3(-3, 0.41, 12), props: { isStatic: true } })!;
    const d = src.factory.spawn({ kind: "box", material: "wood", position: new Vector3(-6, 2, 12), generation: 1 })!;
    src.joints.create("hinge", a, b.body, b, new Vector3(1.6, 3, 10), new Vector3(0, 0, 1));
    const floor = src.world.raycast(new Vector3(0, 1, 15), new Vector3(0, -1, 15))!.body;
    const motor = src.joints.create("motor", d, floor, null, new Vector3(-6, 2, 12), Vector3.Up())!;
    src.joints.setMotorSpeed(motor, -7);
    src.joints.create("spring", b, c.body, c, c.mesh.position, Vector3.Up(), b.mesh.position);
    src.fields.addPoint("repulsor", new Vector3(5, 4, 5), 150, 7);
    src.fields.addZone(new Vector3(-8, 3, -8), new Vector3(9.81, 0, 0), new Vector3(2, 3, 2));
    src.water.add(new Vector3(8, 1, 12), new Vector3(2, 1, 2));
    src.world.step(1 / 60);

    const json = JSON.stringify(captureExperiment(systems(src)));
    const data = validateExperiment(JSON.parse(json), ENV_IDS);
    expect(data.version).toBe(SAVE_VERSION);

    const dst = await createLab();
    const report = restoreExperiment(data, systems(dst));
    expect(report).toEqual({ objects: 4, joints: 3, skipped: 0 });
    expect(dst.world.gravity.y).toBeCloseTo(-3, 5);
    expect(dst.destruction.level).toBe(1);

    const find = (lab: Lab, material: string) => [...lab.factory.all].find((o) => o.materialId === material)!;
    for (const material of ["steel", "rubber", "glass", "wood"]) {
      const s = find(src, material);
      const r = find(dst, material);
      expect(r.kind).toBe(s.kind);
      expect(r.size.asArray()).toEqual(s.size.asArray());
      expect(Vector3.Distance(r.mesh.position, s.mesh.position)).toBeLessThan(1e-3);
      expect(r.props).toEqual(s.props);
      expect(r.generation).toBe(s.generation);
      expect(Vector3.Distance(r.body.getLinearVelocity(), s.body.getLinearVelocity())).toBeLessThan(1e-3);
      expect(r.body.getMassProperties().mass).toBeCloseTo(s.props.mass, 2);
    }
    expect(dst.joints.all.map((j) => j.kind).sort()).toEqual(["hinge", "motor", "spring"]);
    const m2 = dst.joints.all.find((j) => j.kind === "motor")!;
    expect(m2.motorSpeed).toBe(-7);
    expect(m2.b).toBeNull(); // attached to the room again
    const srcSpring = src.joints.all.find((j) => j.kind === "spring")!;
    expect(dst.joints.all.find((j) => j.kind === "spring")!.spring!.restLength).toBeCloseTo(srcSpring.spring!.restLength, 4);
    expect(dst.fields.all.map((f) => f.kind)).toEqual(["repulsor", "zone"]);
    expect(dst.fields.all[0].kind === "repulsor" && dst.fields.all[0].mu).toBe(-150);
    expect(dst.water.all.length).toBe(1);

    // The restored experiment keeps behaving the same way: both worlds evolve alike.
    simulate(src.world, 1);
    simulate(dst.world, 1);
    for (const material of ["steel", "rubber", "wood"]) {
      expect(Vector3.Distance(find(dst, material).mesh.position, find(src, material).mesh.position)).toBeLessThan(0.15);
    }
    src.dispose();
    dst.dispose();
  });

  it("a whole environment's starting experiment survives a save and load", async () => {
    const src = await createLab(true, new ConstructionZone());
    simulate(src.world, 0.5);
    const data = validateExperiment(JSON.parse(JSON.stringify(captureExperiment(systems(src)))), ENV_IDS);
    const dst = await createLab(false, new ConstructionZone());
    const report = restoreExperiment(data, systems(dst));
    expect(report.skipped).toBe(0);
    expect(report.objects).toBe(src.factory.count);
    expect(report.joints).toBe(src.joints.all.length);
    expect(dst.joints.all.filter((j) => j.b === null).length).toBe(src.joints.all.filter((j) => j.b === null).length);
    simulate(dst.world, 2);
    for (const o of dst.factory.all) expect(Number.isFinite(o.mesh.position.y)).toBe(true);
    src.dispose();
    dst.dispose();
  });

  it("rejects files that are not valid saves, with a readable reason", async () => {
    const lab = await createLab();
    lab.factory.spawn({ kind: "box", position: new Vector3(0, 1, 10) });
    const good = JSON.parse(JSON.stringify(captureExperiment(systems(lab))));
    const bad = (mutate: (d: any) => void) => {
      const copy = JSON.parse(JSON.stringify(good));
      mutate(copy);
      return () => validateExperiment(copy, ENV_IDS);
    };
    expect(() => validateExperiment(null, ENV_IDS)).toThrow(/not a MOMENTUM experiment/);
    expect(() => validateExperiment("hello", ENV_IDS)).toThrow();
    expect(bad((d) => (d.version = 99))).toThrow(/version/);
    expect(bad((d) => (d.environment = "moon-base"))).toThrow(/environment/);
    expect(bad((d) => delete d.objects)).toThrow(/objects/);
    expect(bad((d) => (d.objects[0].material = "unobtainium"))).toThrow(/material/);
    expect(bad((d) => (d.objects[0].kind = "torus"))).toThrow(/shape/);
    expect(bad((d) => (d.objects[0].position = [1, "x", 3]))).toThrow(/position/);
    expect(bad((d) => (d.objects[0].size = [1, -1, 1]))).toThrow(/size/);
    expect(bad((d) => (d.objects[0].props.mass = null))).toThrow(/mass/);
    expect(bad((d) => d.joints.push({ kind: "weld", a: 12345, b: null, world: "floor", pivotA: [0, 0, 0], pivotB: [0, 0, 0], axisA: [0, 1, 0] }))).toThrow(/missing object/);
    expect(bad((d) => d.fields.push({ kind: "black-hole" }))).toThrow(/Field/);
    // Out-of-range world values are clamped rather than rejected
    const clamped = bad((d) => { d.gravityY = -9999; d.destructionLevel = 42; })();
    expect(clamped.gravityY).toBe(CONFIG.gravity.min);
    expect(clamped.destructionLevel).toBe(CONFIG.destruction.levels.length - 1);
    lab.dispose();
  });

  it("reports what could not be restored instead of failing", async () => {
    const src = await createLab();
    const a = src.factory.spawn({ kind: "box", position: new Vector3(0, 1, 10) })!;
    const floor = src.world.raycast(new Vector3(0, 1, 15), new Vector3(0, -1, 15))!.body;
    src.joints.create("hinge", a, floor, null, new Vector3(0, 0.5, 10), Vector3.Up());
    const data = captureExperiment(systems(src));
    data.joints[0].world = "collider-that-no-longer-exists";
    const dst = await createLab();
    const report = restoreExperiment(validateExperiment(data, ENV_IDS), systems(dst));
    expect(report).toEqual({ objects: 1, joints: 0, skipped: 1 });
    src.dispose();
    dst.dispose();
  });
});

describe("settings", () => {
  it("sanitises stored values and falls back to defaults", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ quality: "ultra", sensitivity: 99, fov: 10, invertY: "yes", volume: -3 })).toEqual({ ...DEFAULT_SETTINGS, sensitivity: 3, fov: 55, volume: 0 });
    const full = { quality: "high", sensitivity: 1.5, fov: 80, invertY: true, volume: 0.25, dynamicResolution: false, cameraShake: false, renderer: "webgpu", hintsDone: true };
    expect(sanitizeSettings(full)).toEqual(full);
    expect(sanitizeSettings({ renderer: "vulkan" }).renderer).toBe("webgl2");
  });
});

describe("construction zone machines", () => {
  it("turntable turns, cradle transfers its swing, platform bounces and settles, seesaw tips", async () => {
    const lab = await createLab(true, new ConstructionZone());
    const all = [...lab.factory.all];
    const disc = all.find((o) => o.kind === "cylinder" && o.materialId === "steel")!;
    const c = ConstructionZone.CRADLE;
    const cradle = all.filter((o) => o.kind === "sphere" && Math.abs(o.mesh.position.z - c.z) < 0.01).sort((p, q) => p.mesh.position.x - q.mesh.position.x);
    expect(cradle.length).toBe(c.count);
    const plate = all.find((o) => o.materialId === "plastic" && o.kind === "box" && o.size.x === 2.4)!;
    const plank = all.find((o) => o.materialId === "wood" && o.size.x === 5)!;
    const lastRestX = cradle[c.count - 1].mesh.position.x;

    let lastMax = lastRestX;
    let plateMin = plate.mesh.position.y;
    simulate(lab.world, 3, () => {
      lastMax = Math.max(lastMax, cradle[c.count - 1].mesh.position.x);
      plateMin = Math.min(plateMin, plate.mesh.position.y);
    });
    // Turntable: motor holds 1.2 rad/s about the vertical and the disc stays in place
    expect(Math.abs(disc.body.getAngularVelocity().y)).toBeCloseTo(1.2, 1);
    expect(Math.hypot(disc.mesh.position.x - ConstructionZone.TURNTABLE.x, disc.mesh.position.z - ConstructionZone.TURNTABLE.z)).toBeLessThan(0.05);
    // Cradle: the far ball was kicked out by the raised one, and the balls stayed in their plane
    expect(lastMax).toBeGreaterThan(lastRestX + 0.4);
    for (const ball of cradle) expect(Math.abs(ball.mesh.position.z - c.z)).toBeLessThan(0.02);
    // Platform: pushed down by the falling crate, guided vertically
    expect(plateMin).toBeLessThan(0.95);
    expect(Math.hypot(plate.mesh.position.x - ConstructionZone.PLATFORM.x, plate.mesh.position.z - ConstructionZone.PLATFORM.z)).toBeLessThan(0.03);
    // Seesaw: the steel ball outweighs the rubber block, so that end is down
    const q = plank.mesh.rotationQuaternion!;
    const tilt = 2 * Math.asin(Math.min(1, Math.abs(q.z)));
    expect(tilt).toBeGreaterThan(0.1);
    simulate(lab.world, 6);
    expect(Math.abs(plate.body.getLinearVelocity().y)).toBeLessThan(0.1); // settled
    expect(plate.mesh.position.y).toBeGreaterThan(0.4);
    expect(lab.factory.count).toBeLessThanOrEqual(CONFIG.limits.maxObjects);
    lab.dispose();
  });
});
