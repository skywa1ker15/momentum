import { CONFIG } from "../core/config";
import { PROP_LIMITS, type PhysicalProps, type SandboxObject } from "../objects/ObjectFactory";
import type { ObjectState } from "../objects/ObjectState";
import { MATERIALS, MATERIAL_ORDER, type MaterialId } from "../materials/Materials";
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

export interface JointSummary {
  count: number;
  /** Target speed of the object's first motor joint (rad/s), or null when it has none. */
  motorSpeed: number | null;
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
  onMaterialChange: ((id: MaterialId) => void) | null = null;
  onMotorSpeed: ((radPerSec: number) => void) | null = null;
  onRemoveJoints: (() => void) | null = null;
  onEnvironment: ((id: string) => void) | null = null;
  onDestructionLevel: ((level: number) => void) | null = null;

  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly body: HTMLElement;
  private readonly live: Record<string, HTMLElement> = {};
  private readonly sliders = new Map<NumericProp, { input: HTMLInputElement; value: HTMLElement; spec: SliderSpec }>();
  private readonly staticToggle: HTMLInputElement;
  private readonly gravityInput: HTMLInputElement;
  private readonly gravityValue: HTMLElement;
  private readonly materialInfo: HTMLElement;
  private readonly swatches = new Map<MaterialId, HTMLButtonElement>();
  private readonly jointRow: HTMLElement;
  private readonly jointCount: HTMLElement;
  private readonly motorRow: HTMLElement;
  private readonly motorInput: HTMLInputElement;
  private readonly motorValue: HTMLElement;
  private readonly envButtons = new Map<string, HTMLButtonElement>();
  private readonly destructionButtons: HTMLButtonElement[] = [];
  private lastLiveAt = 0;

  constructor(parent: HTMLElement, environments: ReadonlyArray<{ id: string; name: string }>) {
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
    editors.appendChild(el("div", "section-label", "Material"));
    this.materialInfo = el("div", "material-info");
    editors.appendChild(this.materialInfo);
    const swatchRow = el("div", "swatch-row");
    for (const id of MATERIAL_ORDER) {
      const def = MATERIALS[id];
      const b = el("button", "swatch");
      b.type = "button";
      b.title = def.name;
      b.setAttribute("aria-label", def.name);
      b.style.setProperty("--swatch", `rgb(${def.look.color.map((c) => Math.round(c * 255)).join(",")})`);
      b.addEventListener("click", () => this.onMaterialChange?.(id));
      swatchRow.appendChild(b);
      this.swatches.set(id, b);
    }
    editors.appendChild(swatchRow);
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

    // Joints
    this.jointRow = el("div", "joint-section");
    this.jointRow.appendChild(el("div", "section-label", "Joints"));
    const jr = el("div", "stat-row");
    this.jointCount = el("span", "stat-value", "0");
    jr.append(el("span", "stat-label", "Attached"), this.jointCount);
    this.jointRow.appendChild(jr);
    this.motorRow = el("label", "slider-row");
    this.motorValue = el("span", "stat-value", "");
    this.motorInput = el("input");
    this.motorInput.type = "range";
    this.motorInput.min = String(-CONFIG.joints.maxMotorSpeed);
    this.motorInput.max = String(CONFIG.joints.maxMotorSpeed);
    this.motorInput.step = "0.5";
    this.motorInput.addEventListener("input", () => {
      this.motorValue.textContent = `${fixed(Number(this.motorInput.value), 1)} rad/s`;
      this.onMotorSpeed?.(Number(this.motorInput.value));
    });
    this.motorRow.append(el("span", "stat-label", "Motor speed"), this.motorInput, this.motorValue);
    this.jointRow.appendChild(this.motorRow);
    const jActions = el("div", "inspector-actions");
    jActions.appendChild(this.button("Remove joints", () => this.onRemoveJoints?.()));
    this.jointRow.appendChild(jActions);
    editors.appendChild(this.jointRow);
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
    world.appendChild(el("div", "section-label", "Destruction"));
    const levels = el("div", "inspector-actions");
    CONFIG.destruction.levels.forEach(([name], i) => {
      const b = this.button(name, () => this.onDestructionLevel?.(i));
      levels.appendChild(b);
      this.destructionButtons.push(b);
    });
    world.appendChild(levels);
    world.appendChild(el("div", "section-label", "Environment"));
    const envs = el("div", "inspector-actions");
    for (const env of environments) {
      const b = this.button(env.name, () => this.onEnvironment?.(env.id));
      envs.appendChild(b);
      this.envButtons.set(env.id, b);
    }
    world.appendChild(envs);
    this.root.appendChild(world);

    this.root.appendChild(el("div", "inspector-hint")).innerHTML = "<kbd>Tab</kbd> edit mode";
    this.setObject(null);
    this.setGravity(CONFIG.physics.gravity);
  }

  setObject(obj: SandboxObject | null, joints: JointSummary = { count: 0, motorSpeed: null }): void {
    this.root.classList.toggle("has-object", obj !== null);
    this.title.textContent = obj ? `${obj.kind} #${obj.id}` : "";
    if (!obj) return;
    this.setProps(obj.props);
    const def = MATERIALS[obj.materialId];
    this.materialInfo.innerHTML = `<span class="material-name">${def.name}</span><span class="stat-value">${def.density} kg/m³ · hardness ${def.hardness} · ${def.breakSpeed === null ? "unbreakable" : `breaks at ${def.breakSpeed} m/s impact`}</span>`;
    for (const [id, b] of this.swatches) b.classList.toggle("active", id === obj.materialId);
    this.setJoints(joints);
  }

  setJoints(joints: JointSummary): void {
    this.jointRow.classList.toggle("hidden", joints.count === 0);
    this.jointCount.textContent = String(joints.count);
    this.motorRow.classList.toggle("hidden", joints.motorSpeed === null);
    if (joints.motorSpeed !== null) {
      this.motorInput.value = String(joints.motorSpeed);
      this.motorValue.textContent = `${fixed(joints.motorSpeed, 1)} rad/s`;
    }
  }

  setDestructionLevel(level: number): void {
    for (const [i, b] of this.destructionButtons.entries()) b.classList.toggle("active", i === level);
  }

  setEnvironment(id: string): void {
    for (const [envId, b] of this.envButtons) b.classList.toggle("active", envId === id);
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
    L.momentum.textContent = si(s.momentum, "N·s"); // 1 N·s = 1 kg·m/s
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
