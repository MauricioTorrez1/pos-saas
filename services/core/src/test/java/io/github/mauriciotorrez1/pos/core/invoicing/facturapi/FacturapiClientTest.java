package io.github.mauriciotorrez1.pos.core.invoicing.facturapi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.mauriciotorrez1.pos.core.invoicing.CancellationMotive;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiNotConfiguredException;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiRejectedException;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiUnavailableException;
import io.github.mauriciotorrez1.pos.core.invoicing.FiscalCustomerData;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalPeriod;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceDraft;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceLineDraft;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceType;
import io.github.mauriciotorrez1.pos.core.invoicing.IssuedInvoice;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** Runs the client against a fake Facturapi built on the JDK HTTP server, so no network or extra library is needed. */
class FacturapiClientTest {

    private static final String SECRET_KEY = "sk_test_NOT_A_REAL_KEY_123";
    private static final String INVOICE_JSON =
            "{\"id\":\"inv_1\",\"uuid\":\"11111111-2222-3333-4444-555555555555\",\"status\":\"valid\","
                    + "\"total\":116.50,\"cancellation_status\":\"none\"}";

    private HttpServer server;
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private final AtomicInteger calls = new AtomicInteger();
    private volatile Responder responder = exchange -> reply(exchange, 200, INVOICE_JSON);
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void startFakeServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            received.add(new Received(
                    exchange.getRequestMethod(),
                    exchange.getRequestURI().toString(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            responder.respond(exchange);
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).addAppender(logs);
    }

    @AfterEach
    void stopFakeServer() {
        server.stop(0);
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).detachAppender(logs);
    }

    @Test
    void createsAnInvoiceSendingTheKeyInTheAuthorizationHeader() {
        IssuedInvoice invoice = client(SECRET_KEY, Duration.ofSeconds(5)).createInvoice(draft());

        assertThat(invoice).isEqualTo(new IssuedInvoice(
                "inv_1", "11111111-2222-3333-4444-555555555555", "valid", "none", 11650));
        Received request = received.get(0);
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.uri()).isEqualTo("/invoices");
        assertThat(request.authorization()).isEqualTo("Bearer " + SECRET_KEY);
        assertThat(request.body())
                .contains("\"type\":\"I\"", "\"customer\":\"cus_1\"", "\"payment_form\":\"01\"", "\"use\":\"G03\"")
                .contains("\"price\":12.5,","\"quantity\":3.275", "\"tax_included\":true", "\"rate\":0.1600");
    }

    @Test
    void sendsTheGlobalPeriodAndTheRelatedInvoicesOfACreditNote() {
        InvoiceDraft global = new InvoiceDraft("cus_public", draft().lines(), "01", "S01", InvoiceType.INCOME,
                new GlobalPeriod("04", "11", 2026), null);
        InvoiceDraft creditNote = new InvoiceDraft("cus_1", draft().lines(), "01", "G03", InvoiceType.CREDIT_NOTE,
                null, List.of("uuid-original"));
        FacturapiClient client = client(SECRET_KEY, Duration.ofSeconds(5));

        client.createInvoice(global);
        client.createInvoice(creditNote);

        assertThat(received.get(0).body()).contains("\"global\":{", "\"periodicity\":\"04\"", "\"year\":2026");
        assertThat(received.get(1).body()).contains("\"type\":\"E\"", "uuid-original");
    }

    @Test
    void createsACustomerAndReturnsItsId() {
        responder = exchange -> reply(exchange, 200, "{\"id\":\"cus_9\"}");

        var customer = client(SECRET_KEY, Duration.ofSeconds(5)).createCustomer(
                new FiscalCustomerData("ESCUELA KEMPER URGATE", "EKU9003173C9", "601", "42501", null));

        assertThat(customer.id()).isEqualTo("cus_9");
        assertThat(received.get(0).uri()).isEqualTo("/customers");
        assertThat(received.get(0).body()).contains("\"tax_id\":\"EKU9003173C9\"", "\"zip\":\"42501\"");
    }

    @Test
    void cancelsWithTheSatMotive() {
        responder = exchange -> reply(exchange, 200, INVOICE_JSON.replace("none", "pending"));

        IssuedInvoice invoice = client(SECRET_KEY, Duration.ofSeconds(5))
                .cancelInvoice("inv_1", CancellationMotive.WITH_RELATED_DOCUMENT, "inv_2");

        assertThat(invoice.cancellationStatus()).isEqualTo("pending");
        assertThat(received.get(0).method()).isEqualTo("DELETE");
        assertThat(received.get(0).uri()).isEqualTo("/invoices/inv_1?motive=01&substitution=inv_2");
    }

    @Test
    void downloadsPdfAndXml() {
        responder = exchange -> reply(exchange, 200, "<cfdi/>");

        FacturapiClient client = client(SECRET_KEY, Duration.ofSeconds(5));

        assertThat(client.downloadXml("inv_1")).isEqualTo("<cfdi/>".getBytes(StandardCharsets.UTF_8));
        assertThat(client.downloadPdf("inv_1")).isNotEmpty();
        assertThat(received).extracting(Received::uri).containsExactly("/invoices/inv_1/xml", "/invoices/inv_1/pdf");
    }

    @Test
    void mapsA4xxToARejectionWithoutRetryingAndKeepsTheProviderTextOutOfTheMessage() {
        responder = exchange -> reply(exchange, 400, "{\"message\":\"RFC XAXX010101000 is not valid\"}");

        assertThatThrownBy(() -> client(SECRET_KEY, Duration.ofSeconds(5)).getInvoice("inv_1"))
                .isInstanceOfSatisfying(FacturapiRejectedException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(400);
                    assertThat(failure.providerMessage()).contains("XAXX010101000");
                    assertThat(failure.getMessage()).doesNotContain("XAXX010101000").contains("HTTP 400");
                });
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void flagsAnInvalidKeyAndAMissingInvoice() {
        responder = exchange -> reply(exchange, 401, "{}");
        assertThatThrownBy(() -> client(SECRET_KEY, Duration.ofSeconds(5)).getInvoice("x"))
                .isInstanceOfSatisfying(FacturapiRejectedException.class,
                        failure -> assertThat(failure.isAuthenticationFailure()).isTrue());

        responder = exchange -> reply(exchange, 404, "{}");
        assertThatThrownBy(() -> client(SECRET_KEY, Duration.ofSeconds(5)).getInvoice("x"))
                .isInstanceOfSatisfying(FacturapiRejectedException.class,
                        failure -> assertThat(failure.isNotFound()).isTrue());
    }

    @Test
    void retriesAReadOn5xxAndSucceeds() {
        responder = exchange -> {
            if (calls.get() < 3) {
                reply(exchange, 503, "{}");
            } else {
                reply(exchange, 200, INVOICE_JSON);
            }
        };

        IssuedInvoice invoice = client(SECRET_KEY, Duration.ofSeconds(5)).getInvoice("inv_1");

        assertThat(invoice.id()).isEqualTo("inv_1");
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void givesUpAReadAfterTheConfiguredRetries() {
        responder = exchange -> reply(exchange, 500, "{}");

        assertThatThrownBy(() -> client(SECRET_KEY, Duration.ofSeconds(5)).getInvoice("inv_1"))
                .isInstanceOfSatisfying(FacturapiUnavailableException.class,
                        failure -> assertThat(failure.status()).isEqualTo(500));
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void neverRetriesAStampOrACancellation() {
        responder = exchange -> reply(exchange, 502, "{}");
        FacturapiClient client = client(SECRET_KEY, Duration.ofSeconds(5));

        assertThatThrownBy(() -> client.createInvoice(draft())).isInstanceOf(FacturapiUnavailableException.class);
        assertThat(calls.get()).isEqualTo(1);

        assertThatThrownBy(() -> client.cancelInvoice("inv_1", CancellationMotive.WITHOUT_RELATED_DOCUMENT, null))
                .isInstanceOf(FacturapiUnavailableException.class);
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void turnsATimeoutIntoUnavailableAndDoesNotRetryAStamp() {
        responder = exchange -> {
            sleep(600);
            reply(exchange, 200, INVOICE_JSON);
        };

        assertThatThrownBy(() -> client(SECRET_KEY, Duration.ofMillis(150)).createInvoice(draft()))
                .isInstanceOfSatisfying(FacturapiUnavailableException.class, failure -> {
                    assertThat(failure.status()).isZero();
                    assertThat(failure.getCause()).isNotNull();
                });
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void retriesAReadThatTimesOut() {
        responder = exchange -> {
            if (calls.get() == 1) {
                sleep(600);
            }
            reply(exchange, 200, INVOICE_JSON);
        };

        assertThat(client(SECRET_KEY, Duration.ofMillis(150)).getInvoice("inv_1").id()).isEqualTo("inv_1");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void failsWithoutCallingTheApiWhenThereIsNoKey() {
        assertThatThrownBy(() -> client("", Duration.ofSeconds(5)).getInvoice("inv_1"))
                .isInstanceOf(FacturapiNotConfiguredException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void neverLogsTheKeyNorFiscalData() {
        responder = exchange -> reply(exchange, 500, "{\"message\":\"RFC XAXX010101000\"}");
        FacturapiClient client = client(SECRET_KEY, Duration.ofSeconds(5));

        assertThatThrownBy(() -> client.getInvoice("inv_1")).isInstanceOf(FacturapiUnavailableException.class);
        assertThatThrownBy(() -> client.createCustomer(
                new FiscalCustomerData("NOMBRE FISCAL", "XAXX010101000", "601", "42501", "a@b.mx")))
                .isInstanceOf(FacturapiUnavailableException.class);

        List<String> lines = new ArrayList<>();
        logs.list.forEach(event -> lines.add(event.getFormattedMessage()));
        assertThat(lines).isNotEmpty();
        assertThat(String.join("\n", lines)).doesNotContain(SECRET_KEY, "XAXX010101000", "NOMBRE FISCAL");
        assertThat(properties(SECRET_KEY, Duration.ofSeconds(5)).toString()).doesNotContain(SECRET_KEY);
        assertThat(new FiscalCustomerData("NOMBRE FISCAL", "XAXX010101000", "601", "42501", null).toString())
                .doesNotContain("XAXX010101000");
    }

    private FacturapiClient client(String key, Duration readTimeout) {
        return new FacturapiClient(properties(key, readTimeout));
    }

    private FacturapiProperties properties(String key, Duration readTimeout) {
        return new FacturapiProperties(key, "http://127.0.0.1:" + server.getAddress().getPort(),
                Duration.ofSeconds(2), readTimeout, 2, Duration.ofMillis(10));
    }

    private static InvoiceDraft draft() {
        return new InvoiceDraft("cus_1",
                List.of(new InvoiceLineDraft("Cable", "26121600", "MTR", "Metro", 125_000, 3_275, 1600)),
                "01", "G03", InvoiceType.INCOME, null, null);
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private record Received(String method, String uri, String authorization, String body) {
    }

    @FunctionalInterface
    private interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }
}
