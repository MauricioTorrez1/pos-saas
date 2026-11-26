package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiConflictException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiNotFoundException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.InvalidCfdiRequestException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.ProviderNotDoneException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.ProviderNotDoneException.Reason;
import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * Cancels a stamped CFDI before the SAT and follows the cancellation until it ends (RF-037, ADR 0081).
 *
 * <p>Cancelling is asynchronous at the SAT: an invoice whose receiver must accept stays {@code pending} until the
 * receiver answers (or the SAT accepts it after 72 hours). The request is recorded as {@code requested} and committed
 * before calling the provider, like stamping (ADR 0050); an answer that is lost leaves it {@code requested}, and the
 * next request reads the invoice at the provider first, so a cancellation is never sent blindly twice. Nothing is
 * deleted: an accepted cancellation marks the invoice superseded, or releases the sales of a global.
 */
@Service
public class CancellationService {

    /** Which table holds the CFDI. Table names are constants, never user input. */
    public enum CfdiKind {
        /** An individual invoice, which a customer received. */
        INVOICE("invoice", Set.of(CancellationMotive.WITH_RELATED_DOCUMENT, CancellationMotive.WITHOUT_RELATED_DOCUMENT,
                CancellationMotive.OPERATION_NOT_CARRIED_OUT)),
        /** A global invoice to the general public. */
        GLOBAL("global_invoice", Set.of(CancellationMotive.WITHOUT_RELATED_DOCUMENT,
                CancellationMotive.OPERATION_NOT_CARRIED_OUT, CancellationMotive.GLOBAL_INVOICE_RELATED));

        private final String table;
        private final Set<CancellationMotive> motives;

        CfdiKind(String table, Set<CancellationMotive> motives) {
            this.table = table;
            this.motives = motives;
        }

        /** @return the table name, also used as the audit entity type */
        public String table() {
            return table;
        }
    }

    /**
     * Where a cancellation stands.
     *
     * @param id local id of the CFDI
     * @param kind {@code invoice} or {@code global_invoice}
     * @param fiscalUuid UUID of the CFDI
     * @param cancellationStatus {@code requested}, {@code pending}, {@code accepted}, {@code rejected} or {@code failed}
     * @param motive the SAT motive
     * @param substituteFiscalUuid the replacing CFDI of motive 01, or {@code null}
     */
    public record CancellationView(UUID id, String kind, UUID fiscalUuid, String cancellationStatus, String motive,
            UUID substituteFiscalUuid) {
    }

    private static final Logger LOG = LoggerFactory.getLogger(CancellationService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final FiscalInvoicing provider;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;
    private final Duration attemptLease;

    CancellationService(FiscalInvoicing provider, JdbcTemplate jdbc, TransactionTemplate transaction, AuditLog auditLog,
            @Value("${invoicing.attempt-lease:PT2M}") Duration attemptLease) {
        this.provider = provider;
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
        this.attemptLease = attemptLease;
    }

    /**
     * Asks the SAT to cancel a stamped CFDI.
     *
     * @param kind which table
     * @param id local id
     * @param motiveCode SAT motive, {@code 01} to {@code 04}
     * @param substituteFiscalUuid for motive {@code 01}: the UUID of the replacement invoice of this one
     * @param actorId the user who asks
     * @return where the cancellation stands
     * @throws CfdiNotFoundException if the business has no such CFDI
     * @throws InvalidCfdiRequestException if the motive or the substitute break a rule
     * @throws CfdiConflictException if the CFDI is not stamped or is already being cancelled
     * @throws ProviderNotDoneException if the provider refused, is not configured or did not answer
     */
    public CancellationView cancel(CfdiKind kind, UUID id, String motiveCode, UUID substituteFiscalUuid, UUID actorId) {
        CancellationMotive motive = motive(kind, motiveCode);
        if (motive == CancellationMotive.WITH_RELATED_DOCUMENT && substituteFiscalUuid == null) {
            throw new InvalidCfdiRequestException("substitute_required");
        }
        Request request = transaction.execute(status ->
                claim(kind, id, motive, motive == CancellationMotive.WITH_RELATED_DOCUMENT ? substituteFiscalUuid : null, actorId));
        if (request.recover()) {
            Optional<CancellationView> settled = settleFromProvider(kind, id, actorId, true);
            if (settled.isPresent()) {
                return settled.get();
            }
        }
        IssuedInvoice answer;
        try {
            answer = provider.cancelInvoice(request.providerInvoiceId(), motive, request.substituteProviderId());
        } catch (FacturapiNotConfiguredException failure) {
            fail(kind, id, "provider_not_configured", actorId);
            throw new ProviderNotDoneException(Reason.PROVIDER_NOT_CONFIGURED, null);
        } catch (FacturapiRejectedException failure) {
            LOG.warn("Cancellation of {} {} was rejected by the provider with HTTP {}", kind.table(), id, failure.status());
            fail(kind, id, "provider_rejected", actorId);
            throw new ProviderNotDoneException(Reason.PROVIDER_REJECTED, failure.providerMessage());
        } catch (FacturapiException failure) {
            LOG.warn("Cancellation of {} {}: the outcome is unknown ({})", kind.table(), id, failure.getMessage());
            markUnknown(kind, id, "provider_unavailable");
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        return save(kind, id, outcomeOf(answer), actorId);
    }

    /**
     * Reads the cancellation at the provider and records it if it moved (the receiver accepted or refused).
     *
     * @param kind which table
     * @param id local id
     * @param actorId the user who asks
     * @return where the cancellation stands
     * @throws CfdiNotFoundException if the business has no such CFDI
     * @throws CfdiConflictException if nobody asked to cancel it
     * @throws ProviderNotDoneException if the provider did not answer
     */
    public CancellationView refresh(CfdiKind kind, UUID id, UUID actorId) {
        CancellationView current = view(kind, id);
        if (current.cancellationStatus() == null || "failed".equals(current.cancellationStatus())) {
            throw new CfdiConflictException("not_requested");
        }
        if ("accepted".equals(current.cancellationStatus()) || "rejected".equals(current.cancellationStatus())) {
            return current;
        }
        return settleFromProvider(kind, id, actorId, false).orElseGet(() -> view(kind, id));
    }

    // --- claiming -----------------------------------------------------------------------------------------------

    private record Request(String providerInvoiceId, String substituteProviderId, boolean recover) {
    }

    private Request claim(CfdiKind kind, UUID id, CancellationMotive motive, UUID substitute, UUID actorId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT status, provider_invoice_id, fiscal_uuid, cancellation_status, cancellation_error_code,
                       (cancellation_updated_at < now() - make_interval(secs => ?)) AS stale
                FROM %s WHERE id = ? FOR UPDATE
                """.formatted(kind.table()), attemptLease.toSeconds(), id);
        if (rows.isEmpty()) {
            throw new CfdiNotFoundException(id);
        }
        Map<String, Object> row = rows.get(0);
        if (!"stamped".equals(row.get("status"))) {
            throw new CfdiConflictException("not_stamped");
        }
        String state = (String) row.get("cancellation_status");
        if ("accepted".equals(state)) {
            throw new CfdiConflictException("already_cancelled");
        }
        if ("pending".equals(state)) {
            throw new CfdiConflictException("awaiting_acceptance");
        }
        boolean recover = "requested".equals(state);
        if (recover && row.get("cancellation_error_code") == null && !Boolean.TRUE.equals(row.get("stale"))) {
            throw new CfdiConflictException("in_progress");
        }
        String substituteProviderId = substitute == null ? null : substituteProviderId(id, substitute);
        jdbc.update("""
                UPDATE %s SET cancellation_status = 'requested', cancellation_motive = ?, cancellation_substitute_uuid = ?,
                       cancellation_error_code = NULL, cancellation_requested_by = ?, cancellation_requested_at = now(),
                       cancellation_updated_at = now(), updated_at = now()
                WHERE id = ?
                """.formatted(kind.table()), motive.satCode(), substitute, actorId, id);
        audit(kind, id, "requested", Map.of("motive", motive.satCode(), "fiscalUuid", String.valueOf(row.get("fiscal_uuid"))), actorId);
        return new Request((String) row.get("provider_invoice_id"), substituteProviderId, recover);
    }

    /**
     * Motive 01 needs the replacement already stamped and related to this invoice (SAT relation 04), which is what
     * {@code POST /invoices} with {@code replacesInvoiceId} issues.
     */
    private String substituteProviderId(UUID invoiceId, UUID substituteFiscalUuid) {
        List<String> found = jdbc.queryForList("""
                SELECT provider_invoice_id FROM invoice
                WHERE fiscal_uuid = ? AND replaces_invoice_id = ? AND status = 'stamped'
                """, String.class, substituteFiscalUuid, invoiceId);
        if (found.isEmpty()) {
            throw new InvalidCfdiRequestException("substitute_not_replacement");
        }
        return found.get(0);
    }

    private static CancellationMotive motive(CfdiKind kind, String code) {
        CancellationMotive motive = Arrays.stream(CancellationMotive.values())
                .filter(candidate -> candidate.satCode().equals(code == null ? null : code.trim()))
                .findFirst().orElseThrow(() -> new InvalidCfdiRequestException("motive_unknown"));
        if (!kind.motives.contains(motive)) {
            throw new InvalidCfdiRequestException("motive_not_allowed");
        }
        return motive;
    }

    // --- reading the provider -----------------------------------------------------------------------------------

    /**
     * Reads the CFDI at the provider. When the cancellation shows there (pending, accepted or rejected) it is
     * recorded; when the provider still shows it untouched, empty is returned so the caller may send the request.
     */
    private Optional<CancellationView> settleFromProvider(CfdiKind kind, UUID id, UUID actorId, boolean beforeSending) {
        String providerId = transaction.execute(status -> jdbc.queryForObject(
                "SELECT provider_invoice_id FROM %s WHERE id = ?".formatted(kind.table()), String.class, id));
        IssuedInvoice current;
        try {
            current = provider.getInvoice(providerId);
        } catch (FacturapiException failure) {
            LOG.warn("Could not read {} {} at the provider ({})", kind.table(), id, failure.getMessage());
            if (beforeSending) {
                markUnknown(kind, id, "provider_unavailable");
            }
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        String outcome = outcomeOf(current);
        if ("requested".equals(outcome)) {
            return Optional.empty();
        }
        return Optional.of(save(kind, id, outcome, actorId));
    }

    /** Maps the provider's view to ours: {@code canceled} is accepted; otherwise its cancellation status decides. */
    static String outcomeOf(IssuedInvoice invoice) {
        if ("canceled".equals(invoice.status()) || "accepted".equals(invoice.cancellationStatus())) {
            return "accepted";
        }
        if ("pending".equals(invoice.cancellationStatus())) {
            return "pending";
        }
        if ("rejected".equals(invoice.cancellationStatus()) || "expired".equals(invoice.cancellationStatus())) {
            return "rejected";
        }
        return "requested";
    }

    // --- saving -------------------------------------------------------------------------------------------------

    private CancellationView save(CfdiKind kind, UUID id, String outcome, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            String before = jdbc.queryForObject("SELECT cancellation_status FROM %s WHERE id = ? FOR UPDATE"
                    .formatted(kind.table()), String.class, id);
            jdbc.update("""
                    UPDATE %s SET cancellation_status = ?, cancellation_error_code = ?, cancellation_updated_at = now(),
                           updated_at = now()
                    WHERE id = ?
                    """.formatted(kind.table()), outcome, "requested".equals(outcome) ? "provider_unconfirmed" : null, id);
            if ("accepted".equals(outcome)) {
                stopCovering(kind, id);
            }
            if (!outcome.equals(before)) {
                audit(kind, id, outcome, Map.of(), actorId);
            }
        });
        LOG.info("Cancellation of {} {} is {}", kind.table(), id, outcome);
        return view(kind, id);
    }

    /** A cancelled invoice no longer covers its sale; a cancelled global gives its sales back for the corrected one. */
    private void stopCovering(CfdiKind kind, UUID id) {
        if (kind == CfdiKind.INVOICE) {
            jdbc.update("UPDATE invoice SET superseded_at = COALESCE(superseded_at, now()) WHERE id = ?", id);
        } else {
            jdbc.update("UPDATE global_invoice_sale SET released_at = now() WHERE global_invoice_id = ? AND released_at IS NULL", id);
        }
    }

    private void fail(CfdiKind kind, UUID id, String errorCode, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE %s SET cancellation_status = 'failed', cancellation_error_code = ?, cancellation_updated_at = now()
                    WHERE id = ?
                    """.formatted(kind.table()), errorCode, id);
            audit(kind, id, "failed", Map.of("errorCode", errorCode), actorId);
        });
    }

    private void markUnknown(CfdiKind kind, UUID id, String errorCode) {
        transaction.executeWithoutResult(status -> jdbc.update("""
                UPDATE %s SET cancellation_error_code = ?, cancellation_updated_at = now() WHERE id = ?
                """.formatted(kind.table()), errorCode, id));
    }

    private void audit(CfdiKind kind, UUID id, String outcome, Map<String, Object> extra, UUID actorId) {
        Map<String, Object> detail = new LinkedHashMap<>(extra);
        detail.put("cancellationStatus", outcome);
        auditLog.record(new AuditEntry(actorId, "invoice.cancellation." + outcome, kind.table(), id, null,
                JSON.writeValueAsString(detail)));
    }

    private CancellationView view(CfdiKind kind, UUID id) {
        List<CancellationView> found = transaction.execute(status -> jdbc.query("""
                SELECT id, fiscal_uuid, cancellation_status, cancellation_motive, cancellation_substitute_uuid
                FROM %s WHERE id = ?
                """.formatted(kind.table()), (rs, row) -> new CancellationView(rs.getObject("id", UUID.class), kind.table(),
                rs.getObject("fiscal_uuid", UUID.class), rs.getString("cancellation_status"),
                rs.getString("cancellation_motive"), rs.getObject("cancellation_substitute_uuid", UUID.class)), id));
        if (found == null || found.isEmpty()) {
            throw new CfdiNotFoundException(id);
        }
        return found.get(0);
    }
}
