package io.github.mauriciotorrez1.pos.core.reporting;

import java.util.Objects;
import java.util.UUID;

/**
 * One sensitive change to record: who did what to which entity, with the value before and after.
 * The values are JSON text built by the caller. They must hold ids and business values only:
 * never PINs, tokens, card data, or personal data that the audit does not need (OWASP Logging).
 *
 * @param actorId    the user who acted, or {@code null} for an action of the system itself
 * @param action     what happened, in lowercase with dots, such as {@code price.changed}
 * @param entityType the kind of entity changed, in lowercase with underscores, such as {@code product}
 * @param entityId   the id of the entity changed
 * @param oldValue   the JSON value before the change, or {@code null} for a creation
 * @param newValue   the JSON value after the change, or {@code null} for a removal
 */
public record AuditEntry(UUID actorId, String action, String entityType, UUID entityId,
                         String oldValue, String newValue) {

    /** Checks that the mandatory fields are present. */
    public AuditEntry {
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(entityType, "entityType");
        Objects.requireNonNull(entityId, "entityId");
    }
}
