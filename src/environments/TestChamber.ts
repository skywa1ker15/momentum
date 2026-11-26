import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BaseEnvironment, type BlockOptions, type EnvironmentContext, type LightRig } from "./Environment";
import type { ObjectFactory } from "../objects/ObjectFactory";

const W = 36; // x extent
const D = 48; // z extent
const H = 11; // ceiling height
const T = 1; // wall thickness

/** Primary physics testing chamber: open floor, test pad, inclined plane, pillars and an observation deck. */
export class TestChamber extends BaseEnvironment {
  readonly id = "test-chamber";
  readonly name = "Test Chamber 01";
  readonly spawnPoint = new Vector3(0, 1.0, 12);
  readonly spawnYaw = Math.PI;
  readonly center = new Vector3(0, H / 2, 0);
  readonly lightRig: LightRig = {
    spots: [
      { position: new Vector3(-7, 10.5, -6), direction: new Vector3(0.63, -1, 0).normalize() },
      { position: new Vector3(7, 10.5, -6), direction: new Vector3(-0.63, -1, 0).normalize() },
    ],
    spotColor: new Color3(0.6, 0.9, 1.0),
    fogColor: new Color3(0.03, 0.045, 0.065),
  };

  /** Top surface of the inclined plane: start (high end) position, used to place rolling props. */
  static readonly RAMP = { x: -11, z: -12, length: 10, width: 4, angle: 0.3, centerY: 1.75 };
  static readonly DECK = { z: 20.5, top: 3.2, width: 16, depth: 7 };

  build(ctx: EnvironmentContext): void {
    const { scene, materials: m } = ctx;
    this.scene = scene;

    // Shell
    this.block("floor", new Vector3(W, T, D), new Vector3(0, -T / 2, 0), m.floor, { friction: 0.8 });
    this.block("ceiling", new Vector3(W, T, D), new Vector3(0, H + T / 2, 0), m.ceiling, { receiveShadow: false });
    this.block("wall-north", new Vector3(W + 2 * T, H, T), new Vector3(0, H / 2, -D / 2 - T / 2), m.wall);
    this.block("wall-south", new Vector3(W + 2 * T, H, T), new Vector3(0, H / 2, D / 2 + T / 2), m.wall);
    this.block("wall-west", new Vector3(T, H, D), new Vector3(-W / 2 - T / 2, H / 2, 0), m.wall);
    this.block("wall-east", new Vector3(T, H, D), new Vector3(W / 2 + T / 2, H / 2, 0), m.wall);

    this.buildWallDetail(ctx);
    this.buildCeilingLights(ctx);

    // Pillars
    for (const [x, z] of [[-9, -6], [9, -6], [-9, 8], [9, 8]] as const) {
      this.block(`pillar-${x}-${z}`, new Vector3(1.2, H, 1.2), new Vector3(x, H / 2, z), m.structure, { castShadow: true });
      this.block(`pillar-band-${x}-${z}`, new Vector3(1.26, 0.08, 1.26), new Vector3(x, 1.5, z), m.emissiveCyan, {
        collider: false,
        receiveShadow: false,
      });
    }

    // Central test pad (flush with the floor, visual only)
    const pad = CreateCylinder("test-pad", { diameter: 10, height: 0.02, tessellation: 64 }, scene);
    pad.position.set(0, 0.011, -6);
    pad.material = m.deck;
    pad.receiveShadows = true;
    this.finishStatic(pad);
    const ring = CreateTorus("test-pad-ring", { diameter: 10, thickness: 0.07, tessellation: 96 }, scene);
    ring.position.set(0, 0.02, -6);
    ring.material = m.emissiveCyan;
    this.finishStatic(ring);

    // Inclined plane for rolling / sliding experiments
    const r = TestChamber.RAMP;
    this.block("ramp", new Vector3(r.width, 0.3, r.length), new Vector3(r.x, r.centerY, r.z), m.structure, {
      rotationX: r.angle,
      castShadow: true,
      friction: 0.5,
    });
    const highZ = r.z - (r.length / 2) * Math.cos(r.angle);
    const highY = r.centerY + (r.length / 2) * Math.sin(r.angle);
    this.block("ramp-support", new Vector3(r.width - 0.6, highY - 0.15, 0.8), new Vector3(r.x, (highY - 0.15) / 2, highZ + 0.6), m.deck, {
      castShadow: true,
    });
    for (const side of [-1, 1]) {
      this.block(`ramp-rail-${side}`, new Vector3(0.1, 0.25, r.length), new Vector3(r.x + side * (r.width / 2 - 0.05), r.centerY + 0.26, r.z), m.emissiveAmber, {
        rotationX: r.angle,
        receiveShadow: false,
      });
    }

    this.buildObservationDeck(ctx);
  }

  populate(factory: ObjectFactory): void {
    // Crate pyramid on the test pad
    const s = 0.8;
    for (let row = 0; row < 4; row++) {
      const n = 4 - row;
      for (let i = 0; i < n; i++) {
        factory.spawn({
          kind: "box",
          size: new Vector3(s, s, s),
          position: new Vector3((i - (n - 1) / 2) * (s + 0.02), s / 2 + row * s + 0.01, -6),
          material: "wood",
        });
      }
    }
    // Block tower
    for (let i = 0; i < 7; i++) {
      factory.spawn({
        kind: "box",
        size: new Vector3(0.9, 0.45, 0.9),
        position: new Vector3(5.5, 0.225 + i * 0.455, -9.5),
        material: i % 2 === 0 ? "concrete" : "plastic",
      });
    }
    // Spheres resting at the top of the inclined plane, held by nothing: they roll on start
    const r = TestChamber.RAMP;
    for (let i = 0; i < 3; i++) {
      const along = -r.length / 2 + 0.8;
      factory.spawn({
        kind: "sphere",
        position: new Vector3(
          r.x + (i - 1) * 1.1,
          r.centerY - along * Math.sin(r.angle) + 0.15 + 0.4,
          r.z + along * Math.cos(r.angle),
        ),
        material: (["steel", "rubber", "elastic"] as const)[i],
      });
    }
    // Loose props
    for (let i = 0; i < 4; i++) {
      factory.spawn({ kind: "cylinder", position: new Vector3(-4.5 + i * 0.9, 0.41, 2.5), material: (["glass", "ice", "plastic", "steel"] as const)[i] });
    }
  }

  private buildWallDetail({ scene, materials: m }: EnvironmentContext): void {
    // Vertical ribs: one source mesh, GPU instanced around the perimeter (visual only)
    const rib = this.instanceSource(CreateBox("wall-rib", { width: 0.35, height: H, depth: 0.25 }, scene));
    rib.material = m.structure;
    let n = 0;
    const place = (x: number, z: number, yaw: number) => {
      const inst = rib.createInstance(`wall-rib-${n++}`);
      inst.position.set(x, H / 2, z);
      inst.rotation.y = yaw;
      this.finishStatic(inst);
    };
    for (let x = -W / 2 + 3; x < W / 2; x += 6) {
      place(x, -D / 2 + 0.125, 0);
      place(x, D / 2 - 0.125, 0);
    }
    for (let z = -D / 2 + 3; z < D / 2; z += 6) {
      place(-W / 2 + 0.125, z, Math.PI / 2);
      place(W / 2 - 0.125, z, Math.PI / 2);
    }

    // Light strips
    for (const [y, mat] of [[1.1, m.emissiveCyan], [9.2, m.emissiveCyan]] as const) {
      const opts: BlockOptions = { collider: false, receiveShadow: false };
      this.block(`strip-n-${y}`, new Vector3(W, 0.06, 0.05), new Vector3(0, y, -D / 2 + 0.03), mat, opts);
      this.block(`strip-s-${y}`, new Vector3(W, 0.06, 0.05), new Vector3(0, y, D / 2 - 0.03), mat, opts);
      this.block(`strip-w-${y}`, new Vector3(0.05, 0.06, D), new Vector3(-W / 2 + 0.03, y, 0), mat, opts);
      this.block(`strip-e-${y}`, new Vector3(0.05, 0.06, D), new Vector3(W / 2 - 0.03, y, 0), mat, opts);
    }
  }

  private buildCeilingLights({ scene, materials: m }: EnvironmentContext): void {
    const panel = this.instanceSource(CreateBox("ceiling-light", { width: 5, height: 0.08, depth: 0.9 }, scene));
    panel.material = m.lightPanel;
    let n = 0;
    for (const x of [-10, 0, 10]) {
      for (let z = -18; z <= 18; z += 9) {
        const inst = panel.createInstance(`ceiling-light-${n++}`);
        inst.position.set(x, H - 0.05, z);
        this.finishStatic(inst);
      }
    }
  }

  private buildObservationDeck({ materials: m }: EnvironmentContext): void {
    const d = TestChamber.DECK;
    const front = d.z - d.depth / 2;
    this.block("deck", new Vector3(d.width, 0.4, d.depth), new Vector3(0, d.top - 0.2, d.z), m.deck, { castShadow: true });
    this.block("deck-edge", new Vector3(d.width, 0.06, 0.06), new Vector3(0, d.top - 0.2, front - 0.03), m.emissiveCyan, {
      collider: false,
      receiveShadow: false,
    });
    for (const x of [-d.width / 2 + 0.6, d.width / 2 - 0.6]) {
      this.block(`deck-leg-${x}`, new Vector3(0.5, d.top - 0.4, 0.5), new Vector3(x, (d.top - 0.4) / 2, front + 0.6), m.structure, {
        castShadow: true,
      });
    }
    // Glass balustrade along the front edge
    this.block("deck-glass", new Vector3(d.width, 1.1, 0.08), new Vector3(0, d.top + 0.55, front + 0.04), m.glass, { receiveShadow: false });
    this.block("deck-rail", new Vector3(d.width, 0.06, 0.12), new Vector3(0, d.top + 1.13, front + 0.04), m.structure, { collider: false });

    // Access ramp on the east side, rising south -> onto the deck's east end
    const run = 9;
    const angle = Math.atan2(d.top, run);
    const len = Math.hypot(run, d.top);
    const rampX = d.width / 2 + 1.6;
    // Surface top should meet deck top: offset centre down by half thickness along the normal
    const cz = d.z - d.depth / 2 - run / 2 + 2.2;
    this.block("deck-ramp", new Vector3(3, 0.3, len), new Vector3(rampX, d.top / 2 - 0.15 * Math.cos(angle), cz), m.structure, {
      rotationX: -angle,
      castShadow: true,
      friction: 0.9,
    });
    // Landing joining ramp top to the deck
    const landingZ0 = cz + run / 2;
    const landingDepth = d.z + d.depth / 2 - landingZ0;
    this.block("deck-landing", new Vector3(3.2, 0.4, landingDepth), new Vector3(rampX, d.top - 0.2, landingZ0 + landingDepth / 2), m.deck, {
      castShadow: true,
    });
  }
}
