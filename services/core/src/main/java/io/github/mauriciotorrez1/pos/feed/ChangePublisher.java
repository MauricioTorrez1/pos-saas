package io.github.mauriciotorrez1.pos.feed;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * Announces that something a register must know has changed: a product, a price, the permissions of a person.
 * The module that owns the data calls it inside the same transaction that changes the data, so the change and
 * its announcement are saved or lost together. The sync module implements it and numbers the change in the feed
 * that registers download (ADR 0048), so the owner modules never depend on {@code sync}.
 *
 * <p>Calling it twice in one transaction is allowed: the register applies the changes in order and the last one wins.
 */
public interface ChangePublisher {

    /** A product with its price, barcodes and tax. The shape of each payload is in {@code packages/contracts}. */
    String PRODUCT = "product";
    /** A staff member with the permissions that the register enforces without internet. */
    String STAFF_MEMBER = "staff_member";

    /**
     * Publishes the new state of an entity, whether it was created or changed.
     *
     * @param entityType what kind of entity it is, such as {@link #PRODUCT}
     * @param entityId   the id of the entity
     * @param payload    the whole state of the entity after the change, as the contract of its type defines it
     * @throws org.springframework.transaction.IllegalTransactionStateException if no transaction is active
     */
    void publish(String entityType, UUID entityId, JsonNode payload);

    /**
     * Publishes that an entity was removed, so every register removes it too (a tombstone).
     *
     * @param entityType what kind of entity it is
     * @param entityId   the id of the entity
     * @throws org.springframework.transaction.IllegalTransactionStateException if no transaction is active
     */
    void publishDeletion(String entityType, UUID entityId);
}
