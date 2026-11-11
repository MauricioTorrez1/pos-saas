package io.github.mauriciotorrez1.pos.core.invoicing;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class FiscalDataValidatorTest {

    private static Receiver company() {
        return new Receiver("ACME FERRETERIA", "ABC010203AB1", "601", "G03", "64000", null);
    }

    private static List<String> problems(Receiver receiver) {
        return FiscalDataValidator.validate(receiver).stream().map(e -> e.field() + ":" + e.code()).toList();
    }

    @Test
    void aCompanyAndANaturalPersonWithConsistentDataAreValid() {
        assertThat(FiscalDataValidator.validate(company())).isEmpty();
        assertThat(FiscalDataValidator.validate(
                new Receiver("JUAN PEREZ GOMEZ", "PEGJ800101AB1", "612", "D01", "01000", "juan@example.com"))).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "ABC", "ABC01020AB1", "ABC011303AB1", "ABC010230AB1", "AB-010203AB1", "ABCD0102031", "abc!10203AB1"})
    void rejectsAnRfcThatIsMissingOrBadlyShaped(String rfc) {
        Receiver receiver = new Receiver("ACME", rfc, "601", "G03", "64000", null);

        assertThat(problems(receiver)).anyMatch(p -> p.startsWith("receiver.taxId:"));
    }

    @Test
    void acceptsALowercaseRfcAndAnEnyeOrAmpersand() {
        assertThat(FiscalDataValidator.validate(new Receiver("X", "abc010203ab1", "601", "G03", "64000", null))).isEmpty();
        assertThat(FiscalDataValidator.validate(new Receiver("X", "Ñ&A010203AB1", "601", "G03", "64000", null))).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"XAXX010101000", "XEXX010101000"})
    void theGenericRfcsBelongToTheGlobalInvoice(String rfc) {
        assertThat(problems(new Receiver("PUBLICO EN GENERAL", rfc, "616", "S01", "64000", null)))
                .contains("receiver.taxId:generic_rfc_not_allowed");
    }

    @Test
    void rejectsAnUnknownRegimeAndOneThatDoesNotFitTheTaxpayerType() {
        assertThat(problems(new Receiver("X", "ABC010203AB1", "999", "G03", "64000", null)))
                .containsExactly("receiver.taxRegime:unknown_regime");
        assertThat(problems(new Receiver("X", "ABC010203AB1", "612", "G03", "64000", null)))
                .containsExactly("receiver.taxRegime:regime_does_not_fit_taxpayer_type");
        assertThat(problems(new Receiver("X", "PEGJ800101AB1", "601", "G03", "64000", null)))
                .containsExactly("receiver.taxRegime:regime_does_not_fit_taxpayer_type");
    }

    @Test
    void rejectsAnUnknownCfdiUseAndPersonalUsesForCompanies() {
        assertThat(problems(new Receiver("X", "ABC010203AB1", "601", "Z99", "64000", null)))
                .containsExactly("receiver.cfdiUse:unknown_cfdi_use");
        assertThat(problems(new Receiver("X", "ABC010203AB1", "601", "D01", "64000", null)))
                .containsExactly("receiver.cfdiUse:use_does_not_fit_taxpayer_type");
        assertThat(problems(new Receiver("X", "PEGJ800101AB1", "612", "CN01", "64000", null)))
                .containsExactly("receiver.cfdiUse:use_does_not_fit_regime");
    }

    @ParameterizedTest
    @CsvSource({"6400", "640000", "ABCDE", "6 400"})
    void rejectsAZipCodeThatIsNotFiveDigits(String zip) {
        assertThat(problems(new Receiver("X", "ABC010203AB1", "601", "G03", zip, null)))
                .containsExactly("receiver.zipCode:invalid_format");
    }

    @Test
    void reportsEveryMissingFieldAtOnceAndNeverTheirValues() {
        List<FieldError> errors = FiscalDataValidator.validate(new Receiver(null, null, null, null, null, "not-an-email"));

        assertThat(errors).extracting(FieldError::field).containsExactly("receiver.legalName", "receiver.taxId",
                "receiver.taxRegime", "receiver.cfdiUse", "receiver.zipCode", "receiver.email");
        assertThat(FiscalDataValidator.validate(null)).containsExactly(new FieldError("receiver", "required"));
    }

    @Test
    void theReceiverHidesItsDataWhenPrinted() {
        assertThat(company().toString()).doesNotContain("ABC010203AB1").doesNotContain("ACME");
    }

    @Test
    void checksTheShapeOfPaymentFormsAndProductKeys() {
        assertThat(FiscalDataValidator.isPaymentForm("01")).isTrue();
        assertThat(FiscalDataValidator.isPaymentForm("99")).isTrue();
        assertThat(FiscalDataValidator.isPaymentForm("32")).isFalse();
        assertThat(FiscalDataValidator.isPaymentForm(null)).isFalse();
        assertThat(FiscalDataValidator.isProductKey("27112700")).isTrue();
        assertThat(FiscalDataValidator.isProductKey("2711270")).isFalse();
    }
}
