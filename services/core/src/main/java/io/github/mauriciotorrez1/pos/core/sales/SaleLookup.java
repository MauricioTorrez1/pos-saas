package io.github.mauriciotorrez1.pos.core.sales;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read access to the sales of the current business, for modules such as invoicing. */
@Service
public class SaleLookup {

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
        List<SaleView> found = jdbc.query("SELECT folio, total_cents FROM sale WHERE id = ?",
                (rs, row) -> new SaleView(saleId, rs.getLong("folio"), rs.getLong("total_cents"), lines(saleId), payments(saleId)),
                saleId);
        return found.stream().findFirst();
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
