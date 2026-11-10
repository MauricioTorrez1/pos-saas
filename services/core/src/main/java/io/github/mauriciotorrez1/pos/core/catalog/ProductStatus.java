package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** Whether the business sells the product now. An inactive product stays in the catalog but is not offered. */
public enum ProductStatus {
    ACTIVE,
    INACTIVE;

    /**
     * Returns the status as the database and the API write it.
     *
     * @return the lower case name
     */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * Finds a status by its code.
     *
     * @param code the lower case name
     * @return the status, or empty when unknown
     */
    public static Optional<ProductStatus> fromCode(String code) {
        return Arrays.stream(values()).filter(status -> status.code().equals(code)).findFirst();
    }
}
