package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the line tax cases of packages/contracts. */
class LineTaxContractTest {

    private static final CaseFile CASES = ContractCases.read("line-tax.json", CaseFile.class);

    static Stream<LineCase> lines() {
        return CASES.lines().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("lines")
    void splitsTheExpectedBaseAndTax(LineCase lineCase) {
        LineTotals line = LineTotals.of(
                new UnitPrice(lineCase.unitPriceE4()),
                new Quantity(lineCase.quantityMilli(), Unit.fromCode(lineCase.unit())),
                new TaxRate(TaxFactor.fromCode(lineCase.taxFactor()), lineCase.taxRateBp()));

        assertThat(line.subtotal().cents()).isEqualTo(lineCase.expectedSubtotalCents());
        assertThat(line.tax().cents()).isEqualTo(lineCase.expectedTaxCents());
        assertThat(line.total().cents()).isEqualTo(lineCase.expectedTotalCents());
        assertThat(line.taxRate().factor().code()).isEqualTo(lineCase.taxFactor());
        assertThat(line.taxRate().bp()).isEqualTo(lineCase.taxRateBp());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidInput(RejectionCase rejectionCase) {
        ContractCases.assertFailsWith(
                () -> LineTotals.of(
                        new UnitPrice(rejectionCase.unitPriceE4()),
                        new Quantity(rejectionCase.quantityMilli(), Unit.fromCode(rejectionCase.unit())),
                        new TaxRate(TaxFactor.fromCode(rejectionCase.taxFactor()), rejectionCase.taxRateBp())),
                rejectionCase.expectedError());
    }

    private record CaseFile(
            @JsonProperty("$schema") String schema, List<LineCase> lines, List<RejectionCase> rejections) {}

    private record LineCase(
            String name,
            long unitPriceE4,
            long quantityMilli,
            String unit,
            String taxFactor,
            int taxRateBp,
            long expectedSubtotalCents,
            long expectedTaxCents,
            long expectedTotalCents) {

        @Override
        public String toString() {
            return name;
        }
    }

    private record RejectionCase(
            String name,
            long unitPriceE4,
            long quantityMilli,
            String unit,
            String taxFactor,
            int taxRateBp,
            String expectedError) {

        @Override
        public String toString() {
            return name;
        }
    }
}
