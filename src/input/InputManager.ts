/** Keyboard / mouse state with pointer lock. Frame-transient state is cleared by endFrame(). */
export class InputManager {
  /** Mouse movement accumulated this frame (pixels), only while pointer is locked. */
  lookX = 0;
  lookY = 0;
  wheel = 0;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** While the pointer is free: should Tab be taken as a command (true) or left to move focus (false)? */
  captureTab: () => boolean = () => false;

  /** True when pointer lock is unavailable or refused: the game runs with a free cursor and arrow-key look. */
  fallback = false;
  /** Set when the browser refused pointer lock (for a message in the menu). */
  onLockProblem: ((message: string) => void) | null = null;
  private lastFrame = performance.now();
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.listen(window, "keydown", (e) => {
      if (this.fallback && e.code === "Escape") {
        this.exitLock();
        return;
      }
      if (!this.locked) {
        // Only the global keys work while the pointer is free (start screen, edit mode).
        if (e.code !== "KeyH" && e.code !== "Tab" && e.code !== "Escape") return;
        if (e.code === "Tab" && !this.captureTab()) return; // native focus navigation
        // Do not steal H from a focused text field.
        if (e.code === "KeyH" && e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") return;
      }
      if (this.fallback && e.code.startsWith("Arrow")) e.preventDefault();
      if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("F")) {
        if (e.code !== "F5" && e.code !== "F11" && e.code !== "F12") e.preventDefault();
      }
      if (!e.repeat) this.press(e.code);
    });
    this.listen(window, "keyup", (e) => this.release(e.code));
    this.listen(canvas, "mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.press(`Mouse${e.button}`);
    });
    this.listen(window, "mouseup", (e) => this.release(`Mouse${e.button}`));
    this.listen(document, "mousemove", (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    this.listen(canvas, "wheel", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(document, "pointerlockerror", () => this.enterFallback("The browser refused mouse capture."));
    this.listen(document, "pointerlockchange", () => {
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
    this.listen(window, "blur", () => this.releaseAll());
  }

  get locked(): boolean {
    return this.fallback || document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.locked) return;
    this.canvas.focus();
    if (typeof this.canvas.requestPointerLock !== "function") {
      this.enterFallback("This browser cannot capture the mouse.");
      return;
    }
    try {
      const result = this.canvas.requestPointerLock() as Promise<void> | undefined;
      result?.catch?.(() => this.enterFallback("The browser refused mouse capture."));
    } catch {
      this.enterFallback("The browser refused mouse capture.");
    }
  }

  exitLock(): void {
    if (this.fallback) {
      this.fallback = false;
      this.releaseAll();
      this.onLockChange?.(false);
    } else if (this.locked) document.exitPointerLock();
  }

  /** Mouse capture is not available: play with a free cursor, looking with the arrow keys. */
  private enterFallback(reason: string): void {
    if (this.fallback || document.pointerLockElement === this.canvas) return;
    this.fallback = true;
    this.onLockProblem?.(`${reason} Playing without it: look with the arrow keys, Esc opens the menu.`);
    this.onLockChange?.(true);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** -1 / 0 / +1 from a pair of keys. */
  axis(negative: string, positive: string): number {
    return (this.down.has(positive) ? 1 : 0) - (this.down.has(negative) ? 1 : 0);
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.fallback) {
      this.lookX = this.axis("ArrowLeft", "ArrowRight") * 420 * dt;
      this.lookY = this.axis("ArrowUp", "ArrowDown") * 420 * dt;
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  private press(code: string): void {
    this.down.add(code);
    this.pressed.add(code);
  }

  private release(code: string): void {
    if (this.down.delete(code)) this.released.add(code);
  }

  private releaseAll(): void {
    for (const code of this.down) this.released.add(code);
    this.down.clear();
  }

  private listen<K extends keyof (WindowEventMap & DocumentEventMap)>(
    target: EventTarget,
    type: K,
    handler: (e: (WindowEventMap & DocumentEventMap)[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
  }
}
