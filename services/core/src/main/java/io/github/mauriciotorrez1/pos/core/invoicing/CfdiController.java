package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.invoicing.CancellationService.CancellationView;
import io.github.mauriciotorrez1.pos.core.invoicing.CancellationService.CfdiKind;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiConflictException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiNotFoundException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.InvalidCfdiRequestException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.ProviderNotDoneException;
import io.github.mauriciotorrez1.pos.core.invoicing.CreditNoteService.CreditNoteView;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceListing.InvoiceRow;
import java.util.List;
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
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Cancellations (RF-037) and credit notes (RF-038) of ADR 0082, plus the list of individual invoices the panel shows.
 * Cancelling needs {@code invoice.cancel} (owner only); the rest {@code invoice.issue} (ADR 0042).
 */
@RestController
class CfdiController {

    private final CancellationService cancellations;
    private final CreditNoteService creditNotes;
    private final InvoiceListing invoices;
    private final UserDirectory directory;

    CfdiController(CancellationService cancellations, CreditNoteService creditNotes, InvoiceListing invoices,
            UserDirectory directory) {
        this.cancellations = cancellations;
        this.creditNotes = creditNotes;
        this.invoices = invoices;
        this.directory = directory;
    }

    /** @return the latest individual invoices with their cancellation state */
    @GetMapping("/invoices")
    List<InvoiceRow> list() {
        return invoices.recent(50);
    }

    /**
     * Asks the SAT to cancel an individual invoice.
     *
     * @param id the invoice
     * @param request motive {@code 01}, {@code 02} or {@code 03}; for {@code 01} the UUID of its replacement
     * @param jwt the token of the caller
     * @return where the cancellation stands
     */
    @PostMapping("/invoices/{id}/cancel")
    CancellationView cancelInvoice(@PathVariable UUID id, @RequestBody CancelRequest request, @AuthenticationPrincipal Jwt jwt) {
        return cancellations.cancel(CfdiKind.INVOICE, id, request.motive(), request.substituteFiscalUuid(), actor(jwt));
    }

    /**
     * Reads at the provider whether a pending cancellation of an invoice was accepted or refused.
     *
     * @param id the invoice
     * @param jwt the token of the caller
     * @return where the cancellation stands
     */
    @PostMapping("/invoices/{id}/cancellation-refresh")
    CancellationView refreshInvoice(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return cancellations.refresh(CfdiKind.INVOICE, id, actor(jwt));
    }

    /**
     * Asks the SAT to cancel a global invoice; motive {@code 04} when a sale of it was invoiced on its own.
     *
     * @param id the global
     * @param request motive {@code 02}, {@code 03} or {@code 04}
     * @param jwt the token of the caller
     * @return where the cancellation stands
     */
    @PostMapping("/invoices/global/{id}/cancel")
    CancellationView cancelGlobal(@PathVariable UUID id, @RequestBody CancelRequest request, @AuthenticationPrincipal Jwt jwt) {
        return cancellations.cancel(CfdiKind.GLOBAL, id, request.motive(), request.substituteFiscalUuid(), actor(jwt));
    }

    /**
     * Reads at the provider whether a cancellation of a global ended.
     *
     * @param id the global
     * @param jwt the token of the caller
     * @return where the cancellation stands
     */
    @PostMapping("/invoices/global/{id}/cancellation-refresh")
    CancellationView refreshGlobal(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return cancellations.refresh(CfdiKind.GLOBAL, id, actor(jwt));
    }

    /** @return the returns of invoiced sales that have no credit note yet */
    @GetMapping("/invoices/credit-notes/candidates")
    List<CreditNoteView> creditNoteCandidates() {
        return creditNotes.candidates();
    }

    /** @return the latest credit notes */
    @GetMapping("/invoices/credit-notes")
    List<CreditNoteView> recentCreditNotes() {
        return creditNotes.recent();
    }

    /**
     * Stamps the credit note of a return. Repeating it after a timeout is safe.
     *
     * @param request the return
     * @param jwt the token of the caller
     * @return 201 with the stamped credit note
     */
    @PostMapping("/invoices/credit-notes")
    ResponseEntity<CreditNoteView> issueCreditNote(@RequestBody CreditNoteRequest request, @AuthenticationPrincipal Jwt jwt) {
        if (request.returnId() == null) {
            throw new InvalidCfdiRequestException("return_required");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(creditNotes.issue(request.returnId(), actor(jwt)));
    }

    private UUID actor(Jwt jwt) {
        return directory.findActiveBySubject(jwt.getSubject()).map(AppUser::id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
    }

    @ExceptionHandler(CfdiNotFoundException.class)
    ProblemDetail notFound(CfdiNotFoundException missing) {
        return problem(HttpStatus.NOT_FOUND, "not_found", "There is no such invoice or return in this business.");
    }

    @ExceptionHandler(InvalidCfdiRequestException.class)
    ProblemDetail invalid(InvalidCfdiRequestException invalid) {
        return problem(HttpStatus.UNPROCESSABLE_CONTENT, invalid.code(), "The request breaks a rule. Nothing was sent.");
    }

    @ExceptionHandler(CfdiConflictException.class)
    ProblemDetail conflict(CfdiConflictException conflict) {
        return problem(HttpStatus.CONFLICT, conflict.code(), "The invoice is not in a state that allows this.");
    }

    @ExceptionHandler(ProviderNotDoneException.class)
    ProblemDetail notDone(ProviderNotDoneException failure) {
        ProblemDetail problem = switch (failure.reason()) {
            case PROVIDER_REJECTED -> problem(HttpStatus.UNPROCESSABLE_CONTENT, "provider_rejected",
                    "The invoicing provider refused the request. Nothing changed.");
            case PROVIDER_NOT_CONFIGURED -> problem(HttpStatus.SERVICE_UNAVAILABLE, "provider_not_configured",
                    "Invoicing is not configured for this business yet.");
            case OUTCOME_UNKNOWN -> problem(HttpStatus.SERVICE_UNAVAILABLE, "outcome_unknown",
                    "The invoicing provider did not answer. Send the same request again: the provider is checked first.");
        };
        if (failure.providerMessage() != null) {
            problem.setProperty("providerMessage", failure.providerMessage());
        }
        return problem;
    }

    private static ProblemDetail problem(HttpStatus status, String code, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setProperty("code", code);
        return problem;
    }

    /**
     * Body of a cancellation.
     *
     * @param motive SAT motive, {@code 01} to {@code 04}
     * @param substituteFiscalUuid for motive {@code 01}, the UUID of the replacement invoice
     */
    record CancelRequest(String motive, UUID substituteFiscalUuid) {
    }

    /**
     * Body of a credit note.
     *
     * @param returnId the return of an invoiced sale
     */
    record CreditNoteRequest(UUID returnId) {
    }
}
