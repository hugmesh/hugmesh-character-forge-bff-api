package systems.hugmesh.characterforgebff.godot;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The upload-gate contract for {@code godot/character-forge/register/register.sql}
 * (DESIGN §4 "publishes into hugmesh.games via the standard zip upload").
 *
 * <p><b>Why this test exists.</b> The games BFF runs every uploaded
 * {@code register.sql} through {@code RegisterSqlPolicy} (default-deny allowlist).
 * That policy's statement splitter is single-quote aware but does <b>not</b> model
 * {@code --} comments, so a semicolon inside a comment line ends a statement EARLY.
 * The tail fragment then no longer begins with a comment marker, survives
 * {@code stripLeadingComments}, matches neither the INSERT nor the UPDATE shape, and
 * the whole upload is rejected with 400 — the install transaction rolls back and the
 * game never lands in the portal catalog. This shipped broken once (two semicolons in
 * the banner comments), which is invisible to every in-repo suite because the vetter
 * lives in another repository.
 *
 * <p>The splitter below is a VERBATIM behavioural mirror of
 * {@code games.hugmesh.bff.upload.RegisterSqlPolicy#split} +
 * {@code #stripLeadingComments} (hugmesh.games,
 * {@code backend/src/main/java/games/hugmesh/bff/upload/RegisterSqlPolicy.java}).
 * Keep the two in lockstep if that policy ever changes.
 */
class RegisterSqlContractTest {

    private static final Path REGISTER_SQL =
            Path.of("godot", "character-forge", "register", "register.sql");

    /** The catalog tables the games policy admits an INSERT into. */
    private static final Set<String> INSERT_TABLES = Set.of(
            "games", "levels", "chapters", "federation_modules", "game_access",
            "game_event_support");

    private static final Pattern INSERT_INTO =
            Pattern.compile("^INSERT\\s+INTO\\s+([A-Za-z_][A-Za-z0-9_]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern UPDATE_GAMES_FEATURES =
            Pattern.compile("^UPDATE\\s+games\\s+SET\\s+features\\s*=", Pattern.CASE_INSENSITIVE);

    private static String sql() throws IOException {
        return Files.readString(REGISTER_SQL, StandardCharsets.UTF_8);
    }

    @Test
    void everySplitStatementSurvivesTheGamesUploadAllowlist() throws IOException {
        List<String> statements = split(sql());

        assertThat(statements)
                .as("the four catalog INSERTs + the feature-flag UPDATE")
                .hasSize(5);
        for (String statement : statements) {
            assertThat(allowed(statement))
                    .as("RegisterSqlPolicy would reject: %s", preview(statement))
                    .isTrue();
        }
    }

    @Test
    void theFourCatalogRowsAndTheFeatureFlagUpdateAreAllPresent() throws IOException {
        List<String> statements = split(sql());
        List<String> targets = new ArrayList<>();
        for (String statement : statements) {
            Matcher insert = INSERT_INTO.matcher(statement);
            targets.add(insert.find() ? insert.group(1).toLowerCase(java.util.Locale.ROOT)
                    : "update:games.features");
        }
        assertThat(targets).containsExactly(
                "games", "chapters", "federation_modules", "game_access", "update:games.features");
    }

    /**
     * The root cause guard: the vetter's lexer treats a {@code --} line as ordinary
     * text, so a semicolon there splits, and an unbalanced quote there flips the
     * in-string state for the REST of the file. Neither may appear in a comment.
     */
    @Test
    void noCommentLineCarriesASemicolonOrAnUnbalancedQuote() throws IOException {
        String[] lines = sql().split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String trimmed = lines[i].trim();
            if (!trimmed.startsWith("--")) {
                continue;
            }
            assertThat(trimmed)
                    .as("register.sql:%d — a semicolon in a comment splits the statement early",
                            i + 1)
                    .doesNotContain(";");
            assertThat(count(trimmed, '\'') % 2)
                    .as("register.sql:%d — an odd number of single quotes in a comment "
                            + "desyncs the vetter's string lexer", i + 1)
                    .isZero();
        }
    }

    /** The constructs {@code RegisterSqlPolicy#rejectUnsupportedLexerConstructs} fails closed on. */
    @Test
    void carriesNoLexerConstructTheVetterFailsClosedOn() throws IOException {
        String body = sql();
        assertThat(body).as("C-style block comments are rejected outright").doesNotContain("/*");
        assertThat(body).as("dollar-quoting is rejected outright").doesNotContain("$$");
        assertThat(Pattern.compile("(?<![A-Za-z0-9_])[Ee]'").matcher(body).find())
                .as("C-style escape strings E'...' are rejected outright")
                .isFalse();
    }

    // ── RegisterSqlPolicy mirror ────────────────────────────────────────

    private static boolean allowed(String statement) {
        Matcher insert = INSERT_INTO.matcher(statement);
        if (insert.find()) {
            return INSERT_TABLES.contains(insert.group(1).toLowerCase(java.util.Locale.ROOT));
        }
        return UPDATE_GAMES_FEATURES.matcher(statement).find();
    }

    /** Verbatim mirror of {@code RegisterSqlPolicy#split}. */
    private static List<String> split(String sql) {
        List<String> statements = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inString = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (inString) {
                cur.append(c);
                if (c == '\'') {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == '\'') {
                        cur.append(sql.charAt(++i));
                    } else {
                        inString = false;
                    }
                }
                continue;
            }
            if (c == '\'') {
                inString = true;
                cur.append(c);
            } else if (c == ';') {
                addIfStatement(statements, cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        addIfStatement(statements, cur.toString());
        return statements;
    }

    private static void addIfStatement(List<String> statements, String raw) {
        String s = stripLeadingComments(raw);
        if (!s.isEmpty()) {
            statements.add(s);
        }
    }

    /** Verbatim mirror of {@code RegisterSqlPolicy#stripLeadingComments}. */
    private static String stripLeadingComments(String raw) {
        String[] lines = raw.split("\n", -1);
        int start = 0;
        while (start < lines.length) {
            String t = lines[start].trim();
            if (t.isEmpty() || t.startsWith("--")) {
                start++;
            } else {
                break;
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < lines.length; i++) {
            if (i > start) {
                sb.append('\n');
            }
            sb.append(lines[i]);
        }
        return sb.toString().trim();
    }

    private static int count(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) {
                n++;
            }
        }
        return n;
    }

    private static String preview(String statement) {
        String flat = statement.replace('\n', ' ').trim();
        return flat.length() > 90 ? flat.substring(0, 90) + "…" : flat;
    }
}
