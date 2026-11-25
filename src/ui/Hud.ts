import "./styles.css";
import type { PrimitiveKind } from "../objects/ObjectFactory";

export interface HudStats {
  fps: number;
  frameMs: number;
  objects: number;
  objectLimit: number;
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
  ["Objects", [["1 2 3", "Select shape"], ["F", "Spawn selected shape"], ["Hold LMB", "Grab and carry"], ["Scroll", "Push / pull held object"], ["RMB", "Throw held / push target"], ["X", "Delete target"]]],
  ["Simulation", [["P", "Pause / resume"], ["[  ]", "Slower / faster"], ["R", "Reset experiment"]]],
  ["Interface", [["H", "Toggle this guide"], ["F2", "Cycle graphics quality"], ["Esc", "Release mouse"]]],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** DOM overlay. Purely presentational: reads state passed in, raises intent through callbacks. */
export class Hud {
  onEnter: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly simPill: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly stat: Record<string, HTMLElement> = {};
  private readonly slots = new Map<PrimitiveKind, HTMLElement>();
  private toastTimer = 0;
  private lastStatsAt = 0;

  constructor(parent: HTMLElement, environmentName: string, kinds: readonly PrimitiveKind[]) {
    this.root = el("div", "hud");
    parent.appendChild(this.root);

    const brand = el("div", "panel brand");
    brand.append(el("div", "brand-mark", "MOMENTUM"), el("div", "brand-sub", environmentName));
    this.root.appendChild(brand);

    this.simPill = el("div", "panel sim-pill");
    this.root.appendChild(this.simPill);

    const telemetry = el("div", "panel telemetry");
    for (const [key, label] of [["fps", "FPS"], ["frame", "Frame"], ["objects", "Objects"], ["bodies", "Bodies"], ["backend", "Renderer"], ["quality", "Quality"]]) {
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
    kinds.forEach((kind, i) => {
      const slot = el("div", "slot", `<span class="slot-key">${i + 1}</span>${ICONS[kind]}<span class="slot-name">${kind}</span>`);
      this.slots.set(kind, slot);
      hotbar.appendChild(slot);
    });
    hotbar.appendChild(el("div", "hotbar-hint", "<kbd>F</kbd> spawn &nbsp; <kbd>H</kbd> controls"));
    this.root.appendChild(hotbar);

    this.toastEl = el("div", "panel toast");
    this.root.appendChild(this.toastEl);

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

    this.overlay = el("div", "overlay");
    const card = el("div", "panel start-card");
    card.append(
      el("div", "start-eyebrow", "Experimental physics facility"),
      el("h1", undefined, "MOMENTUM"),
      el("p", undefined, "A sandbox laboratory. Spawn, carry, throw and collide rigid bodies simulated by the Havok engine."),
    );
    const enter = el("button", "enter-button", "Enter laboratory");
    enter.type = "button";
    enter.addEventListener("click", () => this.onEnter?.());
    card.append(enter, el("div", "start-hint", "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp;·&nbsp; <kbd>F</kbd> spawn &nbsp;·&nbsp; <kbd>LMB</kbd> grab &nbsp;·&nbsp; <kbd>H</kbd> all controls"));
    this.overlay.appendChild(card);
    this.root.appendChild(this.overlay);
  }

  setLocked(locked: boolean): void {
    this.overlay.classList.toggle("hidden", locked);
    this.root.classList.toggle("in-play", locked);
  }

  toggleGuide(): void {
    this.guide.classList.toggle("open");
  }

  setSelected(kind: PrimitiveKind): void {
    for (const [k, slot] of this.slots) slot.classList.toggle("selected", k === kind);
  }

  setTarget(label: string | null, holding: boolean): void {
    this.crosshair.classList.toggle("active", label !== null);
    this.crosshair.classList.toggle("holding", holding);
    this.targetLabel.textContent = label ?? "";
    this.targetLabel.classList.toggle("visible", label !== null);
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
    this.stat.frame.textContent = `${s.frameMs.toFixed(1)} ms`;
    this.stat.objects.textContent = `${s.objects} / ${s.objectLimit}`;
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
