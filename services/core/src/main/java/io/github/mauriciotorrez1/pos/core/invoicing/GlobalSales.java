package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Reads the sales a global invoice covers (ADR 0079). Every amount is net of the returns the core received, and
 * row-level security keeps the reads inside the current business.
 */
@Component
class GlobalSales {

    /** The day a sale counts on, as in {@code SaleLookup} (E1-60). */
    private static final String BUSINESS_DATE = "COALESCE(s.business_date, (s.completed_at AT TIME ZONE 'America/Mexico_City')::date)";

    /** A sale may go into a global when nobody is invoicing it on its own and no live global holds it. */
    private static final String NOT_INVOICED = """
            NOT EXISTS (SELECT 1 FROM invoice i WHERE i.sale_id = s.id AND i.status IN ('pending', 'stamped'))
            AND NOT EXISTS (SELECT 1 FROM global_invoice_sale g WHERE g.sale_id = s.id AND g.released_at IS NULL)""";

    private static final String NET_GROUPS = """
            SELECT s.id, s.folio, %s AS day, l.tax_factor, l.tax_rate_bp,
                   sum(l.line_total_cents - COALESCE(r.refunded, 0)) AS net_cents
            FROM sale s
            JOIN sale_line l ON l.sale_id = s.id
            LEFT JOIN (SELECT sale_line_id, sum(refund_cents) AS refunded FROM sale_return_line GROUP BY sale_line_id) r
                   ON r.sale_line_id = l.id
            WHERE %s
            GROUP BY s.id, s.folio, day, l.tax_factor, l.tax_rate_bp
            ORDER BY day, s.folio, s.id, l.tax_factor DESC, l.tax_rate_bp DESC
            """;

    private final JdbcTemplate jdbc;

    GlobalSales(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Lists the sales of a period that no invoice covers yet, plus the late ones: sales of an earlier period whose
     * global was already stamped when they reached the core (a register that synced late). Without this they would
     * never be invoiced. Sales returned in full are left out.
     *
     * @param from first day, included
     * @param to last day, included
     * @return the sales, oldest first
     */
    List<GlobalSale> eligibleBetween(LocalDate from, LocalDate to) {
        String where = """
                (%1$s BETWEEN ? AND ?
                 OR (%1$s < ? AND EXISTS (SELECT 1 FROM global_invoice gp
                                         WHERE gp.status = 'stamped' AND %1$s BETWEEN gp.period_start AND gp.period_end)))
                AND """.formatted(BUSINESS_DATE) + " " + NOT_INVOICED;
        return collect(jdbc.queryForList(NET_GROUPS.formatted(BUSINESS_DATE, where), from, to, from));
    }

    /**
     * Counts the sales of a period that are already invoiced on their own, for the preview.
     *
     * @param from first day, included
     * @param to last day, included
     * @return how many sales have a pending or stamped individual invoice
     */
    long individuallyInvoicedBetween(LocalDate from, LocalDate to) {
        Long count = jdbc.queryForObject("""
                SELECT count(*) FROM sale s
                WHERE %s BETWEEN ? AND ?
                  AND EXISTS (SELECT 1 FROM invoice i WHERE i.sale_id = s.id AND i.status IN ('pending', 'stamped'))
                """.formatted(BUSINESS_DATE), Long.class, from, to);
        return count == null ? 0 : count;
    }

    /**
     * Reads the sales an existing global holds, to send exactly the same invoice again after a lost answer.
     *
     * @param globalInvoiceId the global
     * @return its sales, oldest first
     */
    List<GlobalSale> linkedTo(UUID globalInvoiceId) {
        String where = "s.id IN (SELECT sale_id FROM global_invoice_sale WHERE global_invoice_id = ? AND released_at IS NULL)";
        return collect(jdbc.queryForList(NET_GROUPS.formatted(BUSINESS_DATE, where), globalInvoiceId));
    }

    /**
     * Picks the payment form of the global: the method that brought in the most money in those sales.
     *
     * @param sales the sales of the global
     * @return the SAT payment form code; cash ({@code 01}) when there is no payment
     */
    String dominantPaymentForm(List<GlobalSale> sales) {
        if (sales.isEmpty()) {
            return "01";
        }
        Object[] ids = sales.stream().map(GlobalSale::saleId).toArray();
        String method = jdbc.query("""
                SELECT method FROM sale_payment WHERE sale_id = ANY (?)
                GROUP BY method ORDER BY sum(amount_cents) DESC, method LIMIT 1
                """, statement -> statement.setArray(1, statement.getConnection().createArrayOf("uuid", ids)),
                rs -> rs.next() ? rs.getString(1) : "cash");
        return switch (method) {
            case "transfer" -> "03";
            case "card", "card_manual" -> "04";
            default -> "01";
        };
    }

    private static List<GlobalSale> collect(List<Map<String, Object>> rows) {
        Map<UUID, GlobalSale.Builder> bySale = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            long net = ((Number) row.get("net_cents")).longValue();
            UUID saleId = (UUID) row.get("id");
            GlobalSale.Builder sale = bySale.computeIfAbsent(saleId, id -> new GlobalSale.Builder(id,
                    ((Number) row.get("folio")).longValue(), ((java.sql.Date) row.get("day")).toLocalDate()));
            if (net > 0) {
                Integer rate = "rate".equals(row.get("tax_factor")) ? ((Number) row.get("tax_rate_bp")).intValue() : null;
                sale.groups.add(new GlobalSale.TaxGroup(rate, net));
            }
        }
        List<GlobalSale> sales = new ArrayList<>();
        bySale.values().stream().filter(sale -> !sale.groups.isEmpty()).forEach(sale -> sales.add(sale.build()));
        return sales;
    }

    /**
     * One sale inside a global invoice.
     *
     * @param saleId the sale
     * @param folio ticket number, sent as the identification of its concept
     * @param day the day it counts on
     * @param groups what it adds up to per tax rate, net of returns
     */
    record GlobalSale(UUID saleId, long folio, LocalDate day, List<TaxGroup> groups) {

        /** @return the total of the sale in cents */
        long totalCents() {
            return groups.stream().mapToLong(TaxGroup::totalCents).sum();
        }

        /**
         * The lines of a sale with one tax treatment.
         *
         * @param taxRateBasisPoints VAT rate in basis points, or {@code null} when exempt
         * @param totalCents total with VAT, in cents
         */
        record TaxGroup(Integer taxRateBasisPoints, long totalCents) {
        }

        private static final class Builder {
            private final UUID saleId;
            private final long folio;
            private final LocalDate day;
            private final List<TaxGroup> groups = new ArrayList<>();

            private Builder(UUID saleId, long folio, LocalDate day) {
                this.saleId = saleId;
                this.folio = folio;
                this.day = day;
            }

            private GlobalSale build() {
                return new GlobalSale(saleId, folio, day, List.copyOf(groups));
            }
        }
    }
}
