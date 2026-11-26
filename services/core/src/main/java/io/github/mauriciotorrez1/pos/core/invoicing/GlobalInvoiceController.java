package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.GlobalAlreadyIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.GlobalInProgressException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.InvalidGlobalRequestException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.IssuerNotConfiguredException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.NoSalesToInvoiceException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.PeriodNotClosedException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.PreviewStaleException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.Preview;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.Summary;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The global invoice to the general public (RF-036, ADR 0079): a preview of the period, the stamping and the list.
 * All three need {@code invoice.issue} (ADR 0042). Errors are {@code application/problem+json} with a {@code code}
 * the panel turns into a message.
 */
@RestController
class GlobalInvoiceController {

    private final GlobalInvoiceService service;
    private final UserDirectory directory;

    GlobalInvoiceController(GlobalInvoiceService service, UserDirectory directory) {
        this.service = service;
        this.directory = directory;
    }

    /**
     * Shows which sales the global of a period would hold and their totals per tax rate. Nothing is stamped.
     *
     * @param periodicity {@code daily}, {@code biweekly} or {@code monthly} (default)
     * @param day any day of the period, {@code yyyy-MM-dd}
     * @return the preview
     */
    @GetMapping("/invoices/global/preview")
    Preview preview(@RequestParam(required = false) String periodicity, @RequestParam(required = false) String day) {
        return service.preview(periodicity, parseDay(day));
    }

    /**
     * Lists the latest globals, failed attempts included.
     *
     * @return up to 24 globals, newest period first
     */
    @GetMapping("/invoices/global")
    List<Summary> recent() {
        return service.recent(24);
    }

    /**
     * Stamps the global of a closed period. Sending it again after a timeout is safe: the period is stamped once.
     *
     * @param request the period, the optional payment form and the count of the preview
     * @param jwt the token of the caller
     * @return 201 with the stamped global
     */
    @PostMapping(path = "/invoices/global", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Summary> issue(@RequestBody IssueGlobalRequest request, @AuthenticationPrincipal Jwt jwt) {
        AppUser actor = directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
        Summary result = service.issue(new IssueGlobalInvoiceCommand(request.periodicity(), parseDay(request.day()),
                request.paymentForm(), request.expectedSaleCount(), actor.id()));
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    private static LocalDate parseDay(String day) {
        if (day == null || day.isBlank()) {
            throw new InvalidGlobalRequestException("day");
        }
        try {
            return LocalDate.parse(day.trim());
        } catch (DateTimeParseException notADate) {
            throw new InvalidGlobalRequestException("day");
        }
    }

    @ExceptionHandler(InvalidGlobalRequestException.class)
    ProblemDetail invalid(InvalidGlobalRequestException invalid) {
        ProblemDetail problem = problem(HttpStatus.UNPROCESSABLE_CONTENT, "invalid_request",
                "The field " + invalid.field() + " is not valid.");
        problem.setProperty("field", invalid.field());
        return problem;
    }

    @ExceptionHandler(PeriodNotClosedException.class)
    ProblemDetail notClosed(PeriodNotClosedException open) {
        return problem(HttpStatus.UNPROCESSABLE_CONTENT, "period_not_closed",
                "The period is not over yet; its global invoice is issued once it ends.");
    }

    @ExceptionHandler(NoSalesToInvoiceException.class)
    ProblemDetail noSales(NoSalesToInvoiceException none) {
        return problem(HttpStatus.UNPROCESSABLE_CONTENT, "no_sales", "The period has no sales left to invoice.");
    }

    @ExceptionHandler(PreviewStaleException.class)
    ProblemDetail stale(PreviewStaleException stale) {
        ProblemDetail problem = problem(HttpStatus.CONFLICT, "preview_stale",
                "The sales of the period changed since the preview. Nothing was stamped.");
        problem.setProperty("expectedSaleCount", stale.expected());
        problem.setProperty("actualSaleCount", stale.actual());
        return problem;
    }

    @ExceptionHandler(GlobalAlreadyIssuedException.class)
    ProblemDetail alreadyIssued(GlobalAlreadyIssuedException duplicate) {
        ProblemDetail problem = problem(HttpStatus.CONFLICT, "already_issued", "The period already has a global invoice.");
        problem.setProperty("globalInvoice", duplicate.existing());
        return problem;
    }

    @ExceptionHandler(GlobalInProgressException.class)
    ProblemDetail inProgress(GlobalInProgressException busy) {
        return problem(HttpStatus.CONFLICT, "in_progress",
                "Another request is stamping the global invoice of this period. Wait a moment and check again.");
    }

    @ExceptionHandler(IssuerNotConfiguredException.class)
    ProblemDetail issuerNotConfigured(IssuerNotConfiguredException missing) {
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "issuer_not_configured",
                "The ZIP code of the place of issue is not set (INVOICING_ISSUER_ZIP_CODE).");
    }

    @ExceptionHandler(InvoiceNotIssuedException.class)
    ProblemDetail notIssued(InvoiceNotIssuedException failure) {
        ProblemDetail problem = switch (failure.reason()) {
            case PROVIDER_REJECTED -> {
                ProblemDetail rejected = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_CONTENT,
                        "The invoicing provider refused the global invoice. Its sales were released; try again once fixed.");
                if (failure.providerMessage() != null) {
                    rejected.setProperty("providerMessage", failure.providerMessage());
                }
                yield rejected;
            }
            case PROVIDER_NOT_CONFIGURED -> ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "Invoicing is not configured for this business yet.");
            case OUTCOME_UNKNOWN -> ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                    "The invoicing provider did not answer, so the global invoice may or may not exist. "
                            + "Send the same request again: the provider is checked before stamping.");
        };
        problem.setProperty("code", failure.reason().name().toLowerCase());
        problem.setProperty("globalInvoiceId", failure.invoiceId());
        return problem;
    }

    private static ProblemDetail problem(HttpStatus status, String code, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setProperty("code", code);
        return problem;
    }

    /**
     * Body of {@code POST /invoices/global}.
     *
     * @param periodicity {@code daily}, {@code biweekly} or {@code monthly} (default)
     * @param day any day of the period, {@code yyyy-MM-dd}
     * @param paymentForm optional SAT payment form
     * @param expectedSaleCount the count the preview showed; optional
     */
    record IssueGlobalRequest(String periodicity, String day, String paymentForm, Integer expectedSaleCount) {
    }
}
