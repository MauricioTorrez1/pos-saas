package io.github.mauriciotorrez1.pos.tenant;

import io.micrometer.common.KeyValue;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationFilter;
import org.springframework.stereotype.Component;

/**
 * Adds the tenant to every trace span. It is a high-cardinality key: it goes to the trace, never to
 * a metric label, so Prometheus does not grow one series per business.
 */
@Component
public class TenantObservationFilter implements ObservationFilter {

    @Override
    public Observation.Context map(Observation.Context context) {
        TenantContext.current()
                .ifPresent(tenant -> context.addHighCardinalityKeyValue(KeyValue.of("tenant.id", tenant.toString())));
        return context;
    }
}
