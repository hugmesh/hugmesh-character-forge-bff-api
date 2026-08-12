package net.hugmesh.characterforgebff.config;

import io.r2dbc.postgresql.codec.Json;
import io.r2dbc.spi.ConnectionFactory;
import org.springframework.boot.data.r2dbc.autoconfigure.DataR2dbcAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.data.convert.ReadingConverter;
import org.springframework.data.r2dbc.convert.R2dbcCustomConversions;
import org.springframework.data.r2dbc.dialect.DialectResolver;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;

/**
 * R2DBC type-conversion shims for the character-forge BFF's Postgres data source.
 * Copied from the forum-bff / user-bff {@code R2dbcConvertersConfig}, plus one
 * repo-specific converter for the {@code jsonb} definition column.
 *
 * <h2>Why these shims are needed</h2>
 *
 * <p>The Postgres R2DBC driver returns {@code OffsetDateTime} for {@code timestamptz}
 * columns and {@code LocalDateTime} for plain {@code timestamp} columns, but the entity
 * record ({@link net.hugmesh.characterforgebff.character.CharacterForgeCharacter
 * CharacterForgeCharacter}) declares its timestamp fields as {@link java.time.Instant
 * Instant}. Spring Data R2DBC's reflective JSR-310 fallback converters are silently
 * skipped under GraalVM native-image AOT compilation, so registering the reading
 * converters explicitly keeps the conversion deterministic in both JVM and
 * native-image modes.
 *
 * <p>The {@code definition} column is {@code jsonb}: the Postgres driver surfaces it
 * as {@link Json}, which {@link PgJsonToStringConverter} maps onto the entity's
 * {@code String} field. READ side only — the WRITE side never entity-maps the
 * definition: the repository INSERT/UPDATE legs bind it as text and
 * {@code CAST(:def AS jsonb)} in SQL (see
 * {@code CharacterForgeCharacterR2dbcRepository}), so no String→Json writing
 * converter (which would hijack EVERY String column) is ever registered.
 *
 * @see net.hugmesh.characterforgebff.config.NativeHintsConfig
 */
@Configuration(proxyBeanMethods = false)
public class R2dbcConvertersConfig {

    /**
     * Replaces the auto-configured {@link R2dbcCustomConversions} bean
     * (see {@link DataR2dbcAutoConfiguration}) with the dialect defaults plus the
     * explicit reading converters needed for JVM and native-image modes.
     *
     * @param connectionFactory the R2DBC connection factory used to resolve the
     *                          active dialect and its built-in converters
     * @return a {@link R2dbcCustomConversions} instance that maps
     *         {@code OffsetDateTime}/{@code LocalDateTime} to {@link Instant} and
     *         Postgres {@link Json} to {@code String}
     */
    @Bean
    public R2dbcCustomConversions r2dbcCustomConversions(ConnectionFactory connectionFactory) {
        var dialect = DialectResolver.getDialect(connectionFactory);
        var converters = new ArrayList<Object>(dialect.getConverters());
        converters.add(new OffsetDateTimeToInstantConverter());
        converters.add(new LocalDateTimeToInstantConverter());
        converters.add(new PgJsonToStringConverter());
        return R2dbcCustomConversions.of(dialect, converters);
    }

    /**
     * Reading converter: maps the {@code OffsetDateTime} the Postgres R2DBC driver
     * returns for {@code timestamptz} columns to the {@link Instant} the entity
     * record declares.
     */
    @ReadingConverter
    static class OffsetDateTimeToInstantConverter implements Converter<OffsetDateTime, Instant> {
        /**
         * @param source the {@code OffsetDateTime} read from the Postgres column
         * @return the equivalent {@link Instant} (UTC epoch)
         */
        @Override public Instant convert(OffsetDateTime source) { return source.toInstant(); }
    }

    /**
     * Reading converter: maps the {@code LocalDateTime} the Postgres R2DBC driver
     * returns for plain {@code timestamp} columns to {@link Instant} (treating the
     * value as UTC, which is the convention for all timestamp columns in this schema).
     */
    @ReadingConverter
    static class LocalDateTimeToInstantConverter implements Converter<LocalDateTime, Instant> {
        /**
         * @param source the {@code LocalDateTime} read from the column (assumed UTC)
         * @return the equivalent {@link Instant} pinned to {@link ZoneOffset#UTC}
         */
        @Override public Instant convert(LocalDateTime source) { return source.toInstant(ZoneOffset.UTC); }
    }

    /**
     * Reading converter: maps the Postgres driver's {@link Json} codec value (what a
     * {@code jsonb} column reads back as) onto the entity's {@code String} definition
     * field. Read-only by design — see the class doc for why there is deliberately NO
     * String→Json writing twin.
     */
    @ReadingConverter
    static class PgJsonToStringConverter implements Converter<Json, String> {
        /**
         * @param source the {@code jsonb} column value as the driver's {@link Json}
         * @return the canonical JSON text stored in the column
         */
        @Override public String convert(Json source) { return source.asString(); }
    }
}
