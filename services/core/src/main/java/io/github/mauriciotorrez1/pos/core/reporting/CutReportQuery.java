package io.github.mauriciotorrez1.pos.core.reporting;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads what a cut report needs from the records that the registers uploaded (ADR 0046). It only reads,
 * and row-level security limits every query to the business of the transaction. Customers are not
 * involved: the tables hold none.
 */
@Repository
class CutReportQuery {

    private final JdbcTemplate jdbc;

    CutReportQuery(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Where the report goes: the e-mail of the owner of the business.
     *
     * @return the address, or empty if the business has none
     */
    Optional<String> ownerEmail() {
        return jdbc.queryForList("SELECT owner_email FROM tenant WHERE owner_email IS NOT NULL", String.class).stream().findFirst();
    }

    /**
     * Builds the report of a cut.
     *
     * @param cutId the cut
     * @return the report, or empty if the cut is not known to the business
     */
    Optional<CutReport> find(UUID cutId) {
        return jdbc.query("""
                SELECT c.session_id, c.closed_at, c.reason, s.opening_float_cents,
                       c.expected_cash_cents, c.expected_card_cents, c.expected_transfer_cents,
                       c.counted_cash_cents, c.counted_card_cents, c.counted_transfer_cents,
                       COALESCE((SELECT name FROM tenant LIMIT 1), 'su negocio') AS business_name
                FROM cash_cut c JOIN cash_session s ON s.id = c.session_id
                WHERE c.id = ?
                """, (row, number) -> {
            UUID sessionId = row.getObject("session_id", UUID.class);
            long[] sales = jdbc.queryForObject(
                    "SELECT count(*), COALESCE(sum(total_cents), 0) FROM sale WHERE cash_session_id = ?",
                    (r, n) -> new long[] {r.getLong(1), r.getLong(2)}, sessionId);
            return new CutReport(row.getString("business_name"), row.getObject("closed_at", OffsetDateTime.class).toInstant(),
                    row.getLong("opening_float_cents"), sales[0], sales[1],
                    byMethod("SELECT p.method, sum(p.amount_cents) FROM sale_payment p JOIN sale s ON s.id = p.sale_id "
                            + "WHERE s.cash_session_id = ? GROUP BY p.method ORDER BY p.method", sessionId),
                    byMethod("SELECT f.method, sum(f.amount_cents) FROM sale_return_refund f JOIN sale_return r ON r.id = f.return_id "
                            + "WHERE r.cash_session_id = ? GROUP BY f.method ORDER BY f.method", sessionId),
                    movements(sessionId),
                    new CutReport.Amounts(row.getLong("expected_cash_cents"), row.getLong("expected_card_cents"), row.getLong("expected_transfer_cents")),
                    new CutReport.Amounts(row.getLong("counted_cash_cents"), row.getLong("counted_card_cents"), row.getLong("counted_transfer_cents")),
                    row.getString("reason"));
        }, cutId).stream().findFirst();
    }

    private Map<String, Long> byMethod(String sql, UUID sessionId) {
        Map<String, Long> amounts = new LinkedHashMap<>();
        jdbc.query(sql, row -> {
            amounts.put(row.getString(1), row.getLong(2));
        }, sessionId);
        return amounts;
    }

    private List<CutReport.Movement> movements(UUID sessionId) {
        return jdbc.query("SELECT kind, amount_cents, reason FROM cash_movement WHERE session_id = ? ORDER BY occurred_at, id",
                (row, number) -> new CutReport.Movement(row.getString("kind"), row.getLong("amount_cents"), row.getString("reason")),
                sessionId);
    }
}
