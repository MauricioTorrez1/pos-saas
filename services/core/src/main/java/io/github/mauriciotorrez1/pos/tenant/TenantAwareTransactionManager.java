package io.github.mauriciotorrez1.pos.tenant;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Transaction manager that runs {@code SET LOCAL app.tenant_id} as the first statement of every
 * transaction (ADR 0004, ADR 0035). Hooking the manager instead of an annotation covers every way
 * to open a transaction, so no code path can forget it.
 *
 * <p>The value is local to the transaction: it disappears on commit or rollback, so a pooled
 * connection never carries it to the next request. With no tenant in {@link TenantContext}
 * nothing is set and row-level security hides every row.
 */
public class TenantAwareTransactionManager extends JdbcTransactionManager {

    private static final String PIN_TENANT = "SELECT set_config('app.tenant_id', ?, true)";

    /**
     * Creates the manager.
     *
     * @param dataSource the data source of the application role
     */
    public TenantAwareTransactionManager(DataSource dataSource) {
        super(dataSource);
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
        super.doBegin(transaction, definition);
        Optional<UUID> tenant = TenantContext.current();
        if (tenant.isEmpty()) {
            return;
        }
        try {
            pinTenant(tenant.get());
        } catch (SQLException ex) {
            doCleanupAfterCompletion(transaction);
            throw new CannotCreateTransactionException("Could not pin the tenant on the transaction", ex);
        }
    }

    private void pinTenant(UUID tenantId) throws SQLException {
        ConnectionHolder holder = (ConnectionHolder) TransactionSynchronizationManager.getResource(obtainDataSource());
        Connection connection = holder.getConnection();
        try (PreparedStatement statement = connection.prepareStatement(PIN_TENANT)) {
            statement.setString(1, tenantId.toString());
            statement.execute();
        }
    }
}
