package io.github.mauriciotorrez1.pos.core.sales;

import java.time.LocalDate;

/**
 * The completed sales of one business day, as the core counts them (E1-60).
 *
 * @param day the day the sales count on, in the time zone of the register
 * @param salesCount how many sales
 * @param totalCents what they add up to with VAT, in cents
 */
public record DailySales(LocalDate day, long salesCount, long totalCents) {
}
