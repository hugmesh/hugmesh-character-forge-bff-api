// REMOTE bundle config for the Character Forge micro-frontend (native-
// federation remote name "character-forge"). The hugmesh.systems host
// consumes the single exposed `./routes` module via
// loadRemoteModule({ remoteName: 'character-forge', exposedModule: './routes' })
// and mounts CHARACTER_FORGE_ROUTES at /character-forge — so the remote name
// and the exposed module key MUST stay unchanged or the host mount breaks.
//
// The shared-deps surface + RxJS skip list live in ./federation-base.js so the
// federation contract lands in one file, consistent with the host and every
// other HugMesh remote (admin/games/character-studio convention).
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'character-forge',
  exposes: {
    './routes': './src/app/character-forge.routes.ts',
  },
});
