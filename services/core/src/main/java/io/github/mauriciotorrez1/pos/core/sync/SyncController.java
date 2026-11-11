package io.github.mauriciotorrez1.pos.core.sync;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * {@code POST /sync/push}: receives the batch of a register (RF-021). The business is the one of the
 * validated token (ADR 0039), so a body that names another business is refused, not obeyed. The answer
 * follows {@code sync-push-response.schema.json}: HTTP 200 with a result per operation handled, or a
 * problem (400, 503) that means nothing was confirmed. {@code GET /sync/pull} gives the register what changed
 * in the catalog, prices and permissions since its cursor (RF-023).
 */
@RestController
class SyncController {

    private static final Set<String> PULL_PARAMETERS = Set.of("cursor", "limit");

    private final SyncPushService service;
    private final SyncPullService pullService;

    SyncController(SyncPushService service, SyncPullService pullService) {
        this.service = service;
        this.pullService = pullService;
    }

    /**
     * Gives the next page of changes after a cursor, as in {@code sync-pull-response.schema.json}. The business is
     * the one of the token. The same cursor gives the same changes, so a register that lost the answer asks again.
     *
     * @param parameters the query: {@code cursor} (the {@code nextCursor} of the last page applied, absent to start)
     *                   and {@code limit} (1 to 500, 200 if absent)
     * @return 200 with the page; 400 for a bad query; 409 if the cursor is ahead of the core
     */
    @GetMapping(path = "/sync/pull", produces = MediaType.APPLICATION_JSON_VALUE)
    PullResponse pull(@RequestParam Map<String, String> parameters) {
        parameters.keySet().forEach(name -> {
            if (!PULL_PARAMETERS.contains(name)) {
                throw new InvalidBatchException("Unexpected parameter " + name + ": the business comes from the token");
            }
        });
        Integer limit = null;
        if (parameters.containsKey("limit")) {
            try {
                limit = Integer.valueOf(parameters.get("limit"));
            } catch (NumberFormatException notANumber) {
                throw new InvalidBatchException("limit must be a whole number");
            }
        }
        SyncPullService.Page page = pullService.pull(parameters.get("cursor"), limit);
        List<PullChange> changes = page.changes().stream()
                .map(change -> new PullChange(change.seq(), change.entityType(), change.entityId().toString(),
                        change.deleted(), change.schemaVersion(), change.payload(), change.changedAt().toString()))
                .toList();
        return new PullResponse(changes, page.nextCursor(), page.hasMore());
    }

    @ExceptionHandler(CursorAheadException.class)
    ResponseEntity<ProblemDetail> cursorAhead(CursorAheadException ahead) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ahead.getMessage());
        problem.setProperty("code", "cursor_ahead");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
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

    /**
     * The body of a pull answer.
     *
     * @param changes    the changes after the cursor, ascending
     * @param nextCursor what to send next time
     * @param hasMore    whether the register should ask again right away
     */
    record PullResponse(List<PullChange> changes, String nextCursor, boolean hasMore) {
    }

    /**
     * One change of a pull answer. The payload is absent for a deletion.
     *
     * @param seq           its number in the feed
     * @param entityType    the kind of entity
     * @param entityId      the id of the entity
     * @param deleted       whether it was removed
     * @param schemaVersion the version of the payload shape
     * @param payload       the whole state after the change, or null
     * @param changedAt     when it was published
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record PullChange(long seq, String entityType, String entityId, boolean deleted, int schemaVersion, JsonNode payload,
                      String changedAt) {
    }
}
