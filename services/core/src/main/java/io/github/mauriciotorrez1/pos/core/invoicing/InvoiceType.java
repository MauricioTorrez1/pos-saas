package io.github.mauriciotorrez1.pos.core.invoicing;

/** CFDI voucher type. */
public enum InvoiceType {
    /** Sale (SAT type {@code I}). */
    INCOME("I"),
    /** Credit note for a return (SAT type {@code E}). */
    CREDIT_NOTE("E");

    private final String satCode;

    InvoiceType(String satCode) {
        this.satCode = satCode;
    }

    /** @return the one-letter SAT code */
    public String satCode() {
        return satCode;
    }
}
