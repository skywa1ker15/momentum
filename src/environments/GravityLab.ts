import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BaseEnvironment, type EnvironmentContext, type LightRig, type PopulateContext } from "./Environment";
import type { MaterialId } from "../materials/Materials";

const S = 32; // floor is S x S
const H = 16;
const T = 1;

/**
 * Gravity Laboratory: a tall square chamber around a central field emitter.
 * Starts with an attractor above the pad and an upward-gravity column in one corner.
 */
export class GravityLab extends BaseEnvironment {
  readonly id = "gravity-lab";
  readonly name = "Gravity Laboratory";
  readonly spawnPoint = new Vector3(0, 1.0, 12.5);
  readonly spawnYaw = Math.PI;
  readonly center = new Vector3(0, H / 2, 0);
  readonly lightRig: LightRig = {
    spots: [
      { position: new Vector3(-5, 15, 0), direction: new Vector3(0.3, -1, 0).normalize() },
      { position: new Vector3(5, 15, 0), direction: new Vector3(-0.3, -1, 0).normalize() },
    ],
    spotColor: new Color3(0.72, 0.55, 1.0),
    fogColor: new Color3(0.045, 0.03, 0.075),
  };

  static readonly EMITTER = new Vector3(0, 4, 0);
  static readonly COLUMN = { x: 10, z: -10, half: new Vector3(2.5, 7.5, 2.5) };
  static readonly GALLERY = { top: 2.6, depth: 3.5 };

  build(ctx: EnvironmentContext): void {
    const { scene, materials: m } = ctx;
    this.scene = scene;

    this.block("g-floor", new Vector3(S, T, S), new Vector3(0, -T / 2, 0), m.floor, { friction: 0.8 });
    this.block("g-ceiling", new Vector3(S, T, S), new Vector3(0, H + T / 2, 0), m.ceiling, { receiveShadow: false });
    this.block("g-wall-n", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, -S / 2 - T / 2), m.wall);
    this.block("g-wall-s", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, S / 2 + T / 2), m.wall);
    this.block("g-wall-w", new Vector3(T, H, S), new Vector3(-S / 2 - T / 2, H / 2, 0), m.wall);
    this.block("g-wall-e", new Vector3(T, H, S), new Vector3(S / 2 + T / 2, H / 2, 0), m.wall);

    // Light strips at three heights
    for (const y of [1.1, 8, 14.8]) {
      const o = { collider: false, receiveShadow: false };
      this.block(`g-strip-n-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, -S / 2 + 0.03), m.emissiveViolet, o);
      this.block(`g-strip-s-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, S / 2 - 0.03), m.emissiveViolet, o);
      this.block(`g-strip-w-${y}`, new Vector3(0.05, 0.06, S), new Vector3(-S / 2 + 0.03, y, 0), m.emissiveViolet, o);
      this.block(`g-strip-e-${y}`, new Vector3(0.05, 0.06, S), new Vector3(S / 2 - 0.03, y, 0), m.emissiveViolet, o);
    }

    // Corner buttresses, turned 45 degrees
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      this.block(`g-buttress-${x}-${z}`, new Vector3(2.4, H, 2.4), new Vector3(x * (S / 2 - 0.4), H / 2, z * (S / 2 - 0.4)), m.structure, {
        rotationY: Math.PI / 4,
        castShadow: true,
      });
    }

    // Central pad and emitter ring (visual; the floor provides the collider)
    const pad = CreateCylinder("g-pad", { diameter: 12, height: 0.02, tessellation: 72 }, scene);
    pad.position.set(0, 0.011, 0);
    pad.material = m.deck;
    pad.receiveShadows = true;
    this.finishStatic(pad);
    for (const [d, y] of [[12, 0.02], [4, 0.025]] as const) {
      const ring = CreateTorus(`g-pad-ring-${d}`, { diameter: d, thickness: 0.07, tessellation: 96 }, scene);
      ring.position.set(0, y, 0);
      ring.material = m.emissiveViolet;
      this.finishStatic(ring);
    }
    const halo = CreateTorus("g-ceiling-halo", { diameter: 9, thickness: 0.22, tessellation: 96 }, scene);
    halo.position.set(0, H - 0.3, 0);
    halo.material = m.lightPanel;
    this.finishStatic(halo);

    // Four pylons around the pad
    const band = this.instanceSource(CreateBox("g-pylon-band", { width: 0.66, height: 0.08, depth: 0.66 }, scene));
    band.material = m.emissiveViolet;
    let n = 0;
    for (const [x, z] of [[-7.5, -7.5], [7.5, 7.5], [-7.5, 7.5]] as const) {
      this.block(`g-pylon-${n}`, new Vector3(0.6, 9, 0.6), new Vector3(x, 4.5, z), m.structure, { castShadow: true });
      for (const y of [2, 5, 8]) {
        const inst = band.createInstance(`g-pylon-band-${n++}`);
        inst.position.set(x, y, z);
        this.finishStatic(inst);
      }
    }

    // Frame marking the upward-gravity column
    const c = GravityLab.COLUMN;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      this.block(`g-column-post-${dx}-${dz}`, new Vector3(0.12, c.half.y * 2, 0.12), new Vector3(c.x + dx * c.half.x, c.half.y, c.z + dz * c.half.z), m.emissiveCyan, {
        collider: false,
        receiveShadow: false,
      });
    }

    // Observation gallery along the south wall, reached by a ramp on the west side
    const g = GravityLab.GALLERY;
    const gz = S / 2 - g.depth / 2;
    this.block("g-gallery", new Vector3(S - 8, 0.4, g.depth), new Vector3(2, g.top - 0.2, gz), m.deck, { castShadow: true });
    this.block("g-gallery-glass", new Vector3(S - 8, 1.1, 0.08), new Vector3(2, g.top + 0.55, gz - g.depth / 2 + 0.04), m.glass, { receiveShadow: false });
    this.block("g-gallery-edge", new Vector3(S - 8, 0.06, 0.06), new Vector3(2, g.top - 0.2, gz - g.depth / 2 - 0.03), m.emissiveViolet, { collider: false, receiveShadow: false });
    const run = 7;
    const angle = Math.atan2(g.top, run);
    const len = Math.hypot(run, g.top);
    const rampX = -S / 2 + 2;
    const rampZ = S / 2 - g.depth - run / 2;
    this.block("g-gallery-ramp", new Vector3(3, 0.3, len), new Vector3(rampX, g.top / 2 - 0.15 * Math.cos(angle), rampZ), m.structure, {
      rotationX: -angle,
      castShadow: true,
      friction: 0.9,
    });
    this.block("g-gallery-landing", new Vector3(4, 0.4, g.depth), new Vector3(rampX, g.top - 0.2, gz), m.deck, { castShadow: true });
  }

  populate({ factory, fields }: PopulateContext): void {
    // Emitter: at 4.4 m (the ring of props below) it pulls at 400 / 4.4^2 = 21 m/s^2, about twice g
    fields.addPoint("attractor", GravityLab.EMITTER, 400, 10);
    // Upward column
    const c = GravityLab.COLUMN;
    fields.addZone(new Vector3(c.x, c.half.y, c.z), new Vector3(0, 3, 0), c.half);

    // The emitter slams these together at 10 m/s and more, so they are materials that survive it:
    // the room demonstrates gravity, not destruction.
    const mats: MaterialId[] = ["rubber", "steel", "elastic"];
    // Ring of mixed-material objects on the pad, close enough to be lifted
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      factory.spawn({
        kind: i % 3 === 0 ? "sphere" : i % 3 === 1 ? "box" : "cylinder",
        position: new Vector3(Math.cos(a) * 2.6, 0.45, Math.sin(a) * 2.6),
        material: mats[i % mats.length],
      });
    }
    // Objects that stay grounded outside the lift radius
    for (let i = 0; i < 4; i++) {
      factory.spawn({ kind: "box", size: new Vector3(0.9, 0.9, 0.9), position: new Vector3(-13 + i * 1.1, 0.46, 9), material: i % 2 ? "concrete" : "wood" });
    }
    // Balls waiting in the upward column
    for (let i = 0; i < 4; i++) {
      factory.spawn({ kind: "sphere", position: new Vector3(c.x - 1 + (i % 2) * 2, 0.4, c.z - 1 + Math.floor(i / 2) * 2), material: i % 2 ? "rubber" : "elastic" });
    }
  }
}
