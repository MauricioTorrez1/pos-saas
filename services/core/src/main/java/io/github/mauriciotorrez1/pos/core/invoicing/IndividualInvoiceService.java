package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceInProgressException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException.Reason;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleAlreadyInvoicedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleNotFoundException;
import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.core.sales.SaleLookup;
import io.github.mauriciotorrez1.pos.core.sales.SaleView;
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
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * Issues the CFDI of one sale (RF-035, ADR 0050). Stamping has an effect outside the database that cannot be
 * undone, so the flow is built around that:
 *
 * <ol>
 *   <li>The attempt is recorded as {@code pending} in its own transaction and committed <em>before</em> calling the
 *       provider. The unique constraint on the sale makes two requests take turns, and the second one sees the first.
 *   <li>No database transaction stays open during the HTTP call.
 *   <li>The invoice is sent with our invoice id as {@code external_id}. If the answer is lost, the next attempt
 *       <em>looks the invoice up by that id first</em> and only stamps again when the provider has none.
 *   <li>The result is saved with its audit entry in one transaction.
 * </ol>
 */
@Service
public class IndividualInvoiceService {

    private static final Logger LOG = LoggerFactory.getLogger(IndividualInvoiceService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final SaleLookup sales;
    private final FiscalInvoicing provider;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;
    private final String defaultProductKey;
    private final Duration attemptLease;

    IndividualInvoiceService(SaleLookup sales, FiscalInvoicing provider, JdbcTemplate jdbc,
            TransactionTemplate transaction, AuditLog auditLog,
            @Value("${invoicing.default-sat-product-key:}") String defaultProductKey,
            @Value("${invoicing.attempt-lease:PT2M}") Duration attemptLease) {
        this.sales = sales;
        this.provider = provider;
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
        this.defaultProductKey = defaultProductKey;
        this.attemptLease = attemptLease;
    }

    /**
     * Invoices a sale to a receiver, or finishes an earlier attempt that did not end.
     *
     * @param command the sale, the receiver and the user who asks
     * @return the stamped invoice
     * @throws InvalidFiscalDataException if the receiver or a SAT key breaks a rule (nothing was sent)
     * @throws SaleNotFoundException if the core has no such sale
     * @throws SaleAlreadyInvoicedException if the sale already has a stamped invoice
     * @throws InvoiceInProgressException if another request is stamping the sale right now
     * @throws InvoiceNotIssuedException if the provider refused, is not configured or did not answer
     */
    public InvoiceResult issue(IssueInvoiceCommand command) {
        Receiver receiver = normalize(command.receiver());
        List<FieldError> errors = new ArrayList<>(FiscalDataValidator.validate(receiver));
        SaleView sale = sales.find(command.saleId()).orElseThrow(() -> new SaleNotFoundException(command.saleId()));
        List<InvoiceLineDraft> lines = lines(sale, command.satProductKeys(), errors);
        String paymentForm = paymentForm(sale, command.paymentForm(), errors);
        if (!errors.isEmpty()) {
            throw new InvalidFiscalDataException(errors);
        }

        Claim claim = transaction.execute(status -> claim(sale, receiver, command.actorId()));
        if (claim.recover()) {
            Optional<InvoiceResult> recovered = recover(claim.id(), sale, command.actorId());
            if (recovered.isPresent()) {
                return recovered.get();
            }
        }
        return stamp(claim.id(), sale, receiver, lines, paymentForm, command.actorId());
    }

    // --- claiming the sale ------------------------------------------------------------------------------------

    private record Claim(UUID id, boolean recover) {
    }

    private Claim claim(SaleView sale, Receiver receiver, UUID actorId) {
        UUID id = Uuid7.next();
        int inserted = jdbc.update("""
                INSERT INTO invoice (id, sale_id, status, receiver_tax_id, requested_by)
                VALUES (?, ?, 'pending', ?, ?)
                ON CONFLICT ON CONSTRAINT invoice_one_per_sale DO NOTHING
                """, id, sale.id(), receiver.taxId(), actorId);
        if (inserted == 1) {
            return new Claim(id, false);
        }
        // The row lock makes concurrent takeovers of the same failed or stale attempt take turns.
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT id, status, error_code, fiscal_uuid, provider_invoice_id, total_cents,
                       (attempt_started_at < now() - make_interval(secs => ?)) AS stale
                FROM invoice WHERE sale_id = ? FOR UPDATE
                """, attemptLease.toSeconds(), sale.id());
        UUID existingId = (UUID) row.get("id");
        String state = (String) row.get("status");
        if ("stamped".equals(state)) {
            throw new SaleAlreadyInvoicedException(new InvoiceResult(existingId, sale.id(), "stamped",
                    (UUID) row.get("fiscal_uuid"), (String) row.get("provider_invoice_id"), ((Number) row.get("total_cents")).longValue()));
        }
        boolean outcomeUnknown = "pending".equals(state);
        boolean finishedUnknown = outcomeUnknown && row.get("error_code") != null;
        boolean abandoned = outcomeUnknown && Boolean.TRUE.equals(row.get("stale"));
        if (outcomeUnknown && !finishedUnknown && !abandoned) {
            throw new InvoiceInProgressException(sale.id());
        }
        jdbc.update("""
                UPDATE invoice SET status = 'pending', error_code = NULL, provider_http_status = NULL,
                       attempts = attempts + 1, attempt_started_at = now(), updated_at = now(), requested_by = ?
                WHERE id = ?
                """, actorId, existingId);
        return new Claim(existingId, outcomeUnknown);
    }

    // --- resolving an attempt of unknown outcome --------------------------------------------------------------

    /** Asks the provider whether the earlier attempt did stamp. Only when it did not is it safe to stamp again. */
    private Optional<InvoiceResult> recover(UUID invoiceId, SaleView sale, UUID actorId) {
        Optional<IssuedInvoice> found;
        try {
            found = provider.findByExternalId(invoiceId.toString());
        } catch (FacturapiException failure) {
            LOG.warn("Invoice {}: could not check the provider before retrying ({})", invoiceId, failure.getMessage());
            markUnknown(invoiceId, failure);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, invoiceId, null);
        }
        if (found.isEmpty()) {
            return Optional.empty();
        }
        Optional<UUID> fiscalUuid = fiscalUuidOf(found.get());
        if (fiscalUuid.isEmpty()) {
            markUnknown(invoiceId, null);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, invoiceId, null);
        }
        LOG.info("Invoice {} was already stamped at the provider; saving it instead of stamping again", invoiceId);
        return Optional.of(saveStamped(invoiceId, sale, found.get(), fiscalUuid.get(), null, true, actorId));
    }

    // --- stamping ---------------------------------------------------------------------------------------------

    private InvoiceResult stamp(UUID invoiceId, SaleView sale, Receiver receiver, List<InvoiceLineDraft> lines,
            String paymentForm, UUID actorId) {
        IssuedInvoice issued;
        try {
            FiscalCustomer customer = provider.createCustomer(new FiscalCustomerData(receiver.legalName(),
                    receiver.taxId(), receiver.taxRegime(), receiver.zipCode(), receiver.email()));
            issued = provider.createInvoice(new InvoiceDraft(customer.id(), lines, paymentForm, receiver.cfdiUse(),
                    InvoiceType.INCOME, null, List.of(), invoiceId.toString()));
        } catch (FacturapiNotConfiguredException failure) {
            markFailed(invoiceId, sale, "provider_not_configured", null, actorId);
            throw new InvoiceNotIssuedException(Reason.PROVIDER_NOT_CONFIGURED, invoiceId, null);
        } catch (FacturapiRejectedException failure) {
            LOG.warn("Invoice {} was rejected by the provider with HTTP {}", invoiceId, failure.status());
            markFailed(invoiceId, sale, "provider_rejected", failure.status(), actorId);
            throw new InvoiceNotIssuedException(Reason.PROVIDER_REJECTED, invoiceId, failure.providerMessage());
        } catch (FacturapiException failure) {
            LOG.warn("Invoice {}: the outcome of the stamping is unknown ({})", invoiceId, failure.getMessage());
            markUnknown(invoiceId, failure);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, invoiceId, null);
        }
        Optional<UUID> fiscalUuid = fiscalUuidOf(issued);
        if (fiscalUuid.isEmpty()) {
            markUnknown(invoiceId, null);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, invoiceId, null);
        }
        return saveStamped(invoiceId, sale, issued, fiscalUuid.get(), receiver.taxId(), false, actorId);
    }

    private static Optional<UUID> fiscalUuidOf(IssuedInvoice issued) {
        if (issued.uuid() == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(issued.uuid()));
        } catch (IllegalArgumentException notAUuid) {
            return Optional.empty();
        }
    }

    // --- saving the outcome -----------------------------------------------------------------------------------

    private InvoiceResult saveStamped(UUID invoiceId, SaleView sale, IssuedInvoice issued, UUID fiscalUuid,
            String receiverTaxId, boolean recovered, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE invoice SET status = 'stamped', provider_invoice_id = ?, fiscal_uuid = ?, total_cents = ?,
                           error_code = NULL, provider_http_status = NULL, stamped_at = now(), updated_at = now(),
                           receiver_tax_id = COALESCE(?, receiver_tax_id)
                    WHERE id = ?
                    """, issued.id(), fiscalUuid, issued.totalCents(), receiverTaxId, invoiceId);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("saleId", sale.id().toString());
            detail.put("providerInvoiceId", issued.id());
            detail.put("fiscalUuid", fiscalUuid.toString());
            detail.put("totalCents", issued.totalCents());
            detail.put("totalMatchesSale", issued.totalCents() == sale.totalCents());
            detail.put("recovered", recovered);
            auditLog.record(new AuditEntry(actorId, "invoice.stamped", "invoice", invoiceId, null, json(detail)));
        });
        LOG.info("Invoice {} stamped for sale {}", invoiceId, sale.id());
        return new InvoiceResult(invoiceId, sale.id(), "stamped", fiscalUuid, issued.id(), issued.totalCents());
    }

    private void markFailed(UUID invoiceId, SaleView sale, String errorCode, Integer httpStatus, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE invoice SET status = 'failed', error_code = ?, provider_http_status = ?, updated_at = now()
                    WHERE id = ?
                    """, errorCode, httpStatus, invoiceId);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("saleId", sale.id().toString());
            detail.put("errorCode", errorCode);
            detail.put("providerHttpStatus", httpStatus);
            auditLog.record(new AuditEntry(actorId, "invoice.failed", "invoice", invoiceId, null, json(detail)));
        });
    }

    /** The attempt ended without an answer: it stays pending, flagged so the next request may look it up and go on. */
    private void markUnknown(UUID invoiceId, FacturapiException failure) {
        Integer httpStatus = failure instanceof FacturapiUnavailableException unavailable && unavailable.status() > 0
                ? unavailable.status() : null;
        transaction.executeWithoutResult(status -> jdbc.update("""
                UPDATE invoice SET error_code = 'provider_unavailable', provider_http_status = ?, updated_at = now()
                WHERE id = ?
                """, httpStatus, invoiceId));
    }

    private static String json(Map<String, Object> detail) {
        return JSON.writeValueAsString(detail);
    }

    // --- building the invoice ---------------------------------------------------------------------------------

    private List<InvoiceLineDraft> lines(SaleView sale, Map<UUID, String> productKeys, List<FieldError> errors) {
        List<InvoiceLineDraft> lines = new ArrayList<>();
        for (int index = 0; index < sale.lines().size(); index++) {
            SaleView.Line line = sale.lines().get(index);
            String key = productKeys != null && productKeys.get(line.id()) != null ? productKeys.get(line.id()) : defaultProductKey;
            if (key == null || key.isBlank()) {
                errors.add(new FieldError("lines[" + index + "].satProductKey", "required"));
                continue;
            }
            if (!FiscalDataValidator.isProductKey(key.trim())) {
                errors.add(new FieldError("lines[" + index + "].satProductKey", "invalid_format"));
                continue;
            }
            Integer tax = "rate".equals(line.taxFactor()) ? line.taxRateBasisPoints() : null;
            lines.add(new InvoiceLineDraft(line.productName(), key.trim(), satUnitKey(line.unit()), unitName(line.unit()),
                    line.unitPriceE4(), line.quantityMilli(), tax));
        }
        return lines;
    }

    private static String satUnitKey(String unit) {
        return switch (unit) {
            case "meter" -> "MTR";
            case "kilogram" -> "KGM";
            case "liter" -> "LTR";
            default -> "H87";
        };
    }

    private static String unitName(String unit) {
        return switch (unit) {
            case "meter" -> "Metro";
            case "kilogram" -> "Kilogramo";
            case "liter" -> "Litro";
            default -> "Pieza";
        };
    }

    /** One payment form per CFDI: the one of the largest payment unless the caller says otherwise. */
    private static String paymentForm(SaleView sale, String requested, List<FieldError> errors) {
        if (requested != null) {
            if (!FiscalDataValidator.isPaymentForm(requested)) {
                errors.add(new FieldError("paymentForm", "invalid_format"));
            }
            return requested;
        }
        String method = sale.payments().isEmpty() ? "cash" : sale.payments().get(0).method();
        return switch (method) {
            case "transfer" -> "03";
            case "card", "card_manual" -> "04";
            default -> "01";
        };
    }

    private static Receiver normalize(Receiver receiver) {
        if (receiver == null) {
            return null;
        }
        return new Receiver(
                receiver.legalName() == null ? null : receiver.legalName().trim().replaceAll("\\s+", " "),
                receiver.taxId() == null ? null : receiver.taxId().trim().toUpperCase(),
                receiver.taxRegime() == null ? null : receiver.taxRegime().trim(),
                receiver.cfdiUse() == null ? null : receiver.cfdiUse().trim().toUpperCase(),
                receiver.zipCode() == null ? null : receiver.zipCode().trim(),
                receiver.email() == null || receiver.email().isBlank() ? null : receiver.email().trim());
    }
}
