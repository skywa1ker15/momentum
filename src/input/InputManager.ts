/** Keyboard / mouse state with pointer lock. Frame-transient state is cleared by endFrame(). */
export class InputManager {
  /** Mouse movement accumulated this frame (pixels), only while pointer is locked. */
  lookX = 0;
  lookY = 0;
  wheel = 0;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** While the pointer is free: should Tab be taken as a command (true) or left to move focus (false)? */
  captureTab: () => boolean = () => false;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.listen(window, "keydown", (e) => {
      if (!this.locked) {
        // Only the global keys work while the pointer is free (start screen, edit mode).
        if (e.code !== "KeyH" && e.code !== "Tab" && e.code !== "Escape") return;
        if (e.code === "Tab" && !this.captureTab()) return; // native focus navigation
        // Do not steal H from a focused text field.
        if (e.code === "KeyH" && e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") return;
      }
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
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    this.listen(canvas, "wheel", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(document, "pointerlockchange", () => {
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
    this.listen(window, "blur", () => this.releaseAll());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.locked) return;
    this.canvas.focus();
    const result = this.canvas.requestPointerLock() as Promise<void> | undefined;
    result?.catch?.(() => {
      /* user gesture missing or lock denied: the overlay stays up */
    });
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
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
