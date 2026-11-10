package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.Objects;

/**
 * Period of a global invoice for the public (the {@code global} object of Facturapi).
 *
 * @param periodicity SAT periodicity code: {@code 01} daily, {@code 02} weekly, {@code 03} biweekly,
 *     {@code 04} monthly, {@code 05} bimonthly
 * @param months SAT month code, such as {@code 11}; bimonthly periods use {@code 13} to {@code 18}
 * @param year four-digit year
 */
public record GlobalPeriod(String periodicity, String months, int year) {

    public GlobalPeriod {
        Objects.requireNonNull(periodicity, "periodicity");
        Objects.requireNonNull(months, "months");
    }
}
