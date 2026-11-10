package io.github.mauriciotorrez1.pos.core.invoicing.facturapi;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings of the Facturapi client, bound from {@code facturapi.*}.
 *
 * @param apiKey secret key of the account; comes from {@code FACTURAPI_API_KEY} and is never logged
 * @param baseUrl API root; the test key and the live key use the same URL and differ in the account mode
 * @param connectTimeout time allowed to open the connection
 * @param readTimeout time allowed to wait for each response
 * @param maxRetries extra attempts for operations that are safe to repeat (reads); writes are never retried
 * @param retryBackoff wait before the first retry; it doubles on each retry
 */
@ConfigurationProperties(prefix = "facturapi")
public record FacturapiProperties(
        String apiKey,
        @DefaultValue("https://www.facturapi.io/v2") String baseUrl,
        @DefaultValue("3s") Duration connectTimeout,
        @DefaultValue("20s") Duration readTimeout,
        @DefaultValue("2") int maxRetries,
        @DefaultValue("300ms") Duration retryBackoff) {

    /** @return {@code true} when a key was provided */
    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    /** Leaves the key out so printing the settings cannot leak it. */
    @Override
    public String toString() {
        return "FacturapiProperties[baseUrl=" + baseUrl + ", apiKey=" + (hasApiKey() ? "***" : "<none>") + "]";
    }
}
