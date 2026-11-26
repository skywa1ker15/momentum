# Development log

## 2026-11-26 - Assessment fixes

An audit of the Phase 6 build found 21 problems (3 high, 8 medium, 10 low). This entry records what was done about each.

### Fixed
- **H1 Fixed-step physics.** The frame loop now takes fixed 1/60 s steps (up to 4 per frame) with render interpolation. Real-time pace holds down to 15 FPS (10 FPS now yields 0.67 s of simulation per second instead of 0.33 s) and the same scene gives identical results from 15 to 240 FPS.
- **H2 Throwing.** Throws aim for 16 m/s, capped at 2,500 N s for heavy objects. A 1.1 kg chip leaves at 16 m/s instead of 2,381 m/s.
- **M1** The control guide opens above the menu. **M2** Esc in edit mode opens the menu; Esc also closes the guide. **M3** Tab moves keyboard focus in the menu and inside panels; in edit mode it returns to the lab only when no panel control has focus.
- **M4 / M5 Spawn placement.** Objects are placed against the first surface in the way, backed off along its normal, kept clear of the player's capsule, and refused ("No room to spawn here") when nothing fits.
- **M6** Overwriting and deleting a save slot need a second click. Reset, environment loads and save loads can be undone with Z (Z again redoes).
- **M7** A loading screen with status text shows until the lab is ready.
- **L1** Save values are clamped (position, speed, spin, field strength and reach, water size and density; a zero rotation becomes identity). **L2** Objects leaving the world in any direction are removed. **L10** Saves store where the player stood, the view direction and the tool.
- **L3** The getting-started panel sits above the hotbar. **L4** The inspector collapses to its header in play mode until something is selected; U hides the interface. **L5** Minimum text size raised to about 12 px and secondary text lightened. **L6** Camera shake has a setting and defaults to off when the system asks for reduced motion. **L7** Presets are defined in physical pixels with a height cap. **L8** Touch-only devices get a notice.
- **Performance.** Dynamic resolution (on by default, can be switched off); High preset reduced from 4x to 2x MSAA and capped at 1440 rendered lines; tiny debris no longer casts shadows; contact handling no longer allocates per contact.
- **Engineering.** Biome linter; GitHub Actions workflow running lint, type check, tests and build; the browser smoke test now lives in the repository (`npm run e2e`, 23 checks); `App.ts` split (controls and menu wiring moved out).
- **Found while fixing:** the Gravity Laboratory shattered most of its own props within two seconds (57 fractures) because the emitter slammed breakable materials together. The earlier slow test browser had hidden it. Props near the emitter are now rubber, steel and elastic, and a test asserts that no environment except the arena breaks its own props.

### Partly done
- **H3 Frame rate on the target laptop** is still unmeasured. The presets and dynamic resolution are estimates until someone runs it on the MSI Thin 15.
- **M8 WebGPU** can now be chosen in Settings (with automatic fallback and reset on failure), but it is not the default because it has never been verified on real hardware.

### Not done
- **L9** Nobody has listened to the sound.
- Object pooling for fragments. The bundle is still one 1.65 MB chunk (splitting it by hand nearly doubled the download, so it was reverted).
- `typescript-eslint` does not support TypeScript 7 yet, so the linter is Biome rather than ESLint.

### Tested
- `npm run check`: lint clean, type check clean, 93 tests passing (9 new), build succeeds.
- `npm run e2e`: 23 checks passing in headless Chrome with real input, run twice.
- The earlier phase scenarios were rerun; two needed their scripts updated because the simulation now runs twice as fast in the 3 FPS test browser.

## 2026-11-26 - Phase 6: UI and experience

### Implemented
- **Menu.** Replaces the start screen and doubles as the pause menu (Esc). Tabs: Laboratory (enter / resume), Environments (four cards), Experiments, Settings. The simulation and player are frozen while it is open.
- **Save and load.** Three browser-storage slots plus export to and import from a JSON file. A save holds objects (shape, size, material, pose, velocities, all properties, fragment generation), joints (including joints to the room, motor speeds and spring rest lengths), gravity fields, water volumes, world gravity and destruction level. Input is validated field by field; invalid data is rejected with a reason and nothing changes. Anything that cannot be restored is counted and reported.
- **Settings.** Graphics quality, mouse sensitivity, field of view, invert vertical look, sound volume; sanitised and stored in the browser; the earlier quality setting is carried over.
- **Construction Zone.** Fourth environment: motorised turntable, seesaw on a hinge, Newton's cradle (five steel balls on planar hinges), a platform on a slider and spring, and a depot of beams, planks and wheels.
- **Tool strip** above the hotbar showing all five tools; Shift+Q cycles backwards.
- **Getting-started checklist**: six steps that tick themselves off; can be shown again from Settings.
- **Sound.** Synthesised with Web Audio (no audio files): impact thuds shaped by hardness and mass, fracture cracks, explosions, splashes, interface clicks; distance attenuation and rate limiting.

### Tested
- `npm test`: 84 tests passing (6 new), against real Havok. New checks: a full round trip through JSON of objects, properties, velocities, hinge / motor / spring joints (one to the room), fields and water, after which the original and restored worlds evolve alike; a whole environment's starting experiment survives save and load with nothing skipped; twelve kinds of invalid save are rejected with the right reason and out-of-range world values are clamped; a joint to a missing room collider is skipped and reported; settings sanitising; the Construction Zone machines (turntable holds 1.2 rad/s, the cradle passes its swing to the far ball and stays planar, the platform is pushed down and guided vertically then settles, the seesaw tips).
- Production build in headless Chrome with real input: all four menu tabs; settings changed and still in effect after a page reload; onboarding steps ticking off through real key and mouse input; save to a slot, switch to the Construction Zone, load the slot and get the identical state back (environment, counts, gravity); importing a file with an unknown environment and a non-JSON file gives the right error; importing a valid file loads it; sound engine running and producing sounds. All Phase 1 to 5 scenarios rerun. No console errors or warnings.

### Bugs found and fixed during the phase
- Newton's cradle did nothing: the raised ball started inside a gantry post. Gantry widened.
- The sprung platform barely moved: a 9 t steel plate with a spring tuned to its own mass shrugged off the falling crate. Plate changed to plastic with a steel block dropped on it.
- The seesaw's steel ball rolled off before the player arrived; replaced with a block.
- The scene settled (and made noise) behind the start menu, so the opening motion was missed; the simulation now waits until the player enters and freezes whenever the menu is open.

### Known limitations
- Sound was verified only as "the engine runs and schedules sounds"; nobody has listened to it. Levels and timbre may need tuning by ear.
- Export was verified by its status message and by importing the same data; the downloaded file itself was not inspected in the headless browser.
- Saves do not include the player's position, held object, selected tool or active blasts and particles.
- Loading a save made in a future version is refused; there is no migration path yet (version 1 is the first).
- Multi-select, snapping and non-vertical world gravity are not implemented (see roadmap).
- WebGPU and frame rate on the target laptop remain unverified (see Phase 1 entry).

## 2026-11-26 - Phase 5: Advanced simulation

### Implemented
- **Explosions (simulated).** Blast tool: detonate a small, medium or large charge where you aim. A pressure front expands at 120 m/s and each body is hit when the front reaches it, with an impulse proportional to the area it presents and falling with distance; walls block the blast and other objects shield partly. Blasts feed the destruction system.
- **Water (simulated).** Box-shaped water volumes apply Archimedes buoyancy and drag through the engine, so wood, ice and elastic float at a level set by their density while steel, glass, concrete and plastic sink. Placed with the Field tool; the Test Chamber starts with a tank.
- **Deformation.** Visual: rubber, elastic and plastic squash along the impact direction in proportion to the measured impact and spring back; only the drawn mesh changes. Simulated: a soft body built from eight elastic spheres and 28 springs, which compresses under load and recovers.
- **Mechanical.** Slider joints (one axis, 1.5 m travel either way) and spring joints (tuned to 2.5 Hz on the lighter body, running between the two points clicked); torque mode for the Force tool (V).
- **Particles (visual).** Dust on fracture in the material's colour, sparks on hard impacts, fire and smoke for blasts, splashes on water entry. Systems are pooled per kind; the particle budget follows graphics quality and is cut when the frame rate drops. Blasts also draw a shock ring and shake the camera.
- HUD: Blast tool, particle counter, updated control guide. README now has a simulated-versus-visual table.

### Tested
- `npm test`: 78 tests passing (14 new), against real Havok. New checks: blast impulse equals i(r) x A at two distances and arrives with the front; wood is thrown 13x faster than steel of the same shape (density ratio); a pillar blocks a blast, an object shields partly, nothing moves beyond the radius; blasts break glass but not steel; concurrent blast limit; wood and ice float with submerged fraction equal to density / 1000; steel sinks, slowed by drag; one splash event per entry; volume picking and limit; spring frequency within 5 % of 2.5 Hz at 60 and 240 Hz steps, with amplitude and decay bounds; slider keeps off-axis position and orientation and respects its travel; link tool creates a spring between the two clicked points and it survives a material change; torque spins a sphere at tau / I without moving it; visual squash flattens an elastic ball, preserves mesh volume, restores the exact scale, and leaves the collider and mass untouched; the starting tank and soft lattice behave as described.
- Production build in headless Chrome: torque mode, placing and removing a water volume, spring link kind, a large blast at the crate pyramid (crates thrown and fractured, dust drawn), reset. Phase 1 to 4 scenarios rerun. No console errors or warnings.

### Bugs and findings during the phase
- Springs came out overdamped: Havok's damping parameter is not in N s/m. Measured its behaviour, added a calibrated scale factor, and test the result at two step sizes.
- Havok damps very slow bodies before putting them to sleep, so a tiny blast impulse decays within a few steps; tests measure right after the front arrives.
- My first scripted blast hit nothing: the aim passed through the 2 cm gap between two crates and detonated behind the pyramid. The system was right; the script was wrong.

### Known limitations
- Water does not flow, pour or slosh; it is a fixed volume with buoyancy and drag. The submerged fraction is estimated from the object's vertical extent.
- Explosions and water do not affect the player.
- Blast impulses act at the centre of mass, so a blast does not spin objects by itself.
- The soft lattice is the only simulated deformable; squash on single objects is visual.
- Particles keep the default update rate tied to time scale but are not collision-aware (they pass through geometry).
- Hold-T rotation, the splash, sparks and squash visuals were exercised only through their logic tests or event counters, not judged by eye at real frame rates.
- Deferred: snapping, non-vertical world gravity, multi-select, prefabricated machines.
- WebGPU and frame rate on the target laptop remain unverified (see Phase 1 entry).

## 2026-11-26 - Phase 4: Destruction

### Implemented
- **Impact measurement.** Per body and per step, contact impulses from Havok are summed as vectors; dividing by mass gives the velocity change the contacts imposed.
- **Fracture.** Each material has an impact strength (`breakSpeed`, m/s): glass 9, ice 10, concrete 12, wood 18, plastic 20, steel 120; rubber and elastic are unbreakable. The threshold drops by 20 % when the other body is harder and rises by 25 % when it is softer. An object that exceeds it is replaced by 2 to 16 fragments cut around the impact point; the fragments tile its volume, keep its total mass, start with its rigid-body velocity, and are ordinary objects (grab, inspect, break again up to two generations deep).
- **Structural bonds.** Weld joints are breakable: they fail at half the weaker material's impact strength, releasing pieces of a structure without breaking the pieces themselves.
- **Debris management.** Object limit raised to 350. A fracture that would exceed it removes the oldest debris first, then settles for fewer pieces.
- **Intensity.** Off / Low / Normal / High (B key or inspector) scales all thresholds and the number of fragments.
- **Force-tool strikes** count as impacts, so a hard strike can shatter an object.
- **Destruction Arena.** A 40-brick concrete wall bonded by 67 welds, a 5.5 t steel wrecking ball on a ball joint that is released into the wall when the experiment starts, three glass panes welded to the floor, ice, wood and plastic stacks, and steel and rubber balls to throw.
- HUD: debris and break counters; material info shows the impact strength; pendulum joints get a visible cable.

### Tested
- `npm test`: 64 tests passing (16 new), against real Havok. New checks: box fragments tile the parent exactly with no overlaps and respect the minimum edge; seeded determinism; smaller pieces near the impact; round-shape fragments lie inside the shape; glass survives a 0.6 m drop and shatters from 7 m with mass conserved in both our records and the engine; fragment momentum equals the parent's; rubber, elastic and steel survive a 10 m drop; the same 4 m concrete drop does nothing at Off and Normal and breaks at High; thresholds for hardness, size, generation and intensity; the object limit holds under fracture; force-tool strike breaks glass but not rubber; measured impact equals the actual velocity change for floor and body-body collisions; a 7-block stack with heavy blocks on light ones at 1/30 s steps registers under 1 m/s and nothing breaks; a weld holds at 0.8x and fails at 1.2x its strength; unbreakable welds; in the arena the wall stands until the ball arrives, then more than 5 bonds break and bricks fracture while the ball stays on its joint.
- Production build in headless Chrome: arena loads, the ball breaks the wall (22 bonds broken, 4 bricks fractured, 22 debris in the run recorded), intensity key and inspector buttons, reset restores the wall, switching back to the Test Chamber returns the body count to baseline. Phase 1 to 3 scenarios rerun. No console errors or warnings.

### Bugs found and fixed during the phase
- **Resting stacks shattered on their own in the browser.** The first version summed contact impulse magnitudes. A light block under heavy ones receives large opposing impulses every step, and more so at the 1/30 s steps the browser takes on slow frames, so the starting tower broke with no impact at all. The headless tests ran at 1/60 s and missed it; the browser run caught it. Fixed by summing impulses as vectors, with a regression test at 1/30 s.
- A box landing flat reports several contact points; judging each separately under-read the impact. Covered by the same per-step sum.
- The arena wall silently lost 6 bonds to the 64-joint limit; limit raised to 160.
- An existing weld test started failing because dropped wooden welds now legitimately break; it now uses an unbreakable material.

### Known limitations
- Fragments are boxes. Spheres and cylinders break into box-shaped pieces that only approximate their volume (mass is still conserved).
- Crushing is not modelled: only impacts (net velocity change) break things, not slow squeezing under load.
- The outward scatter of fragments is a model, not an engine result; it is momentum-neutral but adds some kinetic energy.
- No dust, sparks or sound on fracture yet (Phase 5 and 6).
- Fracture throughput and frame rate with hundreds of fragments are unmeasured on the target laptop.
- I could not get the scripted in-browser throw to break glass (the scripted throw fell short); glass breaking from impacts is covered by the headless drop and strike tests instead.
- WebGPU remains unverified (see Phase 1 entry).

## 2026-11-26 - Phase 3: Advanced interactions

### Implemented
- **Materials.** Steel, wood, concrete, glass, rubber, plastic, ice, elastic, with real densities (kg/m^3) and representative friction and restitution, plus hardness and durability. M / N choose the material for new objects; the inspector shows and changes the material of the selected object (mass follows density). Starting props now use mixed materials.
- **Gravity fields.** Attractors and repulsors (inverse-square, a = mu / r^2, capped below 0.75 m, limited reach) and box-shaped gravity zones that replace world gravity inside them. Forces go through the engine each step. Field tool: place, remove, change type and strength; at most 8 fields.
- **Joints.** Weld, hinge, ball and motor, between two objects or between an object and the room. Link tool: click the first object, then the second body; the joint sits at the second point clicked and hinge / motor axes follow the surface normal there. Motor speed (-20 to 20 rad/s) is set in the inspector. Joints survive a material change. At most 64 joints.
- **Turning held objects.** Hold T while carrying to rotate with the mouse.
- **Gravity Laboratory.** Second environment: tall chamber with a central emitter (attractor) that lifts nearby objects, an upward-gravity column, and an observation gallery. F4 or the inspector switches environment; everything from the old environment is disposed.
- HUD: material chip, four-tool chip with per-tool detail, environment name and selector, expanded control guide.

### Tested
- `npm test`: 48 tests passing (20 new), against real Havok. New checks: every material writes density x volume, friction and restitution to the engine; ice slides more than 3x further than rubber; elastic rebounds more than 2.5x higher than concrete; in-place material change keeps identity, transform, velocity and body count; attractor acceleration matches mu / r^2 within 10 %; repulsor pushes away; no effect outside the radius; fields wake sleeping bodies; a zone gives +g inside and -g outside; field limit and ray picking; weld keeps distance and orientation; hinge keeps the pivot distance and stays in its plane; ball joint swings in both directions; motor reaches its target speed and follows a change; joints survive a material change and die with their object; both environments build, simulate and dispose with zero bodies and no leftover meshes; Gravity Lab emitter lifts at least 8 of 10 nearby props, the column lifts all four balls, distant crates stay put; player walks up the gallery ramp; field tool and link tool behaviour; held-object rotation rate.
- Production build in headless Chrome with real input: material cycling, placing three field types, removing a field by aiming, hinge between two boxes, motor to the floor, selecting, edit mode, steel swatch (mass 518 kg to 1696 kg, joints kept), switching to the Gravity Laboratory and back three times (body count returns to its baseline of 45). Phase 1 and 2 scenarios rerun. No console errors or warnings.

### Bugs found and fixed during the phase
- Gravity Lab emitter was too weak and too high to lift the props (caught by the test); repositioned and strengthened.
- Changing material silently dropped the object's joints; joints are now recreated.
- Momentum displayed as "kkg m/s"; now shown in N s.
- Joint and field markers bloomed into large glowing blobs; they now use colours below the bloom threshold.

### Known limitations
- Durability and hardness are displayed but have no effect until the destruction system (Phase 4).
- Zone gravity is axis-aligned and fixed at 9.81 m/s^2 when placed with the tool; field positions cannot be moved after placing (remove and place again).
- Hinge / motor axis comes from the surface normal at the second click; there is no manual axis control.
- Motor torque is capped at 20 kN m; very heavy assemblies will not reach the target speed.
- Turning held objects (T) was verified by the headless test only: the headless browser does not report mouse movement under pointer lock.
- The player is not affected by fields or zones.
- Deferred: multi-select, torque tool, slider and spring joints, snapping, non-vertical world gravity.
- WebGPU and performance on the target laptop remain unverified (see Phase 1 entry).

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
