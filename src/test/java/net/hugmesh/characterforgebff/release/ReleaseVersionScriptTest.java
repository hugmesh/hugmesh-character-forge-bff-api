package net.hugmesh.characterforgebff.release;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs scripts/release-version.sh, the first job of the Release workflow, against the refs a
 * Release run can see. It must turn exactly main, release/X.Y and v&lt;pom version&gt; into
 * something publishable and refuse everything else before an image is built. A tag is only
 * accepted for a commit on its channel's branch (main for a beta, release/X.Y for a stable), so
 * the tag cases run against a throwaway repository; every channel case, including the newest
 * stable line, lives in scripts/test-release-version.sh.
 */
class ReleaseVersionScriptTest {

    private static final Path ROOT = Path.of("").toAbsolutePath();
    private static final Path SCRIPT = ROOT.resolve("scripts/release-version.sh");
    private static final String SHA = "0123456789abcdef0123456789abcdef01234567";
    private static final String IMAGE = "ghcr.io/hugmesh/hugmesh-character-forge-bff-api";

    private static String version;

    @TempDir
    Path tmp;

    @BeforeAll
    static void readPomVersion() throws Exception {
        version = ReleaseBetaSchemeGuardTest.projectVersion();
    }

    private record Result(int exit, String stdout, String stderr, String githubOutput) { }

    private Result run(String event, String ref, Map<String, String> extra) throws Exception {
        Path out = tmp.resolve("github_output");
        Files.deleteIfExists(out);
        Files.createFile(out);
        ProcessBuilder pb = new ProcessBuilder("bash", SCRIPT.toString()).directory(ROOT.toFile());
        Map<String, String> env = pb.environment();
        env.keySet().removeIf(k -> k.startsWith("GITHUB_") || k.startsWith("RELEASE_"));
        env.put("GITHUB_EVENT_NAME", event);
        env.put("GITHUB_REF", ref);
        env.put("GITHUB_REF_NAME", ref.replaceFirst("^refs/(heads|tags)/", ""));
        env.put("GITHUB_SHA", SHA);
        env.put("GITHUB_OUTPUT", out.toString());
        env.put("IMAGE", IMAGE);
        env.putAll(extra);
        Path stdout = tmp.resolve("stdout");
        Path stderr = tmp.resolve("stderr");
        pb.redirectOutput(stdout.toFile()).redirectError(stderr.toFile());
        Process p = pb.start();
        assertThat(p.waitFor(30, TimeUnit.SECONDS)).as("script finished").isTrue();
        return new Result(p.exitValue(), Files.readString(stdout), Files.readString(stderr), Files.readString(out));
    }

    private Result run(String event, String ref) throws Exception {
        return run(event, ref, Map.of());
    }

    @Test
    @DisplayName("the script reads the same project version as an XML parse of pom.xml")
    void readsTheProjectVersion() throws Exception {
        Result r = run("push", "refs/heads/main");
        assertThat(r.exit()).as(r.stderr()).isZero();
        assertThat(r.stdout()).contains("version=" + version + "\n");
    }

    /** A one-commit repository whose commit is the tip of both origin/main and origin/release/X.Y. */
    private Map<String, String> checkoutWithChannelBranches() throws Exception {
        Path repo = tmp.resolve("repo");
        git(tmp, "init", "-q", repo.toString());
        git(repo, "commit", "-q", "--allow-empty", "-m", "c");
        String commit = git(repo, "rev-parse", "HEAD");
        git(repo, "update-ref", "refs/remotes/origin/main", commit);
        String line = version.replaceFirst("^(\\d+\\.\\d+)\\..*$", "$1");
        git(repo, "update-ref", "refs/remotes/origin/release/" + line, commit);
        return env("RELEASE_GIT_DIR", repo.toString(), "GITHUB_SHA", commit);
    }

    private static String git(Path dir, String... args) throws Exception {
        String[] cmd = new String[args.length + 9];
        String[] prefix = {"git", "-C", dir.toString(), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                "-c", "commit.gpgsign=false"};
        System.arraycopy(prefix, 0, cmd, 0, prefix.length);
        System.arraycopy(args, 0, cmd, prefix.length, args.length);
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(p.waitFor(30, TimeUnit.SECONDS)).as("git finished").isTrue();
        assertThat(p.exitValue()).as("git %s: %s", String.join(" ", args), out).isZero();
        return out.strip();
    }

    @Test
    @DisplayName("tag v<pom version> (push or dispatch) on its channel's branch is a release, with outputs written for later jobs")
    void matchingTagIsARelease() throws Exception {
        Map<String, String> checkout = checkoutWithChannelBranches();
        String sha12 = checkout.get("GITHUB_SHA").substring(0, 12);
        boolean beta = version.contains("-");
        for (String event : new String[] {"push", "workflow_dispatch"}) {
            Result r = run(event, "refs/tags/v" + version, checkout);
            assertThat(r.exit()).as(event + ": " + r.stderr()).isZero();
            assertThat(r.githubOutput())
                    .contains("version=" + version + "\n")
                    .contains("kind=release\n")
                    .contains("sha12=" + sha12 + "\n")
                    .contains("channel=" + (beta ? "beta" : "stable") + "\n")
                    .contains("tags=" + IMAGE + ":" + version + "," + IMAGE + ":sha-" + sha12 + ",");
        }
    }

    @Test
    @DisplayName("a tag on a commit the checkout does not have is refused (fail closed)")
    void tagOnAnUnknownCommitIsRefused() throws Exception {
        Map<String, String> checkout = new HashMap<>(checkoutWithChannelBranches());
        checkout.put("GITHUB_SHA", SHA);
        Result r = run("push", "refs/tags/v" + version, checkout);
        assertThat(r.exit()).isEqualTo(1);
        assertThat(r.stderr()).contains("not in the local checkout");
        assertThat(r.githubOutput()).isEmpty();
    }

    @Test
    @DisplayName("push or dispatch on main is a main build")
    void mainIsAMainBuild() throws Exception {
        for (String event : new String[] {"push", "workflow_dispatch"}) {
            Result r = run(event, "refs/heads/main");
            assertThat(r.exit()).as(event + ": " + r.stderr()).isZero();
            assertThat(r.githubOutput())
                    .contains("kind=main\n")
                    .contains("tags=" + IMAGE + ":main," + IMAGE + ":sha-" + SHA.substring(0, 12) + "\n")
                    .contains("channel=none\n")
                    .contains("latest=false\n");
        }
    }

    @Test
    @DisplayName("a tag that does not name the pom version is refused")
    void mismatchedTagIsRefused() throws Exception {
        Result r = run("push", "refs/tags/v" + version + "9");
        assertThat(r.exit()).isEqualTo(1);
        assertThat(r.stderr()).contains("does not match the pom version");
        assertThat(r.githubOutput()).isEmpty();
    }

    @Test
    @DisplayName("other branches, non-v tags and pull-request events publish nothing")
    void everythingElseIsRefused() throws Exception {
        assertThat(run("workflow_dispatch", "refs/heads/feature/x").exit()).isEqualTo(1);
        assertThat(run("push", "refs/heads/release/next").exit()).isEqualTo(1);
        assertThat(run("push", "refs/tags/studio-v" + version).exit()).isEqualTo(1);
        assertThat(run("pull_request", "refs/heads/main").exit()).isEqualTo(1);
        assertThat(run("pull_request_target", "refs/tags/v" + version).exit()).isEqualTo(1);
        assertThat(run("pull_request", "refs/pull/7/merge").exit()).isEqualTo(1);
    }

    @Test
    @DisplayName("a SNAPSHOT, a +build version or a frontend version that differs is refused")
    void badVersionsAreRefused() throws Exception {
        String pom = Files.readString(ROOT.resolve("pom.xml"), StandardCharsets.UTF_8);
        String pkg = Files.readString(ROOT.resolve("frontend/package.json"), StandardCharsets.UTF_8);
        String marker = "  <version>" + version + "</version>";
        assertThat(pom).contains(marker);

        for (String bad : new String[] {"0.2.0-SNAPSHOT", "0.2.0-beta.1+build.7", "0.2", "v0.2.0"}) {
            Path badPom = write("pom-" + bad.hashCode() + ".xml", pom.replace(marker, "  <version>" + bad + "</version>"));
            Path badPkg = write("pkg-" + bad.hashCode() + ".json",
                    pkg.replace("\"version\": \"" + version + "\"", "\"version\": \"" + bad + "\""));
            Result r = run("push", "refs/tags/v" + bad,
                    env("RELEASE_POM", badPom.toString(), "RELEASE_PACKAGE_JSON", badPkg.toString()));
            assertThat(r.exit()).as("version %s", bad).isEqualTo(1);
            assertThat(r.githubOutput()).isEmpty();
        }

        Path otherPkg = write("pkg-other.json",
                pkg.replace("\"version\": \"" + version + "\"", "\"version\": \"0.0.0\""));
        Result r = run("push", "refs/tags/v" + version, env("RELEASE_PACKAGE_JSON", otherPkg.toString()));
        assertThat(r.exit()).isEqualTo(1);
        assertThat(r.stderr()).contains("differs from pom version");
    }

    @Test
    @DisplayName("a missing or malformed GITHUB_SHA is refused")
    void badShaIsRefused() throws Exception {
        assertThat(run("push", "refs/heads/main", env("GITHUB_SHA", "")).exit()).isEqualTo(1);
        assertThat(run("push", "refs/heads/main", env("GITHUB_SHA", "abc")).exit()).isEqualTo(1);
    }

    private Path write(String name, String content) throws IOException {
        Path p = tmp.resolve(name);
        Files.writeString(p, content, StandardCharsets.UTF_8);
        return p;
    }

    private static Map<String, String> env(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }
}
