import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { CONFIG, QUALITY, QUALITY_ORDER, type QualityLevel } from "./config";
import type { RenderBackend } from "../render/EngineFactory";
import { MaterialLibrary } from "../render/MaterialLibrary";
import { Lighting } from "../render/Lighting";
import { RenderPipeline } from "../render/RenderPipeline";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { ENVIRONMENTS } from "../environments";
import type { LabEnvironment } from "../environments/Environment";
import { GravityFields } from "../fields/GravityFields";
import { JointManager, type Joint } from "../construction/Joints";
import { FieldTool } from "../tools/FieldTool";
import { LinkTool } from "../tools/LinkTool";
import { FieldVisuals } from "../render/FieldVisuals";
import { DestructionSystem } from "../destruction/Destruction";
import { ExplosionSystem } from "../effects/Explosions";
import { Deformation } from "../effects/Deformation";
import { WaterVolumes } from "../fluids/WaterVolumes";
import { Effects } from "../render/Effects";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { loadSettings, saveSettings, sanitizeSettings, type Settings } from "./Settings";
import { SoundEngine } from "../audio/SoundEngine";
import { captureExperiment, restoreExperiment, validateExperiment, type ExperimentData, type ExperimentSystems } from "../persistence/Experiment";
import { listSlots } from "../persistence/Storage";
import { handleControls } from "./Controls";
import { wireMenu } from "./MenuController";
import { Interpolator } from "../objects/Interpolator";
import { boundingRadius, findSpawnPosition } from "../objects/SpawnPlacement";
import { defaultSize, primitiveVolume } from "../objects/ObjectFactory";
import { DYNAMIC_RESOLUTION } from "./config";
import { MATERIALS, MATERIAL_ORDER, DEFAULT_MATERIAL, type MaterialId } from "../materials/Materials";
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

export type ToolId = "hand" | "force" | "field" | "link" | "blast";
export const TOOLS: readonly ToolId[] = ["hand", "force", "field", "link", "blast"];
/** Particle budget per graphics quality. */
const FX_BUDGET: Record<QualityLevel, number> = { low: 0.4, medium: 0.75, high: 1 };

const IDLE: MoveIntent = { forward: 0, strafe: 0, sprint: false, jump: false };

/** Composition root: builds every system and runs the frame loop. */
export class App {
  readonly scene: Scene;
  readonly world: PhysicsWorld;
  readonly factory: ObjectFactory;
  readonly player: PlayerController;
  readonly grab: GrabTool;
  readonly force: ForceTool;
  readonly selection: Selection;
  readonly fields: GravityFields;
  readonly joints: JointManager;
  readonly fieldTool: FieldTool;
  readonly linkTool: LinkTool;
  readonly destruction: DestructionSystem;
  readonly explosions: ExplosionSystem;
  readonly water: WaterVolumes;
  readonly deformation: Deformation;
  readonly effects: Effects;
  environment: LabEnvironment;
  selectedMaterial: MaterialId = DEFAULT_MATERIAL;
  tool: ToolId = "hand";
  mode: HudMode = "menu";
  readonly settings: Settings = loadSettings();
  quality: QualityLevel = this.settings.quality;
  readonly sound = new SoundEngine();
  selectedKind: PrimitiveKind = "box";

  private readonly camera: FreeCamera;
  readonly input: InputManager;
  readonly hud: Hud;
  private readonly interp: Interpolator;
  private readonly canvas: HTMLCanvasElement;
  private undoData: ExperimentData | null = null;
  /** Extra render scale applied by dynamic resolution (1 = the preset's own scale). */
  private dynScale = 1;
  private lowTime = 0;
  private highTime = 0;
  private lastRaiseAt = -Infinity;
  private raiseBlockedUntil = 0;
  private readonly lighting: Lighting;
  private readonly pipeline: RenderPipeline;
  private readonly overlay: VectorOverlay;
  private readonly fieldVisuals: FieldVisuals;
  private readonly materials: MaterialLibrary;
  private pendingEdit = false;
  /** Camera shake amplitude in metres (visual), decays every frame. */
  private shake = 0;
  private frame = 0;
  private baseFov = (this.settings.fov * Math.PI) / 180;
  private everEntered = false;

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
    const materials = (this.materials = new MaterialLibrary(this.scene));
    this.environment = ENVIRONMENTS[0].create();
    this.environment.build({ scene: this.scene, materials });
    this.scene.fogColor = this.environment.lightRig.fogColor;

    this.camera = new FreeCamera("player-camera", this.environment.spawnPoint.clone(), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 150;
    this.camera.fov = this.baseFov;

    this.lighting = new Lighting(this.scene, this.environment, QUALITY[this.quality].shadowMapSize);
    this.pipeline = new RenderPipeline(this.scene, this.camera);
    this.pipeline.bakeReflections(this.environment);

    this.factory = new ObjectFactory(this.scene, materials);
    // Level of detail for shadows: tiny debris does not cast.
    const casts = (o: SandboxObject) => primitiveVolume(o.kind, o.size) >= CONFIG.limits.shadowMinVolume;
    this.factory.onSpawned.push((o) => {
      if (casts(o)) this.lighting.addCaster(o.mesh);
    });
    this.factory.onRemoved.push((o) => this.lighting.removeCaster(o.mesh));
    this.factory.onRebuilt.push((o, oldMesh) => {
      this.lighting.removeCaster(oldMesh);
      if (casts(o)) this.lighting.addCaster(o.mesh);
    });
    this.interp = new Interpolator(this.factory);
    this.world.onAfterStep.add(() => this.interp.capture());
    this.canvas = canvas;
    this.fields = new GravityFields(this.world, this.factory);
    this.joints = new JointManager(this.scene, this.factory);
    this.destruction = new DestructionSystem(this.world, this.factory, this.joints, Date.now() & 0xffff);
    this.explosions = new ExplosionSystem(this.world, this.factory, this.destruction);
    this.water = new WaterVolumes(this.world, this.factory);
    this.deformation = new Deformation(this.factory);
    this.effects = new Effects(this.scene);
    this.fieldVisuals = new FieldVisuals(this.scene, this.fields, this.joints, materials, this.water);
    this.wireEffects();
    this.environment.populate({ factory: this.factory, fields: this.fields, joints: this.joints, water: this.water });

    this.player = new PlayerController(this.scene, this.environment.spawnPoint, this.environment.spawnYaw);
    this.grab = new GrabTool(this.world, this.factory);
    this.force = new ForceTool(this.world, this.factory, this.destruction);
    this.selection = new Selection(this.factory);
    this.fieldTool = new FieldTool(this.world, this.fields, this.water);
    this.linkTool = new LinkTool(this.world, this.factory, this.joints);
    this.overlay = new VectorOverlay(this.scene);

    this.input = new InputManager(canvas);
    // In edit mode Tab returns to the lab unless a panel control has focus, where it moves focus as usual.
    this.input.captureTab = () => this.mode === "edit" && !this.hud.panelHasFocus();
    this.hud = new Hud(uiRoot, ENVIRONMENTS, PRIMITIVE_KINDS, TOOLS);
    this.hud.setEnvironment(this.environment.id, this.environment.name);
    this.hud.setSelected(this.selectedKind);
    this.selectMaterial(this.selectedMaterial);
    this.hud.menu.setActiveRenderer(backend === "WebGPU" ? "webgpu" : "webgl2");
    wireMenu(this);
    this.applySettings();
    this.input.onLockProblem = (message) => {
      this.hud.menu.setStatus(message, true);
      window.setTimeout(() => this.hud.toast(message), 100);
    };
    this.input.onLockChange = (locked) => {
      this.mode = locked ? "play" : this.pendingEdit ? "edit" : "menu";
      this.pendingEdit = false;
      this.hud.setMode(this.mode);
      if (locked && !this.everEntered) {
        this.everEntered = true;
        this.hud.menu.setResumable(true);
        if (!this.settings.hintsDone) this.hud.onboarding.start();
      }
      if (this.mode === "menu") this.hud.menu.setSlots(listSlots());
      if (this.mode !== "menu") this.hud.closeGuide();
      if (this.mode === "edit") this.hud.onboarding.complete("edit");
      if (!locked) {
        this.grab.release();
        this.force.end();
      }
    };
    this.hud.setMode(this.mode);

    const inspector = this.hud.inspector;
    this.selection.onChange = (obj) => inspector.setObject(obj, obj ? this.jointSummary(obj) : undefined);
    this.joints.onChange.push(() => {
      const obj = this.selection.current;
      if (obj) inspector.setJoints(this.jointSummary(obj));
    });
    inspector.onMaterialChange = (id) => {
      const obj = this.selection.current;
      if (obj) this.factory.setMaterial(obj, id);
    };
    inspector.onMotorSpeed = (speed) => {
      const obj = this.selection.current;
      if (obj) for (const j of this.motorsOf(obj)) this.joints.setMotorSpeed(j, speed);
    };
    inspector.onRemoveJoints = () => {
      if (this.selection.current) this.joints.removeFor(this.selection.current);
    };
    inspector.onEnvironment = (id) => this.loadEnvironment(id);
    inspector.onDestructionLevel = (level) => this.setDestructionLevel(level);
    inspector.setDestructionLevel(this.destruction.level);
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
    canvas.addEventListener("click", () => {
      this.sound.unlock();
      this.input.requestLock();
    });

    this.applyQuality();
    window.addEventListener("resize", () => {
      this.applyResolution();
      this.engine.resize();
    });
    this.syncCamera(1);
  }

  start(): void {
    this.engine.runRenderLoop(() => this.tick());
  }

  // --- actions (also used by automated tests) --------------------------------

  spawnSelected(): SandboxObject | null {
    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;
    if (this.factory.atLimit) {
      this.hud.toast(`Object limit reached (${CONFIG.limits.maxObjects})`);
      return null;
    }
    const size = defaultSize(this.selectedKind);
    const position = findSpawnPosition(this.world, eye, dir, this.player.position, boundingRadius(this.selectedKind, size));
    if (!position) {
      this.hud.toast("No room to spawn here");
      return null;
    }
    return this.factory.spawn({ kind: this.selectedKind, material: this.selectedMaterial, position });
  }

  selectKind(kind: PrimitiveKind): void {
    this.selectedKind = kind;
    this.hud.setSelected(kind);
  }

  selectMaterial(id: MaterialId): void {
    this.selectedMaterial = id;
    const def = MATERIALS[id];
    this.hud.setMaterial(def.name, def.look.color, def.density);
  }

  cycleMaterial(direction: -1 | 1): void {
    const n = MATERIAL_ORDER.length;
    this.selectMaterial(MATERIAL_ORDER[(MATERIAL_ORDER.indexOf(this.selectedMaterial) + direction + n) % n]);
  }

  /** Loads another environment with its starting experiment (or reloads the current one). */
  loadEnvironment(id: string): void {
    this.undoData = this.captureExperiment();
    this.switchEnvironment(id, true);
  }

  /**
   * Tears down the current experiment and switches to environment `id`. The static room is
   * rebuilt only when it actually changes. With `populate` false the room is left empty
   * (used when a saved experiment is about to be restored into it).
   */
  private switchEnvironment(id: string, populate: boolean): void {
    const entry = ENVIRONMENTS.find((e) => e.id === id);
    if (!entry) return;
    this.clearExperiment();
    if (id !== this.environment.id) {
      this.environment.dispose();
      this.environment = entry.create();
      this.environment.build({ scene: this.scene, materials: this.materials });
      this.scene.fogColor = this.environment.lightRig.fogColor;
      this.lighting.applyEnvironment(this.environment);
      this.pipeline.bakeReflections(this.environment);
      this.hud.setEnvironment(this.environment.id, this.environment.name);
    }
    if (populate) {
      this.startExperiment();
      this.hud.toast(this.environment.name);
    }
  }

  nextEnvironment(): void {
    const i = ENVIRONMENTS.findIndex((e) => e.id === this.environment.id);
    this.loadEnvironment(ENVIRONMENTS[(i + 1) % ENVIRONMENTS.length].id);
  }

  /** Detonates a blast where the player is aiming (just off the surface hit, or 8 m ahead in free space). */
  detonateAimed(): boolean {
    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;
    const hit = this.world.raycast(eye, eye.add(dir.scale(40)));
    const point = hit ? hit.point.add(hit.normal.scale(0.25)) : eye.add(dir.scale(8));
    if (this.explosions.detonate(point)) return true;
    this.hud.toast("Too many blasts in progress");
    return false;
  }

  /** Connects simulation events to their visual effects. */
  private wireEffects(): void {
    this.destruction.onFracture = (parent, fragments, point) => {
      const c = MATERIALS[parent.materialId].look.color;
      this.effects.burst("dust", point, 14 + fragments.length * 3, new Color3(c[0], c[1], c[2]), Math.cbrt(parent.props.mass / 300));
      this.sound.fracture(MATERIALS[parent.materialId].hardness, Vector3.Distance(point, this.player.eyePosition));
    };
    this.destruction.onImpact = (obj, deltaV, direction, point) => {
      this.deformation.impact(obj, deltaV, direction);
      if (deltaV > 1.5) this.sound.impact(deltaV / 14, MATERIALS[obj.materialId].hardness, obj.props.mass, Vector3.Distance(obj.mesh.position, this.player.eyePosition));
      if (deltaV > 6 && point && MATERIALS[obj.materialId].hardness >= 4) this.effects.burst("sparks", point, Math.min(40, deltaV * 2.5));
    };
    this.explosions.onDetonate = (wave) => {
      this.effects.explosion(wave);
      const distance = Vector3.Distance(wave.center, this.player.eyePosition);
      this.sound.explosion(wave.radius / 10, distance);
      if (this.settings.cameraShake) this.shake = Math.min(0.35, this.shake + (wave.radius / 10) * (1.6 / (1 + distance)));
    };
    this.water.onSplash = (obj, point, speed) => {
      if (speed > 1) {
        this.effects.burst("splash", point, Math.min(60, 10 + speed * 5), undefined, Math.cbrt(obj.props.mass / 200));
        this.sound.splash(speed / 8, Vector3.Distance(point, this.player.eyePosition));
      }
    };
  }

  setDestructionLevel(level: number): void {
    this.destruction.setLevel(level);
    this.hud.inspector.setDestructionLevel(this.destruction.level);
    this.hud.toast(`Destruction: ${this.destruction.levelName}`);
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
    this.linkTool.cancel();
    this.tool = tool;
  }

  /** Short description of the active tool's current setting for the HUD. */
  private toolDetail(): string {
    switch (this.tool) {
      case "force":
        return this.force.mode === "torque" ? `torque ${si(this.force.torque, "N·m")}` : `${si(this.force.force, "N")} · ${si(this.force.impulse, "N·s")}`;
      case "field":
        if (this.fieldTool.kind === "zone") return "zone · gravity along view";
        if (this.fieldTool.kind === "water") return "water volume";
        return `${this.fieldTool.kind} · μ ${this.fieldTool.strength} m³/s²`;
      case "link":
        return this.linkTool.pending ? `${this.linkTool.kind} · pick second body` : this.linkTool.kind;
      case "blast":
        return `${this.explosions.levelName} charge`;
      default:
        return this.grab.held ? "hold T to turn" : "";
    }
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
    this.undoData = this.captureExperiment();
    this.clearExperiment();
    this.startExperiment();
    this.hud.toast("Experiment reset · Z to undo");
  }

  /** Brings back the experiment as it was before the last reset, environment load or save load. */
  undo(): void {
    const data = this.undoData;
    if (!data) {
      this.hud.toast("Nothing to undo");
      return;
    }
    const result = this.loadExperiment(data); // also stores the current state, so Z again redoes
    this.hud.toast(result.ok ? "Restored previous experiment" : result.message);
  }

  /** Removes every object, joint and field and releases all tools. */
  private clearExperiment(): void {
    this.grab.release();
    this.force.end();
    this.linkTool.cancel();
    this.selection.select(null);
    this.joints.clear();
    this.fields.clear();
    this.water.clear();
    this.explosions.clear();
    this.factory.clear();
    this.destruction.stats.fractures = 0;
    this.destruction.stats.bondsBroken = 0;
  }

  /** Populates the current environment and puts the player and world back to their starting state. */
  private startExperiment(): void {
    this.setGravity(this.environment.gravityY);
    this.environment.populate({ factory: this.factory, fields: this.fields, joints: this.joints, water: this.water });
    this.player.teleport(this.environment.spawnPoint, this.environment.spawnYaw);
    this.world.paused = false;
    this.world.timeScale = 1;
  }

  private motorsOf(obj: SandboxObject): Joint[] {
    return this.joints.jointsOf(obj).filter((j) => j.kind === "motor");
  }

  private jointSummary(obj: SandboxObject) {
    const motors = this.motorsOf(obj);
    return { count: this.joints.jointsOf(obj).length, motorSpeed: motors.length ? motors[0].motorSpeed : null };
  }

  cycleQuality(): void {
    this.updateSettings({ quality: QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length] });
    this.hud.toast(`Graphics quality: ${this.quality}`);
  }

  /** Changes settings, applies them and stores them in the browser. */
  updateSettings(change: Partial<Settings>): void {
    Object.assign(this.settings, sanitizeSettings({ ...this.settings, ...change }));
    saveSettings(this.settings);
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings;
    this.player.sensitivity = s.sensitivity;
    this.player.invertY = s.invertY;
    this.baseFov = (s.fov * Math.PI) / 180;
    this.sound.setVolume(s.volume);
    if (this.quality !== s.quality) {
      this.quality = s.quality;
      this.dynScale = 1;
      this.applyQuality();
    }
    if (!s.dynamicResolution && this.dynScale !== 1) {
      this.dynScale = 1;
      this.applyResolution();
    }
    this.hud.menu.setSettings(s);
  }

  // --- experiments -----------------------------------------------------------

  private experimentSystems(): ExperimentSystems {
    return {
      environmentId: this.environment.id,
      world: this.world,
      factory: this.factory,
      joints: this.joints,
      fields: this.fields,
      water: this.water,
      destruction: this.destruction,
      roomBody: (name) => this.environment.roomBody(name),
    };
  }

  captureExperiment(): ExperimentData {
    const data = captureExperiment(this.experimentSystems());
    const p = this.player.position;
    data.player = { position: [p.x, p.y, p.z], yaw: this.player.yaw, pitch: this.player.pitch };
    data.tool = this.tool;
    return data;
  }

  /**
   * Loads untrusted experiment data (a slot or an imported file). Returns a message for the
   * user; nothing is changed when the data is not a valid save.
   */
  loadExperiment(raw: unknown): { ok: boolean; message: string } {
    let data: ExperimentData;
    try {
      data = validateExperiment(raw, ENVIRONMENTS.map((e) => e.id));
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "That is not a valid experiment." };
    }
    this.undoData = this.captureExperiment();
    this.switchEnvironment(data.environment, false);
    const report = restoreExperiment(data, this.experimentSystems());
    this.hud.inspector.setGravity(data.gravityY);
    this.hud.inspector.setDestructionLevel(this.destruction.level);
    if (data.player) {
      this.player.teleport(new Vector3(...data.player.position), data.player.yaw);
      this.player.pitch = data.player.pitch;
    } else {
      this.player.teleport(this.environment.spawnPoint, this.environment.spawnYaw);
    }
    if (data.tool && (TOOLS as readonly string[]).includes(data.tool)) this.setTool(data.tool as ToolId);
    this.world.paused = false;
    this.world.timeScale = 1;
    const skipped = report.skipped ? ` (${report.skipped} item${report.skipped === 1 ? "" : "s"} could not be restored)` : "";
    return { ok: true, message: `Loaded ${report.objects} objects and ${report.joints} joints${skipped}.` };
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

    this.interp.restore();
    if (input.wasPressed("KeyH")) this.hud.toggleGuide();
    if (input.wasPressed("Escape")) {
      if (this.hud.closeGuide()) {
        /* Esc closed the guide */
      } else if (this.mode === "edit") {
        // Edit mode has the pointer free already, so the browser does not turn Esc into a mode change.
        this.mode = "menu";
        this.hud.setMode(this.mode);
        this.hud.menu.setSlots(listSlots());
      }
    }
    if (input.wasPressed("Tab")) {
      if (locked) this.enterEditMode();
      else if (this.mode === "edit") input.requestLock();
    }

    let intent = IDLE;
    if (locked) {
      if (this.grab.held && input.isDown("KeyT")) {
        // Turn the held object instead of the view: mouse X about the vertical, mouse Y about the view's right axis.
        const right = new Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
        const k = CONFIG.interaction.turnSpeed / Math.max(dt, 1 / 240);
        this.grab.rotate(Vector3.Up().scale(input.lookX * k).addInPlace(right.scale(input.lookY * k)));
      } else {
        this.player.look(input.lookX, input.lookY);
      }
      intent = {
        forward: input.axis("KeyS", "KeyW"),
        strafe: input.axis("KeyA", "KeyD"),
        sprint: input.isDown("ShiftLeft") || input.isDown("ShiftRight"),
        jump: input.wasPressed("Space"),
      };
      if (intent.forward !== 0 || intent.strafe !== 0) this.hud.onboarding.complete("move");
      handleControls(this);
    }

    // The menu is a pause screen: nothing moves while it is open (including before first entry).
    const frozen = this.mode === "menu";
    if (!frozen) this.player.update(dt, intent);
    this.syncCamera(dt, intent.sprint && (intent.forward !== 0 || intent.strafe !== 0));

    const eye = this.player.eyePosition;
    const dir = this.player.viewDirection;
    if (this.grab.held) this.grab.setHoldPoint(eye, dir);
    if (this.force.target) this.force.setDirection(dir);

    const simDt = frozen ? 0 : this.world.advance(dt);
    this.deformation.update(simDt);
    this.effects.update(this.explosions.waves, frozen || this.world.paused ? 0 : this.world.timeScale);

    if (++this.frame % 30 === 0) {
      this.factory.cullOutOfBounds();
      // Adaptive particle budget: quality preset, halved when the frame rate sags.
      const fps = this.engine.getFps();
      this.effects.budget = FX_BUDGET[this.quality] * (fps < 25 ? 0.25 : fps < 42 ? 0.5 : 1);
    }
    if (!frozen) this.updateDynamicResolution(dt);

    const active = this.grab.held ?? this.force.target;
    const target = active ?? (locked ? this.pickObject() : null);
    this.hud.setTarget(target ? `${target.kind} · ${formatMass(target.props.mass)}${target.props.isStatic ? " · static" : ""}` : null, active !== null);
    this.hud.setTool(this.tool, this.toolDetail(), TOOLS.indexOf(this.tool));
    this.interp.apply(this.world.alpha);
    this.fieldVisuals.update();

    const selected = this.selection.current;
    if (selected) {
      const state = readState(selected);
      this.hud.inspector.updateLive(state, { last: this.selection.lastImpact, peak: this.selection.peakImpact, contacts: this.selection.contacts }, performance.now());
      this.overlay.setVelocity(state.position, state.velocity);
    } else {
      this.overlay.setVelocity(null);
    }
    const forcePoint = this.force.mode === "force" ? this.force.applicationPoint() : null;
    this.overlay.setForce(forcePoint, this.force.forceDirection, (this.force.level + 1) / CONFIG.force.magnitudes.length);
    this.hud.update(
      {
        fps: this.engine.getFps(),
        frameMs: this.engine.getDeltaTime(),
        objects: this.factory.count,
        debris: this.factory.debrisCount,
        particles: this.effects.activeParticles,
        fractures: this.destruction.stats.fractures,
        objectLimit: CONFIG.limits.maxObjects,
        bodies: this.world.bodyCount,
        backend: this.backend,
        quality: this.dynScale < 1 ? `${this.quality} · ${Math.round(this.dynScale * 100)}%` : this.quality,
        paused: this.world.paused || frozen,
        timeScale: this.world.timeScale,
      },
      performance.now(),
    );

    this.scene.render();
    input.endFrame();
  }

  private syncCamera(dt: number, sprinting = false): void {
    const eye = this.player.eyePosition;
    const cam = this.camera;
    // Horizontal follows exactly; vertical is eased so steps and landings do not jolt the view.
    const k = 1 - Math.exp(-22 * dt);
    const y = Math.abs(eye.y - cam.position.y) > 1.5 ? eye.y : cam.position.y + (eye.y - cam.position.y) * k;
    cam.position.set(eye.x, y, eye.z);
    if (this.shake > 0.002) {
      // Visual only: the player body does not move.
      cam.position.addInPlaceFromFloats((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.exp(-9 * dt);
    }
    cam.rotationQuaternion = this.player.viewRotation();
    const targetFov = this.baseFov + (sprinting ? 0.07 : 0);
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-8 * dt));
  }

  private applyQuality(): void {
    const q = QUALITY[this.quality];
    this.applyResolution();
    this.lighting.setShadowMapSize(q.shadowMapSize);
    this.pipeline.applyQuality(q);
  }

  /** Sets the render resolution from the quality preset, the display and the dynamic scale. */
  private applyResolution(): void {
    const q = QUALITY[this.quality];
    const cssHeight = this.canvas.clientHeight || window.innerHeight || 720;
    const native = window.devicePixelRatio || 1; // physical pixels per CSS pixel
    const perCssPixel = Math.min(native * q.renderScale, q.maxRenderHeight / cssHeight) * this.dynScale;
    this.engine.setHardwareScalingLevel(1 / perCssPixel);
  }

  /**
   * Dynamic resolution: lowers the render scale when the frame rate stays low and raises it
   * again when there is headroom. A raise that is followed quickly by a drop is not retried
   * for a while, so the scale does not oscillate.
   */
  private updateDynamicResolution(dt: number): void {
    if (!this.settings.dynamicResolution) return;
    const D = DYNAMIC_RESOLUTION;
    const fps = this.engine.getFps();
    const now = performance.now() / 1000;
    if (fps < D.lowFps) {
      this.lowTime += dt;
      this.highTime = 0;
    } else if (fps > D.highFps) {
      this.highTime += dt;
      this.lowTime = 0;
    } else {
      this.lowTime = this.highTime = 0;
    }
    if (this.lowTime > D.lowerAfter && this.dynScale > D.minScale) {
      this.dynScale = Math.max(D.minScale, this.dynScale - D.step);
      this.lowTime = 0;
      if (now - this.lastRaiseAt < 10) this.raiseBlockedUntil = now + 30;
      this.applyResolution();
    } else if (this.highTime > D.raiseAfter && this.dynScale < 1 && now > this.raiseBlockedUntil) {
      this.dynScale = Math.min(1, this.dynScale + D.step);
      this.highTime = 0;
      this.lastRaiseAt = now;
      this.applyResolution();
    }
  }
}
