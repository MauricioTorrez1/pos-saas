package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A request to stamp the global invoice of a period.
 *
 * @param periodicity {@code daily}, {@code biweekly} or {@code monthly}; {@code null} means monthly
 * @param day any day of the period
 * @param paymentForm optional SAT payment form; the one that brought in the most money when absent
 * @param expectedSaleCount the number of sales the preview showed; when it no longer matches nothing is stamped.
 *     May be {@code null} to skip the check
 * @param actorId the user who asks
 */
public record IssueGlobalInvoiceCommand(String periodicity, LocalDate day, String paymentForm, Integer expectedSaleCount,
        UUID actorId) {
}
