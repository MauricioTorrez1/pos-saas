package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceInProgressException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleAlreadyInvoicedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleNotFoundException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * {@code POST /invoices}: issues the individual invoice of a sale (RF-035). Who may call it is decided by the
 * permission matrix ({@code invoice.issue}, ADR 0042). Errors are {@code application/problem+json}; none of them
 * echoes fiscal data except the provider's own refusal text, which goes back only to the user who sent that data.
 */
@RestController
class InvoiceController {

    private final IndividualInvoiceService service;
    private final UserDirectory directory;

    InvoiceController(IndividualInvoiceService service, UserDirectory directory) {
        this.service = service;
        this.directory = directory;
    }

    /**
     * Invoices a sale. Sending the same request again after a failure or a timeout is safe: the sale is stamped at
     * most once.
     *
     * @param request the sale and the receiver
     * @param jwt the token of the caller
     * @return 201 with the stamped invoice
     */
    @PostMapping(path = "/invoices", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<InvoiceResult> issue(@RequestBody IssueInvoiceRequest request, @AuthenticationPrincipal Jwt jwt) {
        if (request.saleId() == null || request.receiver() == null) {
            throw new InvalidFiscalDataException(List.of(
                    new FieldError(request.saleId() == null ? "saleId" : "receiver", "required")));
        }
        AppUser actor = directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
        Receiver receiver = new Receiver(request.receiver().legalName(), request.receiver().taxId(),
                request.receiver().taxRegime(), request.receiver().cfdiUse(), request.receiver().zipCode(),
                request.receiver().email());
        InvoiceResult result = service.issue(new IssueInvoiceCommand(request.saleId(), receiver, request.paymentForm(),
                request.satProductKeys(), actor.id()));
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    @ExceptionHandler(InvalidFiscalDataException.class)
    ProblemDetail invalidFiscalData(InvalidFiscalDataException invalid) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_CONTENT,
                "The fiscal data is not valid. Nothing was sent to the provider.");
        problem.setProperty("errors", invalid.errors());
        return problem;
    }

    @ExceptionHandler(SaleNotFoundException.class)
    ProblemDetail saleNotFound(SaleNotFoundException notFound) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "The core has not received that sale");
    }

    @ExceptionHandler(SaleAlreadyInvoicedException.class)
    ProblemDetail alreadyInvoiced(SaleAlreadyInvoicedException duplicate) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "The sale already has an invoice");
        problem.setProperty("invoice", duplicate.existing());
        return problem;
    }

    @ExceptionHandler(InvoiceInProgressException.class)
    ProblemDetail inProgress(InvoiceInProgressException busy) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
                "Another request is invoicing this sale right now. Wait a moment and check again.");
    }

    @ExceptionHandler(InvoiceNotIssuedException.class)
    ProblemDetail notIssued(InvoiceNotIssuedException failure) {
        ProblemDetail problem = switch (failure.reason()) {
            case PROVIDER_REJECTED -> {
                ProblemDetail rejected = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_CONTENT,
                        "The invoicing provider refused the data. Correct it and send the request again.");
                if (failure.providerMessage() != null) {
                    rejected.setProperty("providerMessage", failure.providerMessage());
                }
                yield rejected;
            }
            case PROVIDER_NOT_CONFIGURED -> ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "Invoicing is not configured for this business yet.");
            case OUTCOME_UNKNOWN -> ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "The invoicing provider did not answer, so the invoice may or may not exist. "
                            + "Send the same request again: the provider is checked before stamping.");
        };
        problem.setProperty("code", failure.reason().name().toLowerCase());
        problem.setProperty("invoiceId", failure.invoiceId());
        return problem;
    }

    /**
     * Body of {@code POST /invoices}.
     *
     * @param saleId the sale to invoice
     * @param receiver fiscal data of the customer
     * @param paymentForm optional SAT payment form; derived from the sale when absent
     * @param satProductKeys optional SAT product key per sale line id
     */
    record IssueInvoiceRequest(UUID saleId, ReceiverRequest receiver, String paymentForm, Map<UUID, String> satProductKeys) {
    }

    /**
     * Fiscal data of the receiver inside the request. Its {@code toString} hides everything.
     *
     * @param legalName name as registered at the SAT
     * @param taxId RFC
     * @param taxRegime SAT regime code
     * @param cfdiUse SAT CFDI use code
     * @param zipCode fiscal ZIP code
     * @param email optional e-mail
     */
    record ReceiverRequest(String legalName, String taxId, String taxRegime, String cfdiUse, String zipCode, String email) {

        @Override
        public String toString() {
            return "ReceiverRequest[redacted]";
        }
    }
}
