package io.github.mauriciotorrez1.pos.core.reporting;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * What the e-mail of a cut says. It holds amounts in cents and the reasons that staff typed, and
 * nothing about customers: the core does not even store them.
 *
 * @param businessName     the name of the business
 * @param closedAt         when the cut was made
 * @param openingFloat     the cash the session started with
 * @param salesCount       how many sales the session made
 * @param salesTotal       what they add up to
 * @param salesByMethod    what was collected, by payment method
 * @param refundsByMethod  what was given back, by payment method
 * @param movements        the cash taken out or put in during the session
 * @param expected         what the register expected, by payment method
 * @param counted          what the cashier counted, by payment method
 * @param differenceReason why the count differs, as typed at the cut, or {@code null}
 */
record CutReport(String businessName, Instant closedAt, long openingFloat, long salesCount, long salesTotal,
                 Map<String, Long> salesByMethod, Map<String, Long> refundsByMethod, List<Movement> movements,
                 Amounts expected, Amounts counted, String differenceReason) {

    /**
     * An amount for each way of paying, in cents.
     *
     * @param cash     cash
     * @param card     card
     * @param transfer bank transfer
     */
    record Amounts(long cash, long card, long transfer) {

        long total() {
            return cash + card + transfer;
        }
    }

    /**
     * Cash that went in or out of the drawer.
     *
     * @param kind   {@code in} or {@code out}
     * @param amount cents
     * @param reason why
     */
    record Movement(String kind, long amount, String reason) {
    }
}
