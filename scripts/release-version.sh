#!/usr/bin/env bash
# release-version.sh: the version guard of .github/workflows/release.yml (beta scheme, 2026-10-21).
#
# Decides what a Release run is allowed to publish, BEFORE anything is built:
#   * a push of tag v<version>, or a dispatch on that tag  -> kind=release (image :<version>, :beta, :sha-<12>)
#   * a push to main, or a dispatch on main                 -> kind=main    (image :main, :sha-<12>)
#   * anything else (another branch, a non-v tag, any pull_request event) -> refused, exit 1
#
# The version is read from the project <version> in pom.xml. A release is refused unless the tag
# names exactly that version, the version is MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-<pre-release>
# (for example 0.2.0-beta.1), it is not a SNAPSHOT, and frontend/package.json carries the same
# string. Published tags are immutable, so a mismatch must stop the run, not be "fixed" by it.
#
# Inputs (environment): GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REF_NAME, GITHUB_SHA, and optionally
# GITHUB_OUTPUT (the step output file), RELEASE_POM (default pom.xml) and RELEASE_PACKAGE_JSON
# (default frontend/package.json). Outputs: version, kind, sha12 (stdout and GITHUB_OUTPUT).
# Exercised by src/test/java/net/hugmesh/characterforgebff/release/ReleaseVersionScriptTest.java.
set -euo pipefail

pom=${RELEASE_POM:-pom.xml}
package_json=${RELEASE_PACKAGE_JSON:-frontend/package.json}
event=${GITHUB_EVENT_NAME:-}
ref=${GITHUB_REF:-}
ref_name=${GITHUB_REF_NAME:-}
sha=${GITHUB_SHA:-}

fail() {
  echo "::error::release-version: $*" >&2
  exit 1
}

[ -f "$pom" ] || fail "no $pom"
[ -f "$package_json" ] || fail "no $package_json"

# The project version is the only <version> element indented by exactly two spaces (a direct child
# of <project>); the parent's and every dependency's are indented deeper. ReleaseVersionScriptTest
# checks this against a real XML parse of pom.xml, so a reformatted pom fails a test, not a release.
version=$(awk '/^  <version>[^<]*<\/version>[[:space:]]*$/ { sub(/^  <version>/, ""); sub(/<\/version>.*/, ""); print; exit }' "$pom")
[ -n "$version" ] || fail "could not read the project <version> from $pom"

case "$version" in
  *SNAPSHOT*) fail "version $version is a SNAPSHOT; a published coordinate must be a fixed version" ;;
esac
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]]; then
  fail "version $version is not MAJOR.MINOR.PATCH[-pre.release] (no +build metadata: OCI tags reject +)"
fi

frontend_version=$(sed -n 's/^  "version": "\([^"]*\)",*[[:space:]]*$/\1/p' "$package_json" | head -n 1)
[ "$frontend_version" = "$version" ] \
  || fail "frontend version '$frontend_version' ($package_json) differs from pom version '$version'; one repo, one version"

case "$event" in
  pull_request|pull_request_target) fail "a Release run never comes from a pull request event ($event)" ;;
esac

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "GITHUB_SHA '$sha' is not a 40-character commit id"
sha12=${sha:0:12}

case "$ref" in
  refs/tags/v*)
    [ "${ref_name#v}" = "$version" ] \
      || fail "tag $ref_name does not match the pom version $version; tag v$version, or bump the pom first"
    kind=release
    ;;
  refs/heads/main)
    kind=main
    ;;
  *)
    fail "ref '$ref' publishes nothing: only refs/heads/main and refs/tags/v<version> do"
    ;;
esac

echo "version=$version"
echo "kind=$kind"
echo "sha12=$sha12"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=$version"
    echo "kind=$kind"
    echo "sha12=$sha12"
  } >> "$GITHUB_OUTPUT"
fi
