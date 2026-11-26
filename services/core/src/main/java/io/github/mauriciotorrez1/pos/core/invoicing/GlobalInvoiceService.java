package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.GlobalAlreadyIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.GlobalInProgressException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.InvalidGlobalRequestException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.IssuerNotConfiguredException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.NoSalesToInvoiceException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.PeriodNotClosedException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceFailures.PreviewStaleException;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.Preview;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.RateTotal;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.SaleRow;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.Summary;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalPeriodicity.Period;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalSales.GlobalSale;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException.Reason;
import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
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
 * The global invoice to «Público en general» of the sales nobody asked to invoice (RF-036, ADR 0077).
 *
 * <p>It follows the same steps as the individual invoice (ADR 0050): the attempt and the sales it covers are
 * recorded and committed before calling the provider; no transaction stays open during the call; the invoice goes
 * with our id as {@code external_id}, so a lost answer is looked up before stamping again; the outcome is saved with
 * its audit entry. A sale is in at most one live global, which the database itself enforces.
 */
@Service
public class GlobalInvoiceService {

    /** RFC, name and regime the SAT fixes for the general public. */
    static final String PUBLIC_RFC = "XAXX010101000";
    static final String PUBLIC_NAME = "PUBLICO EN GENERAL";
    static final String PUBLIC_REGIME = "616";
    /** Each concept of a global is one ticket: product key «sale» and unit «activity» (Anexo 20). */
    static final String GLOBAL_PRODUCT_KEY = "01010101";
    static final String GLOBAL_UNIT_KEY = "ACT";

    private static final Logger LOG = LoggerFactory.getLogger(GlobalInvoiceService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("America/Mexico_City");

    private final GlobalSales sales;
    private final FiscalInvoicing provider;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;
    private final String issuerZipCode;
    private final Duration attemptLease;
    private final Clock clock;

    GlobalInvoiceService(GlobalSales sales, FiscalInvoicing provider, JdbcTemplate jdbc, TransactionTemplate transaction,
            AuditLog auditLog, @Value("${invoicing.issuer-zip-code:}") String issuerZipCode,
            @Value("${invoicing.attempt-lease:PT2M}") Duration attemptLease) {
        this.sales = sales;
        this.provider = provider;
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
        this.issuerZipCode = issuerZipCode == null ? "" : issuerZipCode.trim();
        this.attemptLease = attemptLease;
        this.clock = Clock.system(BUSINESS_ZONE);
    }

    /**
     * Shows what the global of a period would hold, without stamping anything.
     *
     * @param periodicity {@code daily}, {@code biweekly} or {@code monthly}; {@code null} means monthly
     * @param day any day of the period
     * @return the preview
     * @throws InvalidGlobalRequestException if the periodicity is unknown or the day is missing
     */
    @Transactional(readOnly = true)
    public Preview preview(String periodicity, LocalDate day) {
        Period period = period(periodicity, day);
        List<GlobalSale> eligible = sales.eligibleBetween(period.start(), period.end());
        List<SaleRow> rows = eligible.stream()
                .map(sale -> new SaleRow(sale.saleId(), sale.folio(), sale.day(), sale.totalCents())).toList();
        return new Preview(period.periodicity().apiName(), period.start(), period.end(), period.closedOn(today()),
                period.deadline(), eligible.size(), eligible.stream().mapToLong(GlobalSale::totalCents).sum(),
                totalsByRate(eligible), sales.dominantPaymentForm(eligible),
                sales.individuallyInvoicedBetween(period.start(), period.end()), live(period).orElse(null), rows);
    }

    /**
     * Lists the latest globals of the business, newest period first.
     *
     * @param limit how many
     * @return the globals, including failed attempts
     */
    @Transactional(readOnly = true)
    public List<Summary> recent(int limit) {
        return jdbc.query(SUMMARY_SELECT + " ORDER BY g.period_start DESC, g.created_at DESC LIMIT ?",
                (rs, row) -> summary(rs), Math.max(1, Math.min(limit, 100)));
    }

    /**
     * Stamps the global of a closed period, or finishes an earlier attempt of that period that did not end.
     * Sending the same request again is safe: a period is stamped at most once.
     *
     * @param command the period, the optional payment form, the count the owner saw and who asks
     * @return the stamped global
     * @throws InvalidGlobalRequestException if a field is wrong
     * @throws PeriodNotClosedException if the period is not over
     * @throws NoSalesToInvoiceException if no sale is left to invoice
     * @throws PreviewStaleException if the sales changed since the preview
     * @throws GlobalAlreadyIssuedException if the period already has a stamped global
     * @throws GlobalInProgressException if another request is stamping it right now
     * @throws IssuerNotConfiguredException if the ZIP code of the place of issue is not set
     * @throws InvoiceNotIssuedException if the provider refused, is not configured or did not answer
     */
    public Summary issue(IssueGlobalInvoiceCommand command) {
        Period period = period(command.periodicity(), command.day());
        if (command.paymentForm() != null && !FiscalDataValidator.isPaymentForm(command.paymentForm())) {
            throw new InvalidGlobalRequestException("paymentForm");
        }
        if (!period.closedOn(today())) {
            throw new PeriodNotClosedException(period.end());
        }
        if (issuerZipCode.isEmpty()) {
            throw new IssuerNotConfiguredException();
        }

        Claim claim = transaction.execute(status -> claim(period, command));
        if (claim.recover()) {
            Optional<Summary> recovered = recover(claim.id(), command.actorId());
            if (recovered.isPresent()) {
                return recovered.get();
            }
        }
        return stamp(claim.id(), period, command.actorId());
    }

    // --- claiming the period ----------------------------------------------------------------------------------

    private record Claim(UUID id, boolean recover) {
    }

    private Claim claim(Period period, IssueGlobalInvoiceCommand command) {
        InvoicingLock.acquire(jdbc);
        List<Map<String, Object>> live = jdbc.queryForList("""
                SELECT id, status, error_code, (attempt_started_at < now() - make_interval(secs => ?)) AS stale
                FROM global_invoice WHERE periodicity = ? AND period_start = ? AND status IN ('pending', 'stamped')
                FOR UPDATE
                """, attemptLease.toSeconds(), period.periodicity().satCode(), Date.valueOf(period.start()));
        if (!live.isEmpty()) {
            return reclaim(live.get(0), command.actorId());
        }
        List<GlobalSale> eligible = sales.eligibleBetween(period.start(), period.end());
        if (eligible.isEmpty()) {
            throw new NoSalesToInvoiceException();
        }
        if (command.expectedSaleCount() != null && command.expectedSaleCount() != eligible.size()) {
            throw new PreviewStaleException(command.expectedSaleCount(), eligible.size());
        }
        UUID id = Uuid7.next();
        GlobalPeriod sat = period.toSat();
        String paymentForm = command.paymentForm() != null ? command.paymentForm() : sales.dominantPaymentForm(eligible);
        jdbc.update("""
                INSERT INTO global_invoice (id, periodicity, period_start, period_end, sat_months, sat_year, status,
                                            payment_form, sale_count, expected_total_cents, requested_by)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """, id, sat.periodicity(), Date.valueOf(period.start()), Date.valueOf(period.end()), sat.months(),
                sat.year(), paymentForm, eligible.size(), eligible.stream().mapToLong(GlobalSale::totalCents).sum(),
                command.actorId());
        jdbc.batchUpdate("INSERT INTO global_invoice_sale (global_invoice_id, sale_id, total_cents) VALUES (?, ?, ?)",
                eligible, 500, (statement, sale) -> {
                    statement.setObject(1, id);
                    statement.setObject(2, sale.saleId());
                    statement.setLong(3, sale.totalCents());
                });
        return new Claim(id, false);
    }

    private Claim reclaim(Map<String, Object> row, UUID actorId) {
        UUID existingId = (UUID) row.get("id");
        if ("stamped".equals(row.get("status"))) {
            throw new GlobalAlreadyIssuedException(find(existingId));
        }
        boolean finishedUnknown = row.get("error_code") != null;
        boolean abandoned = Boolean.TRUE.equals(row.get("stale"));
        if (!finishedUnknown && !abandoned) {
            throw new GlobalInProgressException();
        }
        jdbc.update("""
                UPDATE global_invoice SET error_code = NULL, provider_http_status = NULL, attempts = attempts + 1,
                       attempt_started_at = now(), updated_at = now(), requested_by = ?
                WHERE id = ?
                """, actorId, existingId);
        return new Claim(existingId, true);
    }

    // --- resolving an attempt of unknown outcome --------------------------------------------------------------

    private Optional<Summary> recover(UUID globalId, UUID actorId) {
        Optional<IssuedInvoice> found;
        try {
            found = provider.findByExternalId(globalId.toString());
        } catch (FacturapiException failure) {
            LOG.warn("Global invoice {}: could not check the provider before retrying ({})", globalId, failure.getMessage());
            markUnknown(globalId, failure);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, globalId, null);
        }
        if (found.isEmpty()) {
            return Optional.empty();
        }
        Optional<UUID> fiscalUuid = fiscalUuidOf(found.get());
        if (fiscalUuid.isEmpty()) {
            markUnknown(globalId, null);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, globalId, null);
        }
        LOG.info("Global invoice {} was already stamped at the provider; saving it instead of stamping again", globalId);
        return Optional.of(saveStamped(globalId, found.get(), fiscalUuid.get(), true, actorId));
    }

    // --- stamping ---------------------------------------------------------------------------------------------

    private Summary stamp(UUID globalId, Period period, UUID actorId) {
        // Read inside a transaction: row-level security shows rows only once the business is pinned (ADR 0035).
        List<GlobalSale> held = transaction.execute(status -> sales.linkedTo(globalId));
        String paymentForm = transaction.execute(status ->
                jdbc.queryForObject("SELECT payment_form FROM global_invoice WHERE id = ?", String.class, globalId));
        IssuedInvoice issued;
        try {
            FiscalCustomer customer = provider.createCustomer(
                    new FiscalCustomerData(PUBLIC_NAME, PUBLIC_RFC, PUBLIC_REGIME, issuerZipCode, null));
            issued = provider.createInvoice(new InvoiceDraft(customer.id(), lines(held), paymentForm, "S01",
                    InvoiceType.INCOME, period.toSat(), List.of(), globalId.toString()));
        } catch (FacturapiNotConfiguredException failure) {
            markFailed(globalId, "provider_not_configured", null, actorId);
            throw new InvoiceNotIssuedException(Reason.PROVIDER_NOT_CONFIGURED, globalId, null);
        } catch (FacturapiRejectedException failure) {
            LOG.warn("Global invoice {} was rejected by the provider with HTTP {}", globalId, failure.status());
            markFailed(globalId, "provider_rejected", failure.status(), actorId);
            throw new InvoiceNotIssuedException(Reason.PROVIDER_REJECTED, globalId, failure.providerMessage());
        } catch (FacturapiException failure) {
            LOG.warn("Global invoice {}: the outcome of the stamping is unknown ({})", globalId, failure.getMessage());
            markUnknown(globalId, failure);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, globalId, null);
        }
        Optional<UUID> fiscalUuid = fiscalUuidOf(issued);
        if (fiscalUuid.isEmpty()) {
            markUnknown(globalId, null);
            throw new InvoiceNotIssuedException(Reason.OUTCOME_UNKNOWN, globalId, null);
        }
        return saveStamped(globalId, issued, fiscalUuid.get(), false, actorId);
    }

    /** One concept per ticket and tax rate: quantity one, the ticket folio as its identification (Anexo 20). */
    static List<InvoiceLineDraft> lines(List<GlobalSale> held) {
        List<InvoiceLineDraft> lines = new ArrayList<>();
        for (GlobalSale sale : held) {
            for (GlobalSale.TaxGroup group : sale.groups()) {
                lines.add(new InvoiceLineDraft("Venta", GLOBAL_PRODUCT_KEY, GLOBAL_UNIT_KEY, "Actividad",
                        group.totalCents() * 100, 1_000, group.taxRateBasisPoints(), String.valueOf(sale.folio())));
            }
        }
        return lines;
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

    private Summary saveStamped(UUID globalId, IssuedInvoice issued, UUID fiscalUuid, boolean recovered, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE global_invoice SET status = 'stamped', provider_invoice_id = ?, fiscal_uuid = ?, total_cents = ?,
                           error_code = NULL, provider_http_status = NULL, stamped_at = now(), updated_at = now()
                    WHERE id = ?
                    """, issued.id(), fiscalUuid, issued.totalCents(), globalId);
            Summary saved = find(globalId);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("periodicity", saved.periodicity());
            detail.put("periodStart", saved.periodStart().toString());
            detail.put("periodEnd", saved.periodEnd().toString());
            detail.put("saleCount", saved.saleCount());
            detail.put("providerInvoiceId", issued.id());
            detail.put("fiscalUuid", fiscalUuid.toString());
            detail.put("totalCents", issued.totalCents());
            detail.put("totalMatchesSales", issued.totalCents() == saved.expectedTotalCents());
            detail.put("recovered", recovered);
            auditLog.record(new AuditEntry(actorId, "invoice.global.stamped", "global_invoice", globalId, null, json(detail)));
        });
        LOG.info("Global invoice {} stamped", globalId);
        return find(globalId);
    }

    /** A refused attempt cannot have stamped: its sales are released, so a new attempt may take them again. */
    private void markFailed(UUID globalId, String errorCode, Integer httpStatus, UUID actorId) {
        transaction.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE global_invoice SET status = 'failed', error_code = ?, provider_http_status = ?, updated_at = now()
                    WHERE id = ?
                    """, errorCode, httpStatus, globalId);
            jdbc.update("UPDATE global_invoice_sale SET released_at = now() WHERE global_invoice_id = ? AND released_at IS NULL",
                    globalId);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("errorCode", errorCode);
            detail.put("providerHttpStatus", httpStatus);
            auditLog.record(new AuditEntry(actorId, "invoice.global.failed", "global_invoice", globalId, null, json(detail)));
        });
    }

    /** The attempt ended without an answer: it stays pending and keeps its sales, so the retry sends the same CFDI. */
    private void markUnknown(UUID globalId, FacturapiException failure) {
        Integer httpStatus = failure instanceof FacturapiUnavailableException unavailable && unavailable.status() > 0
                ? unavailable.status() : null;
        transaction.executeWithoutResult(status -> jdbc.update("""
                UPDATE global_invoice SET error_code = 'provider_unavailable', provider_http_status = ?, updated_at = now()
                WHERE id = ?
                """, httpStatus, globalId));
    }

    // --- reading ----------------------------------------------------------------------------------------------

    private static final String SUMMARY_SELECT = """
            SELECT g.id, g.periodicity, g.period_start, g.period_end, g.status, g.sale_count, g.expected_total_cents,
                   g.total_cents, g.fiscal_uuid, g.provider_invoice_id, g.error_code,
                   (SELECT count(*) FROM invoice i WHERE i.overlaps_global_invoice_id = g.id) AS overlapping
            FROM global_invoice g""";

    private Summary find(UUID globalId) {
        return transaction.execute(status -> jdbc.queryForObject(SUMMARY_SELECT + " WHERE g.id = ?", (rs, row) -> summary(rs), globalId));
    }

    private Optional<Summary> live(Period period) {
        return jdbc.query(SUMMARY_SELECT + " WHERE g.periodicity = ? AND g.period_start = ? AND g.status IN ('pending', 'stamped')",
                (rs, row) -> summary(rs), period.periodicity().satCode(), Date.valueOf(period.start())).stream().findFirst();
    }

    private static Summary summary(java.sql.ResultSet rs) throws java.sql.SQLException {
        long total = rs.getLong("total_cents");
        return new Summary(rs.getObject("id", UUID.class), apiName(rs.getString("periodicity")),
                rs.getObject("period_start", LocalDate.class), rs.getObject("period_end", LocalDate.class),
                rs.getString("status"), rs.getInt("sale_count"), rs.getLong("expected_total_cents"),
                rs.wasNull() ? null : total, rs.getObject("fiscal_uuid", UUID.class), rs.getString("provider_invoice_id"),
                rs.getString("error_code"), rs.getLong("overlapping"));
    }

    private static String apiName(String satCode) {
        for (GlobalPeriodicity candidate : GlobalPeriodicity.values()) {
            if (candidate.satCode().equals(satCode)) {
                return candidate.apiName();
            }
        }
        return satCode;
    }

    // --- helpers ----------------------------------------------------------------------------------------------

    private static Period period(String periodicity, LocalDate day) {
        GlobalPeriodicity parsed = GlobalPeriodicity.parse(periodicity)
                .orElseThrow(() -> new InvalidGlobalRequestException("periodicity"));
        if (day == null) {
            throw new InvalidGlobalRequestException("day");
        }
        return parsed.periodOf(day);
    }

    /** The VAT inside a total, per rate, as the preview shows it; the provider computes the stamped figures. */
    static List<RateTotal> totalsByRate(List<GlobalSale> eligible) {
        Map<Integer, Long> totals = new TreeMap<>((left, right) -> Integer.compare(right == null ? -1 : right, left == null ? -1 : left));
        for (GlobalSale sale : eligible) {
            for (GlobalSale.TaxGroup group : sale.groups()) {
                totals.merge(group.taxRateBasisPoints(), group.totalCents(), Long::sum);
            }
        }
        List<RateTotal> result = new ArrayList<>();
        totals.forEach((rate, total) -> {
            long base = rate == null || rate == 0 ? total
                    : BigDecimal.valueOf(total).multiply(BigDecimal.valueOf(10_000))
                            .divide(BigDecimal.valueOf(10_000L + rate), 0, RoundingMode.HALF_UP).longValueExact();
            result.add(new RateTotal(rate, base, total - base, total));
        });
        return result;
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(BUSINESS_ZONE));
    }

    private static String json(Map<String, Object> detail) {
        return JSON.writeValueAsString(detail);
    }
}
