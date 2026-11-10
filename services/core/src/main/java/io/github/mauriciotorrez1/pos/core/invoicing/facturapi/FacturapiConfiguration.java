package io.github.mauriciotorrez1.pos.core.invoicing.facturapi;

import io.github.mauriciotorrez1.pos.core.invoicing.FiscalInvoicing;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Wires the Facturapi client. The service starts without a key; the calls fail until one is set. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(FacturapiProperties.class)
class FacturapiConfiguration {

    @Bean
    FiscalInvoicing fiscalInvoicing(FacturapiProperties properties) {
        return new FacturapiClient(properties);
    }
}
