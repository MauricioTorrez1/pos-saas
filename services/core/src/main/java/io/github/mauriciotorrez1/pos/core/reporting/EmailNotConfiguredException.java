package io.github.mauriciotorrez1.pos.core.reporting;

/** The e-mail provider has no credentials: the core runs, but nothing can be sent. */
public class EmailNotConfiguredException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** Creates the exception. */
    public EmailNotConfiguredException() {
        super("The e-mail provider has no API key or sender address configured");
    }
}
