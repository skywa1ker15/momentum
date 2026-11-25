# Roadmap

Each phase ends with: typecheck, automated tests, a run of the production build in a browser, a bug pass, a performance note, and a dev-log entry. A phase is only pushed and deployed once that is done.

## Phase 1 - Foundation (complete)
Project architecture, rendering engine, Test Chamber 01, first-person player, camera, basic physics interactions (spawn, grab, carry, throw, push, delete), pause / time scale / reset, HUD and control guide, quality presets.

## Phase 2 - Physics systems
- Inspector panel: live mass, velocity, speed, momentum (p = m v), kinetic energy, angular velocity, read from the engine.
- Edit properties in real time: mass, friction, restitution, linear / angular damping, gravity factor, motion type (dynamic / static).
- Force and impulse tools (continuous force, point impulse, torque) with a visual vector overlay.
- Collision events: contact impulse readout, used later by destruction.
- Selection model (select, multi-select, duplicate) and tool switching.
- Exit: every displayed quantity is verified against engine values in tests.

## Phase 3 - Advanced interactions
- Material laboratory: steel, wood, concrete, glass, rubber, plastic, ice, elastic - density, friction, restitution, hardness, durability; mass derived from density and volume.
- Gravity laboratory: global gravity vector and strength, reverse, zero-g; local attract / repel fields (inverse-square, clamped); directional gravity zones.
- Construction: precise move / rotate, snap, fixed / hinge / ball / slider / spring constraints, motors on hinges.
- Second environment: Gravity Laboratory. Environment switching.

## Phase 4 - Destruction
- Pre-fractured breakable objects (Voronoi-style convex pieces) with structural links between pieces.
- Links break from contact impulse versus material durability; pieces become independent rigid bodies; debris budget and pooling.
- Adjustable destruction intensity. Third environment: Destruction Arena.

## Phase 5 - Advanced simulation
- Particle systems (visual): sparks, dust, smoke-like volumes, adaptive counts.
- Explosions: radial impulse on bodies (simulated) plus pressure-wave and flash (visual).
- Water: particle-based fluid within a bounded budget; clearly labelled simulated vs visual in the UI.
- Deformation: soft / elastic bodies via constraint lattices; dent-style visual deformation for hard materials.
- Mechanical machines: gears, pistons, conveyor motors built from Phase 3 constraints.

## Phase 6 - UI and experience
- Full tool wheel / panels, settings (graphics, controls, sensitivity), environment selector, save / load experiments (JSON, local storage + file export), onboarding, audio.
- Construction Zone and Observation environments finished.

## Phase 7 - Optimisation and release
- Profiling on the target machine (MSI Thin 15: Core i7, RTX 2050, 16 GB), object pooling, LOD, sleeping tuning, adaptive quality, WebGPU as default once verified, final production build.

## Target-hardware budget (working numbers, to be confirmed by measurement in Phase 7)
- 60 FPS at 1080p on the medium preset with up to 250 dynamic bodies.
- Hard limits enforced in `config.ts`; raising them requires a measured justification.
