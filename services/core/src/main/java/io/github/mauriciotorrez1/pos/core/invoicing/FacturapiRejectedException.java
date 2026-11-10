package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * Facturapi answered 4xx: the request is wrong and repeating it will not help (invalid RFC, unknown invoice,
 * bad key). The provider text is kept apart because it can echo fiscal data; show it to the user, never log it.
 */
public class FacturapiRejectedException extends FacturapiException {

    private final int status;
    private final String providerMessage;

    public FacturapiRejectedException(String operation, int status, String providerMessage) {
        super(operation, operation + " was rejected by Facturapi with HTTP " + status, null);
        this.status = status;
        this.providerMessage = providerMessage;
    }

    /** @return the HTTP status, always 4xx */
    public int status() {
        return status;
    }

    /** @return the error text from Facturapi, possibly {@code null}; it may contain fiscal data */
    public String providerMessage() {
        return providerMessage;
    }

    /** @return {@code true} for 401 and 403, a key problem and not a data problem */
    public boolean isAuthenticationFailure() {
        return status == 401 || status == 403;
    }

    /** @return {@code true} when the invoice does not exist at the provider */
    public boolean isNotFound() {
        return status == 404;
    }
}
