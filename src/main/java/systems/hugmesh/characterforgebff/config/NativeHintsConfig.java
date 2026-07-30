package systems.hugmesh.characterforgebff.config;

import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ImportRuntimeHints;
import systems.hugmesh.characterforgebff.character.CharacterForgeCharacter;
import systems.hugmesh.characterforgebff.character.CharacterForgeDto;

/**
 * GraalVM native-image / AOT reachability hints for the bits the static analyzer
 * cannot see through on its own — mirrors the forum-bff / user-bff
 * {@code NativeHintsConfig}.
 *
 * <p>Spring Boot's own AOT processing covers the framework surface (the reactive
 * OAuth2 resource-server JWT pipeline, R2DBC, and the Jackson auto-configuration).
 * What it cannot always infer:
 *
 * <ul>
 *   <li><b>JSON-bound DTOs</b> reached reflectively through Jackson — the records
 *       crossing the HTTP boundary ({@link CharacterForgeDto} nested records and the
 *       {@link CharacterForgeCharacter} entity). They need explicit binding hints so
 *       their canonical constructors/accessors survive native image.</li>
 *   <li><b>The vendored VN pack manifests</b> ({@code vn/packs/**}) — classpath
 *       resources the {@code VnPackManifests} component reads at startup;
 *       native-image strips unlisted classpath resources.</li>
 *   <li><b>The springdoc Swagger UI webjar resources</b> — the bundled assets 404
 *       without an explicit resource-include pattern. The raw {@code /v3/api-docs}
 *       JSON is bean-produced and unaffected.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@ImportRuntimeHints(NativeHintsConfig.Hints.class)
public class NativeHintsConfig {

    static class Hints implements RuntimeHintsRegistrar {
        @Override
        public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
            hints.reflection()
                    .registerType(CharacterForgeDto.CharacterView.class, dtoCategories())
                    .registerType(CharacterForgeDto.CreateCharacter.class, dtoCategories())
                    .registerType(CharacterForgeDto.UpdateCharacter.class, dtoCategories())
                    .registerType(CharacterForgeDto.LookupRequest.class, dtoCategories())
                    .registerType(CharacterForgeDto.LookupResponse.class, dtoCategories())
                    .registerType(CharacterForgeDto.LookupEntry.class, dtoCategories())
                    .registerType(CharacterForgeCharacter.class, dtoCategories());

            hints.resources()
                    .registerPattern("vn/packs/*")
                    .registerPattern("vn/packs/**")
                    .registerPattern("META-INF/resources/webjars/swagger-ui/*")
                    .registerPattern("META-INF/resources/webjars/swagger-ui/**");
        }

        private static MemberCategory[] dtoCategories() {
            return new MemberCategory[] {
                    MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                    MemberCategory.INVOKE_DECLARED_METHODS,
                    MemberCategory.ACCESS_DECLARED_FIELDS,
            };
        }
    }
}
