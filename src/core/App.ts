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
import { GrabTool } from "../tools/GrabTool";
import { Hud } from "../ui/Hud";

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
  readonly environment: LabEnvironment;
  quality: QualityLevel = loadQuality();
  selectedKind: PrimitiveKind = "box";

  private readonly camera: FreeCamera;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly lighting: Lighting;
  private readonly pipeline: RenderPipeline;
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

    this.input = new InputManager(canvas);
    this.hud = new Hud(uiRoot, this.environment.name, PRIMITIVE_KINDS);
    this.hud.setSelected(this.selectedKind);
    this.hud.onEnter = () => this.input.requestLock();
    this.input.onLockChange = (locked) => {
      this.hud.setLocked(locked);
      if (!locked) this.grab.release();
    };
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

  resetExperiment(): void {
    this.grab.release();
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
    const obj = this.grab.held ?? this.grab.target(this.player.eyePosition, this.player.viewDirection);
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

    this.world.step(dt);

    if (++this.frame % 30 === 0) this.factory.cullOutOfBounds();

    const target = this.grab.held ?? (locked ? this.grab.target(eye, dir) : null);
    this.hud.setTarget(target ? `${target.kind} · ${target.mass.toFixed(1)} kg` : null, this.grab.held !== null);
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
    if (input.wasPressed("Mouse0")) this.grab.tryGrab(eye, dir);
    if (input.wasReleased("Mouse0")) this.grab.release();
    if (input.wasPressed("Mouse2")) this.grab.throwOrPush(eye, dir);
    if (input.wheel !== 0 && this.grab.held) this.grab.adjustDistance(input.wheel);
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

