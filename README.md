# MOMENTUM

An advanced 3D physics sandbox set in an experimental laboratory. Built with Babylon.js, Havok Physics, TypeScript and Vite.

**Status:** Phases 1 to 5 of 7 complete (foundation, physics systems, advanced interactions, destruction, advanced simulation). See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next and [docs/DEVLOG.md](docs/DEVLOG.md) for what was built and tested.

## Run

```bash
npm install
npm run dev        # development server
npm test           # headless physics tests (real Havok, no GPU needed)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
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
| Q | Next tool: Hand, Force, Field, Link, Blast |
| Hand: hold LMB, scroll, hold T, RMB | Grab and carry, push / pull, turn with the mouse, throw or push |
| Force: hold LMB, RMB, scroll, V | Continuous force at the aimed point, impulse strike, change magnitude, switch force / torque |
| Field: LMB, RMB, scroll, V | Place attractor / repulsor / gravity zone / water volume, remove the one aimed at, change type, change strength |
| Link: LMB then LMB, RMB, scroll | Join an object to another object or the room, remove joints, choose weld / hinge / ball / motor / slider / spring |
| Blast: LMB, scroll | Detonate a charge where you aim, change charge size |
| F4 | Next environment (Test Chamber, Gravity Laboratory, Destruction Arena) |
| B | Destruction intensity: off, low, normal, high |
| Tab | Edit mode: frees the mouse to edit properties and world gravity |
| P, [ ] | Pause, slower / faster simulation |
| R | Reset experiment |
| H | Control guide |
| F2 | Cycle graphics quality |

## Simulated vs visual

| Simulated (acts on the physics engine) | Visual only |
| --- | --- |
| Rigid bodies, collisions, friction, restitution | Dust, sparks, fire, smoke, splashes (particles) |
| Gravity fields and zones | Shock ring of a blast, camera shake |
| Joints, motors, springs, sliders; the soft spring lattice | Squash of rubber / elastic / plastic on impact |
| Fracture, bond breaking | Water surface and volume tint |
| Blast impulses (pressure front) | Velocity and force arrows, field and joint markers |
| Water buoyancy and drag | Bloom, glow, fog, reflections |

## Renderer

WebGL 2 is the default. Add `?renderer=webgpu` to the URL to use WebGPU (falls back to WebGL 2 automatically). WebGPU is opt-in until it has been verified on real GPU hardware; see the dev log.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Development log](docs/DEVLOG.md)
