package io.github.mauriciotorrez1.pos.core.reporting;

import io.github.mauriciotorrez1.pos.events.CashCutRecorded;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Consumes {@link CashCutRecorded} after the cut was committed, on its own thread, so a slow or dead
 * e-mail provider never delays {@code POST /sync/push} (ADR 0052). The event waits in the outbox
 * (ADR 0036) until this method returns normally: throwing keeps it pending, and the scheduler of
 * {@link ReportingConfiguration} offers it again.
 */
@Component
class CutReportListener {

    private final CutReportService service;

    CutReportListener(CutReportService service) {
        this.service = service;
    }

    /**
     * Sends the report of the cut inside the business of the event.
     *
     * @param event the stored cut
     * @throws ReportPendingException if the e-mail could not be sent yet, to keep the event in the outbox
     */
    @Async
    @TransactionalEventListener
    void on(CashCutRecorded event) {
        CutReportService.Outcome outcome = TenantContext.callAs(event.tenantId(), () -> service.deliver(event.cutId()));
        if (outcome == CutReportService.Outcome.RETRY) {
            throw new ReportPendingException(event.cutId());
        }
    }

    /** The report is not sent yet; the event stays in the outbox and is offered again. */
    static final class ReportPendingException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        ReportPendingException(Object cutId) {
            super("The report of cut " + cutId + " is pending");
        }
    }
}
