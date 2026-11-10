package io.github.mauriciotorrez1.pos.core.reporting;

import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Sends the e-mail of a cash cut once, and records how it went (RF-028, ADR 0052).
 *
 * <p>Idempotency: {@code cut_report_delivery} has {@code UNIQUE (tenant_id, cut_id)}. A worker claims the
 * delivery with a conditional {@code UPDATE}, so two workers, or the same event delivered twice, cannot
 * both send. The provider call also carries an idempotency key made from the cut, which covers the case
 * where the e-mail was sent but the answer was lost.
 *
 * <p>The call to the provider runs outside any database transaction, so a slow provider never holds a
 * connection. The business must already be pinned in {@code TenantContext}.
 */
@Service
class CutReportService {

    private static final Logger LOG = LoggerFactory.getLogger(CutReportService.class);
    private static final int MAX_ERROR_LENGTH = 200;

    /** What a call to {@link #deliver} left behind. */
    enum Outcome {
        /** The provider accepted the e-mail now. */
        SENT,
        /** Nothing to do: it was sent, skipped, refused or given up before. */
        DONE,
        /** Nothing could be sent now and nothing will be skipped: try again later. */
        RETRY
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final CutReportQuery query;
    private final EmailSender sender;
    private final ReportingProperties properties;

    CutReportService(JdbcTemplate jdbc, TransactionTemplate transaction, CutReportQuery query, EmailSender sender,
                     ReportingProperties properties) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.query = query;
        this.sender = sender;
        this.properties = properties;
    }

    /**
     * Sends the report of a cut if it has not been sent.
     *
     * @param cutId the cut
     * @return what happened; {@link Outcome#RETRY} asks the caller to leave the event pending
     */
    Outcome deliver(UUID cutId) {
        Optional<Integer> attempt = claim(cutId);
        if (attempt.isEmpty()) {
            return isWaiting(cutId) ? Outcome.RETRY : Outcome.DONE;
        }
        Optional<CutReport> report = transaction.execute(status -> query.find(cutId));
        if (report.isEmpty()) {
            finish(cutId, "rejected", "cut_not_found");
            LOG.warn("Cut report skipped: the cut {} is not known", cutId);
            return Outcome.DONE;
        }
        Optional<String> recipient = recipient();
        if (recipient.isEmpty()) {
            finish(cutId, "skipped", "no_recipient");
            LOG.warn("Cut report of {} skipped: the business has no owner e-mail and no default recipient is set", cutId);
            return Outcome.DONE;
        }
        EmailSender.EmailMessage message = new EmailSender.EmailMessage(recipient.get(),
                CutReportTemplate.subject(report.get(), properties.zone()),
                CutReportTemplate.body(report.get(), properties.zone()), "cut-report-" + cutId);
        try {
            sender.send(message);
        } catch (EmailNotConfiguredException notConfigured) {
            finish(cutId, "skipped", "email_not_configured");
            LOG.warn("Cut report of {} skipped: the e-mail provider has no credentials", cutId);
            return Outcome.DONE;
        } catch (EmailRejectedException rejected) {
            finish(cutId, "rejected", "provider_status_" + rejected.status());
            LOG.error("Cut report of {} was refused by the e-mail provider with status {}", cutId, rejected.status());
            return Outcome.DONE;
        } catch (EmailUnavailableException unavailable) {
            return failed(cutId, attempt.get(), unavailable);
        }
        transaction.executeWithoutResult(status -> jdbc.update(
                "UPDATE cut_report_delivery SET status = 'sent', last_error = NULL, sent_at = now(), updated_at = now() WHERE cut_id = ?", cutId));
        return Outcome.SENT;
    }

    private Outcome failed(UUID cutId, int attempt, EmailUnavailableException failure) {
        String error = failure.getClass().getSimpleName() + ": " + failure.getMessage();
        error = error.length() > MAX_ERROR_LENGTH ? error.substring(0, MAX_ERROR_LENGTH) : error;
        if (attempt >= properties.maxAttempts()) {
            finish(cutId, "gave_up", error);
            LOG.error("Cut report of {} given up after {} attempts", cutId, attempt);
            return Outcome.DONE;
        }
        Duration wait = properties.retryBase().multipliedBy(1L << (attempt - 1));
        OffsetDateTime next = OffsetDateTime.now(ZoneOffset.UTC).plus(wait);
        String recorded = error;
        transaction.executeWithoutResult(status -> jdbc.update(
                "UPDATE cut_report_delivery SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = now() WHERE cut_id = ?",
                recorded, next, cutId));
        LOG.warn("Cut report of {} failed on attempt {}; it will be tried again", cutId, attempt);
        return Outcome.RETRY;
    }

    /** Creates the row if needed and takes the delivery, or returns empty if it is not for this worker. */
    private Optional<Integer> claim(UUID cutId) {
        return transaction.execute(status -> {
            jdbc.update("INSERT INTO cut_report_delivery (id, cut_id) VALUES (?, ?) ON CONFLICT (tenant_id, cut_id) DO NOTHING",
                    Uuid7.next(), cutId);
            List<Integer> attempts = jdbc.queryForList("""
                    UPDATE cut_report_delivery
                    SET status = 'sending', attempts = attempts + 1, updated_at = now()
                    WHERE cut_id = ? AND next_attempt_at <= now()
                      AND (status IN ('pending', 'failed') OR (status = 'sending' AND updated_at < now() - interval '5 minutes'))
                    RETURNING attempts
                    """, Integer.class, cutId);
            return attempts.stream().findFirst();
        });
    }

    private boolean isWaiting(UUID cutId) {
        List<String> status = transaction.execute(s -> jdbc.queryForList(
                "SELECT status FROM cut_report_delivery WHERE cut_id = ?", String.class, cutId));
        return status != null && status.stream().anyMatch(value -> value.equals("failed") || value.equals("sending"));
    }

    private Optional<String> recipient() {
        Optional<String> owner = transaction.execute(status -> query.ownerEmail());
        if (owner.isPresent()) {
            return owner;
        }
        String fallback = properties.defaultRecipient();
        return fallback == null || fallback.isBlank() ? Optional.empty() : Optional.of(fallback);
    }

    private void finish(UUID cutId, String status, String error) {
        transaction.executeWithoutResult(s -> jdbc.update(
                "UPDATE cut_report_delivery SET status = ?, last_error = ?, updated_at = now() WHERE cut_id = ?", status, error, cutId));
    }
}
