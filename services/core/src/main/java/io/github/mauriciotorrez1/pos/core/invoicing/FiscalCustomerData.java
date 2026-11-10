package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.Objects;

/**
 * Fiscal data of an invoice receiver (CFDI 4.0 requires all of it).
 *
 * @param legalName name exactly as registered at the SAT, without the company type
 * @param taxId RFC of the receiver
 * @param taxSystem SAT tax regime code, such as {@code 601}
 * @param zipCode fiscal ZIP code
 * @param email optional address where the provider sends the invoice; may be {@code null}
 */
public record FiscalCustomerData(String legalName, String taxId, String taxSystem, String zipCode, String email) {

    public FiscalCustomerData {
        Objects.requireNonNull(legalName, "legalName");
        Objects.requireNonNull(taxId, "taxId");
        Objects.requireNonNull(taxSystem, "taxSystem");
        Objects.requireNonNull(zipCode, "zipCode");
    }

    /** Hides the fiscal data so a stray log line cannot leak it. */
    @Override
    public String toString() {
        return "FiscalCustomerData[redacted]";
    }
}
