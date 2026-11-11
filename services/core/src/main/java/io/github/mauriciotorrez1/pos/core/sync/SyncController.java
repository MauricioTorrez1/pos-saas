package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.core.identity.DeviceCredentialService;
import io.github.mauriciotorrez1.pos.core.identity.DeviceIdentity;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * {@code POST /sync/push}: receives the batch of a register (RF-021). The register authenticates with
 * its device credential (ADR 0054), and the business and the register are the ones of that credential:
 * a body that names another business is refused, and one that names another register gets 403. The
 * answer follows {@code sync-push-response.schema.json}: HTTP 200 with a result per operation handled,
 * or a problem (400, 403, 503) that means nothing was confirmed.
 */
@RestController
class SyncController {

    private final SyncPushService service;
    private final DeviceCredentialService devices;

    SyncController(SyncPushService service, DeviceCredentialService devices) {
        this.service = service;
        this.devices = devices;
    }

    /**
     * Applies a batch of up to 100 operations.
     *
     * @param body           the batch, as in {@code sync-push-request.schema.json}
     * @param authentication the register that authenticated with its device credential (ADR 0054)
     * @return 200 with a result per operation handled, 403 if the batch names another register, or 503 if the
     *         core could not handle even the first
     */
    @PostMapping(path = "/sync/push", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> push(@RequestBody JsonNode body, Authentication authentication) {
        DeviceIdentity device = (DeviceIdentity) authentication.getPrincipal();
        UUID claimed = claimedRegister(body);
        if (claimed != null && !claimed.equals(device.registerId())) {
            devices.recordRegisterMismatch(device, claimed);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN,
                    "The batch names a register other than the one of the credential. Nothing was confirmed."));
        }
        SyncPushService.PushOutcome outcome = service.push(body);
        if (outcome.stopped() && outcome.results().isEmpty()) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "The core could not handle the batch. Nothing was confirmed; send it again later.");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(problem);
        }
        return ResponseEntity.ok(new PushResponse(outcome.results()));
    }

    /** The register the batch names, or {@code null} if it names none or not a UUIDv7: the service refuses those with 400. */
    private static UUID claimedRegister(JsonNode body) {
        JsonNode claimed = body.isObject() ? body.get("registerId") : null;
        if (claimed == null || !claimed.isString()) {
            return null;
        }
        try {
            UUID id = UUID.fromString(claimed.asString());
            return id.version() == 7 ? id : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
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
