package io.github.mauriciotorrez1.pos.core.invoicing;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.RateTotal;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalPeriodicity.Period;
import io.github.mauriciotorrez1.pos.core.invoicing.GlobalSales.GlobalSale;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The periods, the concepts and the per-rate totals of a global invoice, without a database (ADR 0079). */
class GlobalPeriodicityTest {

    @Test
    void monthlyIsTheDefaultAndUnknownNamesAreRefused() {
        assertThat(GlobalPeriodicity.parse(null)).contains(GlobalPeriodicity.MONTHLY);
        assertThat(GlobalPeriodicity.parse(" Daily ")).contains(GlobalPeriodicity.DAILY);
        assertThat(GlobalPeriodicity.parse("weekly")).isEmpty();
    }

    @Test
    void periodsAreCutByCalendar() {
        assertThat(GlobalPeriodicity.MONTHLY.periodOf(LocalDate.of(2028, 2, 10)))
                .isEqualTo(new Period(GlobalPeriodicity.MONTHLY, LocalDate.of(2028, 2, 1), LocalDate.of(2028, 2, 29)));
        assertThat(GlobalPeriodicity.BIWEEKLY.periodOf(LocalDate.of(2026, 10, 15)).end()).isEqualTo(LocalDate.of(2026, 10, 15));
        assertThat(GlobalPeriodicity.BIWEEKLY.periodOf(LocalDate.of(2026, 10, 16)))
                .isEqualTo(new Period(GlobalPeriodicity.BIWEEKLY, LocalDate.of(2026, 10, 16), LocalDate.of(2026, 10, 31)));
        Period day = GlobalPeriodicity.DAILY.periodOf(LocalDate.of(2026, 1, 5));
        assertThat(day.toSat()).isEqualTo(new GlobalPeriod("01", "01", 2026));
        assertThat(day.closedOn(LocalDate.of(2026, 1, 5))).isFalse();
        assertThat(day.closedOn(LocalDate.of(2026, 1, 6))).isTrue();
        assertThat(day.deadline()).isEqualTo(LocalDate.of(2026, 1, 8));
    }

    @Test
    void eachTicketAndRateIsOneConceptOfQuantityOne() {
        GlobalSale sale = new GlobalSale(UUID.randomUUID(), 42, LocalDate.of(2026, 10, 1),
                List.of(new GlobalSale.TaxGroup(1600, 11600), new GlobalSale.TaxGroup(null, 5000)));

        List<InvoiceLineDraft> lines = GlobalInvoiceService.lines(List.of(sale));

        assertThat(lines).extracting(InvoiceLineDraft::unitPriceE4).containsExactly(1_160_000L, 500_000L);
        assertThat(lines).extracting(InvoiceLineDraft::identification).containsOnly("42");
        assertThat(lines).extracting(InvoiceLineDraft::quantityMilli).containsOnly(1_000L);
    }

    @Test
    void theTotalsPerRateSplitTheVatOutOfTheTotal() {
        List<GlobalSale> sales = List.of(
                new GlobalSale(UUID.randomUUID(), 1, LocalDate.of(2026, 10, 1), List.of(new GlobalSale.TaxGroup(1600, 101))),
                new GlobalSale(UUID.randomUUID(), 2, LocalDate.of(2026, 10, 1),
                        List.of(new GlobalSale.TaxGroup(0, 300), new GlobalSale.TaxGroup(null, 50), new GlobalSale.TaxGroup(800, 108))));

        assertThat(GlobalInvoiceService.totalsByRate(sales)).containsExactly(
                new RateTotal(1600, 87, 14, 101),
                new RateTotal(800, 100, 8, 108),
                new RateTotal(0, 300, 0, 300),
                new RateTotal(null, 50, 0, 50));
    }
}
