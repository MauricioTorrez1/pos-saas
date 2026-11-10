package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.Quantity;

/**
 * A way to count the product in bulk: a "roll" of 100 m of a product whose base unit is the meter.
 *
 * @param name         what the business calls it, such as {@code roll}
 * @param baseQuantity how much of the base unit one presentation holds
 */
public record Presentation(String name, Quantity baseQuantity) {

    /**
     * Converts a number of presentations into the base unit, which is what the inventory counts.
     *
     * @param count how many presentations came in (at least 1)
     * @return the quantity in the base unit: 2 rolls of 100 m are 200.000 m
     * @throws ArithmeticException if the result does not fit in a long
     * @throws io.github.mauriciotorrez1.pos.money.MoneyException if the result is above the limits of a quantity
     */
    public Quantity toBase(long count) {
        if (count < 1) {
            throw new IllegalArgumentException("count must be at least 1, got " + count);
        }
        return new Quantity(Math.multiplyExact(baseQuantity.milli(), count), baseQuantity.unit());
    }
}
