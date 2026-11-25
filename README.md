# MOMENTUM

An advanced 3D physics sandbox set in an experimental laboratory. Built with Babylon.js, Havok Physics, TypeScript and Vite.

**Status:** Phase 1 (Foundation) complete. See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next and [docs/DEVLOG.md](docs/DEVLOG.md) for what was built and tested.

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
| 1 2 3, then F | Select shape, spawn it |
| Hold LMB | Grab and carry (scroll to push / pull) |
| RMB | Throw held object, or push the targeted one |
| X | Delete targeted object |
| P, [ ] | Pause, slower / faster simulation |
| R | Reset experiment |
| H | Control guide |
| F2 | Cycle graphics quality |

## Renderer

WebGL 2 is the default. Add `?renderer=webgpu` to the URL to use WebGPU (falls back to WebGL 2 automatically). WebGPU is opt-in until it has been verified on real GPU hardware; see the dev log.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Development log](docs/DEVLOG.md)
