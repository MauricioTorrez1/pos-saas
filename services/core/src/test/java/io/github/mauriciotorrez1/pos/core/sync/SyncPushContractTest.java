package io.github.mauriciotorrez1.pos.core.sync;

import static org.assertj.core.api.Assertions.assertThat;

import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The core reads the same cases of {@code packages/contracts/cases/sync-push.json} that Vitest runs on the
 * register, so the two sides cannot drift: what the register may send is valid here, and what the contract
 * rejects is refused here too (ADR 0040).
 */
class SyncPushContractTest {

    private static final JsonNode CASES = read("/contracts/cases/sync-push.json");
    private static final Schema RESPONSE_SCHEMA = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
            .getSchema(SchemaLocation.of("classpath:contracts/schemas/sync-push-response.schema.json"));

    private final OperationSchema operationSchema = new OperationSchema();

    @Test
    void everyValidRequestOfTheContractPassesTheEnvelopeAndEveryOperationPasses() {
        assertThat(CASES.get("requests")).isNotEmpty();
        for (JsonNode example : CASES.get("requests")) {
            JsonNode request = example.get("request");
            JsonNode registerId = SyncPushService.checkEnvelope(request);
            for (JsonNode operation : request.get("operations")) {
                assertThat(operationSchema.problemWith(registerId, operation))
                        .as(example.get("name").asString() + " / " + operation.get("type").asString()).isEmpty();
            }
        }
    }

    @Test
    void everyRejectionOfTheContractIsRefusedByTheEnvelopeOrByTheOperationCheck() {
        assertThat(CASES.get("request_rejections")).isNotEmpty();
        for (JsonNode example : CASES.get("request_rejections")) {
            assertThat(isRefused(example.get("request"))).as(example.get("name").asString()).isTrue();
        }
    }

    @Test
    void everyResponseOfTheContractIsAcceptedByTheSchemaThatTheTestsUseForTheEndpoint() {
        for (JsonNode example : CASES.get("responses")) {
            assertThat(RESPONSE_SCHEMA.validate(example.get("response"))).as(example.get("name").asString()).isEmpty();
        }
        for (JsonNode example : CASES.get("response_rejections")) {
            assertThat(RESPONSE_SCHEMA.validate(example.get("response"))).as(example.get("name").asString()).isNotEmpty();
        }
    }

    private boolean isRefused(JsonNode request) {
        try {
            JsonNode registerId = SyncPushService.checkEnvelope(request);
            for (JsonNode operation : request.get("operations")) {
                if (operationSchema.problemWith(registerId, operation).isPresent()) {
                    return true;
                }
            }
            return false;
        } catch (InvalidBatchException invalid) {
            return true;
        }
    }

    private static JsonNode read(String resource) {
        try (InputStream cases = SyncPushContractTest.class.getResourceAsStream(resource)) {
            return JsonMapper.builder().build().readTree(Objects.requireNonNull(cases, resource));
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
