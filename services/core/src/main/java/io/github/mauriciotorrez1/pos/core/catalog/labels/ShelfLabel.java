package io.github.mauriciotorrez1.pos.core.catalog.labels;

import java.util.Objects;

/**
 * What one shelf label shows, already worked out, so a layout only draws it.
 *
 * @param name      the name of the product
 * @param price     the price with VAT as the customer reads it, such as {@code $135.50} or {@code $12.50 / m}
 * @param code      the code to draw as bars, or {@code null} when the product has none
 * @param symbology how to draw the code, or {@code null} when there is no code
 */
public record ShelfLabel(String name, String price, String code, BarcodeSymbology symbology) {

    public ShelfLabel {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(price, "price");
        if ((code == null) != (symbology == null)) {
            throw new IllegalArgumentException("code and symbology go together");
        }
    }

    /**
     * Builds a label whose code picks its own symbology.
     *
     * @param name  the name of the product
     * @param price the price as text
     * @param code  the code, or {@code null}
     * @return the label
     */
    public static ShelfLabel of(String name, String price, String code) {
        return new ShelfLabel(name, price, code, code == null ? null : BarcodeSymbology.forCode(code));
    }

    /**
     * Tells whether the label carries bars.
     *
     * @return {@code true} if it has a code
     */
    public boolean hasBarcode() {
        return code != null;
    }
}
