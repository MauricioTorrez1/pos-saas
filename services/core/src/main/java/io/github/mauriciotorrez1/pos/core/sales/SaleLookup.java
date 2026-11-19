package io.github.mauriciotorrez1.pos.core.sales;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read access to the sales of the current business, for modules such as invoicing. */
@Service
public class SaleLookup {

    /** The day a sale counts on. Rows from before E1-60 have no business date and fall back to their local day. */
    private static final String BUSINESS_DATE = "COALESCE(business_date, (completed_at AT TIME ZONE 'America/Mexico_City')::date)";

    private final JdbcTemplate jdbc;

    SaleLookup(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Finds a sale of the current business. A sale of another business is invisible (row-level security).
     *
     * @param saleId the sale id
     * @return the sale with its lines and payments, or empty if the core has not received it
     */
    @Transactional(readOnly = true)
    public Optional<SaleView> find(UUID saleId) {
        List<SaleView> found = jdbc.query("SELECT folio, total_cents, " + BUSINESS_DATE + " AS business_date FROM sale WHERE id = ?",
                (rs, row) -> new SaleView(saleId, rs.getLong("folio"), rs.getLong("total_cents"),
                        rs.getObject("business_date", LocalDate.class), lines(saleId), payments(saleId)),
                saleId);
        return found.stream().findFirst();
    }

    /**
     * Adds up the sales of the current business by the day they count on, so a sale captured the next morning lands on
     * the day it belongs to (E1-60, ADR 0074).
     *
     * @param from the first day, included
     * @param to the last day, included
     * @return one entry per day that had sales, oldest first
     */
    @Transactional(readOnly = true)
    public List<DailySales> dailySales(LocalDate from, LocalDate to) {
        return jdbc.query("""
                SELECT day, count(*) AS sales, sum(total_cents) AS total
                FROM (SELECT %s AS day, total_cents FROM sale) AS dated
                WHERE day BETWEEN ? AND ?
                GROUP BY day ORDER BY day
                """.formatted(BUSINESS_DATE),
                (rs, row) -> new DailySales(rs.getObject("day", LocalDate.class), rs.getLong("sales"), rs.getLong("total")), from, to);
    }

    private List<SaleView.Line> lines(UUID saleId) {
        return jdbc.query("""
                SELECT id, product_name, unit, quantity_milli, unit_price_e4, tax_factor, tax_rate_bp
                FROM sale_line WHERE sale_id = ? ORDER BY line_number
                """, (rs, row) -> new SaleView.Line(rs.getObject("id", UUID.class), rs.getString("product_name"),
                rs.getString("unit"), rs.getLong("quantity_milli"), rs.getLong("unit_price_e4"),
                rs.getString("tax_factor"), rs.getInt("tax_rate_bp")), saleId);
    }

    private List<SaleView.Payment> payments(UUID saleId) {
        return jdbc.query("SELECT method, amount_cents FROM sale_payment WHERE sale_id = ? ORDER BY amount_cents DESC, id",
                (rs, row) -> new SaleView.Payment(rs.getString("method"), rs.getLong("amount_cents")), saleId);
    }
}
