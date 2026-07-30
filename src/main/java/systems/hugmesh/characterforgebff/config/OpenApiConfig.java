package systems.hugmesh.characterforgebff.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Minimal OpenAPI document metadata for the character-forge BFF spec served by
 * springdoc-openapi-starter-webflux-ui at {@code /v3/api-docs}.
 *
 * <p>Sets a stable {@code info.title} (the service name) + {@code info.version} so
 * the generated artefacts downstream are sensibly named: the platform
 * ng-openapi-gen typed client for the paired in-repo {@code frontend/} remote and
 * the docs pipeline key off these fields. A programmatic {@link OpenAPI} bean is
 * used (rather than the {@code @OpenAPIDefinition} annotation) so the metadata is
 * plain bean wiring — no annotation reflection scan, which keeps the GraalVM native
 * build hint surface minimal.
 */
@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {

    static {
        // The DTO `definition` fields are Jackson-3 JsonNode (the Boot-4 WebFlux
        // codec type — see CharacterForgeDto). springdoc does not know that type and
        // would introspect it as a BEAN, emitting a nonsense schema of boolean
        // getter properties (string/container/valueNode/...) whose reflection order
        // is JVM-nondeterministic (it churned the committed openapi.json). Map it to
        // Object => a free-form `object` schema — truthful: the field IS arbitrary
        // (server-validated) JSON.
        org.springdoc.core.utils.SpringDocUtils.getConfig()
                .replaceWithClass(tools.jackson.databind.JsonNode.class, Object.class);
    }

    @Bean
    OpenAPI characterForgeBffOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("hugmesh-character-forge-bff-api")
                        .version("0.1.0")
                        .description("Character-forge BFF API (/bff/character-forge/**) — "
                                + "owner-scoped 3D character (Char3DConfig) CRUD with full "
                                + "server-side schema validation, the single ACTIVE character "
                                + "per owner, the batched subject→active-config lookup the XR "
                                + "chat room resolves avatars with, and the pure "
                                + "VnCharacter→Char3DConfig /map function."));
    }
}
