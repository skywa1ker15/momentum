import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "../core/config";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { PrimitiveKind } from "./ObjectFactory";

/** Radius of a sphere that encloses the primitive in any orientation, m. */
export function boundingRadius(kind: PrimitiveKind, size: Vector3): number {
  if (kind === "sphere") return size.x / 2;
  if (kind === "cylinder") return Math.hypot(size.x, size.y) / 2;
  return size.length() / 2;
}

const CLEARANCE = 0.03;

/**
 * Where to spawn an object the player is aiming to place, or null when there is no room.
 *
 * The object goes `spawnDistance` ahead, or against the first surface in the way, backed off
 * along the surface normal so it never starts inside geometry. It is then kept clear of the
 * player's capsule (looking straight down would otherwise spawn it inside the player); if
 * moving it clear would push it into a wall, the spawn is refused.
 */
export function findSpawnPosition(world: PhysicsWorld, eye: Vector3, dir: Vector3, playerPosition: Vector3, radius: number): Vector3 | null {
  const reach = CONFIG.interaction.spawnDistance;
  const hit = world.raycast(eye, eye.add(dir.scale(reach + radius + CLEARANCE)));
  const pos = hit ? hit.point.add(hit.normal.scale(radius + CLEARANCE)) : eye.add(dir.scale(reach));

  // Keep clear of the player's capsule (horizontal distance from its axis).
  const need = CONFIG.player.capsuleRadius + radius + 0.08;
  const top = playerPosition.y + CONFIG.player.capsuleHeight / 2 + radius;
  const bottom = playerPosition.y - CONFIG.player.capsuleHeight / 2 - radius;
  const dx = pos.x - playerPosition.x;
  const dz = pos.z - playerPosition.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < need && pos.y < top && pos.y > bottom) {
    // Push outwards along the view's horizontal heading (or the existing offset when looking straight down).
    let hx = dir.x;
    let hz = dir.z;
    let hl = Math.hypot(hx, hz);
    if (hl < 1e-3) {
      hx = dx;
      hz = dz;
      hl = horizontal;
    }
    if (hl < 1e-3) return null;
    pos.x = playerPosition.x + (hx / hl) * need;
    pos.z = playerPosition.z + (hz / hl) * need;
    // Is the pushed position still free? Check the path from the player's axis at that height.
    const from = new Vector3(playerPosition.x, pos.y, playerPosition.z);
    const to = from.add(new Vector3(hx / hl, 0, hz / hl).scale(need + radius + CLEARANCE));
    if (world.raycast(from, to)) return null;
  }
  // Never below a floor directly underneath (a tall object placed against a wall near the ground).
  const below = world.raycast(pos, pos.add(new Vector3(0, -(radius + CLEARANCE), 0)));
  if (below) pos.y = below.point.y + radius + CLEARANCE;
  return pos;
}
