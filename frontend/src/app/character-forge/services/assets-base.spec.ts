import { assetsAnchor, assetsBaseFrom, resolveAssetsBase } from './assets-base';
import { ENGINE_BASE, ENGINE_EXECUTABLE } from './engine-bridge.service';

/** Any absolute URL (has a scheme). The karma harness rewrites
 *  `import.meta.url` to a `file://` source URL; the shipped native-federation
 *  bundle keeps the real `https://` chunk URL. Either way the point of the
 *  assertion is the same: NOT the bare relative string. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The regression guard for the FEDERATED engine-bundle 404: the Godot web export
 * base was a bare relative string resolved against the SHELL document rather
 * than against this remote's own module chunk, so every engine asset was
 * requested from the shell root. probe() then reported the bundle absent and the
 * page rendered the "engine bundle not present" panel — the 3D preview missing
 * with no error to find.
 */
describe('assets-base (engine bundle)', () => {
  // The shell mounts this remote at /character-forge WITHOUT a trailing slash,
  // so the document's directory is the shell ROOT — one level above the remote.
  const SHELL_DOCUMENT = 'https://mesh.example/character-forge';
  // The chunk this module is bundled into is always served from the remote's
  // own mount, in either host.
  const MODULE_CHUNK = 'https://mesh.example/character-forge/chunk-ABC12345.js';
  const STANDALONE_CHUNK = 'https://character-forge.mesh.example/chunk-ABC12345.js';

  it('anchors on the MODULE chunk, not the document — the federated 404', () => {
    expect(assetsBaseFrom(MODULE_CHUNK, 'assets/game/'))
      .toBe('https://mesh.example/character-forge/assets/game/');

    // What the OLD bare-string code did: resolved against the shell document
    // and landed at the shell root — exactly the 404 path.
    expect(new URL('assets/game/', SHELL_DOCUMENT).href)
      .toBe('https://mesh.example/assets/game/');
    expect(assetsBaseFrom(MODULE_CHUNK, 'assets/game/'))
      .not.toBe(new URL('assets/game/', SHELL_DOCUMENT).href);
  });

  it('still resolves inside the remote when it runs STANDALONE at the origin root', () => {
    expect(assetsBaseFrom(STANDALONE_CHUNK, 'assets/game/'))
      .toBe('https://character-forge.mesh.example/assets/game/');
  });

  it('falls back to the bare relative path when the anchor is unusable', () => {
    expect(assetsBaseFrom('not a url', 'assets/game/')).toBe('assets/game/');
  });

  it('takes its anchor from the module graph, not from the HTML document', () => {
    const anchor = assetsAnchor();
    expect(anchor).toMatch(ABSOLUTE_URL);
    // Equality with the document would mean the resolver had fallen back to
    // document.baseURI — precisely the defect.
    expect(anchor).not.toBe(document.baseURI);
    expect(resolveAssetsBase('assets/game/'))
      .not.toBe(new URL('assets/game/', document.baseURI).href);
  });

  describe('ENGINE_BASE — the one value the whole engine derives from', () => {
    it('is absolute, never document-relative', () => {
      expect(ENGINE_BASE).toMatch(ABSOLUTE_URL);
      expect(ENGINE_BASE).not.toBe('assets/game/');
      expect(ENGINE_BASE.endsWith('assets/game/')).toBeTrue();
    });

    /**
     * Godot's `executable` is not just the .js path — the shipped index.js does
     *   startGame() -> exe = config.executable -> Engine.load(exe) -> loadPath = exe
     *   locateFile() -> `${loadPath}.wasm` / `.side.wasm`
     *                 / `.audio.worklet.js` / `.audio.position.worklet.js`
     *   pack = mainPack || `${exe}.pck`
     * so a relative executable drags SIX more assets to the shell root, not one.
     * This asserts the whole derived set, because fixing only the script tag
     * would leave every one of these still broken and still silent.
     */
    it('every asset the Godot glue derives from it is absolute too', () => {
      const exe = `${ENGINE_BASE}${ENGINE_EXECUTABLE}`;
      for (const suffix of [
        '.js', '.wasm', '.pck', '.side.wasm',
        '.audio.worklet.js', '.audio.position.worklet.js',
      ]) {
        expect(`${exe}${suffix}`).toMatch(ABSOLUTE_URL);
      }
      expect(exe).toContain('/assets/game/index');
    });
  });
});
