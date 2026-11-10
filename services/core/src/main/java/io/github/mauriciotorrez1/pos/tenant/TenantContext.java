package io.github.mauriciotorrez1.pos.tenant;

import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.MDC;

/**
 * Holds the business (tenant) on whose behalf the current thread works. The transaction manager
 * reads it when a transaction begins and pins it in the database for row-level security.
 */
public final class TenantContext {

    /** Key of the tenant in the logging context, shown in every log line of the transaction. */
    public static final String MDC_KEY = "tenant_id";

    private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    /**
     * Returns the tenant of the current thread.
     *
     * @return the tenant id, or empty when none was set
     */
    public static Optional<UUID> current() {
        return Optional.ofNullable(CURRENT.get());
    }

    /**
     * Runs an action for a tenant and restores the previous one afterwards, even on failure.
     *
     * @param tenantId the tenant the action works for
     * @param action   the action to run
     * @param <T>      the result type
     * @return the result of the action
     */
    public static <T> T callAs(UUID tenantId, Supplier<T> action) {
        UUID previous = CURRENT.get();
        CURRENT.set(java.util.Objects.requireNonNull(tenantId, "tenantId"));
        MDC.put(MDC_KEY, tenantId.toString());
        try {
            return action.get();
        } finally {
            if (previous == null) {
                CURRENT.remove();
                MDC.remove(MDC_KEY);
            } else {
                CURRENT.set(previous);
                MDC.put(MDC_KEY, previous.toString());
            }
        }
    }

    /**
     * Runs an action without a result for a tenant.
     *
     * @param tenantId the tenant the action works for
     * @param action   the action to run
     */
    public static void runAs(UUID tenantId, Runnable action) {
        callAs(tenantId, () -> {
            action.run();
            return null;
        });
    }
}
