package io.github.mauriciotorrez1.pos.core.sync;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Validates one operation against the JSON Schema that the register also uses
 * ({@code packages/contracts/schemas/sync-push-request.schema.json}), so a drift between the two
 * sides cannot pass unnoticed (ADR 0040). The schema is validated per operation, not per batch,
 * because one bad operation must not stop the good ones (RF-022).
 */
@Component
class OperationSchema {

    private static final String REQUEST_SCHEMA = "classpath:contracts/schemas/sync-push-request.schema.json";
    private static final int MAX_ERRORS_SHOWN = 3;
    private static final int MAX_REASON_LENGTH = 500;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final Schema schema;

    OperationSchema() {
        this.schema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
                .getSchema(SchemaLocation.of(REQUEST_SCHEMA));
    }

    /**
     * Checks an operation as the schema defines it: its keys, its types and the payload of its type.
     *
     * @param registerId the register that sent the batch, a valid UUIDv7
     * @param operation  the operation as received
     * @return the reason why it is not valid, or empty when it is valid
     */
    Optional<String> problemWith(JsonNode registerId, JsonNode operation) {
        ObjectNode single = JSON.createObjectNode();
        single.set("registerId", registerId);
        single.putArray("operations").add(operation);
        List<Error> errors = schema.validate(single);
        if (errors.isEmpty()) {
            return Optional.empty();
        }
        String reason = errors.stream()
                .limit(MAX_ERRORS_SHOWN)
                .map(error -> error.getMessage().replace("$.operations[0]", "operation"))
                .collect(Collectors.joining("; "));
        return Optional.of(reason.length() > MAX_REASON_LENGTH ? reason.substring(0, MAX_REASON_LENGTH) : reason);
    }
}
