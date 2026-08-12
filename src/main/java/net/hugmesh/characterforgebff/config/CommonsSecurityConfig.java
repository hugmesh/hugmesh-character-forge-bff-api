package net.hugmesh.characterforgebff.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import net.hugmesh.commons.config.TenancyResourceServerConfig;
import net.hugmesh.commons.security.DomainRegistry;

/**
 * Registers the shared {@code net.hugmesh.commons} security/tenancy beans into
 * this consumer's application context — the canonical wiring step of the commons
 * adoption recipe (see the forum-bff exemplar).
 *
 * <p>The {@code @SpringBootApplication} component scan covers
 * {@code net.hugmesh.characterforgebff} but NOT {@code net.hugmesh.commons.*},
 * so rather than widen {@code scanBasePackages} to the whole commons tree (which would
 * auto-adopt every future commons {@code @Component} implicitly), we {@code @Import}
 * exactly the two commons beans this BFF needs:
 * <ul>
 *   <li>{@link DomainRegistry} — the issuer->domain registry consumed by
 *       {@code SecurityConfig}, the converter and the {@code PrincipalDomain} bean. Its
 *       {@code @Value} constructor wiring
 *       ({@code spring.security.oauth2.resourceserver.jwt.issuer-uri} +
 *       {@code app.tenancy.issuers}) is honoured by {@code @Import} exactly as a
 *       component scan would.</li>
 *   <li>{@link TenancyResourceServerConfig} — the CONFIG-GATED multi-issuer wiring.
 *       Importing the {@code @Configuration} class PRESERVES its
 *       {@code @ConditionalOnExpression("'${app.tenancy.issuers:}'.contains('=')")}
 *       guard, so single-issuer clusters stay byte-for-byte on the existing
 *       single-issuer path and the {@code tenantAuthManagerResolver} {@code @Bean} is
 *       contributed ONLY when real {@code issuer=domain} pairs are configured.</li>
 * </ul>
 */
@Configuration
@Import({DomainRegistry.class, TenancyResourceServerConfig.class})
public class CommonsSecurityConfig {
}
