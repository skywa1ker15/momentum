import { QUALITY_ORDER, type QualityLevel } from "../core/config";
import type { Settings } from "../core/Settings";
import type { SlotInfo } from "../persistence/Storage";

type Tab = "home" | "environments" | "experiments" | "settings";

export interface MenuEnvironment {
  id: string;
  name: string;
  description: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The main / pause menu shown whenever the pointer is free and edit mode is off:
 * home, environment selection, experiment save and load, and settings.
 */
export class Menu {
  onEnter: (() => void) | null = null;
  onEnvironment: ((id: string) => void) | null = null;
  onSave: ((slot: number) => void) | null = null;
  onLoad: ((slot: number) => void) | null = null;
  onDeleteSlot: ((slot: number) => void) | null = null;
  onExport: (() => void) | null = null;
  onImport: ((file: File) => void) | null = null;
  onSettings: ((change: Partial<Settings>) => void) | null = null;
  onShowGuide: (() => void) | null = null;
  onResetHints: (() => void) | null = null;
  onUiSound: (() => void) | null = null;

  readonly root: HTMLElement;
  private readonly tabs = new Map<Tab, { button: HTMLButtonElement; panel: HTMLElement }>();
  private readonly enterButton: HTMLButtonElement;
  private readonly navEnter: HTMLButtonElement;
  private readonly tabMarker: HTMLElement;
  private tabOrder: Tab[] = [];
  private current: Tab = "home";
  private readonly envCards = new Map<string, HTMLElement>();
  private readonly slotRows: Array<{ info: HTMLElement; load: HTMLButtonElement; remove: HTMLButtonElement }> = [];
  private readonly status: HTMLElement;
  private readonly qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  private readonly ranges: Record<"sensitivity" | "fov" | "volume", { input: HTMLInputElement; value: HTMLElement }>;
  private readonly invert: HTMLInputElement;
  private environmentNames = new Map<string, string>();
  private readonly slotFilled: boolean[] = [];
  private readonly toggles = new Map<string, HTMLInputElement>();
  private readonly rendererButtons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, environments: readonly MenuEnvironment[]) {
    for (const e of environments) this.environmentNames.set(e.id, e.name);
    this.root = el("div", "overlay");
    const card = el("div", "panel menu-card");
    this.root.appendChild(card);
    parent.appendChild(this.root);

    const nav = el("nav", "menu-nav");
    nav.append(el("div", "menu-brand", "MOMENTUM"));
    // The highlight behind the active tab is one element that slides, so switching tabs
    // is a single continuous movement rather than one box fading out and another in.
    this.tabMarker = el("div", "menu-tab-marker");
    nav.appendChild(this.tabMarker);
    card.appendChild(nav);
    // Always-visible way back into the lab, from any tab.
    this.navEnter = el("button", "nav-enter", "Enter laboratory");
    this.navEnter.type = "button";
    this.navEnter.addEventListener("click", () => this.onEnter?.());
    // Clicking the dimmed area around the card also returns to the lab.
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.onEnter?.();
    });
    const content = el("div", "menu-content");
    card.appendChild(content);

    const addTab = (id: Tab, label: string): HTMLElement => {
      const button = el("button", "menu-tab", label);
      button.type = "button";
      button.addEventListener("click", () => {
        this.onUiSound?.();
        this.show(id);
      });
      nav.appendChild(button);
      const panel = el("section", "menu-panel");
      content.appendChild(panel);
      this.tabs.set(id, { button, panel });
      this.tabOrder.push(id);
      return panel;
    };

    // Home
    const home = addTab("home", "Laboratory");
    home.append(el("div", "start-eyebrow", "Experimental physics facility"), el("h1", undefined, "MOMENTUM"));
    home.append(el("p", undefined, "A sandbox laboratory. Spawn objects in real materials, bend gravity, join parts with hinges, motors and springs, and break things, all simulated by the Havok engine."));
    if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches) {
      home.appendChild(el("p", "menu-warning", "MOMENTUM needs a mouse and keyboard. It cannot be played on a touch-only device."));
    }
    this.enterButton = el("button", "enter-button", "Enter laboratory");
    this.enterButton.type = "button";
    this.enterButton.addEventListener("click", () => this.onEnter?.());
    home.appendChild(this.enterButton);
    const hint = el("div", "start-hint");
    hint.innerHTML = "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp;·&nbsp; <kbd>F</kbd> spawn &nbsp;·&nbsp; <kbd>LMB</kbd> grab &nbsp;·&nbsp; <kbd>Q</kbd> tools &nbsp;·&nbsp; <kbd>Esc</kbd> this menu";
    home.appendChild(hint);
    const guide = el("button", "chip-button menu-inline", "Show all controls (H)");
    guide.type = "button";
    guide.addEventListener("click", () => this.onShowGuide?.());
    home.appendChild(guide);

    // Environments
    const envs = addTab("environments", "Environments");
    envs.appendChild(el("h2", undefined, "Environments"));
    envs.appendChild(el("p", "menu-note", "Loading an environment replaces the current experiment. Save it first if you want to keep it."));
    const grid = el("div", "env-grid");
    for (const e of environments) {
      const c = el("button", "env-card");
      c.type = "button";
      c.append(el("span", "env-name", e.name), el("span", "env-desc", e.description), el("span", "env-state", ""));
      c.addEventListener("click", () => {
        this.onUiSound?.();
        this.onEnvironment?.(e.id);
      });
      grid.appendChild(c);
      this.envCards.set(e.id, c);
    }
    envs.appendChild(grid);

    // Experiments
    const exp = addTab("experiments", "Experiments");
    exp.appendChild(el("h2", undefined, "Experiments"));
    exp.appendChild(el("p", "menu-note", "A save holds every object, joint, field and water volume, with positions and velocities. Slots are stored in this browser; export a file to keep or share one."));
    for (let slot = 1; slot <= 3; slot++) {
      const row = el("div", "slot-row");
      const info = el("div", "slot-info");
      // Overwriting and deleting cannot be undone, so they ask for a second click.
      const save = this.action("Save", () => this.onSave?.(slot), () => (this.slotFilled[slot - 1] ? "Overwrite?" : null));
      const load = this.action("Load", () => this.onLoad?.(slot));
      const remove = this.action("Delete", () => this.onDeleteSlot?.(slot), () => "Delete?");
      const buttons = el("div", "slot-actions");
      buttons.append(save, load, remove);
      row.append(el("span", "slot-number", String(slot)), info, buttons);
      exp.appendChild(row);
      this.slotRows.push({ info, load, remove });
    }
    const files = el("div", "slot-actions file-actions");
    const picker = el("input");
    picker.type = "file";
    picker.accept = "application/json,.json";
    picker.hidden = true;
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (file) this.onImport?.(file);
      picker.value = "";
    });
    files.append(this.action("Export to file", () => this.onExport?.()), this.action("Import from file", () => picker.click()), picker);
    exp.appendChild(files);
    this.status = el("div", "menu-status");
    this.status.setAttribute("role", "status");
    exp.appendChild(this.status);

    // Settings
    const set = addTab("settings", "Settings");
    set.appendChild(el("h2", undefined, "Settings"));
    const qRow = el("div", "setting-row");
    qRow.appendChild(el("span", "setting-label", "Graphics quality"));
    const qButtons = el("div", "slot-actions");
    for (const q of QUALITY_ORDER) {
      const b = this.action(q, () => this.onSettings?.({ quality: q }));
      qButtons.appendChild(b);
      this.qualityButtons.set(q, b);
    }
    qRow.appendChild(qButtons);
    set.appendChild(qRow);
    const range = (key: "sensitivity" | "fov" | "volume", label: string, min: number, max: number, step: number, format: (v: number) => string) => {
      const row = el("label", "setting-row");
      const input = el("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const value = el("span", "stat-value", "");
      input.addEventListener("input", () => {
        value.textContent = format(Number(input.value));
        this.onSettings?.({ [key]: Number(input.value) });
      });
      row.append(el("span", "setting-label", label), input, value);
      set.appendChild(row);
      return { input, value, format };
    };
    const sens = range("sensitivity", "Mouse sensitivity", 0.3, 3, 0.05, (v) => `${v.toFixed(2)}×`);
    const fov = range("fov", "Field of view", 55, 100, 1, (v) => `${v.toFixed(0)}°`);
    const vol = range("volume", "Sound volume", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    this.ranges = { sensitivity: sens, fov, volume: vol };
    this.formats = { sensitivity: sens.format, fov: fov.format, volume: vol.format };
    const invRow = el("label", "setting-row toggle-row");
    this.invert = el("input");
    this.invert.type = "checkbox";
    this.invert.addEventListener("change", () => this.onSettings?.({ invertY: this.invert.checked }));
    invRow.append(el("span", "setting-label", "Invert vertical look"), this.invert, el("span", "toggle-track"));
    set.appendChild(invRow);
    const toggle = (key: "dynamicResolution" | "cameraShake" | "viewMotion", label: string) => {
      const row = el("label", "setting-row toggle-row");
      const input = el("input");
      input.type = "checkbox";
      input.addEventListener("change", () => this.onSettings?.({ [key]: input.checked }));
      row.append(el("span", "setting-label", label), input, el("span", "toggle-track"));
      set.appendChild(row);
      this.toggles.set(key, input);
    };
    toggle("dynamicResolution", "Dynamic resolution");
    toggle("cameraShake", "Camera shake");
    toggle("viewMotion", "Head movement");
    const rRow = el("div", "setting-row");
    rRow.appendChild(el("span", "setting-label", "Renderer"));
    const rButtons = el("div", "slot-actions");
    for (const [id, label] of [["webgl2", "WebGL 2"], ["webgpu", "WebGPU (experimental)"]] as const) {
      const b = this.action(label, () => this.onSettings?.({ renderer: id }));
      rButtons.appendChild(b);
      this.rendererButtons.set(id, b);
    }
    rRow.appendChild(rButtons);
    set.appendChild(rRow);
    this.rendererNote = el("p", "menu-note", "");
    set.appendChild(this.rendererNote);
    const hintsRow = el("div", "setting-row");
    hintsRow.append(el("span", "setting-label", "Getting-started checklist"), this.action("Show again", () => this.onResetHints?.()));
    set.appendChild(hintsRow);
    set.appendChild(el("p", "menu-note", "Settings are saved in this browser. Quality can also be cycled in the lab with F2."));

    nav.appendChild(this.navEnter);
    this.show("home");
  }

  private rendererNote!: HTMLElement;
  private activeRenderer = "webgl2";
  private formats!: Record<"sensitivity" | "fov" | "volume", (v: number) => string>;

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
    // The nav is not laid out while the menu is hidden, so re-measure when it comes back.
    if (visible) requestAnimationFrame(() => this.moveTabMarker());
  }

  /** After the first entry the home button resumes instead of entering. */
  setResumable(resumable: boolean): void {
    this.enterButton.textContent = resumable ? "Resume" : "Enter laboratory";
    this.navEnter.textContent = resumable ? "▶ Resume" : "▶ Enter laboratory";
  }

  show(tab: Tab): void {
    // Slide the incoming panel in from the side the tab sits on, so the movement
    // matches the direction the eye travelled.
    const back = this.tabOrder.indexOf(tab) < this.tabOrder.indexOf(this.current);
    for (const [id, t] of this.tabs) {
      t.button.classList.toggle("active", id === tab);
      t.panel.classList.toggle("active", id === tab);
      if (id === tab) {
        t.panel.classList.toggle("from-start", back);
        t.panel.classList.toggle("from-end", !back);
      }
    }
    this.current = tab;
    this.moveTabMarker();
  }

  private moveTabMarker(): void {
    const active = this.tabs.get(this.current)?.button;
    if (!active) return;
    const place = () => {
      if (!active.offsetWidth) return;
      this.tabMarker.style.width = `${active.offsetWidth}px`;
      this.tabMarker.style.height = `${active.offsetHeight}px`;
      this.tabMarker.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
      this.tabMarker.classList.add("placed");
    };
    place();
    if (!this.tabMarker.classList.contains("placed")) requestAnimationFrame(place);
  }

  setEnvironment(id: string): void {
    for (const [envId, card] of this.envCards) {
      const current = envId === id;
      card.classList.toggle("active", current);
      (card.querySelector(".env-state") as HTMLElement).textContent = current ? "Current · click to reload" : "Load";
    }
  }

  setSlots(slots: SlotInfo[]): void {
    slots.forEach((s, i) => {
      const row = this.slotRows[i];
      if (!row) return;
      if (s.summary) {
        const when = s.summary.savedAt ? new Date(s.summary.savedAt).toLocaleString() : "";
        row.info.innerHTML = "";
        row.info.append(el("span", "slot-title", this.environmentNames.get(s.summary.environment) ?? s.summary.environment), el("span", "slot-meta", `${s.summary.objects} objects · ${s.summary.joints} joints${when ? " · " + when : ""}`));
      } else {
        row.info.innerHTML = "";
        row.info.append(el("span", "slot-title empty", "Empty slot"));
      }
      this.slotFilled[i] = s.summary !== null;
      row.load.disabled = !s.summary;
      row.remove.disabled = !s.summary;
    });
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle("error", isError);
  }

  setSettings(s: Settings): void {
    for (const [q, b] of this.qualityButtons) b.classList.toggle("active", q === s.quality);
    for (const key of ["sensitivity", "fov", "volume"] as const) {
      this.ranges[key].input.value = String(s[key]);
      this.ranges[key].value.textContent = this.formats[key](s[key]);
    }
    this.invert.checked = s.invertY;
    this.toggles.get("dynamicResolution")!.checked = s.dynamicResolution;
    this.toggles.get("cameraShake")!.checked = s.cameraShake;
    this.toggles.get("viewMotion")!.checked = s.viewMotion;
    for (const [id, b] of this.rendererButtons) b.classList.toggle("active", id === s.renderer);
    this.rendererNote.textContent =
      s.renderer !== this.activeRenderer
        ? "Reload the page to switch renderer. If WebGPU fails to start, the lab falls back to WebGL 2 and resets this choice."
        : "Dynamic resolution lowers the render resolution when the frame rate drops. WebGPU is experimental and has not yet been verified on real hardware.";
  }

  /** Tells the menu which renderer is actually running ("webgl2" or "webgpu"). */
  setActiveRenderer(id: string): void {
    this.activeRenderer = id;
  }

  /**
   * A menu button. When `confirmLabel` returns text, the first click only changes the label
   * to that text for three seconds and the action runs on a second click.
   */
  private action(label: string, onClick: () => void, confirmLabel?: () => string | null): HTMLButtonElement {
    const b = el("button", "chip-button", label);
    b.type = "button";
    let armed = 0;
    const disarm = () => {
      window.clearTimeout(armed);
      armed = 0;
      b.textContent = label;
      b.classList.remove("confirm");
    };
    b.addEventListener("click", () => {
      this.onUiSound?.();
      const ask = armed ? null : (confirmLabel?.() ?? null);
      if (ask) {
        b.textContent = ask;
        b.classList.add("confirm");
        armed = window.setTimeout(disarm, 3000);
        return;
      }
      if (armed) disarm();
      onClick();
    });
    b.addEventListener("blur", () => armed && disarm());
    return b;
  }
}
