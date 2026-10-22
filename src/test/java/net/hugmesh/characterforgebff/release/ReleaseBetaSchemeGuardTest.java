package net.hugmesh.characterforgebff.release;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pins the beta scheme of 2026-10-21 for this repo: one version for the BFF image and the
 * frontend, a Release workflow that publishes only from main, v* tags and dispatch (on the local
 * runner only through RUNS_ON_PUBLISH), never moves {@code :latest} for a beta, and a CI workflow
 * whose pull-request jobs can never be pointed at the self-hosted runner.
 *
 * <p>Whole-line comments are stripped before anything is asserted, so an explanation of why a
 * line is gone can neither satisfy nor defeat a check.
 */
class ReleaseBetaSchemeGuardTest {

    private static final Path ROOT = Path.of("").toAbsolutePath();

    /** The publish runner line of the scheme (section 3.1), character for character. */
    static final String PUBLISH_RUNS_ON = "${{ fromJSON(github.event_name != 'pull_request'"
            + " && github.event_name != 'pull_request_target'"
            + " && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')"
            + " || startsWith(github.ref, 'refs/tags/studio-v'))"
            + " && vars.RUNS_ON_PUBLISH || '\"ubuntu-latest\"') }}";

    private static final Pattern BETA_OR_FINAL =
            Pattern.compile("^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z]+(\\.[0-9A-Za-z]+)*)?$");

    @Test
    @DisplayName("pom version is a fixed MAJOR.MINOR.PATCH[-beta.N] and frontend/package.json + lock carry the same string")
    void oneVersionPerRepo() throws Exception {
        String pomVersion = projectVersion();
        assertThat(pomVersion).doesNotContain("SNAPSHOT");
        assertThat(BETA_OR_FINAL.matcher(pomVersion).matches())
                .as("pom version %s must be MAJOR.MINOR.PATCH[-pre.release], no +build", pomVersion)
                .isTrue();

        assertThat(firstVersionField(read("frontend/package.json")))
                .as("frontend/package.json version").isEqualTo(pomVersion);

        // package-lock.json repeats the root version twice: top level and packages[""].
        String lock = read("frontend/package-lock.json");
        Matcher m = Pattern.compile("(?m)^ {2}\"version\": \"([^\"]*)\"").matcher(lock);
        assertThat(m.find()).as("lockfile top-level version").isTrue();
        assertThat(m.group(1)).as("lockfile top-level version").isEqualTo(pomVersion);
        Matcher root = Pattern.compile("\"\": \\{\\s*\"name\": \"[^\"]*\",\\s*\"version\": \"([^\"]*)\"").matcher(lock);
        assertThat(root.find()).as("lockfile packages[\"\"] entry").isTrue();
        assertThat(root.group(1)).as("lockfile packages[\"\"] version").isEqualTo(pomVersion);
    }

    @Test
    @DisplayName("release.yml publishes only on push to main, v* tags and dispatch, never on a pull request")
    void releaseTriggers() throws IOException {
        String yaml = code(read(".github/workflows/release.yml"));
        String on = block(yaml, "on");
        assertThat(Pattern.compile("(?m)^\\s*pull_request(_target)?\\s*:").matcher(yaml).find())
                .as("no pull_request / pull_request_target trigger, ever").isFalse();
        assertThat(on).contains("workflow_dispatch");
        assertThat(Pattern.compile("(?m)^ {4}branches: \\[main]\\s*$").matcher(on).find())
                .as("push: branches: [main]").isTrue();
        assertThat(Pattern.compile("(?m)^ {4}tags: \\['v\\*']\\s*$").matcher(on).find())
                .as("push: tags: ['v*']").isTrue();
    }

    @Test
    @DisplayName("release.yml jobs run on the scheme's publish runner line, the signed jobs on hosted ubuntu-latest; nothing reads RUNS_ON")
    void releaseRunnerLine() throws IOException {
        String yaml = code(read(".github/workflows/release.yml"));
        Map<String, String> jobs = jobs(yaml);
        assertThat(jobs).containsOnlyKeys("version", "preflight", "build-and-push", "github-release", "notify-site");
        // The signed publish job and notify-site never run on the self-hosted runner
        // (ReleaseSignedImageGuardTest pins the signing itself).
        java.util.Set<String> hosted = java.util.Set.of("build-and-push", "notify-site");
        jobs.forEach((name, body) -> assertThat(runsOn(body)).as("runs-on of job %s", name)
                .containsExactly(hosted.contains(name) ? "ubuntu-latest" : PUBLISH_RUNS_ON));
        assertThat(Pattern.compile("vars\\.RUNS_ON(?!_PUBLISH)").matcher(yaml).find())
                .as("the PR-era RUNS_ON variable is not read").isFalse();
    }

    @Test
    @DisplayName("release.yml: version guard first, no :latest, refuses an existing version, prerelease never latest")
    void releaseShape() throws IOException {
        String yaml = code(read(".github/workflows/release.yml"));
        Map<String, String> jobs = jobs(yaml);

        assertThat(jobs.get("version")).contains("bash scripts/release-version.sh");
        assertThat(jobs.get("preflight")).contains("needs: version");
        assertThat(jobs.get("build-and-push")).contains("needs: [version, preflight]");

        // A beta never moves :latest (scheme section 4). The old file pushed :latest from main.
        assertThat(Pattern.compile("(?i):latest\\b|'\\{0}:latest'").matcher(yaml).find())
                .as("no :latest tag anywhere in the release workflow").isFalse();

        String image = jobs.get("build-and-push");
        assertThat(image)
                .contains("docker buildx imagetools inspect \"${IMAGE}:${VERSION}\"")
                .contains("tags: ${{ steps.tags.outputs.tags }}")
                .contains("\"${IMAGE}:beta\"")
                .contains("org.opencontainers.image.source=https://github.com/${{ github.repository }}")
                .contains("org.opencontainers.image.revision=${{ github.sha }}");
        assertThat(image.indexOf("imagetools inspect"))
                .as("the overwrite check precedes the push").isLessThan(image.indexOf("docker/build-push-action"));

        String release = jobs.get("github-release");
        assertThat(release)
                .contains("if: needs.version.outputs.kind == 'release'")
                .contains("--verify-tag")
                .contains("--prerelease")
                .contains("--latest=false")
                .contains("contents: write");
        // contents: write is granted to the release job only.
        jobs.forEach((name, body) -> {
            if (!name.equals("github-release")) {
                assertThat(body).as("job %s", name).doesNotContain("contents: write");
            }
        });
        assertThat(block(yaml, "permissions")).contains("contents: read").doesNotContain("write");
    }

    @Test
    @DisplayName("ci.yml: every job (all reachable from pull_request) runs on literal ubuntu-latest")
    void ciPullRequestJobsStayHosted() throws IOException {
        String yaml = code(read(".github/workflows/ci.yml"));
        assertThat(block(yaml, "on")).contains("pull_request");
        Map<String, String> jobs = jobs(yaml);
        assertThat(jobs).isNotEmpty();
        jobs.forEach((name, body) -> assertThat(runsOn(body)).as("runs-on of CI job %s", name)
                .containsExactly("ubuntu-latest"));
        assertThat(yaml).doesNotContain("vars.RUNS_ON").doesNotContain("self-hosted");
    }

    // ---------------------------------------------------------------------------------------

    static String projectVersion() throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        Document doc = f.newDocumentBuilder().parse(new ByteArrayInputStream(
                read("pom.xml").getBytes(StandardCharsets.UTF_8)));
        NodeList children = doc.getDocumentElement().getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node n = children.item(i);
            if (n instanceof Element e && e.getTagName().equals("version")) {
                return e.getTextContent().trim();
            }
        }
        throw new AssertionError("pom.xml has no project <version>");
    }

    private static String firstVersionField(String json) {
        Matcher m = Pattern.compile("(?m)^ {2}\"version\": \"([^\"]*)\"").matcher(json);
        assertThat(m.find()).as("a top-level \"version\" field").isTrue();
        return m.group(1);
    }

    static String read(String relative) throws IOException {
        Path p = ROOT.resolve(relative);
        assertThat(p).as("%s must exist", relative).exists();
        return Files.readString(p, StandardCharsets.UTF_8);
    }

    /** Drops whole-line YAML comments. */
    private static String code(String text) {
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\n", -1)) {
            if (!line.stripLeading().startsWith("#")) {
                out.append(line).append('\n');
            }
        }
        return out.toString();
    }

    /** The body of a top-level key (the lines after {@code key:} up to the next top-level key). */
    private static String block(String yaml, String key) {
        StringBuilder out = new StringBuilder();
        boolean in = false;
        for (String line : yaml.split("\n", -1)) {
            if (!line.isEmpty() && !Character.isWhitespace(line.charAt(0))) {
                in = line.startsWith(key + ":");
                continue;
            }
            if (in) {
                out.append(line).append('\n');
            }
        }
        assertThat(in || out.length() > 0).as("top-level key %s", key).isTrue();
        return out.toString();
    }

    /** Job name -> job body, from the two-space-indented keys under {@code jobs:}. */
    private static Map<String, String> jobs(String yaml) {
        Map<String, String> jobs = new LinkedHashMap<>();
        Pattern jobKey = Pattern.compile("^ {2}([A-Za-z0-9_-]+):\\s*$");
        String current = null;
        StringBuilder body = new StringBuilder();
        for (String line : block(yaml, "jobs").split("\n", -1)) {
            Matcher m = jobKey.matcher(line);
            if (m.matches()) {
                if (current != null) {
                    jobs.put(current, body.toString());
                }
                current = m.group(1);
                body = new StringBuilder();
            } else if (current != null) {
                body.append(line).append('\n');
            }
        }
        if (current != null) {
            jobs.put(current, body.toString());
        }
        return jobs;
    }

    private static List<String> runsOn(String jobBody) {
        List<String> values = new ArrayList<>();
        Matcher m = Pattern.compile("(?m)^ {4}runs-on: (.*?)\\s*$").matcher(jobBody);
        while (m.find()) {
            values.add(m.group(1));
        }
        return values;
    }
}
