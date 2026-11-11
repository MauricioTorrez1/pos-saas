package io.github.mauriciotorrez1.pos.core.reporting;

/**
 * Sends one e-mail. The rest of the core depends on this interface and never on a provider, so a test
 * uses a fake and a provider can be replaced without touching the reports (ADR 0052).
 */
public interface EmailSender {

    /**
     * Sends a plain-text message. Calling it again with the same {@link EmailMessage#idempotencyKey()}
     * must not deliver a second e-mail.
     *
     * @param message what to send
     * @throws EmailNotConfiguredException if the sender has no credentials, so nothing was attempted
     * @throws EmailRejectedException      if the provider refused the message; repeating it is useless
     * @throws EmailUnavailableException   if the provider could not be reached or failed; the outcome is unknown
     */
    void send(EmailMessage message);

    /**
     * One message.
     *
     * @param to             the recipient address
     * @param subject        the subject line
     * @param textBody       the plain-text body
     * @param idempotencyKey a key that is the same for every attempt of the same message
     */
    record EmailMessage(String to, String subject, String textBody, String idempotencyKey) {
    }
}
