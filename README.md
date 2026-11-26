# MOMENTUM

An advanced 3D physics sandbox set in an experimental laboratory. Built with Babylon.js, Havok Physics, TypeScript and Vite.

**Status:** Phases 1 to 6 of 7 complete. Remaining: Phase 7, optimisation and release. See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next and [docs/DEVLOG.md](docs/DEVLOG.md) for what was built and tested.

## Run

```bash
npm install
npm run dev        # development server
npm test           # headless physics tests (real Havok, no GPU needed)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run lint       # Biome linter
npm run e2e        # browser smoke test against a running preview (needs Chrome; see e2e/smoke.mjs)
npm run check      # lint + typecheck + tests + build (what CI runs)
```

## Controls

| Input | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Shift, Space | Sprint, jump |
| 1 2 3, then F | Choose shape, spawn it |
| M / N | Next / previous material (wood, steel, concrete, glass, rubber, plastic, ice, elastic) |
| E | Select / deselect the targeted object for inspection |
| C | Duplicate the selected or targeted object |
| X | Delete the targeted or held object |
| Q / Shift+Q | Next / previous tool: Hand, Force, Field, Link, Blast |
| Hand: hold LMB, scroll, hold T, RMB | Grab and carry, push / pull, turn with the mouse, throw or push |
| Force: hold LMB, RMB, scroll, V | Continuous force at the aimed point, impulse strike, change magnitude, switch force / torque |
| Field: LMB, RMB, scroll, V | Place attractor / repulsor / gravity zone / water volume, remove the one aimed at, change type, change strength |
| Link: LMB then LMB, RMB, scroll | Join an object to another object or the room, remove joints, choose weld / hinge / ball / motor / slider / spring |
| Blast: LMB, scroll | Detonate a charge where you aim, change charge size |
| F4 | Next environment (Test Chamber, Gravity Laboratory, Destruction Arena, Construction Zone) |
| Esc | Menu: environments, save / load experiments, settings. The simulation is frozen while it is open |
| B | Destruction intensity: off, low, normal, high |
| Tab | Edit mode: frees the mouse to edit properties and world gravity |
| P, [ ] | Pause, slower / faster simulation |
| R | Reset experiment |
| Z | Undo the last reset, environment load or save load |
| U | Hide / show the interface |
| H | Control guide |
| F2 | Cycle graphics quality |

## Saving experiments

The menu's Experiments tab has three save slots (stored in the browser) plus export to and import from a `.json` file. A save holds every object, joint, field and water volume with positions, velocities and properties, the gravity setting and the destruction level. Files are validated on import; an invalid file is rejected with a reason and changes nothing.

## Simulated vs visual

| Simulated (acts on the physics engine) | Visual only |
| --- | --- |
| Rigid bodies, collisions, friction, restitution | Dust, sparks, fire, smoke, splashes (particles) |
| Gravity fields and zones | Shock ring of a blast, camera shake |
| Joints, motors, springs, sliders; the soft spring lattice | Squash of rubber / elastic / plastic on impact |
| Fracture, bond breaking | Water surface and volume tint |
| Blast impulses (pressure front) | Velocity and force arrows, field and joint markers |
| Water buoyancy and drag | Bloom, glow, fog, reflections, ambient occlusion |
| Player body: walking, slopes, jumping, pushing objects | Head bob, landing dip, strafe roll, sprint field of view |
| — | Ambient dust, light haze, grain, lens fringing, motion blur |

The right-hand column is decoration. Switching any of it off changes how the laboratory looks, never what an experiment does: the same experiment run on the low and high presets, or with head movement off, produces the same result.

## Graphics presets

| | Low | Medium | High |
| --- | --- | --- | --- |
| Render scale / height cap | 0.7 / 900 px | 1.0 / 1080 px | 1.0 / 1440 px |
| Shadow map | 1024 | 2048 | 4096 |
| Bloom and glow | off | on | on |
| Grain and lens fringing | off | on | on |
| Ambient dust and light haze | off | reduced | full |
| Ambient occlusion, motion blur | off | off | on |

Ambient occlusion and motion blur are downloaded only when the high preset is used. Dynamic resolution (on by default) lowers the render scale when the frame rate drops, and the atmosphere thins before anything else gives way. Head movement, camera shake and dynamic resolution each have a switch in Settings, and all motion effects default to off when the system asks for reduced motion.

## Renderer

WebGL 2 is the default. Choose WebGPU in Settings (or add `?renderer=webgpu` to the URL); it falls back to WebGL 2 automatically and resets the choice if it fails. WebGPU is opt-in until it has been verified on real GPU hardware; see the dev log.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Development log](docs/DEVLOG.md)
