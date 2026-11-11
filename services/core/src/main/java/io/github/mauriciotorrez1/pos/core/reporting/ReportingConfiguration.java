package io.github.mauriciotorrez1.pos.core.reporting;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.modulith.events.IncompleteEventPublications;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Turns on asynchronous listeners and the periodic offer of pending events. This is the scheduler that
 * ADR 0036 left for later: it resubmits every event whose listener has not finished, so a cut report
 * that failed, or one interrupted by a restart, is tried again (ADR 0052).
 */
@Configuration(proxyBeanMethods = false)
@EnableAsync
@EnableScheduling
@EnableConfigurationProperties(ReportingProperties.class)
class ReportingConfiguration {

    private static final Logger LOG = LoggerFactory.getLogger(ReportingConfiguration.class);
    /** Gives the first attempt time to finish before the event is offered a second time. */
    private static final Duration MIN_AGE = Duration.ofSeconds(20);

    private final IncompleteEventPublications incomplete;

    ReportingConfiguration(IncompleteEventPublications incomplete) {
        this.incomplete = incomplete;
    }

    /** Offers the pending events again. */
    @Scheduled(fixedDelayString = "${reporting.resubmit-every:30s}", initialDelayString = "${reporting.resubmit-every:30s}")
    void resubmitPendingEvents() {
        try {
            incomplete.resubmitIncompletePublicationsOlderThan(MIN_AGE);
        } catch (RuntimeException failure) {
            LOG.warn("Could not offer the pending events again: {}", failure.getClass().getName());
        }
    }
}
