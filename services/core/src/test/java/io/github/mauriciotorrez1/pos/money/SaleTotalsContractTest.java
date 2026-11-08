package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the sale totals cases of packages/contracts. */
class SaleTotalsContractTest {

    private static final CaseFile CASES = ContractCases.read("sale-totals.json", CaseFile.class);

    static Stream<SaleCase> sales() {
        return CASES.sales().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("sales")
    void addsUpToTheExpectedTotals(SaleCase saleCase) {
        SaleTotals totals = SaleTotals.of(linesOf(saleCase.lines()));

        assertThat(totals.subtotal().cents()).isEqualTo(saleCase.expectedSubtotalCents());
        assertThat(totals.tax().cents()).isEqualTo(saleCase.expectedTaxCents());
        assertThat(totals.total().cents()).isEqualTo(saleCase.expectedTotalCents());
        assertThat(totals.taxGroups())
                .containsExactlyElementsOf(saleCase.expectedTaxGroups().stream()
                        .map(SaleTotalsContractTest::taxGroupOf)
                        .toList());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidLines(RejectionCase rejectionCase) {
        ContractCases.assertFailsWith(
                () -> SaleTotals.of(linesOf(rejectionCase.lines())), rejectionCase.expectedError());
    }

    private static List<LineTotals> linesOf(List<CaseLine> lines) {
        return lines.stream()
                .map(line -> LineTotals.fromTaxIncluded(
                        new Money(line.totalCents()), taxRateOf(line.taxFactor(), line.taxRateBp())))
                .toList();
    }

    private static TaxGroup taxGroupOf(CaseTaxGroup group) {
        return new TaxGroup(
                taxRateOf(group.taxFactor(), group.taxRateBp()),
                new Money(group.baseCents()),
                new Money(group.taxCents()));
    }

    private static TaxRate taxRateOf(String factor, int bp) {
        return new TaxRate(TaxFactor.fromCode(factor), bp);
    }

    private record CaseFile(
            @JsonProperty("$schema") String schema, List<SaleCase> sales, List<RejectionCase> rejections) {}

    private record CaseLine(long totalCents, String taxFactor, int taxRateBp) {}

    private record CaseTaxGroup(String taxFactor, int taxRateBp, long baseCents, long taxCents) {}

    private record SaleCase(
            String name,
            List<CaseLine> lines,
            long expectedSubtotalCents,
            long expectedTaxCents,
            long expectedTotalCents,
            List<CaseTaxGroup> expectedTaxGroups) {

        @Override
        public String toString() {
            return name;
        }
    }

    private record RejectionCase(String name, List<CaseLine> lines, String expectedError) {

        @Override
        public String toString() {
            return name;
        }
    }
}
