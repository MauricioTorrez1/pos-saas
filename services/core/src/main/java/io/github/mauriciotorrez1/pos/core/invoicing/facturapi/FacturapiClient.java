package io.github.mauriciotorrez1.pos.core.invoicing.facturapi;

import io.github.mauriciotorrez1.pos.core.invoicing.CancellationMotive;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiNotConfiguredException;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiRejectedException;
import io.github.mauriciotorrez1.pos.core.invoicing.FacturapiUnavailableException;
import io.github.mauriciotorrez1.pos.core.invoicing.FiscalCustomer;
import io.github.mauriciotorrez1.pos.core.invoicing.FiscalCustomerData;
import io.github.mauriciotorrez1.pos.core.invoicing.FiscalInvoicing;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalPeriod;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceDraft;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceLineDraft;
import io.github.mauriciotorrez1.pos.core.invoicing.IssuedInvoice;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link FiscalInvoicing} over the Facturapi REST API (ADR 0041).
 *
 * <p>Reads are retried with exponential backoff on 5xx, 429 and network failures. Writes ({@code POST} and
 * {@code DELETE}) are sent once, because a retry after a lost response could stamp or cancel twice. Logs hold the
 * operation, status and attempt only: no key, no request or response body.
 */
public class FacturapiClient implements FiscalInvoicing {

    private static final Logger LOG = LoggerFactory.getLogger(FacturapiClient.class);
    private static final BigDecimal E4 = BigDecimal.valueOf(10_000);
    private static final BigDecimal MILLI = BigDecimal.valueOf(1_000);

    private final FacturapiProperties properties;
    private final RestClient restClient;
    private final JsonMapper json = JsonMapper.builder().build();

    /**
     * Creates the client.
     *
     * @param properties key, URL, timeouts and retry settings
     */
    public FacturapiClient(FacturapiProperties properties) {
        this.properties = properties;
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.readTimeout());
        this.restClient = RestClient.builder().baseUrl(properties.baseUrl()).requestFactory(factory).build();
    }

    @Override
    public FiscalCustomer createCustomer(FiscalCustomerData customer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("legal_name", customer.legalName());
        body.put("tax_id", customer.taxId());
        body.put("tax_system", customer.taxSystem());
        body.put("address", Map.of("zip", customer.zipCode()));
        if (customer.email() != null) {
            body.put("email", customer.email());
        }
        JsonNode response = parse("createCustomer", send("createCustomer", HttpMethod.POST, "/customers", body, false));
        return new FiscalCustomer(requiredText("createCustomer", response, "id"));
    }

    @Override
    public IssuedInvoice createInvoice(InvoiceDraft draft) {
        byte[] response = send("createInvoice", HttpMethod.POST, "/invoices", invoiceBody(draft), false);
        return toInvoice("createInvoice", response);
    }

    @Override
    public IssuedInvoice getInvoice(String invoiceId) {
        return toInvoice("getInvoice", send("getInvoice", HttpMethod.GET, "/invoices/" + invoiceId, null, true));
    }

    @Override
    public IssuedInvoice cancelInvoice(String invoiceId, CancellationMotive motive, String substituteInvoiceId) {
        String path = "/invoices/" + invoiceId + "?motive=" + motive.satCode()
                + (substituteInvoiceId != null ? "&substitution=" + substituteInvoiceId : "");
        return toInvoice("cancelInvoice", send("cancelInvoice", HttpMethod.DELETE, path, null, false));
    }

    @Override
    public byte[] downloadPdf(String invoiceId) {
        return send("downloadPdf", HttpMethod.GET, "/invoices/" + invoiceId + "/pdf", null, true);
    }

    @Override
    public byte[] downloadXml(String invoiceId) {
        return send("downloadXml", HttpMethod.GET, "/invoices/" + invoiceId + "/xml", null, true);
    }

    private Map<String, Object> invoiceBody(InvoiceDraft draft) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", draft.type().satCode());
        body.put("customer", draft.customerId());
        body.put("payment_form", draft.paymentForm());
        body.put("use", draft.cfdiUse());
        List<Map<String, Object>> items = new ArrayList<>();
        draft.lines().forEach(line -> items.add(itemBody(line)));
        body.put("items", items);
        GlobalPeriod period = draft.globalPeriod();
        if (period != null) {
            body.put("global", Map.of("periodicity", period.periodicity(), "months", period.months(), "year", period.year()));
        }
        if (!draft.relatedInvoiceUuids().isEmpty()) {
            body.put("related_documents", List.of(Map.of("relationship", "01", "documents", draft.relatedInvoiceUuids())));
        }
        return body;
    }

    private Map<String, Object> itemBody(InvoiceLineDraft line) {
        List<Map<String, Object>> taxes = new ArrayList<>();
        if (line.taxRateBasisPoints() != null) {
            BigDecimal rate = BigDecimal.valueOf(line.taxRateBasisPoints()).movePointLeft(4);
            taxes.add(Map.of("type", "IVA", "rate", rate));
        }
        Map<String, Object> product = new LinkedHashMap<>();
        product.put("description", line.description());
        product.put("product_key", line.satProductKey());
        product.put("unit_key", line.satUnitKey());
        product.put("unit_name", line.unitName());
        product.put("price", BigDecimal.valueOf(line.unitPriceE4()).divide(E4));
        product.put("tax_included", true);
        product.put("taxes", taxes);
        return Map.of("quantity", BigDecimal.valueOf(line.quantityMilli()).divide(MILLI), "product", product);
    }

    private byte[] send(String operation, HttpMethod method, String path, Object body, boolean retryable) {
        if (!properties.hasApiKey()) {
            throw new FacturapiNotConfiguredException(operation);
        }
        int attempts = retryable ? properties.maxRetries() + 1 : 1;
        long backoffMillis = properties.retryBackoff().toMillis();
        for (int attempt = 1; ; attempt++) {
            try {
                return attemptOnce(operation, method, path, body);
            } catch (FacturapiUnavailableException failure) {
                LOG.warn("Facturapi {} failed on attempt {} of {} (status {})", operation, attempt, attempts, failure.status());
                if (attempt >= attempts) {
                    throw failure;
                }
                pause(backoffMillis << (attempt - 1));
            }
        }
    }

    private byte[] attemptOnce(String operation, HttpMethod method, String path, Object body) {
        try {
            RestClient.RequestBodySpec request = restClient.method(method)
                    .uri(URI.create(properties.baseUrl() + path))
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + properties.apiKey())
                    .accept(MediaType.ALL);
            if (body != null) {
                request.contentType(MediaType.APPLICATION_JSON).body(json.writeValueAsBytes(body));
            }
            return request.exchange((req, res) -> {
                int status = res.getStatusCode().value();
                byte[] payload = res.getBody().readAllBytes();
                if (status >= 200 && status < 300) {
                    return payload;
                }
                if (status >= 500 || status == 429) {
                    throw new FacturapiUnavailableException(operation, status, null);
                }
                throw new FacturapiRejectedException(operation, status, providerMessage(payload));
            });
        } catch (ResourceAccessException failure) {
            throw new FacturapiUnavailableException(operation, 0, failure);
        } catch (RestClientException | JacksonException failure) {
            throw new FacturapiUnavailableException(operation, 0, failure);
        }
    }

    private String providerMessage(byte[] payload) {
        try {
            JsonNode message = json.readTree(payload).path("message");
            return message.isString() ? message.asString() : null;
        } catch (JacksonException notJson) {
            return null;
        }
    }

    private IssuedInvoice toInvoice(String operation, byte[] response) {
        JsonNode node = parse(operation, response);
        BigDecimal total = node.path("total").isNumber() ? node.path("total").decimalValue() : BigDecimal.ZERO;
        return new IssuedInvoice(
                requiredText(operation, node, "id"),
                optionalText(node, "uuid"),
                optionalText(node, "status"),
                optionalText(node, "cancellation_status"),
                total.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact());
    }

    private JsonNode parse(String operation, byte[] response) {
        try {
            return json.readTree(response);
        } catch (JacksonException failure) {
            throw new FacturapiUnavailableException(operation, 0, failure);
        }
    }

    private String requiredText(String operation, JsonNode node, String field) {
        String value = optionalText(node, field);
        if (value == null) {
            throw new FacturapiUnavailableException(operation, 0, null);
        }
        return value;
    }

    private String optionalText(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isString() ? value.asString() : null;
    }

    private void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
