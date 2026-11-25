import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../src/core/config";
import { PlayerController, type MoveIntent } from "../src/player/PlayerController";
import { GrabTool } from "../src/tools/GrabTool";
import { TestChamber } from "../src/environments/TestChamber";
import { createLab, simulate } from "./helpers";

const idle: MoveIntent = { forward: 0, strafe: 0, sprint: false, jump: false };
const walk: MoveIntent = { ...idle, forward: 1 };

function run(player: PlayerController, seconds: number, intent: MoveIntent) {
  for (let t = 0; t < seconds; t += 1 / 60) player.update(1 / 60, intent);
}

describe("player controller", () => {
  it("settles on the floor and walks forward at walk speed", async () => {
    const lab = await createLab();
    const player = new PlayerController(lab.scene, lab.env.spawnPoint, lab.env.spawnYaw);
    run(player, 1, idle);
    expect(player.grounded).toBe(true);
    // The controller keeps a small contact gap (keepDistance .. keepContactTolerance) above the surface.
    expect(player.position.y).toBeGreaterThan(CONFIG.player.capsuleHeight / 2);
    expect(player.position.y).toBeLessThan(CONFIG.player.capsuleHeight / 2 + 0.12);
    const z0 = player.position.z;
    run(player, 2, walk); // yaw = PI: forward is -Z
    const travelled = z0 - player.position.z;
    expect(travelled).toBeGreaterThan(CONFIG.player.walkSpeed * 2 * 0.8);
    expect(travelled).toBeLessThan(CONFIG.player.walkSpeed * 2 * 1.05);
    expect(Math.abs(player.position.x)).toBeLessThan(0.05);
    lab.dispose();
  });

  it("is stopped by walls", async () => {
    const lab = await createLab();
    const player = new PlayerController(lab.scene, new Vector3(15, 1, 15), Math.PI / 2); // facing +X
    run(player, 6, { ...walk, sprint: true });
    expect(player.position.x).toBeLessThan(18 - CONFIG.player.capsuleRadius + 0.05);
    expect(player.position.x).toBeGreaterThan(17);
    lab.dispose();
  });

  it("jumps to roughly the configured height and lands", async () => {
    const lab = await createLab();
    const player = new PlayerController(lab.scene, lab.env.spawnPoint, 0);
    run(player, 1, idle);
    const ground = player.position.y;
    let peak = ground;
    player.update(1 / 60, { ...idle, jump: true });
    for (let i = 0; i < 120; i++) {
      player.update(1 / 60, idle);
      peak = Math.max(peak, player.position.y);
    }
    expect(peak - ground).toBeGreaterThan(CONFIG.player.jumpHeight * 0.8);
    expect(peak - ground).toBeLessThan(CONFIG.player.jumpHeight * 1.2);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeCloseTo(ground, 1);
    lab.dispose();
  });

  it("walks up the access ramp onto the observation deck", async () => {
    const lab = await createLab();
    const d = TestChamber.DECK;
    const player = new PlayerController(lab.scene, new Vector3(d.width / 2 + 1.6, 1, 8), 0); // facing +Z
    run(player, 5, walk);
    expect(player.position.y).toBeGreaterThan(d.top + 0.7);
    expect(player.grounded).toBe(true);
    lab.dispose();
  });

  it("pushes a dynamic crate by walking into it", async () => {
    const lab = await createLab();
    const player = new PlayerController(lab.scene, new Vector3(0, 1, 14), Math.PI);
    const crate = lab.factory.spawn({ kind: "box", position: new Vector3(0, 0.31, 12) })!;
    const z0 = crate.mesh.position.z;
    simulate(lab.world, 2, (dt) => player.update(dt, walk));
    expect(crate.mesh.position.z).toBeLessThan(z0 - 1);
    lab.dispose();
  });
});

describe("grab tool", () => {
  it("targets, carries, and throws with speed = impulse / mass", async () => {
    const lab = await createLab();
    const grab = new GrabTool(lab.world, lab.factory);
    const eye = new Vector3(0, 1.6, 10);
    const dir = new Vector3(0, 0, -1);
    const crate = lab.factory.spawn({ kind: "box", position: new Vector3(0, 1.6, 7) })!;
    lab.world.step(1 / 60);

    expect(grab.target(eye, dir)).toBe(crate);
    expect(grab.target(eye, new Vector3(0, 0, 1))).toBeNull(); // nothing behind
    expect(grab.target(eye, new Vector3(0, -1, 0))).toBeNull(); // floor is not grabbable

    expect(grab.tryGrab(eye, dir)).toBe(true);
    // carry: turn 90 degrees, hold point moves to +X
    const side = new Vector3(1, 0, 0);
    simulate(lab.world, 1.5, () => grab.setHoldPoint(eye, side));
    const hold = eye.add(side.scale(grab.holdDistance));
    expect(Vector3.Distance(crate.mesh.position, hold)).toBeLessThan(0.15);

    grab.throwOrPush(eye, side);
    expect(grab.held).toBeNull();
    lab.world.step(1 / 60);
    const expectedSpeed = CONFIG.interaction.throwImpulse / crate.props.mass;
    expect(crate.body.getLinearVelocity().x).toBeGreaterThan(expectedSpeed * 0.9);
    expect(crate.body.getLinearVelocity().x).toBeLessThan(expectedSpeed * 1.1);
    lab.dispose();
  });

  it("drops the held object when it is deleted", async () => {
    const lab = await createLab();
    const grab = new GrabTool(lab.world, lab.factory);
    const crate = lab.factory.spawn({ kind: "box", position: new Vector3(0, 1.6, 7) })!;
    lab.world.step(1 / 60);
    grab.tryGrab(new Vector3(0, 1.6, 10), new Vector3(0, 0, -1));
    lab.factory.remove(crate);
    expect(grab.held).toBeNull();
    lab.world.step(1 / 60);
    lab.dispose();
  });
});
