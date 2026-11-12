package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.mauriciotorrez1.pos.money.Quantity;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The rules of a product and the conversion of a presentation, without a database. */
class ProductRulesTest {

    @Test
    void aRollOfOneHundredMetersConvertsToTheBaseUnit() {
        Presentation roll = new Presentation("roll", Quantity.parse("100", Unit.METER));

        assertThat(roll.toBase(1).milli()).isEqualTo(100_000);
        assertThat(roll.toBase(3).milli()).isEqualTo(300_000);
        assertThat(roll.toBase(3).unit()).isEqualTo(Unit.METER);
    }

    @Test
    void threePointTwoSevenFiveMetersAreKeptAsThreeThousandTwoHundredSeventyFiveThousandths() {
        assertThat(Quantity.parse("3.275", Unit.METER).milli()).isEqualTo(3275);
    }

    @Test
    void convertingZeroPresentationsIsRefused() {
        Presentation box = new Presentation("box", Quantity.parse("12", Unit.PIECE));

        assertThatThrownBy(() -> box.toBase(0)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void everyUnitHasOneKind() {
        assertThat(MeasurementKind.of(Unit.PIECE)).isEqualTo(MeasurementKind.COUNT);
        assertThat(MeasurementKind.of(Unit.KILOGRAM)).isEqualTo(MeasurementKind.WEIGHT);
        assertThat(MeasurementKind.of(Unit.METER)).isEqualTo(MeasurementKind.LENGTH);
        assertThat(MeasurementKind.of(Unit.LITER)).isEqualTo(MeasurementKind.VOLUME);
    }

    @Test
    void aNameIsTrimmedAndMustNotBeBlankOrTooLong() {
        assertThat(ProductRules.name("  Cable THW 12  ")).isEqualTo("Cable THW 12");
        assertThatThrownBy(() -> ProductRules.name("   ")).isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.name(null)).isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.name("x".repeat(201))).isInstanceOf(InvalidProductException.class);
    }

    @Test
    void codesHaveNoSpacesAndNoRepeats() {
        assertThat(ProductRules.codes(List.of(new ProductCode("7501234567890", CodeKind.BARCODE)))).hasSize(1);
        assertThatThrownBy(() -> ProductRules.codes(List.of(new ProductCode("75 01", CodeKind.BARCODE))))
                .isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.codes(List.of(new ProductCode("", CodeKind.BARCODE))))
                .isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.codes(List.of(new ProductCode("A1", CodeKind.BARCODE),
                new ProductCode("A1", CodeKind.ALTERNATE)))).hasMessageContaining("repeated");
    }

    @Test
    void presentationsFollowTheDecimalsOfTheUnit() {
        assertThat(ProductRules.presentations(List.of(new PresentationDraft("roll", "100.000")), Unit.METER))
                .singleElement().satisfies(roll -> assertThat(roll.baseQuantity().milli()).isEqualTo(100_000));
        // Pieces are whole, quantities never have more than 3 decimals, and zero is not a presentation.
        assertThatThrownBy(() -> ProductRules.presentations(List.of(new PresentationDraft("half", "0.5")), Unit.PIECE))
                .isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.presentations(List.of(new PresentationDraft("roll", "1.2345")), Unit.METER))
                .isInstanceOf(InvalidProductException.class);
        assertThatThrownBy(() -> ProductRules.presentations(List.of(new PresentationDraft("none", "0")), Unit.METER))
                .hasMessageContaining("greater than zero");
        assertThatThrownBy(() -> ProductRules.presentations(List.of(new PresentationDraft("roll", "abc")), Unit.METER))
                .isInstanceOf(InvalidProductException.class);
    }

    @Test
    void presentationNamesAreUniqueIgnoringCase() {
        assertThatThrownBy(() -> ProductRules.presentations(List.of(new PresentationDraft("Roll", "100"),
                new PresentationDraft("roll", "50")), Unit.METER)).hasMessageContaining("repeated");
    }

    @Test
    void theCatalogOffersSixteenEightAndZeroPercentAndExempt() {
        assertThat(ProductRules.tax(TaxRate.of(1600)).bp()).isEqualTo(1600);
        assertThat(ProductRules.tax(TaxRate.of(800)).bp()).isEqualTo(800);
        assertThat(ProductRules.tax(TaxRate.of(0)).bp()).isZero();
        assertThat(ProductRules.tax(TaxRate.EXEMPT)).isEqualTo(TaxRate.EXEMPT);
        assertThatThrownBy(() -> ProductRules.tax(TaxRate.of(1200))).isInstanceOf(InvalidProductException.class);
    }

    @Test
    void theSatFilesLoadAndRejectWhatIsNotInThem() {
        SatCatalog sat = new SatCatalog("");

        assertThat(sat.requireUnitKey("MTR")).isEqualTo("MTR");
        assertThat(sat.requireProductKey("01010101")).isEqualTo("01010101");
        assertThatThrownBy(() -> sat.requireUnitKey("mtr")).hasMessageContaining("invalid format");
        assertThatThrownBy(() -> sat.requireUnitKey("ZZZ")).hasMessageContaining("not in the reviewed catalog");
        assertThatThrownBy(() -> sat.requireProductKey("1234567")).hasMessageContaining("invalid format");
        assertThatThrownBy(() -> sat.requireProductKey("12345678")).hasMessageContaining("not in the reviewed catalog");
        assertThatThrownBy(() -> sat.requireProductKey(null)).isInstanceOf(InvalidProductException.class);
    }
}
