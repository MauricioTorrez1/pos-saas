package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reads numbers typed as text into integers with a fixed number of decimals, without floating point. */
final class DecimalText {

    // Only ASCII digits and one optional point. TypeScript uses the same pattern, so both read the same text the same way.
    private static final Pattern DECIMAL_TEXT = Pattern.compile("([0-9]*)(?:\\.([0-9]*))?");
    private static final int MAX_VALUE_DIGITS = Long.toString(ValueLimits.MAX_VALUE).length();

    private DecimalText() {}

    /**
     * Reads a decimal number written as text: "3.275" with 3 decimals is 3275.
     *
     * <p>Accepts digits with an optional point, such as "12", "12.5", ".5", or "12.". Rejects signs, spaces, commas,
     * currency signs, and exponents.
     *
     * @param text the number as text
     * @param decimals how many decimals the integer keeps: 2 for cents, 3 for quantities, 4 for unit prices
     * @return the number times 10 to the power of {@code decimals}
     * @throws MoneyException with {@code INVALID_FORMAT}, {@code TOO_MANY_DECIMALS}, or {@code OVERFLOW}
     */
    static long read(String text, int decimals) {
        Objects.requireNonNull(text, "text");
        // matches() needs the whole text, so a trailing line break fails here as it does in TypeScript.
        Matcher match = DECIMAL_TEXT.matcher(text);
        if (!match.matches()) {
            throw invalidFormat(text);
        }
        String wholeDigits = match.group(1);
        String fractionDigits = Objects.requireNonNullElse(match.group(2), "");
        if (wholeDigits.isEmpty() && fractionDigits.isEmpty()) {
            throw invalidFormat(text);
        }
        if (fractionDigits.length() > decimals) {
            throw new MoneyException(
                    MoneyErrorCode.TOO_MANY_DECIMALS, "Expected at most %d decimals, got \"%s\"".formatted(decimals, text));
        }

        String digits = withoutLeadingZeros(wholeDigits + fractionDigits + "0".repeat(decimals - fractionDigits.length()));
        // Counting digits first keeps parseLong away from a number that does not fit in a long.
        if (digits.length() > MAX_VALUE_DIGITS || Long.parseLong(digits) > ValueLimits.MAX_VALUE) {
            throw new MoneyException(MoneyErrorCode.OVERFLOW, "\"%s\" exceeds the largest supported value".formatted(text));
        }
        return Long.parseLong(digits);
    }

    private static MoneyException invalidFormat(String text) {
        return new MoneyException(
                MoneyErrorCode.INVALID_FORMAT, "Expected digits with an optional decimal point, got \"%s\"".formatted(text));
    }

    private static String withoutLeadingZeros(String digits) {
        int firstSignificant = 0;
        while (firstSignificant < digits.length() - 1 && digits.charAt(firstSignificant) == '0') {
            firstSignificant++;
        }
        return digits.substring(firstSignificant);
    }
}
