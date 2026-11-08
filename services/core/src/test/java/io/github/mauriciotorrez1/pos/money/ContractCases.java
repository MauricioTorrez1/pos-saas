package io.github.mauriciotorrez1.pos.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Objects;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;

/** Reads the case files of packages/contracts, the same ones the TypeScript register runs in Vitest. */
final class ContractCases {

    // Maven copies packages/contracts/cases here, as configured in pom.xml.
    private static final String CASES_FOLDER = "/contracts/cases/";

    // Strict on purpose: a case with decimals or a misspelled field must fail, not be adjusted.
    private static final JsonMapper STRICT_MAPPER = JsonMapper.builder()
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();

    private ContractCases() {}

    /**
     * Reads one case file.
     *
     * @param fileName the file inside packages/contracts/cases: {@code line-amount.json}
     * @param type the record that matches the file
     * @return the cases
     */
    static <T> T read(String fileName, Class<T> type) {
        String resource = CASES_FOLDER + fileName;
        try (InputStream cases = ContractCases.class.getResourceAsStream(resource)) {
            return STRICT_MAPPER.readValue(Objects.requireNonNull(cases, resource + " not found"), type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Checks that a calculation fails with the error a case names.
     *
     * @param calculation the calculation that must fail
     * @param expectedError the code from the case: {@code overflow}
     */
    static void assertFailsWith(ThrowingCallable calculation, String expectedError) {
        assertThatThrownBy(calculation)
                .isInstanceOfSatisfying(
                        MoneyException.class, e -> assertThat(e.code().wireName()).isEqualTo(expectedError));
    }
}
