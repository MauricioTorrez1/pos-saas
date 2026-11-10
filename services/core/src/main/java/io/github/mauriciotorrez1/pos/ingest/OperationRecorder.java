package io.github.mauriciotorrez1.pos.ingest;

import java.util.Set;

/**
 * Turns one kind of operation that a register uploads into the records of the module that owns them.
 * The sync module collects every recorder and dispatches by type, so it never depends on the modules
 * that store the data. A recorder runs inside the transaction of the operation: if it throws, nothing
 * of that operation is saved.
 */
public interface OperationRecorder {

    /**
     * Returns the operation types this recorder handles, such as {@code sale.completed}.
     *
     * @return the types, never empty
     */
    Set<String> types();

    /**
     * Stores the records of an operation that already passed the shared JSON Schema.
     *
     * @param operation the validated operation
     * @throws OperationRejectedException if the operation breaks a business rule; the operation then goes to quarantine
     * @throws org.springframework.transaction.IllegalTransactionStateException if no transaction is active
     */
    void record(RegisterOperation operation);
}
