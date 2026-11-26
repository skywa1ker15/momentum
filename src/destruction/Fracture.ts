import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PrimitiveKind } from "../objects/ObjectFactory";

/** A fragment in the parent's local frame (before rotation), as an axis-aligned box. */
export interface FractureCell {
  center: Vector3;
  size: Vector3;
}

/** Small deterministic PRNG (mulberry32) so fracture patterns are reproducible in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Splits a box into `target` smaller boxes that exactly tile it.
 * Each step cuts one cell across its longest edge at a random 35..65 % position.
 * Cells nearer the impact point are more likely to be cut, so fragments are
 * smaller around the impact. Cells are never cut below `minEdge`.
 */
export function splitBox(size: Vector3, target: number, impactLocal: Vector3 | null, rng: () => number, minEdge: number): FractureCell[] {
  const cells: FractureCell[] = [{ center: Vector3.Zero(), size: size.clone() }];
  const longest = (c: FractureCell) => Math.max(c.size.x, c.size.y, c.size.z);
  const reach = Math.max(size.x, size.y, size.z);

  while (cells.length < target) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (longest(c) < minEdge * 2) continue;
      const volume = c.size.x * c.size.y * c.size.z;
      const proximity = impactLocal ? 1 + (2 * reach) / (reach * 0.25 + Vector3.Distance(c.center, impactLocal)) : 1;
      const score = volume * proximity * (0.75 + rng() * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) break; // nothing left that may be cut

    const c = cells[best];
    const axis = c.size.x >= c.size.y && c.size.x >= c.size.z ? "x" : c.size.y >= c.size.z ? "y" : "z";
    const len = c.size[axis];
    const cut = Math.min(len - minEdge, Math.max(minEdge, len * (0.35 + rng() * 0.3)));
    const a: FractureCell = { center: c.center.clone(), size: c.size.clone() };
    const b: FractureCell = { center: c.center.clone(), size: c.size.clone() };
    a.size[axis] = cut;
    b.size[axis] = len - cut;
    a.center[axis] = c.center[axis] - len / 2 + cut / 2;
    b.center[axis] = c.center[axis] + cut / 2;
    cells.splice(best, 1, a, b);
  }
  return cells;
}

function insideShape(kind: PrimitiveKind, size: Vector3, p: Vector3): boolean {
  if (kind === "box") return true;
  if (kind === "sphere") return p.length() <= size.x / 2;
  return Math.hypot(p.x, p.z) <= size.x / 2 && Math.abs(p.y) <= size.y / 2;
}

/**
 * Fragments for a primitive. Boxes are tiled exactly. Spheres and cylinders are
 * approximated: their bounding box is split more finely and only cells whose
 * centre lies inside the shape are kept (the caller rescales fragment masses so
 * the total mass is conserved).
 */
export function fractureCells(kind: PrimitiveKind, size: Vector3, target: number, impactLocal: Vector3 | null, rng: () => number, minEdge: number): FractureCell[] {
  const bounds = kind === "sphere" ? new Vector3(size.x, size.x, size.x) : kind === "cylinder" ? new Vector3(size.x, size.y, size.x) : size;
  if (kind === "box") return splitBox(bounds, target, impactLocal, rng, minEdge);
  // Round shapes fill roughly 52 % (sphere) or 79 % (cylinder) of their bounding box.
  const fill = kind === "sphere" ? 0.52 : 0.79;
  const cells = splitBox(bounds, Math.ceil(target / fill), impactLocal, rng, minEdge).filter((c) => insideShape(kind, size, c.center));
  return cells.length >= 2 ? cells : splitBox(bounds, 2, impactLocal, rng, minEdge);
}
