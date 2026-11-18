package io.github.mauriciotorrez1.pos.core.catalog.labels;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.catalog.CodeKind;
import io.github.mauriciotorrez1.pos.core.catalog.Product;
import io.github.mauriciotorrez1.pos.core.catalog.ProductCode;
import io.github.mauriciotorrez1.pos.core.catalog.ProductStatus;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** What a label of a product says and which bars it draws (F0-22). */
class ShelfLabelContentTest {

    private static Product product(Unit unit, long priceE4, List<ProductCode> codes) {
        Instant now = Instant.parse("2026-11-17T12:00:00Z");
        return new Product(UUID.randomUUID(), "Producto", ProductStatus.ACTIVE, unit, codes, List.of(), null,
                new UnitPrice(priceE4), TaxRate.of(1_600), null, null, now, now);
    }

    @Test
    void thePriceIsOneBaseUnitWithVatRoundedToTheCent() {
        // 12.3456 pesos a meter round to 12.35, as a sale line of 1.000 m would.
        ShelfLabel label = ShelfLabels.labelOf(product(Unit.METER, 123_456, List.of()));

        assertThat(label.price()).isEqualTo("$12.35 / m");
        assertThat(label.hasBarcode()).isFalse();
    }

    @Test
    void aPieceHasNoUnitAndThousandsAreGrouped() {
        assertThat(ShelfLabels.labelOf(product(Unit.PIECE, 12_500_000, List.of())).price()).isEqualTo("$1,250.00");
        assertThat(ShelfLabels.labelOf(product(Unit.KILOGRAM, 455_000, List.of())).price()).isEqualTo("$45.50 / kg");
    }

    @Test
    void aProductWithoutPriceSaysSo() {
        assertThat(ShelfLabels.labelOf(product(Unit.PIECE, 0, List.of())).price()).isEqualTo("Sin precio");
    }

    @Test
    void theBarcodeWinsOverAnAlternateCodeEvenWhenItComesSecond() {
        ShelfLabel label = ShelfLabels.labelOf(product(Unit.PIECE, 10_000, List.of(
                new ProductCode("ALT-9", CodeKind.ALTERNATE), new ProductCode("7501031311309", CodeKind.BARCODE))));

        assertThat(label.code()).isEqualTo("7501031311309");
        assertThat(label.symbology()).isEqualTo(BarcodeSymbology.EAN_13);
    }

    @Test
    void anAlternateCodeIsPrintedWhenThereIsNoBarcode() {
        ShelfLabel label = ShelfLabels.labelOf(product(Unit.PIECE, 10_000, List.of(new ProductCode("ALT-9", CodeKind.ALTERNATE))));

        assertThat(label.code()).isEqualTo("ALT-9");
        assertThat(label.symbology()).isEqualTo(BarcodeSymbology.CODE_128);
    }

    @ParameterizedTest
    @ValueSource(strings = {"7501031311309", "4006381333931"})
    void aValidEan13IsDrawnAsEan13(String code) {
        assertThat(BarcodeSymbology.forCode(code)).isEqualTo(BarcodeSymbology.EAN_13);
    }

    @ParameterizedTest
    // A wrong check digit, twelve digits (UPC-A), letters, and fourteen digits: Code 128 keeps them exactly.
    @ValueSource(strings = {"7501031311308", "750103131130", "75010313113A9", "75010313113090"})
    void anythingElseIsDrawnAsCode128(String code) {
        assertThat(BarcodeSymbology.forCode(code)).isEqualTo(BarcodeSymbology.CODE_128);
    }
}
