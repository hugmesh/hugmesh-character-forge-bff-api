// Shared federation config helpers, mirrored byte-for-byte across every
// HugMesh native-federation repo (host shell + each remote) so the
// federation surface (singletons, strictVersion, the RxJS skip list) lives in
// ONE shape platform-wide — a drift between host and remotes (e.g. one bundle
// sharing a different RxJS subpath) can't quietly produce a "shared is not a
// function" runtime failure. Mirrors hugmesh.games/frontend/federation-base.js.
//
// This repo is a REMOTE only (no host shell here): its ./federation.config.js
// calls `hugmeshRemote` below. `hugmeshHost` is carried for parity with
// the shared convention but has no call site in this repo — it's what the
// actual host-shell repo's federation.config.js calls.
//
// Used by:
//   - ./federation.config.js (hugmeshRemote({ name: 'character-forge', ... }))
//
// Provenance: byte-copy of hugmesh-character-studio-ui/federation-base.js
// (only this Used-by note differs) — keep the functional body identical.

const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

// RxJS subpaths the native-federation builder can't resolve as ESM —
// shareAll would otherwise pull them in and the runtime fails to wire.
// (Default native-federation guidance.)
const STD_SKIP = [
  'rxjs/ajax',
  'rxjs/fetch',
  'rxjs/testing',
  'rxjs/webSocket',
];

const STD_SHARED = shareAll({
  singleton: true,
  strictVersion: true,
  requiredVersion: 'auto',
});

/**
 * Federation config for a remote bundle. `exposes` is the public surface the
 * host's loadRemoteModule({ remoteName, exposedModule }) consumes.
 *
 * `extraSkip` lets a specific remote tack on its own skip entries without
 * losing the standard list.
 */
function hugmeshRemote({ name, exposes, extraSkip = [] }) {
  return withNativeFederation({
    name,
    exposes,
    shared: { ...STD_SHARED },
    skip: [...STD_SKIP, ...extraSkip],
  });
}

/**
 * Federation config for the host shell. The host has no `exposes` block (it's a
 * consumer, not a provider), only a shared-deps surface and the skip list.
 * Naming the host explicitly keeps the convention shared across HugMesh
 * repos; a host carries no manifest self-row requirement.
 */
function hugmeshHost({ name = 'hugmesh-host', extraSkip = [] } = {}) {
  return withNativeFederation({
    name,
    shared: { ...STD_SHARED },
    skip: [...STD_SKIP, ...extraSkip],
  });
}

module.exports = {
  hugmeshRemote,
  hugmeshHost,
  STD_SKIP,
  STD_SHARED,
};
