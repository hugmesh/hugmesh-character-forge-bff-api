#!/usr/bin/env python3
"""Self-test for check-pr-runners.py. Run: python3 tools/ci/test_check_pr_runners.py"""
import importlib.util
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "check-pr-runners.py")
REPO_WORKFLOWS = os.path.join(HERE, "..", "..", ".github", "workflows")

GOOD_EXPR = """${{ fromJSON(github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.RUNS_ON || '"ubuntu-latest"') }}"""


def run_guard(files):
    with tempfile.TemporaryDirectory() as d:
        for name, body in files.items():
            with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                fh.write(textwrap.dedent(body))
        p = subprocess.run([sys.executable, SCRIPT, d], capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr


def wf(on, runs_on):
    return f"on: {on}\njobs:\n  a:\n    runs-on: {runs_on}\n    steps:\n      - run: true\n"


class Guard(unittest.TestCase):
    def test_this_repo_is_clean(self):
        p = subprocess.run([sys.executable, SCRIPT, REPO_WORKFLOWS], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_hosted_label_on_pull_request_passes(self):
        rc, out = run_guard({"ci.yml": wf("[pull_request]", "ubuntu-latest")})
        self.assertEqual(rc, 0, out)

    def test_push_main_only_expression_passes(self):
        rc, out = run_guard({"ci.yml": wf("[pull_request, push]", GOOD_EXPR)})
        self.assertEqual(rc, 0, out)

    def test_bare_runs_on_variable_is_refused(self):
        # The exact shape origin/main had before this change.
        expr = """${{ fromJSON(vars.RUNS_ON || '"ubuntu-latest"') }}"""
        rc, out = run_guard({"ci.yml": wf("[pull_request, push]", expr)})
        self.assertEqual(rc, 1, out)
        self.assertIn("job `a` runs on", out)

    def test_event_check_that_lets_pull_request_through_is_refused(self):
        expr = """${{ fromJSON(github.event_name != 'workflow_dispatch' && vars.RUNS_ON || '"ubuntu-latest"') }}"""
        rc, out = run_guard({"ci.yml": wf("[pull_request]", expr)})
        self.assertEqual(rc, 1, out)

    def test_self_hosted_list_is_refused(self):
        rc, out = run_guard({"ci.yml": wf("pull_request", "[self-hosted, Linux, X64]")})
        self.assertEqual(rc, 1, out)

    def test_self_hosted_string_is_refused(self):
        rc, out = run_guard({"ci.yml": wf("{pull_request: {branches: [main]}}", "self-hosted")})
        self.assertEqual(rc, 1, out)

    def test_runner_group_is_refused(self):
        rc, out = run_guard({"ci.yml": wf("[pull_request]", "{group: Default}")})
        self.assertEqual(rc, 1, out)

    def test_matrix_value_is_refused(self):
        rc, out = run_guard({"ci.yml": wf("[pull_request]", "${{ matrix.os }}")})
        self.assertEqual(rc, 1, out)

    def test_pull_request_target_is_refused_even_on_hosted(self):
        rc, out = run_guard({"ci.yml": wf("[pull_request_target]", "ubuntu-latest")})
        self.assertEqual(rc, 1, out)
        self.assertIn("pull_request_target", out)

    def test_workflow_run_and_issue_comment_count_as_pr_events(self):
        for ev in ("workflow_run", "issue_comment", "pull_request_review"):
            rc, out = run_guard({"x.yml": wf(f"[{ev}]", "[self-hosted]")})
            self.assertEqual(rc, 1, f"{ev}: {out}")

    def test_stranger_triggered_events_count_as_untrusted(self):
        # Anyone can open an issue, comment, start a discussion, star or fork a public
        # repository. None of these may put a job on a self-hosted runner.
        for ev in ("issues", "discussion", "discussion_comment", "watch", "fork"):
            rc, out = run_guard({"x.yml": wf(f"[{ev}]", "[self-hosted]")})
            self.assertEqual(rc, 1, f"{ev}: {out}")
            self.assertIn("job `a` runs on", out)

    def test_unknown_event_fails_closed(self):
        rc, out = run_guard({"x.yml": wf("[some_future_event]", "[self-hosted]")})
        self.assertEqual(rc, 1, out)

    def test_workflow_call_is_untrusted(self):
        # A reusable workflow inherits its caller's event, which may be a pull request.
        rc, out = run_guard({"x.yml": wf("{workflow_call: {}}", "[self-hosted]")})
        self.assertEqual(rc, 1, out)

    def test_pull_request_target_with_self_hosted_job_reports_the_job_too(self):
        rc, out = run_guard({"x.yml": wf("[pull_request_target]", "[self-hosted]")})
        self.assertEqual(rc, 1, out)
        self.assertIn("job `a` runs on", out)

    def test_schedule_may_use_self_hosted(self):
        rc, out = run_guard({"nightly.yml": wf("{schedule: [{cron: '0 3 * * *'}]}", "[self-hosted]")})
        self.assertEqual(rc, 0, out)

    def test_reusable_workflow_call_on_pr_is_refused(self):
        body = "on: [pull_request]\njobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@main\n"
        rc, out = run_guard({"ci.yml": body})
        self.assertEqual(rc, 1, out)
        self.assertIn("reusable workflow", out)

    def test_dispatch_and_push_only_may_use_self_hosted(self):
        rc, out = run_guard({
            "rel.yml": wf("[workflow_dispatch]", "[self-hosted, Linux, X64]"),
            "main.yml": wf("{push: {branches: [main]}}", "[self-hosted]"),
        })
        self.assertEqual(rc, 0, out)

    def test_one_bad_file_among_good_fails(self):
        rc, out = run_guard({
            "a.yml": wf("[pull_request]", "ubuntu-latest"),
            "b.yaml": wf("[pull_request]", "[self-hosted]"),
        })
        self.assertEqual(rc, 1, out)
        self.assertIn("b.yaml", out)

    def test_unparseable_file_is_an_error_not_a_pass(self):
        rc, out = run_guard({"ci.yml": "on: [pull_request\njobs: {"})
        self.assertEqual(rc, 2, out)

    def test_empty_directory_is_an_error_not_a_pass(self):
        rc, out = run_guard({})
        self.assertEqual(rc, 2, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
