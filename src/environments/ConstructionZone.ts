import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BaseEnvironment, type EnvironmentContext, type LightRig, type PopulateContext } from "./Environment";

const S = 40;
const H = 12;
const T = 1;

/**
 * Construction Zone: an open build bay with four working machines (turntable, seesaw,
 * Newton's cradle, sprung platform) and a depot of parts to build with.
 */
export class ConstructionZone extends BaseEnvironment {
  readonly id = "construction-zone";
  readonly name = "Construction Zone";
  readonly spawnPoint = new Vector3(0, 1.0, 14);
  readonly spawnYaw = Math.PI;
  readonly center = new Vector3(0, H / 2, 0);
  readonly lightRig: LightRig = {
    spots: [
      { position: new Vector3(-8, 11, 0), direction: new Vector3(0.2, -1, 0).normalize() },
      { position: new Vector3(8, 11, 0), direction: new Vector3(-0.2, -1, 0).normalize() },
    ],
    spotColor: new Color3(0.75, 1.0, 0.85),
    fogColor: new Color3(0.03, 0.06, 0.05),
  };

  static readonly TURNTABLE = new Vector3(-9, 0, -4);
  static readonly SEESAW = new Vector3(9, 0, -4);
  static readonly CRADLE = { x: 0, z: -11, beamY: 4.2, rope: 2.6, count: 5, diameter: 0.5 };
  static readonly PLATFORM = new Vector3(0, 0, 2);

  build(ctx: EnvironmentContext): void {
    const { scene, materials: m } = ctx;
    this.scene = scene;

    this.block("c-floor", new Vector3(S, T, S), new Vector3(0, -T / 2, 0), m.floor, { friction: 0.8 });
    this.block("c-ceiling", new Vector3(S, T, S), new Vector3(0, H + T / 2, 0), m.ceiling, { receiveShadow: false });
    this.block("c-wall-n", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, -S / 2 - T / 2), m.wall);
    this.block("c-wall-s", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, S / 2 + T / 2), m.wall);
    this.block("c-wall-w", new Vector3(T, H, S), new Vector3(-S / 2 - T / 2, H / 2, 0), m.wall);
    this.block("c-wall-e", new Vector3(T, H, S), new Vector3(S / 2 + T / 2, H / 2, 0), m.wall);

    for (const y of [1.1, 9]) {
      const o = { collider: false, receiveShadow: false };
      this.block(`c-strip-n-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, -S / 2 + 0.03), m.emissiveGreen, o);
      this.block(`c-strip-s-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, S / 2 - 0.03), m.emissiveGreen, o);
      this.block(`c-strip-w-${y}`, new Vector3(0.05, 0.06, S), new Vector3(-S / 2 + 0.03, y, 0), m.emissiveGreen, o);
      this.block(`c-strip-e-${y}`, new Vector3(0.05, 0.06, S), new Vector3(S / 2 - 0.03, y, 0), m.emissiveGreen, o);
    }

    const panel = this.instanceSource(CreateBox("c-ceiling-light", { width: 5, height: 0.08, depth: 1 }, scene));
    panel.material = m.lightPanel;
    let n = 0;
    for (const x of [-11, 0, 11]) {
      for (const z of [-12, 0, 12]) {
        const inst = panel.createInstance(`c-ceiling-light-${n++}`);
        inst.position.set(x, H - 0.05, z);
        this.finishStatic(inst);
      }
    }

    // Build-bay floor markings
    for (const p of [ConstructionZone.TURNTABLE, ConstructionZone.SEESAW, ConstructionZone.PLATFORM]) {
      for (const [w, d, dx, dz] of [[4.6, 0.06, 0, -2.3], [4.6, 0.06, 0, 2.3], [0.06, 4.6, -2.3, 0], [0.06, 4.6, 2.3, 0]] as const) {
        this.block(`c-bay-${p.x}-${p.z}-${dx}-${dz}`, new Vector3(w, 0.02, d), new Vector3(p.x + dx, 0.011, p.z + dz), m.emissiveGreen, { collider: false, receiveShadow: false });
      }
    }

    // Seesaw fulcrum (static wedge approximated by a block)
    const s = ConstructionZone.SEESAW;
    this.block("c-fulcrum", new Vector3(0.5, 0.7, 1.2), new Vector3(s.x, 0.35, s.z), m.structure, { castShadow: true });

    // Gantry for Newton's cradle: two posts and a beam
    const c = ConstructionZone.CRADLE;
    const half = (c.count * c.diameter) / 2 + 2.0; // room for the end balls to swing
    this.block("c-gantry-post-l", new Vector3(0.3, c.beamY, 0.3), new Vector3(c.x - half, c.beamY / 2, c.z), m.structure, { castShadow: true });
    this.block("c-gantry-post-r", new Vector3(0.3, c.beamY, 0.3), new Vector3(c.x + half, c.beamY / 2, c.z), m.structure, { castShadow: true });
    this.block("c-gantry-beam", new Vector3(half * 2 + 0.3, 0.3, 0.3), new Vector3(c.x, c.beamY + 0.15, c.z), m.structure, { castShadow: true });

    // Parts depot racks along the east wall
    for (const z of [6, 11]) {
      this.block(`c-rack-${z}`, new Vector3(4.5, 0.12, 2.2), new Vector3(15, 0.06, z), m.deck, { castShadow: false });
    }

    // Observation mezzanine on the west side with a ramp
    const top = 2.8;
    this.block("c-mezzanine", new Vector3(4, 0.4, 20), new Vector3(-S / 2 + 2, top - 0.2, 6), m.deck, { castShadow: true });
    this.block("c-mezzanine-glass", new Vector3(0.08, 1.1, 20), new Vector3(-S / 2 + 4 - 0.04, top + 0.55, 6), m.glass, { receiveShadow: false });
    const run = 8;
    const angle = Math.atan2(top, run);
    this.block("c-mezzanine-ramp", new Vector3(3, 0.3, Math.hypot(run, top)), new Vector3(-S / 2 + 2, top / 2 - 0.15 * Math.cos(angle), -4 - run / 2), m.structure, {
      rotationX: angle,
      castShadow: true,
      friction: 0.9,
    });
  }

  populate({ factory, joints }: PopulateContext): void {
    const floor = this.bodyOf("c-floor");
    const up = Vector3.Up();

    // 1. Motorised turntable carrying three crates
    const t = ConstructionZone.TURNTABLE;
    const disc = factory.spawn({ kind: "cylinder", size: new Vector3(3.6, 0.25, 3.6), material: "steel", position: new Vector3(t.x, 0.2, t.z), props: { friction: 0.9 } });
    if (disc) {
      const motor = joints.create("motor", disc, floor, null, new Vector3(t.x, 0.05, t.z), up);
      if (motor) joints.setMotorSpeed(motor, 1.2);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        factory.spawn({ kind: "box", size: new Vector3(0.5, 0.5, 0.5), material: "wood", position: new Vector3(t.x + Math.cos(a) * 1.1, 0.6, t.z + Math.sin(a) * 1.1) });
      }
    }

    // 2. Seesaw: a plank hinged on the fulcrum, a steel block on one end and a lighter rubber block on the other
    const s = ConstructionZone.SEESAW;
    const plank = factory.spawn({ kind: "box", size: new Vector3(5, 0.14, 0.9), material: "wood", position: new Vector3(s.x, 0.79, s.z) });
    if (plank) {
      joints.create("hinge", plank, this.bodyOf("c-fulcrum"), null, new Vector3(s.x, 0.72, s.z), new Vector3(0, 0, 1));
      factory.spawn({ kind: "box", size: new Vector3(0.45, 0.45, 0.45), material: "steel", position: new Vector3(s.x + 2.1, 1.12, s.z), props: { friction: 1 } });
      factory.spawn({ kind: "box", size: new Vector3(0.5, 0.5, 0.5), material: "rubber", position: new Vector3(s.x - 2.1, 1.15, s.z) });
    }

    // 3. Newton's cradle: steel balls on hinges (planar pendulums), the first one raised
    const c = ConstructionZone.CRADLE;
    const beam = this.bodyOf("c-gantry-beam");
    for (let i = 0; i < c.count; i++) {
      const x = c.x + (i - (c.count - 1) / 2) * (c.diameter + 0.004);
      const raised = i === 0 ? 0.6 : 0;
      const ball = factory.spawn({
        kind: "sphere",
        size: new Vector3(c.diameter, c.diameter, c.diameter),
        material: "steel",
        position: new Vector3(x - Math.sin(raised) * c.rope, c.beamY - Math.cos(raised) * c.rope, c.z),
        props: { restitution: 0.97, friction: 0.05, linearDamping: 0, angularDamping: 0 },
      });
      if (ball) joints.create("hinge", ball, beam, null, new Vector3(x, c.beamY, c.z), new Vector3(0, 0, 1));
    }

    // 4. Sprung platform: a plate that can only move vertically, held up by a spring
    const p = ConstructionZone.PLATFORM;
    const plate = factory.spawn({ kind: "box", size: new Vector3(2.4, 0.2, 2.4), material: "plastic", position: new Vector3(p.x, 1.1, p.z) });
    if (plate) {
      joints.create("slider", plate, floor, null, new Vector3(p.x, 1.1, p.z), up);
      joints.create("spring", plate, floor, null, new Vector3(p.x, 0, p.z), up, new Vector3(p.x, 1.0, p.z));
      factory.spawn({ kind: "box", size: new Vector3(0.5, 0.5, 0.5), material: "steel", position: new Vector3(p.x, 2.6, p.z) });
    }

    // Parts depot
    for (let i = 0; i < 5; i++) {
      factory.spawn({ kind: "box", size: new Vector3(3.4, 0.2, 0.2), material: "steel", position: new Vector3(15, 0.23 + Math.floor(i / 3) * 0.21, 5.6 + (i % 3) * 0.4) });
    }
    for (let i = 0; i < 5; i++) {
      factory.spawn({ kind: "box", size: new Vector3(2.4, 0.1, 0.5), material: "wood", position: new Vector3(15, 0.18 + i * 0.105, 10.6) });
    }
    for (let i = 0; i < 4; i++) {
      factory.spawn({ kind: "cylinder", size: new Vector3(0.9, 0.25, 0.9), material: "rubber", position: new Vector3(13.4 + i * 1.0, 0.25, 12) });
    }
  }
}
