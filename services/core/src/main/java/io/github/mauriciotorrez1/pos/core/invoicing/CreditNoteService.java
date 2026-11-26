package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiConflictException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.CfdiNotFoundException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.InvalidCfdiRequestException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.ProviderNotDoneException;
import io.github.mauriciotorrez1.pos.core.invoicing.CfdiFailures.ProviderNotDoneException.Reason;
import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * The credit note (CFDI of type E) of a return of an invoiced sale (RF-038, ADR 0081). It relates to the invoice or
 * the global that covered the sale with SAT relation 01 and follows the stamping steps of ADR 0050: the attempt is
 * committed before calling, our id goes as {@code external_id}, and a lost answer is looked up before stamping again.
 */
@Service
public class CreditNoteService {

    /** Returns and discounts are one concept per tax rate with this key and unit (Anexo 20). */
    static final String CREDIT_PRODUCT_KEY = "84111506";

    private static final Logger LOG = LoggerFactory.getLogger(CreditNoteService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /**
     * A credit note, or a return that may get one.
     *
     * @param returnId the return
     * @param saleId the sale it returns
     * @param folio ticket number of the sale
     * @param refundCents what was refunded
     * @param target {@code invoice} or {@code global_invoice}: the CFDI it corrects
     * @param relatedFiscalUuid UUID of that CFDI
     * @param creditNoteId the credit note, or {@code null} for a candidate
     * @param status {@code pending}, {@code stamped} or {@code failed}; {@code null} for a candidate
     * @param fiscalUuid UUID of the credit note once stamped
     * @param errorCode why the last attempt failed
     */
    public record CreditNoteView(UUID returnId, UUID saleId, long folio, long refundCents, String target,
            UUID relatedFiscalUuid, UUID creditNoteId, String status, UUID fiscalUuid, String errorCode) {
    }

    private final FiscalInvoicing provider;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;
    private final String issuerZipCode;
    private final Duration attemptLease;

    CreditNoteService(FiscalInvoicing provider, JdbcTemplate jdbc, TransactionTemplate transaction, AuditLog auditLog,
            @Value("${invoicing.issuer-zip-code:}") String issuerZipCode,
            @Value("${invoicing.attempt-lease:PT2M}") Duration attemptLease) {
        this.provider = provider;
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
        this.issuerZipCode = issuerZipCode == null ? "" : issuerZipCode.trim();
        this.attemptLease = attemptLease;
    }

    /**
     * The CFDI a return corrects: the live individual invoice of its sale, or else the global that held it, when the
     * return arrived after that global was stamped. A return that arrived before was already netted out of the global.
     */
    private static final String TARGET = """
            SELECT r.id AS return_id, r.sale_id, s.folio, r.total_cents, r.received_at,
                   i.id AS invoice_id, i.fiscal_uuid AS invoice_uuid, i.provider_customer_id,
                   g.id AS global_id, g.fiscal_uuid AS global_uuid
            FROM sale_return r
            JOIN sale s ON s.id = r.sale_id
            LEFT JOIN LATERAL (SELECT id, fiscal_uuid, provider_customer_id FROM invoice
                               WHERE sale_id = r.sale_id AND status = 'stamped' AND superseded_at IS NULL
                                 AND cancellation_status IS DISTINCT FROM 'accepted'
                               ORDER BY created_at DESC LIMIT 1) i ON true
            LEFT JOIN LATERAL (SELECT gi.id, gi.fiscal_uuid FROM global_invoice_sale l
                               JOIN global_invoice gi ON gi.tenant_id = l.tenant_id AND gi.id = l.global_invoice_id
                               WHERE l.sale_id = r.sale_id AND l.released_at IS NULL AND gi.status = 'stamped'
                                 AND gi.cancellation_status IS DISTINCT FROM 'accepted' AND gi.stamped_at < r.received_at
                               LIMIT 1) g ON true
            """;

    /**
     * Lists the returns of invoiced sales that still have no credit note, newest first.
     *
     * @return up to 100 candidates
     */
    @Transactional(readOnly = true)
    public List<CreditNoteView> candidates() {
        return jdbc.query(TARGET + """
                WHERE (i.id IS NOT NULL OR g.id IS NOT NULL)
                  AND NOT EXISTS (SELECT 1 FROM credit_note c WHERE c.return_id = r.id AND c.status IN ('pending', 'stamped'))
                ORDER BY r.received_at DESC LIMIT 100
                """, (rs, row) -> {
            boolean individual = rs.getObject("invoice_id") != null;
            return new CreditNoteView(rs.getObject("return_id", UUID.class), rs.getObject("sale_id", UUID.class),
                    rs.getLong("folio"), rs.getLong("total_cents"), individual ? "invoice" : "global_invoice",
                    rs.getObject(individual ? "invoice_uuid" : "global_uuid", UUID.class), null, null, null, null);
        });
    }

    /**
     * Lists the latest credit notes, failed attempts included.
     *
     * @return up to 50, newest first
     */
    @Transactional(readOnly = true)
    public List<CreditNoteView> recent() {
        return jdbc.query("""
                SELECT c.id, c.return_id, r.sale_id, s.folio, c.expected_total_cents, c.invoice_id, c.related_fiscal_uuid,
                       c.status, c.fiscal_uuid, c.error_code
                FROM credit_note c JOIN sale_return r ON r.id = c.return_id JOIN sale s ON s.id = r.sale_id
                ORDER BY c.created_at DESC LIMIT 50
                """, (rs, row) -> new CreditNoteView(rs.getObject("return_id", UUID.class), rs.getObject("sale_id", UUID.class),
                rs.getLong("folio"), rs.getLong("expected_total_cents"),
                rs.getObject("invoice_id") != null ? "invoice" : "global_invoice", rs.getObject("related_fiscal_uuid", UUID.class),
                rs.getObject("id", UUID.class), rs.getString("status"), rs.getObject("fiscal_uuid", UUID.class),
                rs.getString("error_code")));
    }

    /**
     * Stamps the credit note of a return, or finishes an earlier attempt. Repeating it is safe: one per return.
     *
     * @param returnId the return
     * @param actorId the user who asks
     * @return the stamped credit note
     * @throws CfdiNotFoundException if the business has no such return
     * @throws InvalidCfdiRequestException if the sale has no CFDI to correct ({@code not_invoiced}), the customer is
     *     unknown ({@code customer_unknown}) or the issuer ZIP code is missing ({@code issuer_not_configured})
     * @throws CfdiConflictException if it is already stamped ({@code already_issued}) or being stamped
     * @throws ProviderNotDoneException if the provider refused, is not configured or did not answer
     */
    public CreditNoteView issue(UUID returnId, UUID actorId) {
        Claim claim = transaction.execute(status -> claim(returnId, actorId));
        if (claim.recover()) {
            Optional<CreditNoteView> recovered = recover(claim, actorId);
            if (recovered.isPresent()) {
                return recovered.get();
            }
        }
        return stamp(claim, actorId);
    }

    // --- claiming -----------------------------------------------------------------------------------------------

    private record Claim(UUID id, UUID returnId, boolean individual, String customerId, String relatedUuid,
            String paymentForm, List<InvoiceLineDraft> lines, boolean recover) {
    }

    private Claim claim(UUID returnId, UUID actorId) {
        InvoicingLock.acquire(jdbc);
        List<Map<String, Object>> targets = jdbc.queryForList(TARGET + " WHERE r.id = ?", returnId);
        if (targets.isEmpty()) {
            throw new CfdiNotFoundException(returnId);
        }
        Map<String, Object> target = targets.get(0);
        boolean individual = target.get("invoice_id") != null;
        if (!individual && target.get("global_id") == null) {
            throw new InvalidCfdiRequestException("not_invoiced");
        }
        String customerId = individual ? (String) target.get("provider_customer_id") : null;
        if (individual && customerId == null) {
            throw new InvalidCfdiRequestException("customer_unknown");
        }
        if (!individual && issuerZipCode.isEmpty()) {
            throw new InvalidCfdiRequestException("issuer_not_configured");
        }
        String relatedUuid = String.valueOf(target.get(individual ? "invoice_uuid" : "global_uuid"));
        List<InvoiceLineDraft> lines = lines(returnId);
        String paymentForm = refundForm(returnId);

        List<Map<String, Object>> existing = jdbc.queryForList("""
                SELECT id, status, error_code, (attempt_started_at < now() - make_interval(secs => ?)) AS stale
                FROM credit_note WHERE return_id = ? FOR UPDATE
                """, attemptLease.toSeconds(), returnId);
        if (existing.isEmpty()) {
            UUID id = Uuid7.next();
            jdbc.update("""
                    INSERT INTO credit_note (id, return_id, invoice_id, global_invoice_id, related_fiscal_uuid, status,
                                             payment_form, expected_total_cents, requested_by)
                    VALUES (?, ?, ?, ?, ?::uuid, 'pending', ?, ?, ?)
                    """, id, returnId, target.get("invoice_id"), individual ? null : target.get("global_id"), relatedUuid,
                    paymentForm, ((Number) target.get("total_cents")).longValue(), actorId);
            return new Claim(id, returnId, individual, customerId, relatedUuid, paymentForm, lines, false);
        }
        Map<String, Object> row = existing.get(0);
        UUID id = (UUID) row.get("id");
        String state = (String) row.get("status");
        if ("stamped".equals(state)) {
            throw new CfdiConflictException("already_issued");
        }
        boolean unknown = "pending".equals(state);
        if (unknown && row.get("error_code") == null && !Boolean.TRUE.equals(row.get("stale"))) {
            throw new CfdiConflictException("in_progress");
        }
        jdbc.update("""
                UPDATE credit_note SET status = 'pending', error_code = NULL, provider_http_status = NULL,
                       attempts = attempts + 1, attempt_started_at = now(), updated_at = now(), requested_by = ?
                WHERE id = ?
                """, actorId, id);
        return new Claim(id, returnId, individual, customerId, relatedUuid, paymentForm, lines, unknown);
    }

    /** One concept per tax rate of the returned lines, worth what was refunded. */
    private List<InvoiceLineDraft> lines(UUID returnId) {
        List<InvoiceLineDraft> lines = new ArrayList<>();
        jdbc.query("""
                SELECT l.tax_factor, l.tax_rate_bp, sum(rl.refund_cents) AS refunded
                FROM sale_return_line rl JOIN sale_line l ON l.id = rl.sale_line_id
                WHERE rl.return_id = ?
                GROUP BY l.tax_factor, l.tax_rate_bp ORDER BY l.tax_factor DESC, l.tax_rate_bp DESC
                """, rs -> {
            Integer rate = "rate".equals(rs.getString("tax_factor")) ? rs.getInt("tax_rate_bp") : null;
            lines.add(new InvoiceLineDraft("Devolución de mercancía", CREDIT_PRODUCT_KEY, GlobalInvoiceService.GLOBAL_UNIT_KEY,
                    "Actividad", rs.getLong("refunded") * 100, 1_000, rate));
        }, returnId);
        return lines;
    }

    private String refundForm(UUID returnId) {
        List<String> method = jdbc.queryForList("""
                SELECT method FROM sale_return_refund WHERE return_id = ?
                GROUP BY method ORDER BY sum(amount_cents) DESC, method LIMIT 1
                """, String.class, returnId);
        String chosen = method.isEmpty() ? "cash" : method.get(0);
        return switch (chosen) {
            case "transfer" -> "03";
            case "card", "card_manual" -> "04";
            default -> "01";
        };
    }

    // --- stamping -----------------------------------------------------------------------------------------------

    private Optional<CreditNoteView> recover(Claim claim, UUID actorId) {
        Optional<IssuedInvoice> found;
        try {
            found = provider.findByExternalId(claim.id().toString());
        } catch (FacturapiException failure) {
            markUnknown(claim.id());
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        if (found.isEmpty() || found.get().uuid() == null) {
            return Optional.empty();
        }
        return Optional.of(saveStamped(claim, found.get(), true, actorId));
    }

    private CreditNoteView stamp(Claim claim, UUID actorId) {
        IssuedInvoice issued;
        try {
            String customerId = claim.individual() ? claim.customerId()
                    : provider.createCustomer(new FiscalCustomerData(GlobalInvoiceService.PUBLIC_NAME,
                            GlobalInvoiceService.PUBLIC_RFC, GlobalInvoiceService.PUBLIC_REGIME, issuerZipCode, null)).id();
            issued = provider.createInvoice(new InvoiceDraft(customerId, claim.lines(), claim.paymentForm(),
                    claim.individual() ? "G02" : "S01", InvoiceType.CREDIT_NOTE, null, List.of(claim.relatedUuid()),
                    claim.id().toString(), "01"));
        } catch (FacturapiNotConfiguredException failure) {
            markFailed(claim.id(), "provider_not_configured", null, actorId);
            throw new ProviderNotDoneException(Reason.PROVIDER_NOT_CONFIGURED, null);
        } catch (FacturapiRejectedException failure) {
            LOG.warn("Credit note {} was rejected by the provider with HTTP {}", claim.id(), failure.status());
            markFailed(claim.id(), "provider_rejected", failure.status(), actorId);
            throw new ProviderNotDoneException(Reason.PROVIDER_REJECTED, failure.providerMessage());
        } catch (FacturapiException failure) {
            LOG.warn("Credit note {}: the outcome of the stamping is unknown ({})", claim.id(), failure.getMessage());
            markUnknown(claim.id());
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        if (issued.uuid() == null) {
            markUnknown(claim.id());
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        return saveStamped(claim, issued, false, actorId);
    }

    private CreditNoteView saveStamped(Claim claim, IssuedInvoice issued, boolean recovered, UUID actorId) {
        UUID fiscalUuid;
        try {
            fiscalUuid = UUID.fromString(issued.uuid());
        } catch (IllegalArgumentException notAUuid) {
            markUnknown(claim.id());
            throw new ProviderNotDoneException(Reason.OUTCOME_UNKNOWN, null);
        }
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE credit_note SET status = 'stamped', provider_invoice_id = ?, fiscal_uuid = ?, total_cents = ?,
                           error_code = NULL, provider_http_status = NULL, stamped_at = now(), updated_at = now()
                    WHERE id = ?
                    """, issued.id(), fiscalUuid, issued.totalCents(), claim.id());
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("returnId", claim.returnId().toString());
            detail.put("relatedFiscalUuid", claim.relatedUuid());
            detail.put("fiscalUuid", fiscalUuid.toString());
            detail.put("totalCents", issued.totalCents());
            detail.put("recovered", recovered);
            auditLog.record(new AuditEntry(actorId, "credit_note.stamped", "credit_note", claim.id(), null,
                    JSON.writeValueAsString(detail)));
        });
        LOG.info("Credit note {} stamped for return {}", claim.id(), claim.returnId());
        // recent() called from inside the bean skips its proxy, so the read needs its own transaction (RLS).
        List<CreditNoteView> notes = transaction.execute(status -> recent());
        return notes.stream().filter(note -> claim.id().equals(note.creditNoteId())).findFirst()
                .orElseThrow(() -> new CfdiNotFoundException(claim.id()));
    }

    private void markFailed(UUID id, String errorCode, Integer httpStatus, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("UPDATE credit_note SET status = 'failed', error_code = ?, provider_http_status = ?, updated_at = now() WHERE id = ?",
                    errorCode, httpStatus, id);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("errorCode", errorCode);
            detail.put("providerHttpStatus", httpStatus);
            auditLog.record(new AuditEntry(actorId, "credit_note.failed", "credit_note", id, null, JSON.writeValueAsString(detail)));
        });
    }

    private void markUnknown(UUID id) {
        transaction.executeWithoutResult(status -> jdbc.update(
                "UPDATE credit_note SET error_code = 'provider_unavailable', updated_at = now() WHERE id = ?", id));
    }
}
