/**
 * Where this remote's own shipped `assets/` tree lives, as an ABSOLUTE URL.
 *
 * THE TRAP: a bare relative string like `'assets/game/'` is resolved by `fetch()`
 * (and by a `<script src>` binding, and by anything the Godot web glue derives
 * from it) against the DOCUMENT's URL — NOT against the Angular app's base href,
 * and NOT against this remote's mount. Standalone that is harmless, because the
 * document already sits inside the remote. Federated into the host shell the
 * document is the SHELL, at `/character-forge` with no trailing slash, so
 * `assets/game/index.js` resolves to `/assets/game/index.js` at the SHELL ROOT
 * and 404s. The page then renders the honest "engine bundle not present" panel,
 * because {@link EngineBridgeService.probe} HEAD-probes that same wrong URL — so
 * the 3D preview is missing with no error anywhere, which is exactly the
 * "works at the remote's own address, not in the shell" report.
 *
 * WHY THIS ONE VALUE FIXES THE WHOLE ENGINE. Every asset the Godot 4.7 web
 * export fetches is derived from the `executable` config, not from the script's
 * own directory — measured in the shipped `assets/game/index.js`:
 *
 *     startGame() -> exe = config.executable -> init(exe) -> Engine.load(exe)
 *                 -> loadPath = exe
 *     locateFile(path) -> `${loadPath}.wasm` / `.side.wasm` / `.js`
 *                       / `.audio.worklet.js` / `.audio.position.worklet.js`
 *     pack = config.mainPack || `${exe}.pck`
 *
 * The Engine's own `locateFile` override (index.js) intercepts every `godot.*`
 * path and rewrites it onto `loadPath`, so Emscripten's `scriptDirectory`
 * (which WOULD have anchored on the script URL) never gets a say. That means an
 * absolute `executable` is not merely sufficient, it is the ONLY lever: fixing
 * the `<script src>` alone would still leave the .pck, the .wasm, the
 * .side.wasm and both audio worklets pointing at the shell.
 *
 * `import.meta.url` is the URL of the very chunk this module is bundled into,
 * which is served from the remote's own mount in BOTH cases
 * (`/character-forge/…` federated, `/` standalone) — so anchoring on it needs no
 * hardcoded mount path and no build-time base href. `document.baseURI` is the
 * fallback for a non-ESM or test context.
 *
 * This is the same fix, and deliberately the same shape, as the canonical
 * `resolveAssetsBase()` in hugmesh-character-studio-ui
 * (`src/app/character-studio/services/assets-base.ts`) and hugmesh-mastodon-ui
 * (`src/app/assets-base.ts`). Keep the three exports identical across the fleet:
 * a remote that invents its own spelling is how one of them silently regresses.
 */

/**
 * The anchor asset paths resolve against: this module's own chunk URL, with the
 * document as a non-ESM/test fallback. Exported for tests — production code
 * should call {@link resolveAssetsBase}.
 */
export function assetsAnchor(): string {
  return typeof import.meta?.url === 'string'
    ? import.meta.url
    : typeof document !== 'undefined'
      ? document.baseURI
      : '/';
}

/**
 * Resolve `relative` against an explicit `anchor`. Pure, so a test can prove the
 * shell-mounted case without a shell.
 */
export function assetsBaseFrom(anchor: string, relative: string): string {
  try {
    // Chunks are emitted beside index.html, so the module's directory IS the
    // app root; new URL() normalises it into an absolute href.
    return new URL(relative, anchor).href;
  } catch {
    return relative;
  }
}

/**
 * The absolute URL of `relative` (e.g. `'assets/game/'`) inside THIS remote,
 * whichever mount it is served from.
 */
export function resolveAssetsBase(relative: string): string {
  return assetsBaseFrom(assetsAnchor(), relative);
}
