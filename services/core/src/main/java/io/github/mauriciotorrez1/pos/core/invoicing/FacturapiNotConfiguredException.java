package io.github.mauriciotorrez1.pos.core.invoicing;

/** The {@code FACTURAPI_API_KEY} variable is empty, so no call was made. */
public class FacturapiNotConfiguredException extends FacturapiException {

    public FacturapiNotConfiguredException(String operation) {
        super(operation, "Facturapi API key is not configured", null);
    }
}
