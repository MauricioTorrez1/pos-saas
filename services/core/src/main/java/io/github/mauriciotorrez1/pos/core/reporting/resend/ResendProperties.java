package io.github.mauriciotorrez1.pos.core.reporting.resend;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings of the Resend e-mail API. The key comes only from the environment ({@code RESEND_API_KEY}),
 * never from a file, and an empty key means that nothing is sent.
 *
 * @param apiKey         the secret API key, or empty
 * @param from           the verified sender address, such as {@code Reportes <reportes@example.com>}
 * @param baseUrl        the API address; tests point it to a fake server
 * @param connectTimeout how long to wait for the connection
 * @param readTimeout    how long to wait for the answer
 */
@ConfigurationProperties(prefix = "resend")
public record ResendProperties(
        String apiKey,
        String from,
        @DefaultValue("https://api.resend.com") String baseUrl,
        @DefaultValue("3s") Duration connectTimeout,
        @DefaultValue("10s") Duration readTimeout) {

    /**
     * Tells whether the sender can send.
     *
     * @return {@code true} if there is a key and a sender address
     */
    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank() && from != null && !from.isBlank();
    }

    @Override
    public String toString() {
        return "ResendProperties[baseUrl=" + baseUrl + ", apiKey=" + (apiKey != null && !apiKey.isBlank() ? "***" : "<none>") + "]";
    }
}
