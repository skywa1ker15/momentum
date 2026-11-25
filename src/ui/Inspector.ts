import { CONFIG } from "../core/config";
import { PROP_LIMITS, type PhysicalProps, type SandboxObject } from "../objects/ObjectFactory";
import type { ObjectState } from "../objects/ObjectState";
import { fixed, mass as formatMass, si } from "./format";

type NumericProp = Exclude<keyof PhysicalProps, "isStatic">;

interface SliderSpec {
  key: NumericProp;
  label: string;
  unit: string;
  /** Logarithmic mapping for quantities spanning orders of magnitude. */
  log?: boolean;
  digits: number;
}

const SLIDERS: SliderSpec[] = [
  { key: "mass", label: "Mass", unit: "kg", log: true, digits: 1 },
  { key: "friction", label: "Friction", unit: "", digits: 2 },
  { key: "restitution", label: "Restitution", unit: "", digits: 2 },
  { key: "linearDamping", label: "Lin. damping", unit: "/s", digits: 2 },
  { key: "angularDamping", label: "Ang. damping", unit: "/s", digits: 2 },
  { key: "gravityFactor", label: "Gravity ×", unit: "", digits: 2 },
];

const STEPS = 1000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface InspectorImpacts {
  last: number;
  peak: number;
  contacts: number;
}

/**
 * Object inspector: live engine readouts plus property editors.
 * Editors are interactive only in edit mode (pointer released).
 */
export class Inspector {
  onPropChange: ((change: Partial<PhysicalProps>) => void) | null = null;
  onGravityChange: ((y: number) => void) | null = null;
  onDuplicate: (() => void) | null = null;
  onDelete: (() => void) | null = null;
  onDeselect: (() => void) | null = null;

  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly body: HTMLElement;
  private readonly live: Record<string, HTMLElement> = {};
  private readonly sliders = new Map<NumericProp, { input: HTMLInputElement; value: HTMLElement; spec: SliderSpec }>();
  private readonly staticToggle: HTMLInputElement;
  private readonly gravityInput: HTMLInputElement;
  private readonly gravityValue: HTMLElement;
  private lastLiveAt = 0;

  constructor(parent: HTMLElement) {
    this.root = el("div", "panel inspector");
    parent.appendChild(this.root);

    const head = el("div", "inspector-head");
    head.append(el("span", "inspector-eyebrow", "Inspector"));
    this.title = el("span", "inspector-title", "");
    head.appendChild(this.title);
    this.root.appendChild(head);

    this.empty = el("div", "inspector-empty");
    this.empty.innerHTML = "No object selected. Aim at an object and press <kbd>E</kbd>.";
    this.root.appendChild(this.empty);

    this.body = el("div", "inspector-body");
    this.root.appendChild(this.body);

    // Live readouts (read from the physics engine every update)
    const liveGrid = el("div", "live-grid");
    const rows: Array<[string, string]> = [
      ["speed", "Speed"],
      ["velocity", "Velocity"],
      ["momentum", "Momentum"],
      ["energy", "Kinetic energy"],
      ["rotEnergy", "… rotational part"],
      ["angular", "Angular speed"],
      ["height", "Height"],
      ["impact", "Impact last / peak"],
    ];
    for (const [key, label] of rows) {
      const row = el("div", "stat-row");
      const value = el("span", "stat-value", "-");
      row.append(el("span", "stat-label", label), value);
      liveGrid.appendChild(row);
      this.live[key] = value;
    }
    this.body.appendChild(liveGrid);

    // Property editors
    const editors = el("div", "editors");
    editors.appendChild(el("div", "section-label", "Properties"));
    for (const spec of SLIDERS) {
      const row = el("label", "slider-row");
      const value = el("span", "stat-value", "");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = String(STEPS);
      input.step = "1";
      input.addEventListener("input", () => {
        const v = this.fromSlider(spec, Number(input.value));
        value.textContent = this.formatProp(spec, v);
        this.onPropChange?.({ [spec.key]: v });
      });
      row.append(el("span", "stat-label", spec.label), input, value);
      editors.appendChild(row);
      this.sliders.set(spec.key, { input, value, spec });
    }
    const staticRow = el("label", "toggle-row");
    this.staticToggle = el("input");
    this.staticToggle.type = "checkbox";
    this.staticToggle.addEventListener("change", () => this.onPropChange?.({ isStatic: this.staticToggle.checked }));
    staticRow.append(el("span", "stat-label", "Static"), this.staticToggle, el("span", "toggle-track"));
    editors.appendChild(staticRow);

    const actions = el("div", "inspector-actions");
    actions.append(
      this.button("Duplicate", () => this.onDuplicate?.()),
      this.button("Delete", () => this.onDelete?.()),
      this.button("Deselect", () => this.onDeselect?.()),
    );
    editors.appendChild(actions);
    this.body.appendChild(editors);

    // World
    const world = el("div", "editors world");
    world.appendChild(el("div", "section-label", "World"));
    const gRow = el("label", "slider-row");
    this.gravityValue = el("span", "stat-value", "");
    this.gravityInput = el("input");
    this.gravityInput.type = "range";
    this.gravityInput.min = String(CONFIG.gravity.min);
    this.gravityInput.max = String(CONFIG.gravity.max);
    this.gravityInput.step = "0.01";
    this.gravityInput.addEventListener("input", () => this.onGravityChange?.(Number(this.gravityInput.value)));
    gRow.append(el("span", "stat-label", "Gravity"), this.gravityInput, this.gravityValue);
    world.appendChild(gRow);
    const presets = el("div", "inspector-actions");
    for (const [name, g] of CONFIG.gravity.presets) presets.appendChild(this.button(name, () => this.onGravityChange?.(g)));
    world.appendChild(presets);
    this.root.appendChild(world);

    this.root.appendChild(el("div", "inspector-hint")).innerHTML = "<kbd>Tab</kbd> edit mode";
    this.setObject(null);
    this.setGravity(CONFIG.physics.gravity);
  }

  setObject(obj: SandboxObject | null): void {
    this.root.classList.toggle("has-object", obj !== null);
    this.title.textContent = obj ? `${obj.kind} #${obj.id}` : "";
    if (obj) this.setProps(obj.props);
  }

  /** Sync editors to the given properties (after selection, clamping or external changes). */
  setProps(props: PhysicalProps): void {
    for (const { input, value, spec } of this.sliders.values()) {
      const v = props[spec.key];
      input.value = String(this.toSlider(spec, v));
      value.textContent = this.formatProp(spec, v);
    }
    this.staticToggle.checked = props.isStatic;
  }

  setGravity(y: number): void {
    this.gravityInput.value = String(y);
    this.gravityValue.textContent = `${fixed(y)} m/s²`;
  }

  setEditable(editable: boolean): void {
    this.root.classList.toggle("editable", editable);
    for (const input of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      input.tabIndex = editable ? 0 : -1;
      if (!editable) input.blur();
    }
  }

  updateLive(s: ObjectState, impacts: InspectorImpacts, now: number): void {
    if (now - this.lastLiveAt < 100) return;
    this.lastLiveAt = now;
    const L = this.live;
    L.speed.textContent = si(s.speed, "m/s");
    L.velocity.textContent = `${fixed(s.velocity.x, 1)}, ${fixed(s.velocity.y, 1)}, ${fixed(s.velocity.z, 1)}`;
    L.momentum.textContent = si(s.momentum, "kg·m/s");
    L.energy.textContent = si(s.kineticLinear + s.kineticRotational, "J");
    L.rotEnergy.textContent = si(s.kineticRotational, "J");
    L.angular.textContent = si(s.angularSpeed, "rad/s");
    L.height.textContent = si(s.position.y, "m");
    L.impact.textContent = impacts.contacts === 0 ? "-" : `${si(impacts.last, "")}/ ${si(impacts.peak, "N·s")}`;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "chip-button", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  private formatProp(spec: SliderSpec, v: number): string {
    if (spec.key === "mass") return formatMass(v);
    return `${fixed(v, spec.digits)}${spec.unit ? " " + spec.unit : ""}`;
  }

  private toSlider(spec: SliderSpec, v: number): number {
    const { min, max } = PROP_LIMITS[spec.key];
    const t = spec.log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    return Math.round(Math.min(1, Math.max(0, t)) * STEPS);
  }

  private fromSlider(spec: SliderSpec, raw: number): number {
    const { min, max } = PROP_LIMITS[spec.key];
    const t = raw / STEPS;
    return spec.log ? min * (max / min) ** t : min + (max - min) * t;
  }
}
