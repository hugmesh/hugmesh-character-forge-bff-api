# Godot web export drop zone (placeholder)

The character-forge Godot web export is baked into THIS directory by the
export step (orchestrator/CI — `make export-web` in `../../../../godot/character-forge/`),
NOT authored here. Expected files (Godot 4 web export, basename `index`, the
hugmesh.games levels convention):

```
index.js            # Engine JS API (defines the global Engine class)
index.pck           # main pack
index.wasm          # engine wasm (Compatibility renderer, threads OFF)
index.side.wasm     # side module
index.audio.worklet.js
index.audio.position.worklet.js
index.png / index.icon.png / index.apple-touch-icon.png
```

Until these exist the forge page's `EngineBridgeService.probe()` finds no
`index.js` and the UI shows the honest "engine bundle not present" panel —
the parameter editor, VN import and save/load work without the engine.

Threads are OFF (single-threaded export, DESIGN §0), so no COOP/COEP headers
are required; `nginx.conf` already serves `.wasm` as `application/wasm` and
`.pck` as `application/octet-stream`.
