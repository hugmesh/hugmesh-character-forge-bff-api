package net.hugmesh.characterforgebff.support;

import liquibase.integration.spring.SpringLiquibase;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;

/**
 * Runs the PRODUCTION Liquibase changelog over the Testcontainers-Postgres database that
 * {@link net.hugmesh.commons.testsupport.PostgresTestSupport} provisions, for the
 * {@code @DataR2dbcTest} {@code character_forge_character} repository SLICE. COPIED from
 * the hugmesh-forum-bff-api {@code PostgresSliceTestConfig} (package adjusted).
 *
 * <p>WHY a dedicated config (vs. the full-context boot tests): a {@code @DataR2dbcTest}
 * slice auto-configures ONLY the reactive R2DBC stack — it does NOT load Spring Boot's
 * Liquibase auto-configuration. So the slice would run its R2DBC queries against an EMPTY
 * schema. This {@code @TestConfiguration} re-adds a {@link SpringLiquibase} bean
 * (Liquibase has no R2DBC runner, so it uses a JDBC datasource) pointed at the SAME
 * container db that {@code PostgresTestSupport.@DynamicPropertySource} published into
 * {@code spring.liquibase.*}. The reactive {@code ConnectionFactory} the slice wires from
 * {@code spring.r2dbc.*} resolves to the same db, so the repository runs against the real
 * Liquibase-applied schema — including changelog 001's {@code jsonb} definition column,
 * the {@code gen_random_uuid()} PK DEFAULT + {@code RETURNING id}, and the partial unique
 * index {@code ux_character_forge_one_active}, NONE of which an H2 PostgreSQL-compat
 * store could honour. A REAL Postgres is REQUIRED for this slice.
 */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresSliceTestConfig {

    /** JDBC datasource at the container db published by PostgresTestSupport's
     *  {@code spring.liquibase.*} dynamic properties (Liquibase runs over JDBC). */
    @Bean
    public DataSource liquibaseDataSource(
            @Value("${spring.liquibase.url}") String url,
            @Value("${spring.liquibase.user}") String user,
            @Value("${spring.liquibase.password}") String password) {
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("org.postgresql.Driver");
        ds.setUrl(url);
        ds.setUsername(user);
        ds.setPassword(password);
        return ds;
    }

    /** Apply the production changelog over the container db BEFORE the reactive
     *  repository runs (the slice depends on this bean transitively). */
    @Bean
    public SpringLiquibase liquibase(DataSource liquibaseDataSource) {
        SpringLiquibase lb = new SpringLiquibase();
        lb.setDataSource(liquibaseDataSource);
        lb.setChangeLog("classpath:db/changelog/db.changelog-master.xml");
        return lb;
    }
}
