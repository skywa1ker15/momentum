import "./styles.css";
import type { PrimitiveKind } from "../objects/ObjectFactory";
import { Inspector } from "./Inspector";
import { Menu, type MenuEnvironment } from "./Menu";
import { Onboarding } from "./Onboarding";
import { formatBenchmark, type BenchmarkResult } from "../core/Benchmark";
import { QUALITY_ORDER as ORDER, type QualityLevel } from "../core/config";

export interface HudStats {
  fps: number;
  frameMs: number;
  objects: number;
  objectLimit: number;
  debris: number;
  fractures: number;
  particles: number;
  bodies: number;
  backend: string;
  quality: string;
  paused: boolean;
  timeScale: number;
}

const ICONS: Record<PrimitiveKind, string> = {
  box: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7.2v9.6L12 21l8-4.2V7.2L12 3Zm0 0v18M4 7.2l8 4.3 8-4.3" /></svg>',
  sphere: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="8.5" ry="3.4" /></svg>',
  cylinder: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="6.5" ry="2.8" /><path d="M5.5 6.5v11c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-11" /></svg>',
};

const CONTROLS: Array<[string, Array<[string, string]>]> = [
  ["Movement", [["W A S D", "Move"], ["Mouse", "Look"], ["Shift", "Sprint"], ["Space", "Jump"]]],
  ["Objects", [["1 2 3", "Choose shape"], ["M N", "Next / previous material"], ["F", "Spawn chosen shape"], ["E", "Select / deselect for inspection"], ["C", "Duplicate selected or targeted"], ["X", "Delete targeted or held"]]],
  ["Hand tool", [["Hold LMB", "Grab and carry"], ["Scroll", "Push / pull held object"], ["Hold T", "Turn held object with the mouse"], ["RMB", "Throw held / push target"]]],
  ["Force tool", [["Hold LMB", "Apply continuous force (or torque) at the point aimed at"], ["RMB", "Strike with an impulse"], ["Scroll", "Change magnitude"], ["V", "Switch between force and torque"]]],
  ["Field tool", [["LMB", "Place attractor, repulsor, gravity zone or water volume"], ["RMB", "Remove the one aimed at"], ["Scroll", "Change type"], ["V", "Change field strength"]]],
  ["Link tool", [["LMB LMB", "Join an object to another object or to the room"], ["RMB", "Remove joints on target / cancel"], ["Scroll", "Weld, hinge, ball, motor, slider or spring"]]],
  ["Blast tool", [["LMB", "Detonate a charge where you aim"], ["Scroll", "Charge size"]]],
  ["Simulation", [["P", "Pause / resume"], ["[  ]", "Slower / faster"], ["R", "Reset experiment"], ["Z", "Undo the last reset or load"], ["F4", "Next environment"], ["B", "Destruction intensity: off, low, normal, high"]]],
  ["Interface", [["Q", "Next tool (Shift+Q previous)"], ["Tab", "Edit mode: free the mouse to edit properties"], ["H", "Toggle this guide"], ["U", "Hide / show the interface"], ["F2", "Cycle graphics quality"], ["Esc", "Menu: environments, save / load, settings"]]],
];

export type HudMode = "menu" | "play" | "edit";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** DOM overlay. Purely presentational: reads state passed in, raises intent through callbacks. */
export class Hud {
  readonly inspector: Inspector;

  private readonly root: HTMLElement;
  readonly menu: Menu;
  readonly onboarding: Onboarding;
  private readonly toolStrip: HTMLElement;
  private readonly toolPills: HTMLElement[] = [];
  private readonly guide: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly simPill: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly benchProgress: HTMLElement;
  private readonly slotMarker: HTMLElement;
  private readonly toolChip: HTMLElement;
  private readonly materialChip: HTMLElement;
  private readonly brandSub: HTMLElement;
  private readonly editBanner: HTMLElement;
  private readonly stat: Record<string, HTMLElement> = {};
  private readonly slots = new Map<PrimitiveKind, HTMLElement>();
  private toastTimer = 0;
  private lastStatsAt = 0;

  constructor(parent: HTMLElement, environments: readonly MenuEnvironment[], kinds: readonly PrimitiveKind[], tools: readonly string[]) {
    this.root = el("div", "hud");
    parent.appendChild(this.root);

    const brand = el("div", "panel brand");
    this.brandSub = el("div", "brand-sub", "");
    brand.append(el("div", "brand-mark", "MOMENTUM"), this.brandSub);
    this.root.appendChild(brand);

    this.simPill = el("div", "panel sim-pill");
    this.root.appendChild(this.simPill);

    const telemetry = el("div", "panel telemetry");
    for (const [key, label] of [["fps", "FPS"], ["frame", "Frame"], ["objects", "Objects"], ["debris", "Debris"], ["particles", "Particles"], ["bodies", "Bodies"], ["backend", "Renderer"], ["quality", "Quality"]]) {
      const row = el("div", "stat-row");
      const value = el("span", "stat-value", "-");
      row.append(el("span", "stat-label", label), value);
      telemetry.appendChild(row);
      this.stat[key] = value;
    }
    this.root.appendChild(telemetry);

    this.crosshair = el("div", "crosshair");
    this.targetLabel = el("div", "target-label");
    this.root.append(this.crosshair, this.targetLabel);

    const hotbar = el("div", "panel hotbar");
    // One marker slides between the slots instead of each slot lighting up on its own,
    // so changing the spawn shape reads as a single movement.
    this.slotMarker = el("div", "slot-marker");
    hotbar.appendChild(this.slotMarker);
    kinds.forEach((kind, i) => {
      const slot = el("div", "slot", `<span class="slot-key">${i + 1}</span>${ICONS[kind]}<span class="slot-name">${kind}</span>`);
      this.slots.set(kind, slot);
      hotbar.appendChild(slot);
    });
    this.materialChip = el("div", "material-chip");
    this.toolChip = el("div", "tool-chip");
    hotbar.append(this.materialChip, el("div", "hotbar-divider"), this.toolChip);
    hotbar.appendChild(el("div", "hotbar-hint", "<kbd>H</kbd> controls"));
    this.root.appendChild(hotbar);

    this.toolStrip = el("div", "tool-strip");
    for (const tool of tools) {
      const pill = el("div", "tool-pill", tool);
      this.toolStrip.appendChild(pill);
      this.toolPills.push(pill);
    }
    this.root.appendChild(this.toolStrip);
    this.onboarding = new Onboarding(this.root);

    this.inspector = new Inspector(this.root, environments);
    this.editBanner = el("div", "panel edit-banner", "Edit mode &nbsp;·&nbsp; click the viewport or press <kbd>Tab</kbd> to return &nbsp;·&nbsp; <kbd>Esc</kbd> menu");
    this.root.appendChild(this.editBanner);

    this.toastEl = el("div", "panel toast");
    this.root.appendChild(this.toastEl);

    this.fadeEl = el("div", "screen-fade");
    this.root.appendChild(this.fadeEl);

    this.benchProgress = el("div", "panel bench-progress");
    this.root.appendChild(this.benchProgress);

    this.guide = el("div", "panel guide");
    this.guide.setAttribute("role", "dialog");
    this.guide.setAttribute("aria-label", "Control guide");
    this.guide.appendChild(el("h2", undefined, "Control guide"));
    const grid = el("div", "guide-grid");
    for (const [title, rows] of CONTROLS) {
      const section = el("section");
      section.appendChild(el("h3", undefined, title));
      for (const [keys, action] of rows) {
        const row = el("div", "guide-row");
        row.append(el("span", "keys", keys.split(" ").filter(Boolean).map((k) => `<kbd>${k}</kbd>`).join("")), el("span", "action", action));
        section.appendChild(row);
      }
      grid.appendChild(section);
    }
    this.guide.appendChild(grid);
    this.root.appendChild(this.guide);

    this.menu = new Menu(this.root, environments);
  }

  setMode(mode: HudMode): void {
    this.menu.setVisible(mode === "menu");
    this.root.classList.toggle("in-play", mode === "play");
    this.root.classList.toggle("edit-mode", mode === "edit");
    this.inspector.setEditable(mode === "edit");
  }

  setEnvironment(id: string, name: string): void {
    this.brandSub.textContent = name;
    this.inspector.setEnvironment(id);
    this.menu.setEnvironment(id);
  }

  /** Material that new objects are spawned with. */
  setMaterial(name: string, rgb: readonly [number, number, number], density: number): void {
    const color = `rgb(${rgb.map((c) => Math.round(c * 255)).join(",")})`;
    this.materialChip.innerHTML = `<kbd>M</kbd><span class="chip-swatch" style="background:${color}"></span><span class="tool-name">${name}</span><span class="chip-density">${density} kg/m³</span>`;
  }

  /** `detail` is the tool's current setting, e.g. the force magnitude. */
  setTool(name: string, detail: string, index = -1): void {
    for (const [i, pill] of this.toolPills.entries()) pill.classList.toggle("active", i === index);
    const html = `<kbd>Q</kbd><span class="tool-name">${name}</span>${detail ? `<span class="tool-detail">${detail}</span>` : ""}`;
    if (this.toolChip.innerHTML !== html) this.toolChip.innerHTML = html;
  }

  toggleGuide(): void {
    this.guide.classList.toggle("open");
  }

  /** Closes the control guide. Returns true when it was open. */
  closeGuide(): boolean {
    const open = this.guide.classList.contains("open");
    this.guide.classList.remove("open");
    return open;
  }

  /** Hides or shows every panel in play mode (the crosshair stays). */
  toggleHidden(): void {
    this.root.classList.toggle("hud-hidden");
  }

  /** True when keyboard focus is on a control inside a HUD panel. */
  panelHasFocus(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLElement && el !== document.body && this.root.contains(el) && el.matches("input, button, select, textarea");
  }

  setSelected(kind: PrimitiveKind): void {
    for (const [k, slot] of this.slots) slot.classList.toggle("selected", k === kind);
    this.moveSlotMarker(kind);
  }

  /** Puts the sliding marker over the chosen slot. Measured, because slot widths vary with the layout. */
  private moveSlotMarker(kind: PrimitiveKind): void {
    const slot = this.slots.get(kind);
    if (!slot) return;
    const place = () => {
      if (!slot.offsetWidth) return; // not laid out yet (hidden or still booting)
      this.slotMarker.style.width = `${slot.offsetWidth}px`;
      this.slotMarker.style.height = `${slot.offsetHeight}px`;
      this.slotMarker.style.transform = `translate3d(${slot.offsetLeft}px, ${slot.offsetTop}px, 0)`;
      this.slotMarker.classList.add("placed");
    };
    place();
    if (!this.slotMarker.classList.contains("placed")) requestAnimationFrame(place);
  }

  setTarget(label: string | null, holding: boolean): void {
    this.crosshair.classList.toggle("active", label !== null);
    this.crosshair.classList.toggle("holding", holding);
    this.targetLabel.textContent = label ?? "";
    this.targetLabel.classList.toggle("visible", label !== null);
  }

  /**
   * Covers the viewport at once, then fades the cover away over `ms`.
   *
   * Called around a change that moves the player or rebuilds the room: the opaque
   * frame hides the jump (and whatever stutter the rebuild costs), and the fade
   * makes the new scene arrive rather than appear.
   */
  fadeFromBlack(ms = 460): void {
    const el = this.fadeEl;
    el.style.transition = "none";
    el.style.opacity = "1";
    void el.offsetWidth; // paint the opaque frame before the fade begins
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms var(--ease-out)`;
      el.style.opacity = "0";
    });
  }

  /** Opacity of the transition cover, 0 .. 1. For tests. */
  get fadeOpacity(): number {
    return Number(this.fadeEl.style.opacity || "0");
  }

  /** Shows how far through a benchmark run we are; null hides the readout. */
  setBenchmarkProgress(text: string | null): void {
    this.benchProgress.classList.toggle("visible", text !== null);
    if (text) this.benchProgress.textContent = `Benchmark · ${text}`;
  }

  /**
   * Shows the finished benchmark: a row per stage, the plain-text version ready to copy,
   * and a button to take the suggested preset.
   */
  showBenchmark(result: BenchmarkResult, onApply: (q: QualityLevel) => void): void {
    this.setBenchmarkProgress(null);
    const wrap = el("div", "overlay bench-overlay");
    const card = el("div", "panel bench-card");
    card.append(el("div", "start-eyebrow", "Benchmark"), el("h2", undefined, "Performance on this machine"));

    const table = el("table", "bench-table");
    const head = el("tr");
    for (const h of ["Stage", "What it measures", "Average", "1% low", "Worst frame"]) head.appendChild(el("th", undefined, h));
    table.appendChild(head);
    for (const s of result.stages) {
      const row = el("tr");
      // Amber below 50 and red below 30: the thresholds where a person starts to feel it.
      const cls = (v: number) => (v < 30 ? "bad" : v < 50 ? "warn" : "good");
      row.append(
        el("td", undefined, s.name),
        el("td", "bench-what", s.what),
        el("td", `num ${cls(s.avgFps)}`, `${s.avgFps.toFixed(0)} fps`),
        el("td", `num ${cls(s.lowFps)}`, `${s.lowFps.toFixed(0)} fps`),
        el("td", "num", `${s.worstFrameMs.toFixed(0)} ms`),
      );
      table.appendChild(row);
    }
    card.appendChild(table);

    const avg = result.overallAvgFps.toFixed(0);
    const verdict = el("p", "bench-verdict");
    if (result.recommended !== result.quality) {
      const better = ORDER.indexOf(result.recommended) > ORDER.indexOf(result.quality);
      verdict.textContent = `Under load this machine managed ${avg} fps on the ${result.quality} preset. ${better ? "It has room for" : "It would be smoother on"} the ${result.recommended} preset.`;
    } else if (result.overallAvgFps < 45) {
      // Nothing lower to fall back to: say so rather than calling this a good fit.
      verdict.textContent = `Only ${avg} fps under load, and ${result.quality} is already the lowest preset. Try a smaller window, or turn off dynamic resolution's ceiling by lowering the display resolution.`;
    } else {
      verdict.textContent = `The ${result.quality} preset suits this machine: ${avg} fps average under load.`;
    }
    card.appendChild(verdict);

    const text = formatBenchmark(result);
    const pre = el("pre", "bench-text");
    pre.textContent = text;
    card.appendChild(pre);

    const row = el("div", "menu-inline");
    if (result.recommended !== result.quality) {
      const apply = el("button", "chip-button primary", `Switch to ${result.recommended}`);
      apply.type = "button";
      apply.addEventListener("click", () => {
        onApply(result.recommended);
        apply.textContent = `Now on ${result.recommended}`;
        apply.disabled = true;
      });
      row.appendChild(apply);
    }
    const copy = el("button", "chip-button", "Copy results");
    copy.type = "button";
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(text).then(
        () => {
          copy.textContent = "Copied";
        },
        () => {
          // No clipboard permission: select the text so it can be copied by hand.
          const range = document.createRange();
          range.selectNodeContents(pre);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          copy.textContent = "Selected — press Ctrl+C";
        },
      );
    });
    const close = el("button", "chip-button", "Close");
    close.type = "button";
    close.addEventListener("click", () => wrap.remove());
    row.append(copy, close);
    card.appendChild(row);

    wrap.appendChild(card);
    this.root.appendChild(wrap);
    close.focus();
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("visible"), 1800);
  }

  update(s: HudStats, now: number): void {
    this.simPill.classList.toggle("paused", s.paused);
    const pill = s.paused ? "PAUSED" : `RUNNING <span>${s.timeScale.toFixed(2)}×</span>`;
    if (this.simPill.innerHTML !== pill) this.simPill.innerHTML = pill;
    if (now - this.lastStatsAt < 250) return; // text updates at 4 Hz are plenty and avoid layout churn
    this.lastStatsAt = now;
    this.stat.fps.textContent = s.fps.toFixed(0);
    // Amber below 50: the one number worth noticing without reading it.
    this.stat.fps.classList.toggle("low", s.fps > 0 && s.fps < 50);
    this.stat.frame.textContent = `${s.frameMs.toFixed(1)} ms`;
    this.stat.objects.textContent = `${s.objects} / ${s.objectLimit}`;
    this.stat.debris.textContent = `${s.debris} · ${s.fractures} breaks`;
    this.stat.particles.textContent = String(s.particles);
    this.stat.bodies.textContent = String(s.bodies);
    this.stat.backend.textContent = s.backend;
    this.stat.quality.textContent = s.quality;
  }
}

/** Shown when start-up fails. Independent of the HUD so it works even if nothing else initialised. */
export function showFatalError(parent: HTMLElement, title: string, detail: string): void {
  const wrap = el("div", "overlay fatal");
  const card = el("div", "panel start-card");
  card.append(el("div", "start-eyebrow", "Start-up failed"), el("h1", undefined, title));
  const p = el("p");
  p.textContent = detail;
  card.appendChild(p);
  wrap.appendChild(card);
  parent.appendChild(wrap);
}
