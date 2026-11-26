package io.github.mauriciotorrez1.pos.core.invoicing;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Serializes the claims of the individual and the global invoices of one business (ADR 0077). Without it, a sale
 * could be claimed by its own invoice and by a global at the same moment, each transaction seeing the sale free.
 */
final class InvoicingLock {

    private InvoicingLock() {
    }

    /**
     * Takes a lock that lasts until the current transaction ends. Must run inside a transaction.
     *
     * @param jdbc the template of that transaction
     */
    static void acquire(JdbcTemplate jdbc) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtext('invoicing'), hashtext(current_tenant_id()::text))", rs -> null);
    }
}
