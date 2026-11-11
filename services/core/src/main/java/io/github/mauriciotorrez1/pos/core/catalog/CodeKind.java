package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** The role of a code of a product: the printed barcode or one the business added. */
public enum CodeKind {
    BARCODE,
    ALTERNATE;

    /**
     * Returns the kind as the database and the API write it.
     *
     * @return the lower case name
     */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * Finds a kind by its code.
     *
     * @param code the lower case name
     * @return the kind, or empty when unknown
     */
    public static Optional<CodeKind> fromCode(String code) {
        return Arrays.stream(values()).filter(kind -> kind.code().equals(code)).findFirst();
    }
}
