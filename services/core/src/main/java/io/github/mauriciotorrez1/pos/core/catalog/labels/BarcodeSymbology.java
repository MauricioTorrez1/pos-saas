package io.github.mauriciotorrez1.pos.core.catalog.labels;

/**
 * How the code of a product is drawn as bars. The scanner sends back exactly the digits or letters it reads, so the
 * symbology must encode the code as it is stored: EAN-13 only for a real EAN-13, Code 128 for everything else.
 */
public enum BarcodeSymbology {
    /** The 13 digits of the retail barcode, when the last one is a valid check digit. */
    EAN_13,
    /** Any other code: letters, digits and symbols of ASCII, of any length. */
    CODE_128;

    private static final int EAN_13_LENGTH = 13;

    /**
     * Picks the symbology for a code.
     *
     * @param code the code of the product, as it is stored
     * @return {@link #EAN_13} when the code is a valid EAN-13, {@link #CODE_128} otherwise
     */
    public static BarcodeSymbology forCode(String code) {
        return isValidEan13(code) ? EAN_13 : CODE_128;
    }

    /**
     * Tells whether a code is a valid EAN-13: 13 digits whose last one is the check digit of the other twelve.
     *
     * @param code the code to check
     * @return {@code true} if it is a valid EAN-13
     */
    static boolean isValidEan13(String code) {
        if (code == null || code.length() != EAN_13_LENGTH || !code.chars().allMatch(c -> c >= '0' && c <= '9')) {
            return false;
        }
        int sum = 0;
        for (int i = 0; i < EAN_13_LENGTH - 1; i++) {
            int digit = code.charAt(i) - '0';
            sum += i % 2 == 0 ? digit : digit * 3;
        }
        int check = (10 - sum % 10) % 10;
        return check == code.charAt(EAN_13_LENGTH - 1) - '0';
    }
}
