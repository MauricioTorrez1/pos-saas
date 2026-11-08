package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the amount sum cases of packages/contracts. */
class AmountSumContractTest {

    private static final CaseFile CASES = ContractCases.read("amount-sum.json", CaseFile.class);

    static Stream<SumCase> sums() {
        return CASES.sums().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("sums")
    void addsUpToTheExpectedTotal(SumCase sumCase) {
        assertThat(sum(sumCase.amountsCents()).cents()).isEqualTo(sumCase.expectedTotalCents());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidAmounts(RejectionCase rejectionCase) {
        ContractCases.assertFailsWith(() -> sum(rejectionCase.amountsCents()), rejectionCase.expectedError());
    }

    private static Money sum(List<Long> amountsCents) {
        return Money.sum(amountsCents.stream().map(Money::new).toList());
    }

    private record CaseFile(
            @JsonProperty("$schema") String schema, List<SumCase> sums, List<RejectionCase> rejections) {}

    private record SumCase(String name, List<Long> amountsCents, long expectedTotalCents) {

        @Override
        public String toString() {
            return name;
        }
    }

    private record RejectionCase(String name, List<Long> amountsCents, String expectedError) {

        @Override
        public String toString() {
            return name;
        }
    }
}
