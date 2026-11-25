import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { CONFIG, QUALITY, QUALITY_ORDER, type QualityLevel } from "./config";
import type { RenderBackend } from "../render/EngineFactory";
import { MaterialLibrary } from "../render/MaterialLibrary";
import { Lighting } from "../render/Lighting";
import { RenderPipeline } from "../render/RenderPipeline";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TestChamber } from "../environments/TestChamber";
import type { LabEnvironment } from "../environments/Environment";
import { ObjectFactory, PRIMITIVE_KINDS, type PrimitiveKind, type SandboxObject } from "../objects/ObjectFactory";
import { PlayerController, type MoveIntent } from "../player/PlayerController";
import { InputManager } from "../input/InputManager";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GrabTool } from "../tools/GrabTool";
import { ForceTool } from "../tools/ForceTool";
import { Selection } from "../tools/Selection";
import { readState } from "../objects/ObjectState";
import { VectorOverlay } from "../render/VectorOverlay";
import { Hud, type HudMode } from "../ui/Hud";
import { mass as formatMass, si } from "../ui/format";

export type ToolId = "hand" | "force";

const QUALITY_KEY = "momentum.quality";
const IDLE: MoveIntent = { forward: 0, strafe: 0, sprint: false, jump: false };

function loadQuality(): QualityLevel {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v && (QUALITY_ORDER as readonly string[]).includes(v)) return v as QualityLevel;
  } catch {
    /* storage unavailable */
  }
  return "medium";
}

/** Composition root: builds every system and runs the frame loop. */
export class App {
  readonly scene: Scene;
  readonly world: PhysicsWorld;
  readonly factory: ObjectFactory;
  readonly player: PlayerController;
  readonly grab: GrabTool;
  readonly force: ForceTool;
  readonly selection: Selection;
  readonly environment: LabEnvironment;
  tool: ToolId = "hand";
  mode: HudMode = "menu";
  quality: QualityLevel = loadQuality();
  selectedKind: PrimitiveKind = "box";

  private readonly camera: FreeCamera;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly lighting: Lighting;
  private readonly pipeline: RenderPipeline;
  private readonly overlay: VectorOverlay;
  private pendingEdit = false;
  private frame = 0;
  private baseFov = 1.12;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly backend: RenderBackend,
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    havok: unknown,
  ) {
    this.scene = new Scene(engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = true;

    this.world = new PhysicsWorld(this.scene, havok);
    const materials = new MaterialLibrary(this.scene);
    this.environment = new TestChamber();
    this.environment.build({ scene: this.scene, materials });

    this.camera = new FreeCamera("player-camera", this.environment.spawnPoint.clone(), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 150;
    this.camera.fov = this.baseFov;

    this.lighting = new Lighting(this.scene, this.environment, QUALITY[this.quality].shadowMapSize);
    this.pipeline = new RenderPipeline(this.scene, this.camera);
    this.pipeline.bakeReflections(this.environment);

    this.factory = new ObjectFactory(this.scene, materials);
    this.factory.onSpawned.push((o) => this.lighting.addCaster(o.mesh));
    this.factory.onRemoved.push((o) => this.lighting.removeCaster(o.mesh));
    this.environment.populate(this.factory);

    this.player = new PlayerController(this.scene, this.environment.spawnPoint, this.environment.spawnYaw);
    this.grab = new GrabTool(this.world, this.factory);
    this.force = new ForceTool(this.world, this.factory);
    this.selection = new Selection(this.factory);
    this.overlay = new VectorOverlay(this.scene);

    this.input = new InputManager(canvas);
    this.hud = new Hud(uiRoot, this.environment.name, PRIMITIVE_KINDS);
    this.hud.setSelected(this.selectedKind);
    this.hud.onEnter = () => this.input.requestLock();
    this.input.onLockChange = (locked) => {
      this.mode = locked ? "play" : this.pendingEdit ? "edit" : "menu";
      this.pendingEdit = false;
      this.hud.setMode(this.mode);
      if (!locked) {
        this.grab.release();
        this.force.end();
      }
    };
    this.hud.setMode(this.mode);

    const inspector = this.hud.inspector;
    this.selection.onChange = (obj) => inspector.setObject(obj);
    inspector.onPropChange = (change) => {
      const obj = this.selection.current;
      if (obj) this.factory.setProps(obj, change);
    };
    inspector.onGravityChange = (y) => this.setGravity(y);
    inspector.onDuplicate = () => this.duplicateSelected();
    inspector.onDelete = () => {
      if (this.selection.current) this.factory.remove(this.selection.current);
    };
    inspector.onDeselect = () => this.selection.select(null);
    canvas.addEventListener("click", () => this.input.requestLock());

    this.applyQuality();
    window.addEventListener("resize", () => this.engine.resize());
    this.syncCamera(1);
  }

  start(): void {
    this.engine.runRenderLoop(() => this.tick());
  }

  // --- actions (also used by automated tests) --------------------------------

  spawnSelected(): SandboxObject | null {
    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;
    const max = CONFIG.interaction.spawnDistance;
    const hit = this.world.raycast(eye, eye.add(dir.scale(max + 0.6)));
    const dist = hit ? Math.max(0.9, hit.distance - 0.6) : max;
    const obj = this.factory.spawn({ kind: this.selectedKind, position: eye.add(dir.scale(dist)) });
    if (!obj) this.hud.toast(`Object limit reached (${CONFIG.limits.maxObjects})`);
    return obj;
  }

  selectKind(kind: PrimitiveKind): void {
    this.selectedKind = kind;
    this.hud.setSelected(kind);
  }

  togglePause(): void {
    this.world.paused = !this.world.paused;
  }

  stepTimeScale(direction: -1 | 1): void {
    const scales = CONFIG.physics.timeScales;
    const i = scales.indexOf(this.world.timeScale);
    const next = Math.min(scales.length - 1, Math.max(0, (i === -1 ? scales.indexOf(1) : i) + direction));
    this.world.timeScale = scales[next];
  }

  /** Object under the crosshair, dynamic or static. */
  pickObject(): SandboxObject | null {
    const eye = this.player.eyePosition;
    const hit = this.world.raycast(eye, eye.add(this.player.viewDirection.scale(CONFIG.force.reach)));
    return hit ? this.factory.fromBody(hit.body) : null;
  }

  /** Selects the held or targeted object for inspection; deselects when it is already selected or nothing is targeted. */
  selectTarget(): void {
    const obj = this.grab.held ?? this.pickObject();
    this.selection.select(obj === this.selection.current ? null : obj);
  }

  duplicateSelected(): SandboxObject | null {
    const src = this.selection.current ?? this.grab.held ?? this.pickObject();
    if (!src) return null;
    const lift = (src.kind === "box" ? src.size.y : src.kind === "sphere" ? src.size.x : src.size.y) + 0.15;
    const copy = this.factory.duplicate(src, new Vector3(0, lift, 0));
    this.hud.toast(copy ? `Duplicated ${src.kind} #${src.id}` : `Object limit reached (${CONFIG.limits.maxObjects})`);
    return copy;
  }

  setTool(tool: ToolId): void {
    if (tool === this.tool) return;
    this.grab.release();
    this.force.end();
    this.tool = tool;
  }

  /** Vertical world gravity in m/s^2 (negative is down). Sleeping bodies are woken so they respond. */
  setGravity(y: number): void {
    const g = Math.min(CONFIG.gravity.max, Math.max(CONFIG.gravity.min, y));
    this.world.setGravity(new Vector3(0, g, 0));
    this.factory.wakeAll();
    this.hud.inspector.setGravity(g);
  }

  /** Frees the mouse so the inspector can be edited; the simulation keeps running. */
  enterEditMode(): void {
    if (!this.input.locked) return;
    this.pendingEdit = true;
    this.input.exitLock();
  }

  resetExperiment(): void {
    this.grab.release();
    this.force.end();
    this.setGravity(CONFIG.physics.gravity);
    this.factory.clear();
    this.environment.populate(this.factory);
    this.player.teleport(this.environment.spawnPoint, this.environment.spawnYaw);
    this.world.paused = false;
    this.world.timeScale = 1;
    this.hud.toast("Experiment reset");
  }

  cycleQuality(): void {
    this.quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length];
    try {
      localStorage.setItem(QUALITY_KEY, this.quality);
    } catch {
      /* storage unavailable */
    }
    this.applyQuality();
    this.hud.toast(`Graphics quality: ${this.quality}`);
  }

  deleteTarget(): boolean {
    const obj = this.grab.held ?? this.pickObject();
    if (!obj) return false;
    this.factory.remove(obj);
    return true;
  }

  // --- frame -----------------------------------------------------------------

  private tick(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    const input = this.input;
    const locked = input.locked;

    if (input.wasPressed("KeyH")) this.hud.toggleGuide();
    if (input.wasPressed("Tab")) {
      if (locked) this.enterEditMode();
      else if (this.mode === "edit") input.requestLock();
    }

    let intent = IDLE;
    if (locked) {
      this.player.look(input.lookX, input.lookY);
      intent = {
        forward: input.axis("KeyS", "KeyW"),
        strafe: input.axis("KeyA", "KeyD"),
        sprint: input.isDown("ShiftLeft") || input.isDown("ShiftRight"),
        jump: input.wasPressed("Space"),
      };
      this.handleActions();
    }

    this.player.update(dt, intent);
    this.syncCamera(dt, intent.sprint && (intent.forward !== 0 || intent.strafe !== 0));

    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;
    if (this.grab.held) this.grab.setHoldPoint(eye, dir);
    if (this.force.target) this.force.setDirection(dir);

    this.world.step(dt);

    if (++this.frame % 30 === 0) this.factory.cullOutOfBounds();

    const active = this.grab.held ?? this.force.target;
    const target = active ?? (locked ? this.pickObject() : null);
    this.hud.setTarget(target ? `${target.kind} · ${formatMass(target.props.mass)}${target.props.isStatic ? " · static" : ""}` : null, active !== null);
    this.hud.setTool(this.tool, this.tool === "force" ? `${si(this.force.force, "N")} · ${si(this.force.impulse, "N·s")}` : "");

    const selected = this.selection.current;
    if (selected) {
      const state = readState(selected);
      this.hud.inspector.updateLive(state, { last: this.selection.lastImpact, peak: this.selection.peakImpact, contacts: this.selection.contacts }, performance.now());
      this.overlay.setVelocity(state.position, state.velocity);
    } else {
      this.overlay.setVelocity(null);
    }
    const forcePoint = this.force.applicationPoint();
    this.overlay.setForce(forcePoint, this.force.forceDirection, (this.force.level + 1) / CONFIG.force.magnitudes.length);
    this.hud.update(
      {
        fps: this.engine.getFps(),
        frameMs: this.engine.getDeltaTime(),
        objects: this.factory.count,
        objectLimit: CONFIG.limits.maxObjects,
        bodies: this.world.bodyCount,
        backend: this.backend,
        quality: this.quality,
        paused: this.world.paused,
        timeScale: this.world.timeScale,
      },
      performance.now(),
    );

    this.scene.render();
    input.endFrame();
  }

  private handleActions(): void {
    const input = this.input;
    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;

    PRIMITIVE_KINDS.forEach((kind, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) this.selectKind(kind);
    });
    if (input.wasPressed("KeyF")) this.spawnSelected();
    if (input.wasPressed("KeyQ")) this.setTool(this.tool === "hand" ? "force" : "hand");
    if (this.tool === "hand") {
      if (input.wasPressed("Mouse0")) this.grab.tryGrab(eye, dir);
      if (input.wasReleased("Mouse0")) this.grab.release();
      if (input.wasPressed("Mouse2")) this.grab.throwOrPush(eye, dir);
      if (input.wheel !== 0 && this.grab.held) this.grab.adjustDistance(input.wheel);
    } else {
      if (input.wasPressed("Mouse0")) this.force.begin(eye, dir);
      if (input.wasReleased("Mouse0")) this.force.end();
      if (input.wasPressed("Mouse2")) this.force.strike(eye, dir);
      if (input.wheel !== 0) this.force.adjustLevel(-input.wheel);
    }
    if (input.wasPressed("KeyE")) this.selectTarget();
    if (input.wasPressed("KeyC")) this.duplicateSelected();
    if (input.wasPressed("KeyX") || input.wasPressed("Delete")) this.deleteTarget();
    if (input.wasPressed("KeyP")) this.togglePause();
    if (input.wasPressed("BracketLeft")) this.stepTimeScale(-1);
    if (input.wasPressed("BracketRight")) this.stepTimeScale(1);
    if (input.wasPressed("KeyR")) this.resetExperiment();
    if (input.wasPressed("F2")) this.cycleQuality();
  }

  private syncCamera(dt: number, sprinting = false): void {
    const eye = this.player.eyePosition;
    const cam = this.camera;
    // Horizontal follows exactly; vertical is eased so steps and landings do not jolt the view.
    const k = 1 - Math.exp(-22 * dt);
    const y = Math.abs(eye.y - cam.position.y) > 1.5 ? eye.y : cam.position.y + (eye.y - cam.position.y) * k;
    cam.position.set(eye.x, y, eye.z);
    cam.rotationQuaternion = this.player.viewRotation();
    const targetFov = this.baseFov + (sprinting ? 0.07 : 0);
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-8 * dt));
  }

  private applyQuality(): void {
    const q = QUALITY[this.quality];
    const ratio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.engine.setHardwareScalingLevel(1 / ratio);
    this.lighting.setShadowMapSize(q.shadowMapSize);
    this.pipeline.applyQuality(q);
  }
}

