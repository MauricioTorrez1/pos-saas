package io.github.mauriciotorrez1.pos.tenant;

import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;

/** Replaces the default transaction manager with the one that pins the tenant. */
@Configuration(proxyBeanMethods = false)
public class TenantIsolationConfiguration {

    /**
     * Creates the transaction manager of the application datasource.
     *
     * @param dataSource the datasource of the application role
     * @return a manager that pins {@code app.tenant_id} on each transaction
     */
    @Bean
    PlatformTransactionManager transactionManager(DataSource dataSource) {
        return new TenantAwareTransactionManager(dataSource);
    }
}
