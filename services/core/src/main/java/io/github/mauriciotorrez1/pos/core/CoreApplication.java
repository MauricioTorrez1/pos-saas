package io.github.mauriciotorrez1.pos.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;
import io.github.mauriciotorrez1.pos.tenant.SentryTenantTagging;
import io.github.mauriciotorrez1.pos.tenant.TenantIsolationConfiguration;
import io.github.mauriciotorrez1.pos.tenant.TenantObservationFilter;

/**
 * Entry point of the core service, a modular monolith.
 *
 * <p>Each direct subpackage of this package is an application module. Its root package is
 * the public API of the module, and its subpackages are internal to it.
 */
@SpringBootApplication
@Import({TenantIsolationConfiguration.class, TenantObservationFilter.class, SentryTenantTagging.class})
public class CoreApplication {

    /**
     * Starts the core service.
     *
     * @param args the command line arguments
     */
    public static void main(String[] args) {
        SpringApplication.run(CoreApplication.class, args);
    }
}
