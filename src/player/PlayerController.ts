import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { CharacterSupportedState, PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import type { Scene } from "@babylonjs/core/scene";
import { CONFIG } from "../core/config";

export interface MoveIntent {
  /** -1..1, +1 = forward. */
  forward: number;
  /** -1..1, +1 = right. */
  strafe: number;
  sprint: boolean;
  jump: boolean;
}

const UP = Vector3.Up();
const DOWN = Vector3.Down();
const HALF_PI = Math.PI / 2;

/**
 * First-person body: a Havok character controller (capsule shape casts against the
 * physics world) plus view angles. It walks, steps, slides on slopes, jumps and
 * pushes dynamic bodies. It always uses standard gravity and real time, so the
 * player can still move while the experiment is paused or in slow motion.
 */
export class PlayerController {
  yaw = 0;
  pitch = 0;
  grounded = false;

  private readonly cc: PhysicsCharacterController;
  private readonly gravity = new Vector3(0, CONFIG.physics.gravity, 0);
  private wantJump = false;
  /** Seconds remaining during which ground contact is ignored after a jump launch. */
  private airLock = 0;

  constructor(scene: Scene, spawn: Vector3, yaw: number) {
    const p = CONFIG.player;
    this.cc = new PhysicsCharacterController(spawn.clone(), { capsuleHeight: p.capsuleHeight, capsuleRadius: p.capsuleRadius }, scene);
    this.cc.characterMass = p.mass;
    this.cc.maxSlopeCosine = Math.cos((50 * Math.PI) / 180);
    this.yaw = yaw;
  }

  get position(): Vector3 {
    return this.cc.getPosition();
  }

  get velocity(): Vector3 {
    return this.cc.getVelocity();
  }

  get eyePosition(): Vector3 {
    return this.cc.getPosition().add(new Vector3(0, CONFIG.player.eyeOffset, 0));
  }

  /** Unit view direction from yaw/pitch (left-handed, yaw 0 looks down +Z). */
  get viewDirection(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  look(dxPixels: number, dyPixels: number): void {
    const s = CONFIG.player.mouseSensitivity;
    this.yaw = (this.yaw + dxPixels * s) % (Math.PI * 2);
    this.pitch = Math.min(HALF_PI - 0.02, Math.max(-HALF_PI + 0.02, this.pitch + dyPixels * s));
  }

  teleport(position: Vector3, yaw: number): void {
    this.cc.setPosition(position.clone());
    this.cc.setVelocity(Vector3.Zero());
    this.yaw = yaw;
    this.pitch = 0;
  }

  /** Advance the character by dt seconds of real time. */
  update(dt: number, intent: MoveIntent): void {
    if (dt <= 0) return;
    dt = Math.min(dt, CONFIG.physics.maxStep);
    const p = CONFIG.player;
    const support = this.cc.checkSupport(dt, DOWN);
    this.airLock = Math.max(0, this.airLock - dt);
    this.grounded = this.airLock === 0 && support.supportedState === CharacterSupportedState.SUPPORTED;
    if (intent.jump && this.grounded) this.wantJump = true;

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward.scale(intent.forward).addInPlace(right.scale(intent.strafe));
    if (wish.lengthSquared() > 1) wish.normalize();

    const current = this.cc.getVelocity();
    let out: Vector3;

    if (this.wantJump && this.grounded) {
      // Launch speed that reaches jumpHeight under standard gravity: v = sqrt(2 g h)
      const launch = Math.sqrt(2 * Math.abs(this.gravity.y) * p.jumpHeight);
      out = current.add(UP.scale(launch - current.dot(UP)));
      this.wantJump = false;
      this.airLock = 0.12; // the capsule is still within contact tolerance for a few frames
    } else if (this.grounded) {
      const desired = wish.scale(intent.sprint ? p.sprintSpeed : p.walkSpeed);
      out = this.cc.calculateMovement(dt, forward, support.averageSurfaceNormal, current, support.averageSurfaceVelocity, desired, UP);
      // Project onto the support surface so walking up slopes keeps horizontal speed.
      out.subtractInPlace(support.averageSurfaceVelocity);
      if (out.dot(UP) > 1e-3) {
        const len = out.length();
        out.normalizeFromLength(len);
        const horizLen = len / support.averageSurfaceNormal.dot(UP);
        const c = support.averageSurfaceNormal.cross(out);
        out = c.cross(UP).scaleInPlace(horizLen);
      }
      out.addInPlace(support.averageSurfaceVelocity);
    } else {
      const desired = wish.scale(p.airSpeed);
      out = this.cc.calculateMovement(dt, forward, UP, current, Vector3.ZeroReadOnly, desired, UP);
      out.addInPlace(UP.scale(-out.dot(UP)));
      out.addInPlace(UP.scale(current.dot(UP)));
      out.addInPlace(this.gravity.scale(dt));
      this.wantJump = false;
    }

    this.cc.setVelocity(out);
    this.cc.integrate(dt, support, this.gravity);
  }

  /** Camera orientation for the current view angles. */
  viewRotation(): Quaternion {
    return Quaternion.RotationYawPitchRoll(this.yaw, this.pitch, 0);
  }

  dispose(): void {
    this.cc.dispose();
  }
}
