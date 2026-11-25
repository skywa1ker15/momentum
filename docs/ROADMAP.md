# Roadmap

Each phase ends with: typecheck, automated tests, a run of the production build in a browser, a bug pass, a performance note, and a dev-log entry. A phase is only pushed and deployed once that is done.

## Phase 1 - Foundation (complete)
Project architecture, rendering engine, Test Chamber 01, first-person player, camera, basic physics interactions (spawn, grab, carry, throw, push, delete), pause / time scale / reset, HUD and control guide, quality presets.

## Phase 2 - Physics systems (complete)
Selection and inspector with live engine readouts (speed, velocity, momentum, kinetic energy with rotational part, angular speed, height, contact impulses); real-time editing of mass, friction, restitution, damping, gravity factor and static / dynamic; Force tool (continuous force and impulse at a point); duplication; tool switching; edit mode; velocity vector overlay. Global gravity control (strength, reverse, zero, presets) was brought forward from Phase 3.

Deferred from the original Phase 2 list: multi-select and a dedicated torque tool (off-centre forces already produce torque). Both move to Phase 3 with the construction tools.

## Phase 3 - Advanced interactions
- Material laboratory: steel, wood, concrete, glass, rubber, plastic, ice, elastic - density, friction, restitution, hardness, durability; mass derived from density and volume.
- Gravity laboratory: arbitrary gravity direction; local attract / repel fields (inverse-square, clamped); directional gravity zones. (Vertical strength, reverse and zero-g already exist.)
- Multi-select, torque tool.
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
