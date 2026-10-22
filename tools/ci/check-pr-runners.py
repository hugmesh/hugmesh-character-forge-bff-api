#!/usr/bin/env python3
"""Refuse any workflow that would run pull-request code on a self-hosted runner.

Usage: python3 tools/ci/check-pr-runners.py [.github/workflows]

Rules, for every *.yml / *.yaml file in the directory:
  1. `pull_request_target` is refused outright. It runs with this repository's
     secrets and write token, so checking out PR code under it hands both to a fork.
  2. If anything other than push, workflow_dispatch or schedule can trigger the
     workflow, every job must name a GitHub-hosted runner. That covers pull requests
     (pull_request, pull_request_review, pull_request_review_comment) and every event a
     stranger can cause on a public repository (issue_comment, issues, discussion,
     discussion_comment, workflow_run, ...). The list is an ALLOW list, so a trigger this
     script has never heard of is treated as untrusted. Allowed `runs-on` values:
       * a plain hosted label: ubuntu-*, windows-*, macos-*
       * exactly this expression shape, which can only pick a configured runner for a
         push to main and falls back to hosted for every other event:
           ${{ fromJSON(github.event_name == 'push' && github.ref == 'refs/heads/main'
                        && vars.<NAME> || '"ubuntu-..."') }}
     Anything else (a label list, a runner group, a matrix value, any other
     expression, a reusable-workflow call) is refused, because this script cannot
     prove it never resolves to a self-hosted runner.

This only keeps OUR workflow files honest. It is not a boundary against a fork: a
fork's pull request runs the fork's copy of the workflow files. The real boundaries
are the org runner-group setting (no public repositories) and fork-PR approval.

Exit 0 = clean, 1 = violations (each printed), 2 = usage or parse error.
"""
import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - ubuntu-latest ships PyYAML
    print("check-pr-runners: PyYAML is not installed (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

# Only these triggers may reach a self-hosted runner. Each needs write access to the
# repository (push, workflow_dispatch) or runs code already on the default branch on a
# timer (schedule). Every other trigger is untrusted: either it runs a pull request's
# code, or a stranger can fire it (an issue, a comment, a discussion, a star, a fork) and
# its payload is stranger input. Allow list, not deny list, so a new event fails closed.
TRUSTED_EVENTS = {"push", "workflow_dispatch", "schedule"}
REFUSED_EVENTS = {"pull_request_target"}

HOSTED_LABEL = re.compile(r"^(ubuntu|windows|macos)-[A-Za-z0-9.\-]+$")
PUSH_MAIN_ONLY = re.compile(
    r"^\$\{\{\s*fromJSON\(\s*"
    r"github\.event_name\s*==\s*'push'\s*&&\s*"
    r"github\.ref\s*==\s*'refs/heads/main'\s*&&\s*"
    r"vars\.[A-Za-z_][A-Za-z0-9_]*\s*\|\|\s*"
    r"'\"(ubuntu|windows|macos)-[A-Za-z0-9.\-]+\"'"
    r"\s*\)\s*\}\}$"
)


def triggers(doc):
    # PyYAML (YAML 1.1) reads a bare `on:` key as the boolean True.
    on = doc.get("on", doc.get(True))
    if on is None:
        return set()
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return {str(x) for x in on}
    if isinstance(on, dict):
        return {str(k) for k in on}
    return set()


def runs_on_ok(value):
    if not isinstance(value, str):
        return False
    v = value.strip()
    return bool(HOSTED_LABEL.match(v) or PUSH_MAIN_ONLY.match(v))


def check_file(path):
    problems = []
    try:
        with open(path, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
    except (OSError, yaml.YAMLError) as exc:
        return None, [f"{path}: cannot parse: {exc}"]
    if not isinstance(doc, dict):
        return None, [f"{path}: not a workflow mapping"]
    events = triggers(doc)
    for ev in sorted(events & REFUSED_EVENTS):
        problems.append(f"{path}: trigger `{ev}` is refused (runs with secrets and a write token)")
    pr_events = events - TRUSTED_EVENTS
    if not pr_events:
        return problems, None
    jobs = doc.get("jobs")
    if not isinstance(jobs, dict) or not jobs:
        problems.append(f"{path}: no jobs mapping")
        return problems, None
    for name, job in jobs.items():
        if not isinstance(job, dict):
            problems.append(f"{path}: job `{name}` is not a mapping")
            continue
        if "uses" in job:
            problems.append(
                f"{path}: job `{name}` calls a reusable workflow ({job['uses']}) on "
                f"{'/'.join(sorted(pr_events))}; its runner cannot be checked here"
            )
            continue
        if "runs-on" not in job:
            problems.append(f"{path}: job `{name}` has no runs-on")
            continue
        if not runs_on_ok(job["runs-on"]):
            problems.append(
                f"{path}: job `{name}` runs on {job['runs-on']!r} although "
                f"{'/'.join(sorted(pr_events))} can trigger it; use ubuntu-latest, or the "
                f"push-to-main-only expression documented in this script"
            )
    return problems, None


def main(argv):
    wf_dir = argv[1] if len(argv) > 1 else ".github/workflows"
    if not os.path.isdir(wf_dir):
        print(f"check-pr-runners: no such directory: {wf_dir}", file=sys.stderr)
        return 2
    files = sorted(
        os.path.join(wf_dir, f)
        for f in os.listdir(wf_dir)
        if f.endswith((".yml", ".yaml"))
    )
    if not files:
        print(f"check-pr-runners: no workflow files in {wf_dir}", file=sys.stderr)
        return 2
    all_problems = []
    for path in files:
        problems, fatal = check_file(path)
        if fatal:
            for line in fatal:
                print(line, file=sys.stderr)
            return 2
        all_problems.extend(problems)
    for line in all_problems:
        print(line)
    if all_problems:
        print(f"check-pr-runners: {len(all_problems)} problem(s) in {len(files)} file(s)")
        return 1
    print(f"check-pr-runners: OK, {len(files)} workflow file(s), no PR job can reach a self-hosted runner")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
