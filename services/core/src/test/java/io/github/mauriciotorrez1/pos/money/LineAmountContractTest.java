package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Objects;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;

/** Runs the cases of packages/contracts, the same ones the TypeScript register runs in Vitest. */
class LineAmountContractTest {

    // Maven copies packages/contracts/cases here, as configured in pom.xml.
    private static final String CASES_RESOURCE = "/contracts/cases/line-amount.json";

    // Strict on purpose: a case with decimals or a misspelled field must fail, not be adjusted.
    private static final JsonMapper STRICT_MAPPER = JsonMapper.builder()
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();

    private static final CaseFile CASES = readCases();

    static Stream<AmountCase> amounts() {
        return CASES.amounts().stream();
    }

    static Stream<RejectionCase> rejections() {
        return CASES.rejections().stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("amounts")
    void calculatesTheExpectedAmount(AmountCase amountCase) {
        long amountCents = LineAmount.inCents(amountCase.unitPriceE4(), amountCase.quantityMilli());

        assertThat(amountCents).isEqualTo(amountCase.expectedAmountCents());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rejections")
    void rejectsInvalidInput(RejectionCase rejectionCase) {
        assertThatThrownBy(() -> LineAmount.inCents(rejectionCase.unitPriceE4(), rejectionCase.quantityMilli()))
                .isExactlyInstanceOf(exceptionFor(rejectionCase.expectedError()));
    }

    private static Class<? extends RuntimeException> exceptionFor(String expectedError) {
        return switch (expectedError) {
            case "negative_input" -> IllegalArgumentException.class;
            case "overflow" -> ArithmeticException.class;
            default -> throw new IllegalStateException("Unknown expected_error: " + expectedError);
        };
    }

    private static CaseFile readCases() {
        try (InputStream cases = LineAmountContractTest.class.getResourceAsStream(CASES_RESOURCE)) {
            return STRICT_MAPPER.readValue(Objects.requireNonNull(cases, CASES_RESOURCE + " not found"), CaseFile.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
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
