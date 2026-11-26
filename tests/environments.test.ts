import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ENVIRONMENTS } from "../src/environments";
import { GravityLab } from "../src/environments/GravityLab";
import { TestChamber } from "../src/environments/TestChamber";
import { PlayerController } from "../src/player/PlayerController";
import { GrabTool } from "../src/tools/GrabTool";
import { FieldTool, nearestAxis } from "../src/tools/FieldTool";
import { LinkTool } from "../src/tools/LinkTool";
import { createLab, simulate } from "./helpers";

const idle = { forward: 0, strafe: 0, sprint: false, jump: false };

describe("environments", () => {
  it("every environment builds, populates, simulates and disposes without leaking bodies or meshes", async () => {
    for (const entry of ENVIRONMENTS) {
      const env = entry.create();
      const lab = await createLab(false);
      // createLab built a TestChamber; swap to the environment under test the same way the app does.
      lab.env.dispose();
      lab.factory.clear();
      expect(lab.world.bodyCount).toBe(0);
      const meshesBefore = lab.scene.meshes.length;
      env.build({ scene: lab.scene, materials: lab.materials });
      expect(lab.world.bodyCount).toBeGreaterThan(5);
      env.populate({ factory: lab.factory, fields: lab.fields, joints: lab.joints, water: lab.water });
      expect(lab.factory.count).toBeGreaterThan(5);
      simulate(lab.world, 1);
      for (const o of lab.factory.all) expect(Number.isFinite(o.mesh.position.y)).toBe(true);
      lab.joints.clear();
      lab.water.clear();
      lab.fields.clear();
      lab.factory.clear();
      env.dispose();
      expect(lab.world.bodyCount).toBe(0);
      // Only hidden object source meshes (kept for reuse) may remain.
      const leftover = lab.scene.meshes.slice(meshesBefore).filter((m) => !m.name.startsWith("src-"));
      expect(leftover.map((m) => m.name)).toEqual([]);
      lab.dispose();
    }
  });

  it("gravity lab: the emitter lifts nearby objects, the column carries balls upward, distant crates stay put", async () => {
    const lab = await createLab(true, new GravityLab());
    const all = [...lab.factory.all];
    const ring = all.filter((o) => Math.hypot(o.mesh.position.x, o.mesh.position.z) < 3);
    const c = GravityLab.COLUMN;
    const column = all.filter((o) => Math.abs(o.mesh.position.x - c.x) < 2 && Math.abs(o.mesh.position.z - c.z) < 2);
    const crates = all.filter((o) => o.mesh.position.z === 9);
    expect(crates.length).toBe(4);
    expect(ring.length).toBe(10);
    expect(column.length).toBe(4);
    simulate(lab.world, 4);
    expect(ring.filter((o) => o.mesh.position.y > 1.5).length).toBeGreaterThanOrEqual(8);
    for (const o of column) expect(o.mesh.position.y).toBeGreaterThan(4);
    for (const o of crates) expect(o.mesh.position.y).toBeLessThan(0.6);
    lab.dispose();
  });

  it("gravity lab: the player stands on the floor and can walk up to the gallery", async () => {
    const lab = await createLab(false, new GravityLab());
    const player = new PlayerController(lab.scene, lab.env.spawnPoint, lab.env.spawnYaw);
    for (let i = 0; i < 60; i++) player.update(1 / 60, idle);
    expect(player.grounded).toBe(true);
    const ramp = new PlayerController(lab.scene, new Vector3(-14, 1, 3), 0);
    for (let i = 0; i < 300; i++) ramp.update(1 / 60, { ...idle, forward: 1 });
    expect(ramp.position.y).toBeGreaterThan(GravityLab.GALLERY.top + 0.7);
    lab.dispose();
  });

  it("no environment except the arena breaks its own props in the first 12 seconds", async () => {
    for (const entry of ENVIRONMENTS) {
      if (entry.id === "destruction-arena") continue;
      const lab = await createLab(true, entry.create());
      while (lab.world.simTime < 12) lab.world.advance(1 / 60);
      expect([entry.id, lab.destruction.stats.fractures]).toEqual([entry.id, 0]);
      lab.dispose();
    }
  });

  it("test chamber still exposes its deck and ramp landmarks", () => {
    expect(TestChamber.DECK.top).toBeGreaterThan(3);
  });
});

describe("phase 3 tools", () => {
  it("field tool places a field off the surface aimed at and removes it again", async () => {
    const lab = await createLab();
    const tool = new FieldTool(lab.world, lab.fields);
    const eye = new Vector3(0, 1.7, 12);
    const down = new Vector3(0, -0.6, -0.8).normalize();
    const f = tool.place(eye, down)!;
    expect(f.kind).toBe("attractor");
    expect(f.position.y).toBeCloseTo(1, 1); // one metre above the floor
    tool.cycleKind(2);
    expect(tool.kind).toBe("zone");
    const zone = tool.place(eye, new Vector3(0.1, 0.9, 0.1).normalize());
    expect(zone && zone.kind === "zone" && zone.gravity.y).toBeCloseTo(9.81, 2);
    expect(lab.fields.all.length).toBe(2);
    expect(tool.removeAimed(eye, f.position.subtract(eye).normalize())).toBe(true);
    expect(lab.fields.all.length).toBe(1);
    expect(nearestAxis(new Vector3(-0.9, 0.2, 0.3)).asArray()).toEqual([-1, 0, 0]);
    lab.dispose();
  });

  it("link tool joins two objects in two clicks and removes the joint on request", async () => {
    const lab = await createLab();
    const joints = lab.joints;
    const tool = new LinkTool(lab.world, lab.factory, joints);
    const a = lab.factory.spawn({ kind: "box", position: new Vector3(-0.5, 0.31, 10) })!;
    const b = lab.factory.spawn({ kind: "box", position: new Vector3(0.5, 0.31, 10) })!;
    lab.world.step(1 / 60);
    const eye = new Vector3(0, 1.7, 13);
    const aim = (p: Vector3) => p.subtract(eye).normalize();
    expect(tool.click(eye, new Vector3(0, 1, 0)).status).toBe("none"); // ceiling is not a sandbox object
    expect(tool.click(eye, aim(a.mesh.position)).status).toBe("first");
    expect(tool.click(eye, aim(a.mesh.position)).status).toBe("cancelled");
    tool.click(eye, aim(a.mesh.position));
    const r = tool.click(eye, aim(b.mesh.position));
    expect(r.status).toBe("joined");
    expect(joints.jointsOf(a).length).toBe(1);
    // Joined to the world: second click on the floor
    tool.cycleKind(2);
    tool.click(eye, aim(b.mesh.position));
    expect(tool.click(eye, new Vector3(0, -0.5, -1).normalize()).status).toBe("joined");
    expect(joints.all.length).toBe(2);
    expect(tool.removeAimed(eye, aim(b.mesh.position))).toBe(2);
    expect(joints.all.length).toBe(0);
    lab.dispose();
  });

  it("a held object can be turned by requesting an angular velocity", async () => {
    const lab = await createLab();
    const grab = new GrabTool(lab.world, lab.factory);
    const box = lab.factory.spawn({ kind: "box", position: new Vector3(0, 1.6, 7) })!;
    lab.world.step(1 / 60);
    const eye = new Vector3(0, 1.6, 10);
    const dir = new Vector3(0, 0, -1);
    grab.tryGrab(eye, dir);
    simulate(lab.world, 0.5, () => {
      grab.setHoldPoint(eye, dir);
      grab.rotate(new Vector3(0, 2, 0));
    });
    const q = box.mesh.rotationQuaternion!;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    expect(angle).toBeGreaterThan(0.8); // about 2 rad/s for 0.5 s
    expect(angle).toBeLessThan(1.2);
    simulate(lab.world, 0.5, () => grab.setHoldPoint(eye, dir)); // no request: spin damps out
    expect(box.body.getAngularVelocity().length()).toBeLessThan(0.05);
    lab.dispose();
  });
});
