# The Godot project moved

`godot/character-forge/` now lives in **hugmesh-games** as
[`games/character-forge/`](https://github.com/hugmesh/hugmesh-games/tree/main/games/character-forge)
— an ordinary, editable, re-uploadable game of that repo: open it in Godot 4.6+,
change it, `make build-godot`, publish the zip through the standard upload lane.

What this repo keeps is the **BFF** (`/bff/character-forge/**`) and the Angular
**remote** under `frontend/`, which drives the engine over the `CharForge` bridge.
The engine renders and answers the bridge; **every control lives in the Angular
page** — the in-canvas editor UI was removed with the move.

The `frontend/` image bakes the engine's web export into `src/assets/game/`; that
export is produced by hugmesh-games (`backend/src/main/resources/assets/levels/character-forge/`)
and copied in by the orchestrator before this image builds. The page boots without
it and says so ("engine bundle not present").

The GDScript test suite runs in hugmesh-games' Godot lane; the `godot` job that used
to run it here is gone with the project.
