package io.github.mauriciotorrez1.pos.core.reporting;

import java.time.Duration;
import java.time.ZoneId;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings of the cut reports.
 *
 * @param defaultRecipient used when the business has no {@code owner_email}; empty means none
 * @param zone             the time zone in which the e-mail shows dates
 * @param maxAttempts      how many times a delivery is tried before it is given up
 * @param retryBase        the wait after the first failure; it doubles after each next one
 * @param resubmitEvery    how often the core looks for events whose listener has not finished
 */
@ConfigurationProperties(prefix = "reporting")
public record ReportingProperties(
        String defaultRecipient,
        @DefaultValue("America/Mexico_City") ZoneId zone,
        @DefaultValue("5") int maxAttempts,
        @DefaultValue("1m") Duration retryBase,
        @DefaultValue("30s") Duration resubmitEvery) {
}
