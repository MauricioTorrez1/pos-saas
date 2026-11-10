package io.github.mauriciotorrez1.pos.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import io.micrometer.tracing.Tracer;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;

/** A log line written inside a request carries the trace id of its span and the tenant (F0-11). */
@SpringBootTest(classes = CoreApplication.class, properties = {
        "management.tracing.sampling.probability=1.0",
        "management.opentelemetry.tracing.export.otlp.endpoint=http://localhost:1/v1/traces",
        "management.otlp.metrics.export.enabled=false",
        "management.opentelemetry.logging.export.otlp.endpoint=http://localhost:1/v1/logs"
})
@ExtendWith(OutputCaptureExtension.class)
@Import(PostgresTestConfiguration.class)
class ObservabilityTest {

    private static final Logger LOG = LoggerFactory.getLogger(ObservabilityTest.class);

    @Autowired
    private ObservationRegistry registry;

    @Autowired
    private Tracer tracer;

    @Test
    void theLogLineCarriesTheTraceIdAndTheTenant(CapturedOutput output) {
        UUID tenant = Uuid7.next();
        String[] traceId = new String[1];

        TenantContext.runAs(tenant, () -> Observation.createNotStarted("test.request", registry).observe(() -> {
            traceId[0] = tracer.currentSpan().context().traceId();
            LOG.info("inside the request");
        }));

        assertThat(traceId[0]).hasSize(32);
        assertThat(output.getAll()).contains(traceId[0]).contains(tenant.toString()).contains("inside the request");
    }
}
