# Architecture

## Principles

1. **The physics engine is the source of truth.** Rigid-body motion, collisions, friction, restitution and raycasts come from Havok. Game code applies forces, impulses and velocities; it does not integrate motion itself.
2. **Simulated vs. visual is explicit.** Anything that is only a visual effect (bloom, glow, fog, reflections, later smoke and sparks) lives under `render/` or is labelled as visual in code and UI. Anything under `physics/`, `objects/`, `tools/` and `player/` acts on the Havok world.
3. **One owner per concern.** Only `PhysicsWorld` steps the simulation. Only `ObjectFactory` creates or destroys sandbox objects. Only `InputManager` touches DOM input events. Only `Hud` touches HUD DOM.
4. **Headless-testable core.** Physics, objects, environments, player and tools run under Babylon's `NullEngine` with the real Havok WASM, so behaviour is tested without a GPU. Rendering-only modules are kept out of that path.
5. **Tree-shaken imports.** Babylon is imported per module (`@babylonjs/core/...`), never from the package root.

## Module map

```
src/
  main.ts                 Boot: engine + Havok, error screen, device-loss handling
  core/
    App.ts                Composition root and frame loop; player-facing actions
    Controls.ts           Maps play-mode input to actions
    MenuController.ts     Connects the menu to the app (saves, files, settings)
    config.ts             Tuning constants, limits, graphics quality presets
    Settings.ts           User settings: load, sanitise, save (browser storage)
  render/                 VISUAL ONLY
    EngineFactory.ts      WebGL 2 / WebGPU engine creation with fallback
    MaterialLibrary.ts    Shared PBR materials, procedural textures
    Lighting.ts           Key/fill/spot lights, shadow generator
    RenderPipeline.ts     Tone mapping, bloom, FXAA/MSAA, glow, reflection probe, selection box
    VectorOverlay.ts      Velocity / force arrows drawn from engine values
    FieldVisuals.ts       Markers for fields, zones, water volumes, joints, cables and springs
    Effects.ts            VISUAL particle bursts (pooled) and blast shock rings, adaptive budget
  physics/
    PhysicsWorld.ts       Havok world: stepping, pause, time scale, gravity, raycast
    loadHavok.ts          Browser WASM loader
  environments/
    Environment.ts        LabEnvironment interface, BaseEnvironment (block helpers, dispose)
    TestChamber.ts        Test Chamber 01
    GravityLab.ts         Gravity Laboratory (emitter field, upward column)
    DestructionArena.ts   Destruction Arena (bonded brick wall, wrecking ball, glass panes)
    ConstructionZone.ts   Construction Zone (turntable, seesaw, Newton's cradle, sprung platform, parts depot)
    index.ts              Environment registry
  materials/
    Materials.ts          Physical material presets (density, friction, restitution, hardness, durability)
  fields/
    GravityFields.ts      Point fields (inverse-square) and gravity zones, applied as engine forces
  construction/
    Joints.ts             Weld / hinge / ball / motor joints (Havok 6-DoF constraints); welds are breakable bonds
  persistence/
    Experiment.ts         Capture, validate and restore an experiment (plain JSON data)
    Storage.ts            Save slots in browser storage, file export / import
  audio/
    SoundEngine.ts        Synthesised sound effects (Web Audio), rate-limited
  effects/
    Explosions.ts         SIMULATED blast: pressure front, impulse per presented area, line of sight
    Deformation.ts        VISUAL squash of soft materials, driven by measured impacts
  fluids/
    WaterVolumes.ts       SIMULATED water: Archimedes buoyancy and quadratic drag in box volumes
  destruction/
    Destruction.ts        Impact measurement, break thresholds, fracture, bond breaking, debris budget
    Fracture.ts           Fragment geometry (pure functions, seeded)
  objects/
    ObjectFactory.ts      Spawn / remove / duplicate objects, editable PhysicalProps, limits, instancing
    Interpolator.ts       Render interpolation between fixed physics steps (visual only)
    SpawnPlacement.ts     Collision-free spawn position in front of the player
    ObjectState.ts        Engine readout: velocity, momentum, kinetic energy (linear + rotational)
  player/
    PlayerController.ts   Havok character controller + view angles
  input/
    InputManager.ts       Keyboard, mouse, pointer lock
  tools/
    GrabTool.ts           Hand tool: target, grab, carry, throw, push
    ForceTool.ts          Force tool: continuous force / impulse at a point on the body
    FieldTool.ts          Field tool: place / remove gravity fields
    LinkTool.ts           Link tool: two-click joints
    Selection.ts          Inspected object, contact-impulse tracking
  ui/
    Hud.ts, styles.css    DOM overlay (glass panels), control guide, start screen, modes
    Inspector.ts          Live readouts and property / gravity editors
    Menu.ts               Main / pause menu: home, environments, experiments, settings
    Onboarding.ts         Getting-started checklist
    format.ts             SI formatting
tests/                    Vitest suites running real Havok headlessly
```

All planned modules now exist.

## Frame loop (`App.tick`)

1. `Interpolator.restore()` puts every mesh back on its exact simulated transform.
2. Read input; apply look; `Controls` turns input into actions.
3. `PlayerController.update(realDt)` - the character moves in real time, independent of pause and time scale.
4. `PhysicsWorld.advance(realDt)` - accumulates real time (x time scale) and takes fixed 1/60 s steps, at most 4 per frame. Results therefore do not depend on the frame rate, and the simulation keeps real-time pace down to 15 FPS. `onBeforeStep` lets tools, fields, water and blasts apply forces; `onAfterStep` runs destruction and records states for interpolation.
5. Housekeeping (out-of-bounds cull, particle budget, dynamic resolution), HUD update.
6. `Interpolator.apply(alpha)` draws moving meshes between the last two simulated states, then `scene.render()`.

Nothing is simulated while the menu is open. `PhysicsWorld.step(dt)` remains as a single-step API for tests.

## Data flow

- `ObjectFactory` raises `onSpawned` / `onRemoved`. Lighting registers shadow casters from these; `GrabTool` drops a held object if it is removed.
- A physics body maps back to its `SandboxObject` through `mesh.metadata.sandboxId`.
- An environment exposes `build()` (static world) and `populate()` (starting props). Reset = clear objects, `populate()` again, teleport the player.

## Interaction modes

- **menu** - main / pause menu, pointer free. The simulation and the player are frozen while it is open (also before first entry, so an environment's opening moment is not missed).
- **play** - pointer locked; movement, tools and hotkeys active.
- **edit** - entered with Tab; pointer free, inspector editors active, simulation still running. Tab or a click on the viewport returns to play.

`App` owns the mode; `Hud.setMode` reflects it. Property edits flow `Inspector -> App -> ObjectFactory.setProps -> Havok`, and `ObjectFactory` clamps to `PROP_LIMITS`.

## Persistence

- `captureExperiment` produces plain data; `validateExperiment` treats its input as untrusted (a picked file or storage contents), checks every field and throws a readable error; `restoreExperiment` rebuilds into an already-loaded, empty environment and reports anything it had to skip.
- Joints are saved in the bodies' own frames (local pivots and axis), so they are rebuilt exactly whatever the bodies' poses. Joints to the room are saved by the room collider's mesh name and resolved with `LabEnvironment.roomBody`.
- Object ids are not preserved; references are remapped on load.

## Physics conventions

- Mass is written to the engine; Havok keeps the inertia tensor **per unit mass**, derived from the collision shape, so rotational inertia follows mass automatically. `ObjectState` multiplies by mass when computing rotational energy.
- Friction and restitution live on the shape material; damping, gravity factor and motion type on the body.
- Sleeping bodies do not react to gravity or property changes until woken; `ObjectFactory.wake` / `wakeAll` handle that.
- Materials: mass = density x volume; friction and restitution are written to the shape. Changing an object's material rebuilds its mesh and body in place (`ObjectFactory.onRebuilt`); joints are recreated on the new body.
- Gravity fields apply F = m a at the centre of mass every step. A zone adds its own gravity and cancels the object's share of world gravity, so net gravity inside equals the zone's. The player is not affected by fields.
- Joints are 6-DoF constraints with locked axes: weld locks all six, hinge and motor leave rotation about the joint axis free, ball leaves all rotation free. Collision between the two joined bodies is disabled.
- Destruction: each step the engine's contact impulses are summed **as vectors** per body; net impulse / mass is the velocity change the contacts imposed. This is step-size independent for resting loads (a block in a stack nets only its own weight x dt), which a sum of magnitudes is not. An object fractures when that velocity change exceeds its material's `breakSpeed`, adjusted for the other body's hardness and the intensity setting. Fracture happens after the step, never inside the contact callback.
- Fragments tile the parent's volume, conserve its mass, and start with the parent's rigid-body velocity at their position. The extra outward scatter is a model (not derived from the engine) and is made momentum-neutral.
- Collision callbacks are enabled on every sandbox object (needed for destruction and the inspector's impact readout).
- Explosions: a front expands at 120 m/s; when it reaches a body the body gets J = i(r) x A through the engine, with i(r) = strength / r^2 tapering to zero at the blast radius and A the area the body presents. Bodies behind static geometry get nothing; bodies behind other objects get 30 %. The impulse is also reported to the destruction system.
- Water: buoyancy F = -rho V_submerged g at the centre of the immersed part, plus quadratic drag. Floating level therefore equals density / 1000 (tested). The water itself does not flow.
- Springs: Havok's stiffness is in N/m (measured), its damping parameter is not N s/m; `springDampingScale` was calibrated by measurement.
- Particle effects are pooled per kind and scaled by a budget (graphics quality x frame-rate headroom).
- Switching environment disposes all static meshes and bodies of the old one; tests assert the body count returns to zero.

## Rendering strategy

- Static environment meshes have frozen world matrices; repeated details (wall ribs, ceiling lights) are GPU instances of one source mesh.
- Every sandbox object is an instance of a unit-sized source mesh per (shape, colour), scaled to size.
- One shadow-casting directional light (PCF). Reflections come from a cube map rendered once from the static environment.
- Quality presets (low / medium / high) control render scale (relative to the display's physical pixels, with a height cap), shadow resolution, MSAA, bloom and glow. Dynamic resolution lowers the render scale by up to 40 % when the frame rate stays under 48 FPS and raises it again when there is headroom.
- Objects smaller than 0.004 m^3 do not cast shadows.

## Babylon 9 notes

Babylon 9 splits modules into pure and side-effect variants. These side-effect imports are required and easy to miss: `Physics/joinedPhysicsEngineComponent` (adds `scene.enablePhysics`), `Meshes/instancedMesh` (adds `createInstance`), `Lights/Shadows/shadowGeneratorSceneComponent`, `PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent`.
