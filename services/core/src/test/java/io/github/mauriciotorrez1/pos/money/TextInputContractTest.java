package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the text input cases of packages/contracts. */
class TextInputContractTest {

    private static final CaseFile CASES = ContractCases.read("text-input.json", CaseFile.class);

    static Stream<ValueCase> values() {
        return CASES.values().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("values")
    void readsTheExpectedValue(ValueCase valueCase) {
        assertThat(read(valueCase.text(), valueCase.readsAs())).isEqualTo(valueCase.expectedValue());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidText(RejectionCase rejectionCase) {
        ContractCases.assertFailsWith(
                () -> read(rejectionCase.text(), rejectionCase.readsAs()), rejectionCase.expectedError());
    }

    /** Reads the text the way the case asks: as cents, as a unit price, or as a quantity of a unit. */
    private static long read(String text, String readsAs) {
        return switch (readsAs) {
            case "amount_cents" -> Money.parse(text).cents();
            case "unit_price_e4" -> UnitPrice.parse(text).e4();
            default -> Quantity.parse(text, Unit.fromCode(readsAs)).milli();
        };
    }

    private record CaseFile(
            @JsonProperty("$schema") String schema, List<ValueCase> values, List<RejectionCase> rejections) {}

    private record ValueCase(String name, String text, String readsAs, long expectedValue) {

        @Override
        public String toString() {
            return name;
        }
    }

    private record RejectionCase(String name, String text, String readsAs, String expectedError) {

        @Override
        public String toString() {
            return name;
        }
    }
}
