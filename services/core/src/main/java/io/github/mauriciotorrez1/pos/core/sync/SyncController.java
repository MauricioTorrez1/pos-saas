package io.github.mauriciotorrez1.pos.core.sync;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * {@code POST /sync/push}: receives the batch of a register (RF-021). The business is the one of the
 * validated token (ADR 0039), so a body that names another business is refused, not obeyed. The answer
 * follows {@code sync-push-response.schema.json}: HTTP 200 with a result per operation handled, or a
 * problem (400, 503) that means nothing was confirmed.
 */
@RestController
class SyncController {

    private final SyncPushService service;

    SyncController(SyncPushService service) {
        this.service = service;
    }

    /**
     * Applies a batch of up to 100 operations.
     *
     * @param body the batch, as in {@code sync-push-request.schema.json}
     * @return 200 with a result per operation handled, or 503 if the core could not handle even the first
     */
    @PostMapping(path = "/sync/push", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> push(@RequestBody JsonNode body) {
        SyncPushService.PushOutcome outcome = service.push(body);
        if (outcome.stopped() && outcome.results().isEmpty()) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "The core could not handle the batch. Nothing was confirmed; send it again later.");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(problem);
        }
        return ResponseEntity.ok(new PushResponse(outcome.results()));
    }

    @ExceptionHandler(InvalidBatchException.class)
    ProblemDetail invalidBatch(InvalidBatchException invalid) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, invalid.getMessage());
    }

    /**
     * The body of a 200 answer.
     *
     * @param results one result per operation handled
     */
    record PushResponse(List<SyncResult> results) {
    }
}
