package io.github.mauriciotorrez1.pos.core.reporting.resend;

import io.github.mauriciotorrez1.pos.core.reporting.EmailNotConfiguredException;
import io.github.mauriciotorrez1.pos.core.reporting.EmailRejectedException;
import io.github.mauriciotorrez1.pos.core.reporting.EmailSender;
import io.github.mauriciotorrez1.pos.core.reporting.EmailUnavailableException;
import java.net.http.HttpClient;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Sends e-mail through the HTTPS API of Resend (free tier, ADR 0052). The call carries an
 * {@code Idempotency-Key}, so repeating it after an unknown outcome does not deliver twice. Nothing
 * of the answer or of the message is kept in exceptions or logs: both can hold an address.
 */
class ResendEmailSender implements EmailSender {

    private final ResendProperties properties;
    private final RestClient restClient;

    ResendEmailSender(ResendProperties properties) {
        this.properties = properties;
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.readTimeout());
        this.restClient = RestClient.builder().baseUrl(properties.baseUrl()).requestFactory(factory).build();
    }

    @Override
    public void send(EmailMessage message) {
        if (!properties.isConfigured()) {
            throw new EmailNotConfiguredException();
        }
        Map<String, Object> body = Map.of(
                "from", properties.from(),
                "to", List.of(message.to()),
                "subject", message.subject(),
                "text", message.textBody());
        try {
            restClient.post().uri("/emails")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + properties.apiKey())
                    .header("Idempotency-Key", message.idempotencyKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .exchange((request, response) -> {
                        int status = response.getStatusCode().value();
                        if (status >= 200 && status < 300) {
                            return null;
                        }
                        if (status >= 500 || status == 429) {
                            throw new EmailUnavailableException(status, null);
                        }
                        throw new EmailRejectedException(status);
                    });
        } catch (RestClientException failure) {
            throw new EmailUnavailableException(0, failure);
        }
    }
}
