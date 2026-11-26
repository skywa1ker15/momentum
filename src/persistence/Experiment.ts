import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { CONFIG } from "../core/config";
import { JOINT_KINDS, type JointKind, type JointManager } from "../construction/Joints";
import type { DestructionSystem } from "../destruction/Destruction";
import type { GravityFields } from "../fields/GravityFields";
import type { WaterVolumes } from "../fluids/WaterVolumes";
import { MATERIALS, type MaterialId } from "../materials/Materials";
import { PRIMITIVE_KINDS, type ObjectFactory, type PhysicalProps, type PrimitiveKind, type SandboxObject } from "../objects/ObjectFactory";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

export const SAVE_VERSION = 1;

type V3 = [number, number, number];
type Q4 = [number, number, number, number];

export interface SavedObject {
  id: number;
  kind: PrimitiveKind;
  size: V3;
  material: MaterialId;
  position: V3;
  rotation: Q4;
  linearVelocity: V3;
  angularVelocity: V3;
  props: PhysicalProps;
  generation: number;
}

export interface SavedJoint {
  kind: JointKind;
  a: number;
  /** Other object's id, or null when joined to the room. */
  b: number | null;
  /** Name of the room collider when joined to the room. */
  world: string | null;
  /** Pivots and axis in the bodies' own frames. */
  pivotA: V3;
  pivotB: V3;
  axisA: V3;
  motorSpeed: number;
  restLength: number | null;
}

export type SavedField = { kind: "attractor" | "repulsor"; position: V3; mu: number; radius: number } | { kind: "zone"; position: V3; halfExtents: V3; gravity: V3 };

export interface SavedWater {
  position: V3;
  halfExtents: V3;
  density: number;
}

/** A complete experiment: everything needed to rebuild the dynamic state of an environment. */
export interface ExperimentData {
  version: number;
  savedAt: string;
  environment: string;
  gravityY: number;
  destructionLevel: number;
  objects: SavedObject[];
  joints: SavedJoint[];
  fields: SavedField[];
  water: SavedWater[];
  /** Where the player stood and looked, and the tool in hand. Optional: older saves lack it. */
  player?: { position: V3; yaw: number; pitch: number };
  tool?: string;
}

/** Limits applied to values read from a save, so a hand-edited file cannot create an absurd state. */
export const SAVE_LIMITS = { position: 200, speed: 200, spin: 100, mu: 5000, fieldRadius: 60, extent: 60 };

export interface ExperimentSystems {
  environmentId: string;
  world: PhysicsWorld;
  factory: ObjectFactory;
  joints: JointManager;
  fields: GravityFields;
  water: WaterVolumes;
  destruction: DestructionSystem;
  /** Looks up a room collider by name, for joints to the room. */
  roomBody(name: string): PhysicsBody | null;
}

const v3 = (v: Vector3): V3 => [v.x, v.y, v.z];
const round = (n: number) => Math.round(n * 1e5) / 1e5;
const r3 = (v: Vector3): V3 => [round(v.x), round(v.y), round(v.z)];

/** Snapshot of the current experiment. Plain JSON-serialisable data. */
export function captureExperiment(sys: ExperimentSystems): ExperimentData {
  const objects: SavedObject[] = [];
  for (const o of sys.factory.all) {
    const q = o.mesh.rotationQuaternion ?? Quaternion.Identity();
    objects.push({
      id: o.id,
      kind: o.kind,
      size: v3(o.size),
      material: o.materialId,
      position: r3(o.mesh.position),
      rotation: [round(q.x), round(q.y), round(q.z), round(q.w)],
      linearVelocity: r3(o.body.getLinearVelocity()),
      angularVelocity: r3(o.body.getAngularVelocity()),
      props: { ...o.props },
      generation: o.generation,
    });
  }
  const joints: SavedJoint[] = sys.joints.all.map((j) => ({
    kind: j.kind,
    a: j.a.id,
    b: j.b ? j.b.id : null,
    world: j.b ? null : j.bBody.transformNode.name,
    pivotA: v3(j.localPivotA),
    pivotB: v3(j.localPivotB),
    axisA: v3(j.localAxisA),
    motorSpeed: j.motorSpeed,
    restLength: j.spring ? j.spring.restLength : null,
  }));
  const fields: SavedField[] = sys.fields.all.map((f) =>
    f.kind === "zone" ? { kind: "zone", position: v3(f.position), halfExtents: v3(f.halfExtents), gravity: v3(f.gravity) } : { kind: f.kind, position: v3(f.position), mu: f.mu, radius: f.radius },
  );
  const water: SavedWater[] = sys.water.all.map((w) => ({ position: v3(w.position), halfExtents: v3(w.halfExtents), density: w.density }));
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    environment: sys.environmentId,
    gravityY: sys.world.gravity.y,
    destructionLevel: sys.destruction.level,
    objects,
    joints,
    fields,
    water,
  };
}

// --- validation -------------------------------------------------------------

class SaveError extends Error {}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function vec(v: unknown, n: number, what: string): number[] {
  if (!Array.isArray(v) || v.length !== n || !v.every(isNum)) throw new SaveError(`${what} is not a list of ${n} numbers`);
  return v as number[];
}
const clampAbs = (v: number, max: number) => Math.min(max, Math.max(-max, v));
/** Vector with each component limited to +-max. */
function bounded(v: unknown, what: string, max: number): V3 {
  return vec(v, 3, what).map((c) => clampAbs(c, max)) as V3;
}
/** Vector whose length is limited to max. */
function limited(v: unknown, what: string, max: number): V3 {
  const a = vec(v, 3, what);
  const len = Math.hypot(a[0], a[1], a[2]);
  return (len > max ? a.map((c) => (c * max) / len) : a) as V3;
}
function rotation(v: unknown, what: string): Q4 {
  const q = vec(v, 4, what);
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len < 1e-6 ? [0, 0, 0, 1] : (q.map((c) => c / len) as Q4);
}
function num(v: unknown, what: string): number {
  if (!isNum(v)) throw new SaveError(`${what} is not a number`);
  return v;
}

/**
 * Checks untrusted data (a file the user picked, or storage contents) and returns it as
 * ExperimentData. Throws an Error with a readable message when it is not a valid save.
 */
export function validateExperiment(raw: unknown, knownEnvironments: readonly string[]): ExperimentData {
  if (!raw || typeof raw !== "object") throw new SaveError("The file is not a MOMENTUM experiment.");
  const d = raw as Record<string, unknown>;
  if (d.version !== SAVE_VERSION) throw new SaveError(`Unsupported save version (${String(d.version)}); this build reads version ${SAVE_VERSION}.`);
  if (typeof d.environment !== "string" || !knownEnvironments.includes(d.environment)) throw new SaveError(`Unknown environment "${String(d.environment)}".`);
  for (const key of ["objects", "joints", "fields", "water"]) {
    if (!Array.isArray(d[key])) throw new SaveError(`The save has no "${key}" list.`);
  }
  const ids = new Set<number>();
  const objects = (d.objects as unknown[]).map((raw, i): SavedObject => {
    const o = raw as Record<string, unknown>;
    const what = `Object ${i + 1}`;
    if (!o || typeof o !== "object") throw new SaveError(`${what} is malformed.`);
    if (!(PRIMITIVE_KINDS as readonly unknown[]).includes(o.kind)) throw new SaveError(`${what} has an unknown shape.`);
    if (typeof o.material !== "string" || !(o.material in MATERIALS)) throw new SaveError(`${what} has an unknown material.`);
    const size = vec(o.size, 3, `${what} size`);
    if (size.some((s) => s <= 0 || s > 50)) throw new SaveError(`${what} has an invalid size.`);
    const p = (o.props ?? {}) as Record<string, unknown>;
    const id = num(o.id, `${what} id`);
    if (ids.has(id)) throw new SaveError(`${what} repeats id ${id}.`);
    ids.add(id);
    return {
      id,
      kind: o.kind as PrimitiveKind,
      size: size as V3,
      material: o.material as MaterialId,
      position: bounded(o.position, `${what} position`, SAVE_LIMITS.position),
      rotation: rotation(o.rotation, `${what} rotation`),
      linearVelocity: limited(o.linearVelocity, `${what} velocity`, SAVE_LIMITS.speed),
      angularVelocity: limited(o.angularVelocity, `${what} angular velocity`, SAVE_LIMITS.spin),
      props: {
        mass: num(p.mass, `${what} mass`),
        friction: num(p.friction, `${what} friction`),
        restitution: num(p.restitution, `${what} restitution`),
        linearDamping: num(p.linearDamping, `${what} linear damping`),
        angularDamping: num(p.angularDamping, `${what} angular damping`),
        gravityFactor: num(p.gravityFactor, `${what} gravity factor`),
        isStatic: p.isStatic === true,
      },
      generation: isNum(o.generation) ? Math.max(0, Math.floor(o.generation)) : 0,
    };
  });
  const joints = (d.joints as unknown[]).map((raw, i): SavedJoint => {
    const j = raw as Record<string, unknown>;
    const what = `Joint ${i + 1}`;
    if (!j || !(JOINT_KINDS as readonly unknown[]).includes(j.kind)) throw new SaveError(`${what} has an unknown type.`);
    const a = num(j.a, `${what} first object`);
    if (!ids.has(a)) throw new SaveError(`${what} refers to a missing object.`);
    const b = j.b === null || j.b === undefined ? null : num(j.b, `${what} second object`);
    if (b !== null && !ids.has(b)) throw new SaveError(`${what} refers to a missing object.`);
    if (b === null && typeof j.world !== "string") throw new SaveError(`${what} is attached to nothing.`);
    return {
      kind: j.kind as JointKind,
      a,
      b,
      world: b === null ? (j.world as string) : null,
      pivotA: vec(j.pivotA, 3, `${what} pivot`) as V3,
      pivotB: vec(j.pivotB, 3, `${what} pivot`) as V3,
      axisA: vec(j.axisA, 3, `${what} axis`) as V3,
      motorSpeed: isNum(j.motorSpeed) ? j.motorSpeed : 0,
      restLength: isNum(j.restLength) ? j.restLength : null,
    };
  });
  const fields = (d.fields as unknown[]).map((raw, i): SavedField => {
    const f = raw as Record<string, unknown>;
    const what = `Field ${i + 1}`;
    const L = SAVE_LIMITS;
    if (f?.kind === "zone") return { kind: "zone", position: bounded(f.position, what, L.position), halfExtents: bounded(f.halfExtents, what, L.extent).map(Math.abs) as V3, gravity: limited(f.gravity, what, CONFIG.gravity.max) };
    if (f?.kind === "attractor" || f?.kind === "repulsor")
      return { kind: f.kind, position: bounded(f.position, what, L.position), mu: clampAbs(num(f.mu, `${what} strength`), L.mu), radius: Math.min(L.fieldRadius, Math.abs(num(f.radius, `${what} radius`))) };
    throw new SaveError(`${what} has an unknown type.`);
  });
  const water = (d.water as unknown[]).map((raw, i): SavedWater => {
    const w = raw as Record<string, unknown>;
    return {
      position: bounded(w?.position, `Water ${i + 1}`, SAVE_LIMITS.position),
      halfExtents: bounded(w?.halfExtents, `Water ${i + 1}`, SAVE_LIMITS.extent).map(Math.abs) as V3,
      density: isNum(w?.density) ? Math.min(20000, Math.max(1, w.density)) : CONFIG.water.density,
    };
  });
  return {
    version: SAVE_VERSION,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
    environment: d.environment,
    gravityY: Math.min(CONFIG.gravity.max, Math.max(CONFIG.gravity.min, isNum(d.gravityY) ? d.gravityY : CONFIG.physics.gravity)),
    destructionLevel: Math.min(CONFIG.destruction.levels.length - 1, Math.max(0, isNum(d.destructionLevel) ? Math.floor(d.destructionLevel) : CONFIG.destruction.defaultLevel)),
    objects,
    joints,
    fields,
    water,
    player: readPlayer(d.player),
    tool: typeof d.tool === "string" ? d.tool.slice(0, 20) : undefined,
  };
}

function readPlayer(raw: unknown): ExperimentData["player"] {
  const p = raw as Record<string, unknown> | undefined;
  if (!p || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(isNum) || !isNum(p.yaw) || !isNum(p.pitch)) return undefined;
  return { position: (p.position as number[]).map((c) => clampAbs(c, SAVE_LIMITS.position)) as V3, yaw: p.yaw % (Math.PI * 2), pitch: clampAbs(p.pitch, 1.55) };
}

// --- restore ----------------------------------------------------------------

export interface RestoreReport {
  objects: number;
  joints: number;
  /** Things in the save that could not be recreated (limits reached, missing room collider). */
  skipped: number;
}

/**
 * Rebuilds a validated experiment. The target environment must already be loaded and
 * empty (no objects, joints, fields or water). Objects get new ids.
 */
export function restoreExperiment(data: ExperimentData, sys: ExperimentSystems): RestoreReport {
  const report: RestoreReport = { objects: 0, joints: 0, skipped: 0 };
  sys.world.setGravity(new Vector3(0, data.gravityY, 0));
  sys.destruction.setLevel(data.destructionLevel);

  const byOldId = new Map<number, SandboxObject>();
  for (const o of data.objects) {
    const obj = sys.factory.spawn({
      kind: o.kind,
      size: new Vector3(...o.size),
      material: o.material,
      position: new Vector3(...o.position),
      rotation: new Quaternion(...o.rotation),
      props: o.props,
      generation: o.generation,
    });
    if (!obj) {
      report.skipped++;
      continue;
    }
    if (!o.props.isStatic) {
      obj.body.setLinearVelocity(new Vector3(...o.linearVelocity));
      obj.body.setAngularVelocity(new Vector3(...o.angularVelocity));
    }
    byOldId.set(o.id, obj);
    report.objects++;
  }

  const toWorld = (position: Vector3, rotation: Quaternion, local: V3) => new Vector3(...local).rotateByQuaternionToRef(rotation, new Vector3()).addInPlace(position);
  for (const j of data.joints) {
    const a = byOldId.get(j.a);
    const b = j.b === null ? null : byOldId.get(j.b);
    const bBody = j.b === null ? sys.roomBody(j.world ?? "") : (b?.body ?? null);
    if (!a || !bBody || (j.b !== null && !b)) {
      report.skipped++;
      continue;
    }
    const rotA = a.mesh.rotationQuaternion ?? Quaternion.Identity();
    const anchorA = toWorld(a.mesh.position, rotA, j.pivotA);
    const axis = new Vector3(...j.axisA).rotateByQuaternionToRef(rotA, new Vector3());
    const nodeB = bBody.transformNode;
    const pivotB = toWorld(nodeB.position, nodeB.rotationQuaternion ?? Quaternion.Identity(), j.pivotB);
    const joint = sys.joints.create(j.kind, a, bBody, b ?? null, j.kind === "spring" ? pivotB : anchorA, axis, anchorA, j.restLength ?? undefined);
    if (!joint) {
      report.skipped++;
      continue;
    }
    if (j.kind === "motor") sys.joints.setMotorSpeed(joint, j.motorSpeed);
    report.joints++;
  }

  for (const f of data.fields) {
    const made = f.kind === "zone" ? sys.fields.addZone(new Vector3(...f.position), new Vector3(...f.gravity), new Vector3(...f.halfExtents)) : sys.fields.addPoint(f.kind, new Vector3(...f.position), Math.abs(f.mu), f.radius);
    if (!made) report.skipped++;
  }
  for (const w of data.water) {
    if (!sys.water.add(new Vector3(...w.position), new Vector3(...w.halfExtents), w.density)) report.skipped++;
  }
  return report;
}
