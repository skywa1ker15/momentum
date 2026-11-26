import type { Observer } from "@babylonjs/core/Misc/observable";
import type { IPhysicsCollisionEvent } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { ObjectFactory, SandboxObject } from "../objects/ObjectFactory";

/**
 * The inspected object, with the contact impulses it receives.
 */
export class Selection {
  current: SandboxObject | null = null;
  /** Impulse of the most recent contact event, N s. */
  lastImpact = 0;
  /** Largest contact impulse since selection, N s. */
  peakImpact = 0;
  contacts = 0;
  onChange: ((obj: SandboxObject | null) => void) | null = null;

  private observer: Observer<IPhysicsCollisionEvent> | null = null;

  constructor(factory: ObjectFactory) {
    factory.onRemoved.push((o) => {
      if (this.current === o) this.select(null);
    });
    // The rebuilt object has a new mesh and body; the old ones are already gone.
    factory.onRebuilt.push((o) => {
      if (this.current !== o) return;
      this.current = null;
      this.observer = null;
      this.select(o);
    });
  }

  select(obj: SandboxObject | null): void {
    if (obj === this.current) return;
    const prev = this.current;
    if (prev) {
      prev.mesh.showBoundingBox = false;
      if (this.observer) prev.body.getCollisionObservable().remove(this.observer);
      this.observer = null;
    }
    this.current = obj;
    this.lastImpact = 0;
    this.peakImpact = 0;
    this.contacts = 0;
    if (obj) {
      obj.mesh.showBoundingBox = true;
      this.observer = obj.body.getCollisionObservable().add((ev) => {
        if (ev.impulse <= 0) return;
        this.lastImpact = ev.impulse;
        this.peakImpact = Math.max(this.peakImpact, ev.impulse);
        this.contacts++;
      });
    }
    this.onChange?.(obj);
  }
}
