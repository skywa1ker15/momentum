# Roadmap

Each phase ends with: typecheck, automated tests, a run of the production build in a browser, a bug pass, a performance note, and a dev-log entry. A phase is only pushed and deployed once that is done.

## Phase 1 - Foundation (complete)
Project architecture, rendering engine, Test Chamber 01, first-person player, camera, basic physics interactions (spawn, grab, carry, throw, push, delete), pause / time scale / reset, HUD and control guide, quality presets.

## Phase 2 - Physics systems (complete)
Selection and inspector with live engine readouts (speed, velocity, momentum, kinetic energy with rotational part, angular speed, height, contact impulses); real-time editing of mass, friction, restitution, damping, gravity factor and static / dynamic; Force tool (continuous force and impulse at a point); duplication; tool switching; edit mode; velocity vector overlay. Global gravity control (strength, reverse, zero, presets) was brought forward from Phase 3.

Deferred from the original Phase 2 list: multi-select and a dedicated torque tool (off-centre forces already produce torque). Both move to Phase 3 with the construction tools.

## Phase 3 - Advanced interactions (complete)
Eight material presets; gravity fields (attractor, repulsor, directional zone) with a placement tool; joints (weld, hinge, ball, motor) with a two-click link tool and motor speed control; turning held objects; second environment (Gravity Laboratory) and environment switching.

Deferred: multi-select, a dedicated torque tool, slider and spring joints, snapping, and arbitrary (non-vertical) world gravity direction. These are picked up in Phase 5 with mechanical machines, except multi-select which moves to Phase 6 (UI).

## Phase 4 - Destruction (complete)
Impact-based fracture driven by material impact strength and hardness; fragments that conserve mass and momentum and can break again; breakable welded bonds for structures; debris budget; four intensity levels; Destruction Arena with a bonded brick wall, glass panes and a wrecking ball.

Simplifications, to revisit in Phase 5: fragments are box-shaped (spheres and cylinders break into box pieces approximating their volume), and there is no dust or spark effect yet.

## Phase 5 - Advanced simulation (complete)
Pooled particle effects with an adaptive budget; explosions as an expanding pressure front with a Blast tool; water volumes with buoyancy and drag; visual squash of soft materials; a simulated soft body (spring lattice); slider and spring joints; torque mode.

Not done, and why: free-flowing water (a particle fluid) was replaced by buoyancy volumes, which are cheaper and physically checkable; fragments are still box-shaped; no prefabricated gears or pistons; snapping and non-vertical world gravity remain open. These are candidates for Phase 6 where they fit the construction UI, otherwise they stay documented as limitations.

## Phase 6 - UI and experience
- Multi-select. Full tool wheel / panels, settings (graphics, controls, sensitivity), environment selector, save / load experiments (JSON, local storage + file export), onboarding, audio.
- Construction Zone and Observation environments finished.

## Phase 7 - Optimisation and release
- Profiling on the target machine (MSI Thin 15: Core i7, RTX 2050, 16 GB), object pooling, LOD, sleeping tuning, adaptive quality, WebGPU as default once verified, final production build.

## Target-hardware budget (working numbers, to be confirmed by measurement in Phase 7)
- 60 FPS at 1080p on the medium preset with up to 250 dynamic bodies.
- Hard limits enforced in `config.ts`; raising them requires a measured justification.
