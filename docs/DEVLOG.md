# Development log

## 2026-11-25 - Phase 2: Physics systems

### Implemented
- **Selection and inspector.** E selects the targeted (or held) object. The inspector shows values read from Havok every 100 ms: speed, velocity vector, momentum, kinetic energy and its rotational part, angular speed, height, last and peak contact impulse. The selected object gets a bounding-box outline and a velocity arrow.
- **Property editing.** Mass (0.1 kg to 20 t, logarithmic), friction, restitution, linear and angular damping, gravity factor, static / dynamic. Each maps to one Havok setting and is clamped in `ObjectFactory.setProps`.
- **Edit mode (Tab).** Frees the mouse without leaving the lab; the simulation keeps running. Tab or a click on the viewport returns to play.
- **World gravity.** Vertical gravity from -25 to +25 m/s^2 with Earth / Moon / Zero / Reverse presets; sleeping bodies are woken so they respond. Reset restores Earth gravity.
- **Force tool (Q).** Hold LMB for a continuous force at the exact point aimed at (50 N to 25 kN, scroll to change); RMB strikes with an impulse equal to that force acting for 0.25 s. Off-centre application produces torque through the engine.
- **Duplicate (C)** copies shape, size, colour and all properties. **Delete (X)** now also works on static objects.
- HUD: tool chip with the force setting, compact inspector, edit-mode banner, updated control guide, masses shown in kg or tonnes.

### Tested
- `npm test`: 28 tests passing (15 from Phase 1 plus 13 new), all against real Havok. New checks include: unit inertia of a sphere (2/5 r^2) and cube (a^2/6); friction changing slide distance; restitution changing rebound height; gravity factor 0 and -1; static toggle; damping; gravity change waking sleeping bodies; duplication; momentum = m v; kinetic energy gained in a fall = m g h within 4 %; rolling sphere rotational energy = 2/5 of translational; constant force giving v = F t / m within 3 %; centred vs off-centre impulse (same linear momentum, spin only when off-centre); contact impulse on landing >= m v.
- Production build in headless Chrome (WebGL 2, software rendering) with real keyboard and mouse events: select, enter edit mode, drag the mass slider (engine mass confirmed changed), gravity preset, duplicate button, return to play with pointer lock, switch tool, change force level, hold force, duplicate and reselect by key, reset. Phase 1 scenarios rerun as regression. No console errors or warnings.

### Bugs found and fixed during the phase
- A first attempt to "correct" inertia when editing mass was wrong: Havok stores inertia per unit mass, so the tensor already follows mass. The energy tests exposed this; the code now writes mass only and `ObjectState` multiplies by mass.
- Mass over 1000 kg was displayed as "kkg".
- The inspector did not fit a 720 px high window; rows were made single-line.

### Known limitations
- The selection outline is a one-pixel bounding box and is subtle on bright objects.
- The force arrow points along the view direction, so from the player's eye it is seen almost end-on.
- Property sliders need edit mode (Tab); there is no in-world picking with the free cursor yet.
- Multi-select and a dedicated torque tool are deferred to Phase 3.
- WebGPU and performance on the target laptop remain unverified (see Phase 1 entry).

## 2026-11-25 - Phase 1: Foundation

### Starting point
The repository `skywa1ker15/momentum` was empty and no Vercel project existed. The project was created from scratch.

### Implemented
- Vite + TypeScript (strict) project, Babylon.js 9.37, Havok 1.3, Vitest. No other runtime dependencies.
- Engine creation: WebGL 2 by default, WebGPU via `?renderer=webgpu` with automatic fallback; start-up error screen; GPU device-loss screen.
- `PhysicsWorld`: Havok world with manual stepping, step clamp (1/30 s), pause, time scale (0.1x to 2x), raycasts.
- Test Chamber 01 (36 x 48 x 11 m): floor, walls, ceiling, four pillars, inclined plane, observation deck with access ramp and glass balustrade - all with static colliders - plus instanced wall ribs and ceiling lights, light strips and a test pad.
- Starting experiment: 10-crate pyramid, 7-block tower, three spheres at the top of the inclined plane, four cylinders.
- First-person player on Havok's character controller: walk, sprint, jump, slopes, pushes dynamic bodies. Moves in real time even while the simulation is paused or slowed.
- Objects: box / sphere / cylinder, mass = density x volume (450 kg/m^3), GPU-instanced, 250-object limit, out-of-bounds cull.
- Interaction: crosshair targeting with kind + mass readout, grab / carry (velocity-driven, stays dynamic), scroll to change hold distance, throw / push by impulse (1400 N s), delete.
- Simulation controls: pause, slower / faster, reset experiment.
- Visuals: PBR materials, one shadow-casting key light (PCF), fill + two spot lights, ACES tone mapping, bloom, FXAA, glow, exponential fog, reflection cube map baked from the environment. Three quality presets, persisted.
- HUD: dark glass panels - brand, simulation state, telemetry (FPS, frame time, objects, physics bodies, renderer, quality), hotbar, toast, control guide, start screen.

### Tested
- `npm test`: 15 tests, all passing, run against the real Havok WASM under Babylon's NullEngine. Covered: free fall against g t^2 / 2, coming to rest, pause, time scale, step clamp, mass, wall containment of a 40 m/s projectile, spheres rolling down the incline, pyramid stability, object limit, body cleanup, out-of-bounds cull, player settling, walk speed, wall blocking, jump height, walking up the ramp onto the deck, pushing a crate, grab targeting, carrying, throw speed = impulse / mass, deleting a held object.
- `npm run build`: typecheck clean, production build succeeds (main chunk about 1.26 MB, 303 kB gzipped, plus Havok WASM).
- Production build run in headless Chrome (WebGL 2, software rendering) with real input events: pointer lock, WASD, spawn, shape select, grab, scroll, throw, delete, pause, time scale, jump, control guide, quality cycling, reset, leaving pointer lock. No console errors or warnings. Screenshots reviewed for lighting, shadows and HUD layout.

### Bugs found and fixed during the phase
- `scene.enablePhysics` silently did nothing: Babylon 9 needs the `joinedPhysicsEngineComponent` side-effect import.
- `createInstance` threw: `Meshes/instancedMesh` side-effect import was missing.
- Jump was cancelled the frame after launch because the capsule was still within ground-contact tolerance; added a short air lock.
- Held objects flew away: the carry code read a stale world matrix; it now reads the body's centre from the engine.
- Floor texture did not tile (DynamicTexture defaults to clamp addressing).
- Scene was too dark; lighting and material values rebalanced.

### Known limitations
- **WebGPU is not verified.** In the build environment (headless Chrome with a software adapter) the WebGPU device was lost within seconds and the frame was black; this looks like an environment limitation but could not be confirmed either way. WebGPU is therefore opt-in (`?renderer=webgpu`) and WebGL 2 is the default. To be verified on the target laptop, then made default.
- **Performance on the target laptop has not been measured.** The only browser available during development used software rendering (2 to 5 FPS), which says nothing about an RTX 2050. FPS and frame time are shown in the HUD for measuring on real hardware.
- The player uses standard gravity regardless of world gravity (deliberate for now; revisit with the gravity laboratory).
- The character controller rests about 0.07 to 0.1 m above surfaces (its contact tolerance).
- While the simulation is paused the player can still walk into objects; pushes applied then take effect on resume.
- One generic solid material. Real materials arrive in Phase 3.
- Grab drives velocity rather than applying a force, so a held object does not sag under its weight; heavy objects lag instead.
- Not yet implemented (later phases): inspection panel and property editing, duplication, tool switching, save / load, additional environments, object pooling, LOD.
- Browser checks were run with an ad-hoc headless-Chrome script that is not part of the repository; only the Vitest suite is automated in-repo.
