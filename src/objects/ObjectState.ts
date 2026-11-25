import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SandboxObject } from "./ObjectFactory";

/** Instantaneous kinematic state, read from the engine. SI units. */
export interface ObjectState {
  position: Vector3;
  velocity: Vector3;
  /** m/s */
  speed: number;
  /** rad/s */
  angularSpeed: number;
  /** Linear momentum magnitude |p| = m |v|, kg m/s */
  momentum: number;
  /** Translational kinetic energy, J */
  kineticLinear: number;
  /** Rotational kinetic energy, J */
  kineticRotational: number;
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();

/**
 * Rotational kinetic energy 1/2 m sum(u_i w_i^2), with w expressed in the body's principal-axis frame.
 * `unitInertia` is Havok's inertia tensor per unit mass (m^2), so I_i = mass * u_i.
 */
export function rotationalEnergy(mass: number, unitInertia: Vector3, inertiaOrientation: Quaternion | undefined, bodyRotation: Quaternion, angularVelocityWorld: Vector3): number {
  // world -> body frame
  Quaternion.InverseToRef(bodyRotation, tmpQ);
  angularVelocityWorld.rotateByQuaternionToRef(tmpQ, tmpV);
  // body -> principal axes
  if (inertiaOrientation) {
    Quaternion.InverseToRef(inertiaOrientation, tmpQ);
    tmpV.rotateByQuaternionToRef(tmpQ, tmpV);
  }
  return 0.5 * mass * (unitInertia.x * tmpV.x * tmpV.x + unitInertia.y * tmpV.y * tmpV.y + unitInertia.z * tmpV.z * tmpV.z);
}

export function readState(obj: SandboxObject): ObjectState {
  const velocity = obj.body.getLinearVelocity();
  const angular = obj.body.getAngularVelocity();
  const speed = velocity.length();
  const mp = obj.body.getMassProperties();
  const mass = mp.mass ?? obj.props.mass;
  const rot = obj.mesh.rotationQuaternion ?? Quaternion.Identity();
  return {
    position: obj.body.getObjectCenterWorld(),
    velocity,
    speed,
    angularSpeed: angular.length(),
    momentum: mass * speed,
    kineticLinear: 0.5 * mass * speed * speed,
    kineticRotational: mp.inertia ? rotationalEnergy(mass, mp.inertia, mp.inertiaOrientation, rot, angular) : 0,
  };
}
