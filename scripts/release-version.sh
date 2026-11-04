#!/usr/bin/env bash
# release-version.sh: the version guard of .github/workflows/release.yml (release channels,
# 2026-11-04; beta scheme of 2026-10-21 before that).
#
# Decides what a Release run is allowed to publish, BEFORE anything is built. THE TAG DECIDES
# THE CHANNEL. There are exactly two release tag shapes:
#
#   tag                 channel  must be on      image tags pushed
#   vX.Y.Z-beta.N       beta     origin/main     :X.Y.Z-beta.N, :sha-<12>, :beta
#   vX.Y.Z              stable   origin/         :X.Y.Z, :sha-<12>, :X.Y, and :latest ONLY when
#                                release/X.Y     X.Y is the newest stable line (computed from
#                                                this repo's own vA.B.C tags, ignoring the one
#                                                being released, with sort -V). A patch on an
#                                                older line moves :X.Y but never :latest.
#   anything else       refused  (an -rc.N or any other prerelease has no channel)
#
#   branch push               kind    image tags pushed
#   refs/heads/main           main    :main, :sha-<12>
#   refs/heads/release/X.Y    branch  :sha-<12> only (pom.xml must be X.Y.something)
#   anything else             refused (exit 1), and so is any pull_request event
#
# "On a branch" means the tagged commit is an ancestor of (or equal to) that branch's tip.
# A stable tag whose commit is only on main is refused; a beta tag whose commit is only on a
# release branch is refused. A stable vX.Y.Z is also refused when a higher vX.Y.W already
# exists (:X.Y would move backwards). The tag check needs the remote-tracking branches
# origin/main and origin/release/X.Y and the v* tags in the local checkout: the workflow
# checks out with fetch-depth: 0, and a missing one fails closed.
#
# The version is read from the project <version> in pom.xml. A release is also refused unless
# the tag names exactly that version, the version is MAJOR.MINOR.PATCH or
# MAJOR.MINOR.PATCH-<pre-release> (for example 0.2.0-beta.1), it is not a SNAPSHOT, and
# frontend/package.json carries the same string. Published tags are immutable, so a mismatch
# must stop the run, not be "fixed" by it. :X.Y.Z is immutable (the image job refuses to
# overwrite it); the floating :beta, :X.Y and :latest move.
#
# Inputs (environment): IMAGE, GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_SHA, and optionally
# GITHUB_OUTPUT (the step output file), RELEASE_POM (default pom.xml), RELEASE_PACKAGE_JSON
# (default frontend/package.json) and RELEASE_GIT_DIR (default the repository root).
# Outputs (stdout, and GITHUB_OUTPUT when set): version, kind, sha12, tags (comma-separated),
# channel (beta|stable|none) and latest (true|false). No network, no Maven.
#
# Tests: bash scripts/test-release-version.sh (channels, refusals, the overwrite step) and
# src/test/java/net/hugmesh/characterforgebff/release/ReleaseVersionScriptTest.java.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pom=${RELEASE_POM:-pom.xml}
package_json=${RELEASE_PACKAGE_JSON:-frontend/package.json}
git_dir=${RELEASE_GIT_DIR:-${SCRIPT_DIR}/..}
image=${IMAGE:-}
event=${GITHUB_EVENT_NAME:-}
ref=${GITHUB_REF:-}
sha=${GITHUB_SHA:-}

fail() {
  echo "::error::release-version: $*" >&2
  exit 1
}

[ -n "$image" ] || fail "IMAGE must be set, for example ghcr.io/hugmesh/hugmesh-character-forge-bff-api"
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

# The tagged commit, peeled (an annotated or signed tag object resolves to its commit).
tagged_commit() {
  git -C "${git_dir}" rev-parse -q --verify "${sha}^{commit}" 2>/dev/null \
    || fail "commit ${sha} is not in the local checkout (${git_dir}). The workflow must check out with fetch-depth: 0."
}

# on_branch <commit> <branch>: 0 when <commit> is on origin/<branch>; fails when that
# remote-tracking branch is absent (fail closed: no branch, no release).
on_branch() {
  local c="$1"
  local b="$2"
  local tracking="refs/remotes/origin/${b}"
  git -C "${git_dir}" rev-parse -q --verify "${tracking}^{commit}" >/dev/null 2>&1 \
    || fail "branch ${b} is not in the local checkout (no ${tracking}). It does not exist on origin, or the workflow did not check out with fetch-depth: 0. Refusing."
  git -C "${git_dir}" merge-base --is-ancestor "${c}" "${tracking}"
}

beta_tag_re='^v([0-9]+)\.([0-9]+)\.([0-9]+)-beta\.[0-9]+$'
stable_tag_re='^v([0-9]+)\.([0-9]+)\.([0-9]+)$'
release_branch_re='^release/([0-9]+)\.([0-9]+)$'
channel=none
latest=false

case "$ref" in
  refs/heads/main)
    kind=main
    tags="${image}:main,${image}:sha-${sha12}"
    ;;
  refs/heads/release/*)
    branch="${ref#refs/heads/}"
    [[ "${branch}" =~ ${release_branch_re} ]] \
      || fail "release branch ${branch} is not named release/X.Y (for example release/0.2). Nothing is published."
    bxy="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    case "${version}" in
      "${bxy}".*) ;;
      *) fail "pom version ${version} is not on the ${bxy} line, but this is ${branch}. A release/X.Y branch carries X.Y.* only." ;;
    esac
    kind=branch
    tags="${image}:sha-${sha12}"
    ;;
  refs/tags/v*)
    tag="${ref#refs/tags/}"
    [ "${tag}" = "v${version}" ] \
      || fail "tag ${tag} does not match the pom version $version; tag v$version, or bump the pom first"
    kind=release
    tags="${image}:${version},${image}:sha-${sha12}"
    commit="$(tagged_commit)"
    if [[ "${tag}" =~ ${beta_tag_re} ]]; then
      channel=beta
      on_branch "${commit}" main \
        || fail "beta tag ${tag} is on commit ${commit}, which is not on main. A beta (vX.Y.Z-beta.N) is cut from main only; a release/X.Y branch publishes stable vX.Y.Z tags."
      tags="${tags},${image}:beta"
    elif [[ "${tag}" =~ ${stable_tag_re} ]]; then
      channel=stable
      major="${BASH_REMATCH[1]}"
      minor="${BASH_REMATCH[2]}"
      patch="${BASH_REMATCH[3]}"
      xy="${major}.${minor}"
      on_branch "${commit}" "release/${xy}" \
        || fail "stable tag ${tag} is on commit ${commit}, which is not on release/${xy}. A stable vX.Y.Z is cut from its release/X.Y branch only (never from main, never from another line's branch)."
      # Newest stable line, from this repo's own vA.B.C tags, ignoring the one being released.
      lines=("${xy}")
      while IFS= read -r t; do
        [[ "${t}" =~ ${stable_tag_re} ]] || continue
        [ "${t}" = "${tag}" ] && continue
        lines+=("${BASH_REMATCH[1]}.${BASH_REMATCH[2]}")
        if [ "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}" = "${xy}" ] && (( 10#${BASH_REMATCH[3]} > 10#${patch} )); then
          fail "stable ${t} already exists on the ${xy} line, so ${tag} is older: :${xy} would move backwards. Fix forward with a higher patch."
        fi
      done < <(git -C "${git_dir}" tag -l 'v*')
      newest="$(printf '%s\n' "${lines[@]}" | sort -V | tail -n 1)"
      tags="${tags},${image}:${xy}"
      if [ "${newest}" = "${xy}" ]; then
        latest=true
        tags="${tags},${image}:latest"  # a stable on the newest line, the only case that moves :latest
      fi
    else
      fail "tag ${tag} names no release channel. Release tags are vX.Y.Z-beta.N (beta, from main) or vX.Y.Z (stable, from release/X.Y); any other prerelease (-rc.N, ...) is refused."
    fi
    ;;
  *)
    fail "ref '$ref' publishes nothing: only refs/heads/main, refs/heads/release/X.Y and refs/tags/v<version> do"
    ;;
esac

printf 'version=%s\nkind=%s\nsha12=%s\ntags=%s\nchannel=%s\nlatest=%s\n' "$version" "$kind" "$sha12" "$tags" "$channel" "$latest"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'version=%s\nkind=%s\nsha12=%s\ntags=%s\nchannel=%s\nlatest=%s\n' "$version" "$kind" "$sha12" "$tags" "$channel" "$latest" >> "$GITHUB_OUTPUT"
fi
