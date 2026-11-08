package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the line amount cases of packages/contracts. */
class LineAmountContractTest {

    private static final CaseFile CASES = ContractCases.read("line-amount.json", CaseFile.class);

    static Stream<AmountCase> amounts() {
        return CASES.amounts().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("amounts")
    void calculatesTheExpectedAmount(AmountCase amountCase) {
        Money amount = LineAmount.of(
                new UnitPrice(amountCase.unitPriceE4()),
                new Quantity(amountCase.quantityMilli(), Unit.fromCode(amountCase.unit())));

        assertThat(amount.cents()).isEqualTo(amountCase.expectedAmountCents());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidInput(RejectionCase rejectionCase) {
        ContractCases.assertFailsWith(
                () -> LineAmount.of(
                        new UnitPrice(rejectionCase.unitPriceE4()),
                        new Quantity(rejectionCase.quantityMilli(), Unit.fromCode(rejectionCase.unit()))),
                rejectionCase.expectedError());
    }

    private record CaseFile(
            @JsonProperty("$schema") String schema, List<AmountCase> amounts, List<RejectionCase> rejections) {}

    private record AmountCase(
            String name, long unitPriceE4, long quantityMilli, String unit, long expectedAmountCents) {

        @Override
        public String toString() {
            return name;
        }
    }

    private record RejectionCase(
            String name, long unitPriceE4, long quantityMilli, String unit, String expectedError) {

        @Override
        public String toString() {
            return name;
        }
    }
}
