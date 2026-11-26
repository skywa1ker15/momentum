export type HintId = "move" | "spawn" | "grab" | "select" | "tool" | "edit";

const STEPS: Array<[HintId, string]> = [
  ["move", "Walk with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>"],
  ["spawn", "Spawn an object with <kbd>F</kbd>"],
  ["grab", "Grab one with <kbd>LMB</kbd>, throw with <kbd>RMB</kbd>"],
  ["select", "Inspect one with <kbd>E</kbd>"],
  ["tool", "Switch tool with <kbd>Q</kbd>"],
  ["edit", "Edit properties with <kbd>Tab</kbd>"],
];

/** Getting-started checklist. Steps tick themselves off as the player does them. */
export class Onboarding {
  onFinished: (() => void) | null = null;
  private readonly root: HTMLElement;
  private readonly items = new Map<HintId, HTMLElement>();
  private readonly done = new Set<HintId>();
  private active = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "panel onboarding";
    const title = document.createElement("div");
    title.className = "onboarding-title";
    title.textContent = "Getting started";
    this.root.appendChild(title);
    for (const [id, html] of STEPS) {
      const row = document.createElement("div");
      row.className = "onboarding-step";
      row.innerHTML = `<span class="tick"></span><span>${html}</span>`;
      this.root.appendChild(row);
      this.items.set(id, row);
    }
    parent.appendChild(this.root);
  }

  /** Shows the checklist from the beginning. */
  start(): void {
    this.done.clear();
    for (const row of this.items.values()) row.classList.remove("done");
    this.active = true;
    this.root.classList.add("visible");
    this.root.classList.remove("finished");
  }

  stop(): void {
    this.active = false;
    this.root.classList.remove("visible");
  }

  complete(id: HintId): void {
    if (!this.active || this.done.has(id)) return;
    this.done.add(id);
    this.items.get(id)?.classList.add("done");
    if (this.done.size === STEPS.length) {
      this.active = false;
      this.root.classList.add("finished");
      window.setTimeout(() => this.root.classList.remove("visible"), 2200);
      this.onFinished?.();
    }
  }
}
