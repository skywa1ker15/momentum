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

## Phase 6 - UI and experience (complete)
Main / pause menu with environment cards, experiment save slots with file export and import, and settings (quality, sensitivity, field of view, invert look, volume); tool strip; getting-started checklist; synthesised sound; Construction Zone environment with four working machines.

Dropped from the plan, with reasons: multi-select (every tool acts on one aimed object; it would need a second interaction model for little gain), snapping and non-vertical world gravity (not requested in the brief; left as documented limitations).

## Assessment fixes (complete)
An audit after Phase 6 found 21 problems; 18 are fixed (see the dev log). Open: frame rate and WebGPU on the target laptop are still unmeasured, and nobody has listened to the sound.

## Phase 7 - Optimisation and release (complete)
A benchmark (Settings, or F9) runs a fixed four-stage sequence and reports average and 1% low frame rates, suggests a preset and offers the result as text to copy. Object and body pooling: removing an object parks its mesh and body, and the next spawn reuses the pair with a fresh collision shape, measured at 0.061 ms against 0.166 ms, which takes a 40-fragment break from about 6.6 ms to 2.8 ms. Curved shapes have two levels of detail; shadows redraw every other frame on the low preset; film grain and lens fringing are off there too. On a first visit the laboratory watches six seconds of play and drops a preset if the machine cannot hold it. Every start checks that the renderer is really drawing by rendering once into an off-screen target and reading it: WebGPU that comes back blank falls back to WebGL 2 by itself, and WebGPU that renders is recorded as verified on that machine.

Measured and not changed: Havok already sleeps resting bodies well (a 200-body step costs 2.47 ms while they settle and 0.10 ms once they have), so there was nothing worth tuning there.

Not done: frame rates on the target laptop. Everything above was measured either in Node with real Havok or in a software-rendered browser at about 8 FPS, so the presets remain estimates until the benchmark is run on the machine itself.

## Target-hardware budget (working numbers, still to be confirmed on the target laptop)
- 60 FPS at 1080p on the medium preset with up to 250 dynamic bodies.
- Hard limits enforced in `config.ts`; raising them requires a measured justification.
- The benchmark judges against this: it suggests a lower preset below 45 FPS average or 28 FPS at the 1% low, and a higher one above 85 FPS average with the 1% low above 55.
