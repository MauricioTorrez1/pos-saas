package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * The fiscal data a customer gives to be invoiced. It is personal data: {@link #toString()} hides it, it is never
 * logged, and only the RFC is stored by the core (ADR 0050).
 *
 * @param legalName name exactly as registered at the SAT, without the company type
 * @param taxId RFC of the receiver
 * @param taxRegime SAT tax regime code, such as {@code 601}
 * @param cfdiUse SAT CFDI use code, such as {@code G03}
 * @param zipCode fiscal ZIP code (5 digits)
 * @param email optional address where the provider sends the invoice; may be {@code null}
 */
public record Receiver(String legalName, String taxId, String taxRegime, String cfdiUse, String zipCode, String email) {

    /** Hides the fiscal data so a stray log line cannot leak it. */
    @Override
    public String toString() {
        return "Receiver[redacted]";
    }
}
