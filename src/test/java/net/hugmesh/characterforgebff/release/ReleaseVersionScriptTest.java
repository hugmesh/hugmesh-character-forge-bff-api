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
 * Release run can see. It must turn exactly main and v&lt;pom version&gt; into something
 * publishable and refuse everything else before an image is built.
 */
class ReleaseVersionScriptTest {

    private static final Path ROOT = Path.of("").toAbsolutePath();
    private static final Path SCRIPT = ROOT.resolve("scripts/release-version.sh");
    private static final String SHA = "0123456789abcdef0123456789abcdef01234567";

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

    @Test
    @DisplayName("tag v<pom version> (push or dispatch) is a release, with outputs written for later jobs")
    void matchingTagIsARelease() throws Exception {
        for (String event : new String[] {"push", "workflow_dispatch"}) {
            Result r = run(event, "refs/tags/v" + version);
            assertThat(r.exit()).as(event + ": " + r.stderr()).isZero();
            assertThat(r.githubOutput())
                    .contains("version=" + version + "\n")
                    .contains("kind=release\n")
                    .contains("sha12=" + SHA.substring(0, 12) + "\n");
        }
    }

    @Test
    @DisplayName("push or dispatch on main is a main build")
    void mainIsAMainBuild() throws Exception {
        for (String event : new String[] {"push", "workflow_dispatch"}) {
            Result r = run(event, "refs/heads/main");
            assertThat(r.exit()).as(event + ": " + r.stderr()).isZero();
            assertThat(r.githubOutput()).contains("kind=main\n");
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
