package io.github.mauriciotorrez1.pos.core.invoicing;

/** SAT motives to cancel a CFDI. */
public enum CancellationMotive {
    /** {@code 01}: issued with errors and replaced by another invoice. */
    WITH_RELATED_DOCUMENT("01"),
    /** {@code 02}: issued with errors and not replaced. */
    WITHOUT_RELATED_DOCUMENT("02"),
    /** {@code 03}: the operation never took place. */
    OPERATION_NOT_CARRIED_OUT("03"),
    /** {@code 04}: nominative operation related to a global invoice. */
    GLOBAL_INVOICE_RELATED("04");

    private final String satCode;

    CancellationMotive(String satCode) {
        this.satCode = satCode;
    }

    /** @return the two-digit SAT code */
    public String satCode() {
        return satCode;
    }
}
