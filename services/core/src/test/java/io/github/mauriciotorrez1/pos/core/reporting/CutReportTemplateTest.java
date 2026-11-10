package io.github.mauriciotorrez1.pos.core.reporting;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The Spanish text of the report: amounts in integers, a clear difference, and nothing about customers. */
class CutReportTemplateTest {

    private static final ZoneId ZONE = ZoneId.of("America/Mexico_City");

    @Test
    void moneyIsFormattedFromCentsWithoutFloatingPoint() {
        assertThat(CutReportTemplate.money(0)).isEqualTo("$0.00");
        assertThat(CutReportTemplate.money(5)).isEqualTo("$0.05");
        assertThat(CutReportTemplate.money(123456)).isEqualTo("$1,234.56");
        assertThat(CutReportTemplate.money(-5)).isEqualTo("-$0.05");
        assertThat(CutReportTemplate.money(9_007_199_254_740_991L)).isEqualTo("$90,071,992,547,409.91");
    }

    @Test
    void theSubjectNamesTheBusinessAndTheClosingTimeInItsZone() {
        // 2026-12-10T18:21:04Z is 12:21 in Mexico City (UTC-6, no daylight saving time).
        assertThat(CutReportTemplate.subject(report(0, 0), ZONE)).isEqualTo("Corte de caja de Tlapaleria - 10/12/2026 12:21");
    }

    @Test
    void aCutThatBalancesSaysSoAndASurplusIsNotAShortage() {
        assertThat(CutReportTemplate.body(report(1000, 1000), ZONE)).contains("Diferencia total: cuadra");
        assertThat(CutReportTemplate.body(report(1000, 1250), ZONE)).contains("Diferencia total: sobran $2.50");
        assertThat(CutReportTemplate.body(report(1000, 400), ZONE)).contains("Diferencia total: faltan $6.00");
    }

    @Test
    void emptySectionsStillSaySoAndNoCustomerDataIsPromised() {
        CutReport empty = new CutReport("Tlapaleria", Instant.parse("2026-12-10T18:21:04Z"), 0, 0, 0,
                Map.of(), Map.of(), List.of(), new CutReport.Amounts(0, 0, 0), new CutReport.Amounts(0, 0, 0), null);

        assertThat(CutReportTemplate.body(empty, ZONE)).contains("0 ventas por $0.00", "Sin devoluciones", "Sin movimientos")
                .doesNotContain("Motivo anotado").contains("No contiene datos de clientes");
    }

    private static CutReport report(long expectedCash, long countedCash) {
        Map<String, Long> sales = new LinkedHashMap<>();
        sales.put("cash", 7600L);
        sales.put("transfer", 4000L);
        return new CutReport("Tlapaleria", Instant.parse("2026-12-10T18:21:04Z"), 50000, 1, 11600, sales, Map.of(),
                List.of(), new CutReport.Amounts(expectedCash, 0, 0), new CutReport.Amounts(countedCash, 0, 0), null);
    }
}
