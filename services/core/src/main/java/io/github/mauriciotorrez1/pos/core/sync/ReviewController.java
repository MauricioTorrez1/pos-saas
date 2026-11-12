package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.DiscrepancyItem;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.Page;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.QuarantineItem;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.ResolveRequest;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.ResolveResult;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The review of quarantined operations and price discrepancies (RF-022, E1-19, ADR 0055). Who may read and who may
 * resolve is decided by the permission matrix (ADR 0042): the owner and the manager, never the cashier.
 */
@RestController
class ReviewController {

    private final ReviewService service;
    private final UserDirectory directory;

    ReviewController(ReviewService service, UserDirectory directory) {
        this.service = service;
        this.directory = directory;
    }

    /**
     * Lists the operations the core kept apart, oldest first.
     *
     * @param status {@code open} (default), {@code resolved} or {@code all}
     * @param cursor the {@code nextCursor} of the previous page
     * @param limit  1 to 100, default 50
     * @return the page
     */
    @GetMapping("/quarantine")
    Page<QuarantineItem> quarantine(@RequestParam(required = false) String status, @RequestParam(required = false) String cursor,
                                    @RequestParam(required = false) Integer limit) {
        return service.quarantine(status, cursor, limit);
    }

    /**
     * Shows one quarantined operation exactly as it arrived.
     *
     * @param opId the idempotency key of the operation
     * @return the operation and its state
     */
    @GetMapping("/quarantine/{opId}")
    QuarantineItem quarantineDetail(@PathVariable UUID opId) {
        return service.quarantineDetail(opId);
    }

    /**
     * Accepts (applies as it is), corrects (applies with another payload) or rejects a quarantined operation.
     *
     * @param opId    the operation
     * @param request the action, the reason and, to correct, the new payload
     * @param jwt     the token of the owner or manager
     * @return 201 with the resolution, or 200 if it was already resolved the same way
     */
    @PostMapping("/quarantine/{opId}/resolution")
    ResponseEntity<ResolveResult> resolveQuarantine(@PathVariable UUID opId, @RequestBody ResolveRequest request,
                                                    @AuthenticationPrincipal Jwt jwt) {
        return answer(service.resolveQuarantine(actor(jwt), opId, request));
    }

    /**
     * Lists the price changes whose previous price was not the one of the core, oldest first.
     *
     * @param status {@code open} (default), {@code resolved} or {@code all}
     * @param cursor the {@code nextCursor} of the previous page
     * @param limit  1 to 100, default 50
     * @return the page
     */
    @GetMapping("/discrepancies")
    Page<DiscrepancyItem> discrepancies(@RequestParam(required = false) String status, @RequestParam(required = false) String cursor,
                                        @RequestParam(required = false) Integer limit) {
        return service.discrepancies(status, cursor, limit);
    }

    /**
     * Shows one price discrepancy.
     *
     * @param id the change id
     * @return the discrepancy
     */
    @GetMapping("/discrepancies/{id}")
    DiscrepancyItem discrepancyDetail(@PathVariable UUID id) {
        return service.discrepancyDetail(id);
    }

    /**
     * Accepts or rejects a price discrepancy.
     *
     * @param id      the price change
     * @param request the action and, to reject, the reason
     * @param jwt     the token of the owner or manager
     * @return 201 with the resolution, or 200 if it was already resolved the same way
     */
    @PostMapping("/discrepancies/{id}/resolution")
    ResponseEntity<ResolveResult> resolveDiscrepancy(@PathVariable UUID id, @RequestBody ResolveRequest request,
                                                     @AuthenticationPrincipal Jwt jwt) {
        return answer(service.resolveDiscrepancy(actor(jwt), id, request));
    }

    @ExceptionHandler(ReviewService.ReviewProblem.class)
    ResponseEntity<ProblemDetail> problem(ReviewService.ReviewProblem problem) {
        return ResponseEntity.status(problem.getStatusCode()).body(problem.getBody());
    }

    private UUID actor(Jwt jwt) {
        return directory.findActiveBySubject(jwt.getSubject()).orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN)).id();
    }

    private static ResponseEntity<ResolveResult> answer(ResolveResult result) {
        return ResponseEntity.status(result.repeated() ? HttpStatus.OK : HttpStatus.CREATED).body(result);
    }
}
