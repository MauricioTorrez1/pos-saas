package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.List;

/** The receiver data or the SAT keys of an invoice break a rule; nothing was sent to the provider. */
public class InvalidFiscalDataException extends RuntimeException {

    private final transient List<FieldError> errors;

    /**
     * @param errors every broken rule, at least one
     */
    public InvalidFiscalDataException(List<FieldError> errors) {
        super("The fiscal data is invalid: " + errors.size() + " problem(s)");
        this.errors = List.copyOf(errors);
    }

    /** @return the broken rules, without any value */
    public List<FieldError> errors() {
        return errors;
    }
}
