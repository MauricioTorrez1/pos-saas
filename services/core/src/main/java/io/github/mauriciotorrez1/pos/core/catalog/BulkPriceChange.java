package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Raises or lowers the price of many products at once by a percentage (RF-006, ADR 0062). The owner first sees what
 * would change, and then confirms it: the change is all or nothing, each product keeps its own audit entry and price
 * history, and the registers receive every new price through the feed.
 */
@Service
public class BulkPriceChange {

    /** More products than this in one change is refused, so one request never holds the catalog for long. */
    static final int MAX_PRODUCTS = 5_000;
    /** Percentages are in hundredths of a percent: 500 is 5 %. */
    static final long MIN_PERCENT_HUNDREDTHS = -9_000;
    static final long MAX_PERCENT_HUNDREDTHS = 50_000;
    private static final long HUNDREDTHS_PER_UNIT = 10_000;
    private static final long MAX_PRICE_E4 = 10_000_000_000L;

    private final ProductCatalog catalog;
    private final AuditLog auditLog;

    BulkPriceChange(ProductCatalog catalog, AuditLog auditLog) {
        this.catalog = catalog;
        this.auditLog = auditLog;
    }

    /** To what the new prices are rounded, in ten-thousandths of a peso. */
    public enum Rounding {
        /** To the cent. */
        CENT(100),
        /** To fifty cents, which is what coins can pay. */
        HALF_PESO(5_000),
        /** To the peso. */
        PESO(10_000);

        private final long stepE4;

        Rounding(long stepE4) {
            this.stepE4 = stepE4;
        }

        /**
         * Reads the rounding of a request.
         *
         * @param code {@code cent}, {@code half_peso} or {@code peso}; {@code null} means to the cent
         * @return the rounding
         * @throws InvalidProductException if the code is none of them
         */
        public static Rounding fromCode(String code) {
            if (code == null) {
                return CENT;
            }
            return switch (code) {
                case "cent" -> CENT;
                case "half_peso" -> HALF_PESO;
                case "peso" -> PESO;
                default -> throw new InvalidProductException("rounding must be cent, half_peso or peso");
            };
        }
    }

    /**
     * What to change.
     *
     * @param search            words that the name of the products contains; {@code null} or blank for every product
     * @param percentHundredths the change in hundredths of a percent, negative to lower: 500 raises 5 %
     * @param rounding          to what the new prices are rounded
     */
    public record Request(String search, long percentHundredths, Rounding rounding) {
    }

    /** One product of a bulk change, with its price before and after. */
    public record Line(UUID productId, String name, long currentPriceE4, long newPriceE4) {
    }

    /**
     * What a bulk change does.
     *
     * @param lines   the products whose price changes, ordered by name
     * @param applied whether the prices were changed, or this is only what would happen
     */
    public record Outcome(List<Line> lines, boolean applied) {
    }

    /** Thrown when the catalog changed between the preview and the confirmation, so nothing was applied. */
    public static final class StalePreviewException extends RuntimeException {
        private final int expected;
        private final int actual;

        StalePreviewException(int expected, int actual) {
            super("The preview showed " + expected + " products and now there are " + actual);
            this.expected = expected;
            this.actual = actual;
        }

        /** @return how many products the preview showed */
        public int expected() {
            return expected;
        }

        /** @return how many products would change now */
        public int actual() {
            return actual;
        }
    }

    /**
     * Shows what a change would do, without changing anything.
     *
     * @param request what to change
     * @return the products whose price would change
     * @throws InvalidProductException if the percentage is out of range or too many products match
     */
    @Transactional(readOnly = true)
    public Outcome preview(Request request) {
        return new Outcome(linesOf(request), false);
    }

    /**
     * Changes the prices. Either every product changes or none does: a failure in the middle rolls everything back.
     *
     * @param actorId       the owner who confirms it
     * @param request       what to change
     * @param expectedCount how many products the preview showed, so a catalog that moved in between is noticed
     * @return the products whose price changed
     * @throws StalePreviewException   if the number of products is no longer the one of the preview
     * @throws InvalidProductException if the percentage is out of range or too many products match
     */
    @Transactional
    public Outcome apply(UUID actorId, Request request, int expectedCount) {
        List<Line> lines = linesOf(request);
        if (lines.size() != expectedCount) {
            throw new StalePreviewException(expectedCount, lines.size());
        }
        for (Line line : lines) {
            catalog.changePrice(actorId, line.productId(), new UnitPrice(line.newPriceE4()));
        }
        if (!lines.isEmpty()) {
            auditLog.record(new AuditEntry(actorId, "price.bulk_change", "price_change", Uuid7.next(), null,
                    "{\"percentHundredths\":" + request.percentHundredths() + ",\"rounding\":\""
                            + request.rounding().name().toLowerCase(java.util.Locale.ROOT) + "\",\"products\":"
                            + lines.size() + "}"));
        }
        return new Outcome(lines, true);
    }

    private List<Line> linesOf(Request request) {
        long percent = request.percentHundredths();
        if (percent == 0 || percent < MIN_PERCENT_HUNDREDTHS || percent > MAX_PERCENT_HUNDREDTHS) {
            throw new InvalidProductException("percent must be between -90 and 500, and not zero");
        }
        List<ProductCatalog.PricedProduct> products = catalog.pricedMatching(request.search(), MAX_PRODUCTS + 1);
        if (products.size() > MAX_PRODUCTS) {
            throw new InvalidProductException("more than " + MAX_PRODUCTS + " products match; narrow the search");
        }
        List<Line> lines = new ArrayList<>();
        for (ProductCatalog.PricedProduct product : products) {
            long changed = newPrice(product.unitPriceE4(), percent, request.rounding());
            if (changed != product.unitPriceE4()) {
                lines.add(new Line(product.id(), product.name(), product.unitPriceE4(), changed));
            }
        }
        return lines;
    }

    /**
     * Applies a percentage to a price and rounds it half up. A price never drops to zero: the lowest is one step of
     * the rounding.
     *
     * @param priceE4           the price in ten-thousandths of a peso
     * @param percentHundredths the change in hundredths of a percent
     * @param rounding          to what the result is rounded
     * @return the new price in ten-thousandths of a peso
     */
    static long newPrice(long priceE4, long percentHundredths, Rounding rounding) {
        long factor = HUNDREDTHS_PER_UNIT + percentHundredths;
        long exact = (priceE4 * factor * 2 + HUNDREDTHS_PER_UNIT) / (HUNDREDTHS_PER_UNIT * 2);
        long step = rounding.stepE4;
        long rounded = ((exact * 2 + step) / (step * 2)) * step;
        return Math.min(MAX_PRICE_E4, Math.max(step, rounded));
    }
}
