package io.github.mauriciotorrez1.pos.ingest;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Reads typed values from a payload that already passed the shared JSON Schema, so every mandatory
 * field exists and has the right type. Amounts are read as {@code long}: the schema keeps them inside
 * the range that JavaScript represents exactly (ADR 0011).
 */
public final class Payload {

    private Payload() {
    }

    /**
     * Reads a mandatory UUID.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the id
     */
    public static UUID uuid(JsonNode node, String field) {
        return UUID.fromString(node.get(field).asString());
    }

    /**
     * Reads an optional UUID.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the id, or {@code null} when the field is null
     */
    public static UUID nullableUuid(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : UUID.fromString(value.asString());
    }

    /**
     * Reads a mandatory text.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the text
     */
    public static String text(JsonNode node, String field) {
        return node.get(field).asString();
    }

    /**
     * Reads an optional text.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the text, or {@code null} when the field is null
     */
    public static String nullableText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }

    /**
     * Reads an integer amount or quantity.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the value
     */
    public static long number(JsonNode node, String field) {
        return node.get(field).longValue();
    }

    /**
     * Reads a UTC timestamp as the type the PostgreSQL driver accepts.
     *
     * @param node  the object that holds the field
     * @param field the field name
     * @return the moment at UTC
     */
    public static OffsetDateTime moment(JsonNode node, String field) {
        return at(Instant.parse(node.get(field).asString()));
    }

    /**
     * Converts an instant to the type the PostgreSQL driver accepts.
     *
     * @param instant the instant
     * @return the moment at UTC
     */
    public static OffsetDateTime at(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
