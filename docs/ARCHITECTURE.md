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
    config.ts             Tuning constants, limits, graphics quality presets
  render/                 VISUAL ONLY
    EngineFactory.ts      WebGL 2 / WebGPU engine creation with fallback
    MaterialLibrary.ts    Shared PBR materials, procedural textures
    Lighting.ts           Key/fill/spot lights, shadow generator
    RenderPipeline.ts     Tone mapping, bloom, FXAA/MSAA, glow, reflection probe, selection box
    VectorOverlay.ts      Velocity / force arrows drawn from engine values
  physics/
    PhysicsWorld.ts       Havok world: stepping, pause, time scale, gravity, raycast
    loadHavok.ts          Browser WASM loader
  environments/
    Environment.ts        LabEnvironment interface
    TestChamber.ts        Test Chamber 01: static geometry + colliders, starting props
  objects/
    ObjectFactory.ts      Spawn / remove / duplicate objects, editable PhysicalProps, limits, instancing
    ObjectState.ts        Engine readout: velocity, momentum, kinetic energy (linear + rotational)
  player/
    PlayerController.ts   Havok character controller + view angles
  input/
    InputManager.ts       Keyboard, mouse, pointer lock
  tools/
    GrabTool.ts           Hand tool: target, grab, carry, throw, push
    ForceTool.ts          Force tool: continuous force / impulse at a point on the body
    Selection.ts          Inspected object, contact-impulse tracking
  ui/
    Hud.ts, styles.css    DOM overlay (glass panels), control guide, start screen, modes
    Inspector.ts          Live readouts and property / gravity editors
    format.ts             SI formatting
tests/                    Vitest suites running real Havok headlessly
```

Planned modules (created when their phase starts, not before): `materials/` (physical material presets), `fields/` (gravity fields and zones), `construction/` (joints, hinges, motors), `destruction/` (fracture, structural links, debris), `effects/` (particles, fluid, smoke; visual vs simulated split), `persistence/` (save / load experiments), `ui/panels/` (inspector, settings, environment select).

## Frame loop (`App.tick`)

1. Read input; apply look.
2. `PlayerController.update(realDt)` - character moves in real time, independent of pause and time scale.
3. Camera follows the player.
4. Tools update their targets (hold point).
5. `PhysicsWorld.step(realDt)` - clamps the delta to 1/30 s, multiplies by time scale, skips when paused; `onBeforeStep` lets tools drive bodies.
6. Housekeeping (out-of-bounds cull), HUD update.
7. `scene.render()`, then input frame state is cleared.

## Data flow

- `ObjectFactory` raises `onSpawned` / `onRemoved`. Lighting registers shadow casters from these; `GrabTool` drops a held object if it is removed.
- A physics body maps back to its `SandboxObject` through `mesh.metadata.sandboxId`.
- An environment exposes `build()` (static world) and `populate()` (starting props). Reset = clear objects, `populate()` again, teleport the player.

## Interaction modes

- **menu** - start screen, pointer free.
- **play** - pointer locked; movement, tools and hotkeys active.
- **edit** - entered with Tab; pointer free, inspector editors active, simulation still running. Tab or a click on the viewport returns to play.

`App` owns the mode; `Hud.setMode` reflects it. Property edits flow `Inspector -> App -> ObjectFactory.setProps -> Havok`, and `ObjectFactory` clamps to `PROP_LIMITS`.

## Physics conventions

- Mass is written to the engine; Havok keeps the inertia tensor **per unit mass**, derived from the collision shape, so rotational inertia follows mass automatically. `ObjectState` multiplies by mass when computing rotational energy.
- Friction and restitution live on the shape material; damping, gravity factor and motion type on the body.
- Sleeping bodies do not react to gravity or property changes until woken; `ObjectFactory.wake` / `wakeAll` handle that.
- Collision callbacks are enabled only for the selected body.

## Rendering strategy

- Static environment meshes have frozen world matrices; repeated details (wall ribs, ceiling lights) are GPU instances of one source mesh.
- Every sandbox object is an instance of a unit-sized source mesh per (shape, colour), scaled to size.
- One shadow-casting directional light (PCF). Reflections come from a cube map rendered once from the static environment.
- Quality presets (low / medium / high) control pixel ratio, shadow resolution, MSAA, bloom and glow.

## Babylon 9 notes

Babylon 9 splits modules into pure and side-effect variants. These side-effect imports are required and easy to miss: `Physics/joinedPhysicsEngineComponent` (adds `scene.enablePhysics`), `Meshes/instancedMesh` (adds `createInstance`), `Lights/Shadows/shadowGeneratorSceneComponent`, `PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent`.
