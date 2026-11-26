import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BaseEnvironment, type EnvironmentContext, type LightRig, type PopulateContext } from "./Environment";
import type { SandboxObject } from "../objects/ObjectFactory";

const S = 44; // floor is S x S
const H = 14;
const T = 1;

/**
 * Destruction Arena: an open floor with a bonded brick wall, glass panes, breakable
 * stacks and a steel wrecking ball that is released into the wall when the experiment starts.
 */
export class DestructionArena extends BaseEnvironment {
  readonly id = "destruction-arena";
  readonly name = "Destruction Arena";
  readonly spawnPoint = new Vector3(0, 1.0, 15);
  readonly spawnYaw = Math.PI;
  readonly center = new Vector3(0, H / 2, 0);
  readonly lightRig: LightRig = {
    spots: [
      { position: new Vector3(-6, 13, -4), direction: new Vector3(0.4, -1, 0).normalize() },
      { position: new Vector3(6, 13, -4), direction: new Vector3(-0.4, -1, 0).normalize() },
    ],
    spotColor: new Color3(1.0, 0.72, 0.45),
    fogColor: new Color3(0.07, 0.045, 0.03),
  };

  /** Bricks are laid on a `pitch` grid slightly larger than the brick, leaving visible seams held by the bonds. */
  static readonly WALL = { z: -4, columns: 8, rows: 5, brick: new Vector3(0.96, 0.47, 0.5), pitch: new Vector3(1, 0.5, 0) };
  /** Wrecking ball: pivot on the ceiling, rope length, and the angle it is released from. */
  static readonly BALL = { pivot: new Vector3(0, H, -4), rope: 12.4, releaseAngle: 0.9, diameter: 1.1 };
  static readonly GALLERY = { top: 3, depth: 4 };

  build(ctx: EnvironmentContext): void {
    const { scene, materials: m } = ctx;
    this.scene = scene;

    this.block("a-floor", new Vector3(S, T, S), new Vector3(0, -T / 2, 0), m.floor, { friction: 0.8 });
    this.block("a-ceiling", new Vector3(S, T, S), new Vector3(0, H + T / 2, 0), m.ceiling, { receiveShadow: false });
    this.block("a-wall-n", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, -S / 2 - T / 2), m.wall);
    this.block("a-wall-s", new Vector3(S + 2 * T, H, T), new Vector3(0, H / 2, S / 2 + T / 2), m.wall);
    this.block("a-wall-w", new Vector3(T, H, S), new Vector3(-S / 2 - T / 2, H / 2, 0), m.wall);
    this.block("a-wall-e", new Vector3(T, H, S), new Vector3(S / 2 + T / 2, H / 2, 0), m.wall);

    // Hazard-coloured light strips
    for (const y of [1.1, 10.5]) {
      const o = { collider: false, receiveShadow: false };
      this.block(`a-strip-n-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, -S / 2 + 0.03), m.emissiveAmber, o);
      this.block(`a-strip-s-${y}`, new Vector3(S, 0.06, 0.05), new Vector3(0, y, S / 2 - 0.03), m.emissiveAmber, o);
      this.block(`a-strip-w-${y}`, new Vector3(0.05, 0.06, S), new Vector3(-S / 2 + 0.03, y, 0), m.emissiveAmber, o);
      this.block(`a-strip-e-${y}`, new Vector3(0.05, 0.06, S), new Vector3(S / 2 - 0.03, y, 0), m.emissiveAmber, o);
    }

    // Ceiling lights (instanced) and the gantry the wrecking ball hangs from
    const panel = this.instanceSource(CreateBox("a-ceiling-light", { width: 6, height: 0.08, depth: 1 }, scene));
    panel.material = m.lightPanel;
    let n = 0;
    for (const x of [-12, 12]) {
      for (let z = -15; z <= 15; z += 10) {
        const inst = panel.createInstance(`a-ceiling-light-${n++}`);
        inst.position.set(x, H - 0.05, z);
        this.finishStatic(inst);
      }
    }
    const b = DestructionArena.BALL;
    this.block("a-gantry", new Vector3(26, 0.5, 1.2), new Vector3(0, H - 0.25, b.pivot.z), m.structure, { collider: false, receiveShadow: false });

    // Impact zone marking under the wall
    const pad = CreateCylinder("a-pad", { diameter: 14, height: 0.02, tessellation: 72 }, scene);
    pad.position.set(0, 0.011, DestructionArena.WALL.z);
    pad.material = m.deck;
    pad.receiveShadows = true;
    this.finishStatic(pad);
    const ring = CreateTorus("a-pad-ring", { diameter: 14, thickness: 0.07, tessellation: 96 }, scene);
    ring.position.set(0, 0.02, DestructionArena.WALL.z);
    ring.material = m.emissiveAmber;
    this.finishStatic(ring);

    // Blast barriers the player can stand behind
    for (const x of [-7, 7]) {
      this.block(`a-barrier-${x}`, new Vector3(4, 1.3, 0.5), new Vector3(x, 0.65, 9), m.structure, { castShadow: true });
      this.block(`a-barrier-top-${x}`, new Vector3(4, 0.05, 0.52), new Vector3(x, 1.33, 9), m.emissiveAmber, { collider: false, receiveShadow: false });
    }

    // Observation gallery along the south wall with a ramp on the east side
    const g = DestructionArena.GALLERY;
    const gz = S / 2 - g.depth / 2;
    this.block("a-gallery", new Vector3(S - 10, 0.4, g.depth), new Vector3(-3, g.top - 0.2, gz), m.deck, { castShadow: true });
    this.block("a-gallery-glass", new Vector3(S - 10, 1.1, 0.08), new Vector3(-3, g.top + 0.55, gz - g.depth / 2 + 0.04), m.glass, { receiveShadow: false });
    this.block("a-gallery-edge", new Vector3(S - 10, 0.06, 0.06), new Vector3(-3, g.top - 0.2, gz - g.depth / 2 - 0.03), m.emissiveAmber, { collider: false, receiveShadow: false });
    const run = 8;
    const angle = Math.atan2(g.top, run);
    const rampX = S / 2 - 2.5;
    const rampZ = S / 2 - g.depth - run / 2;
    this.block("a-gallery-ramp", new Vector3(3, 0.3, Math.hypot(run, g.top)), new Vector3(rampX, g.top / 2 - 0.15 * Math.cos(angle), rampZ), m.structure, {
      rotationX: -angle,
      castShadow: true,
      friction: 0.9,
    });
    this.block("a-gallery-landing", new Vector3(5, 0.4, g.depth), new Vector3(rampX, g.top - 0.2, gz), m.deck, { castShadow: true });
  }

  populate({ factory, joints }: PopulateContext): void {
    const floor = this.bodyOf("a-floor");
    const ceiling = this.bodyOf("a-ceiling");

    // Bonded concrete brick wall: every brick is welded to its right and upper neighbours.
    const w = DestructionArena.WALL;
    const grid: (SandboxObject | null)[][] = [];
    for (let row = 0; row < w.rows; row++) {
      grid.push([]);
      for (let col = 0; col < w.columns; col++) {
        const x = (col - (w.columns - 1) / 2) * w.pitch.x;
        const y = w.brick.y / 2 + row * w.pitch.y;
        grid[row].push(factory.spawn({ kind: "box", size: w.brick, material: "concrete", position: new Vector3(x, y, w.z) }));
      }
    }
    for (let row = 0; row < w.rows; row++) {
      for (let col = 0; col < w.columns; col++) {
        const brick = grid[row][col];
        if (!brick) continue;
        const right = grid[row][col + 1];
        const above = grid[row + 1]?.[col];
        const p = brick.mesh.position;
        if (right) joints.create("weld", brick, right.body, right, new Vector3(p.x + w.pitch.x / 2, p.y, p.z), Vector3.Up());
        if (above) joints.create("weld", brick, above.body, above, new Vector3(p.x, p.y + w.pitch.y / 2, p.z), Vector3.Up());
      }
    }

    // Steel wrecking ball on a ball joint, released from one side so it swings through the wall.
    const b = DestructionArena.BALL;
    const ball = factory.spawn({
      kind: "sphere",
      size: new Vector3(b.diameter, b.diameter, b.diameter),
      material: "steel",
      position: b.pivot.add(new Vector3(0, -Math.cos(b.releaseAngle) * b.rope, Math.sin(b.releaseAngle) * b.rope)),
      props: { linearDamping: 0, angularDamping: 0.3 },
    });
    if (ball) joints.create("ball", ball, ceiling, null, b.pivot, Vector3.Up());

    // Glass panes welded to the floor: they shatter or snap off their base.
    for (let i = 0; i < 3; i++) {
      const pane = factory.spawn({ kind: "box", size: new Vector3(2.2, 2.6, 0.1), material: "glass", position: new Vector3(-13, 1.3, -10 + i * 3.5) });
      if (pane) joints.create("weld", pane, floor, null, new Vector3(-13, 0, -10 + i * 3.5), Vector3.Up());
    }

    // Loose breakables: an ice column, a crate stack and plastic drums
    for (let i = 0; i < 4; i++) {
      factory.spawn({ kind: "cylinder", size: new Vector3(0.9, 0.9, 0.9), material: "ice", position: new Vector3(12, 0.46 + i * 0.91, -9) });
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3 - row; col++) {
        factory.spawn({ kind: "box", size: new Vector3(0.9, 0.9, 0.9), material: "wood", position: new Vector3(11 + (col - (2 - row) / 2) * 0.93, 0.46 + row * 0.91, 2) });
      }
    }
    for (let i = 0; i < 3; i++) {
      factory.spawn({ kind: "cylinder", size: new Vector3(0.6, 0.9, 0.6), material: "plastic", position: new Vector3(-11 + i * 0.8, 0.46, 3) });
    }
    // Ammunition for the player
    for (let i = 0; i < 3; i++) {
      factory.spawn({ kind: "sphere", size: new Vector3(0.45, 0.45, 0.45), material: i === 1 ? "rubber" : "steel", position: new Vector3(-1 + i, 0.23, 12) });
    }
  }
}
