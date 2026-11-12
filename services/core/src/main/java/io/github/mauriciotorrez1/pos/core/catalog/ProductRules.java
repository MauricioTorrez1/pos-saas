package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.MoneyException;
import io.github.mauriciotorrez1.pos.money.Quantity;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** The rules a product must meet before it is saved. Pure functions, so they are tested without a database. */
final class ProductRules {

    /** The general VAT rate, 16%, in basis points. */
    static final int STANDARD_RATE_BP = 1600;
    /** The VAT rates the catalog offers: 0%, 8% (border zone) and 16%. Exempt is a factor, not a rate. */
    private static final java.util.Set<Integer> OFFERED_RATES_BP = java.util.Set.of(0, 800, STANDARD_RATE_BP);

    static final int MAX_NAME_LENGTH = 200;
    static final int MAX_CODES = 20;
    static final int MAX_PRESENTATIONS = 10;
    static final int MAX_PRESENTATION_NAME_LENGTH = 50;

    private static final Pattern CODE_PATTERN = Pattern.compile("\\S{1,64}");

    private ProductRules() {
    }

    /**
     * Cleans and checks a product name.
     *
     * @param raw the name as received
     * @return the name without surrounding spaces
     * @throws InvalidProductException if it is missing, blank, or longer than 200 characters
     */
    static String name(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new InvalidProductException("name is required");
        }
        String name = raw.strip();
        if (name.length() > MAX_NAME_LENGTH) {
            throw new InvalidProductException("name must have at most " + MAX_NAME_LENGTH + " characters");
        }
        return name;
    }

    /**
     * Checks that the catalog offers a tax rate.
     *
     * @param tax the rate: 16%, 8%, 0% or exempt
     * @return the same rate
     * @throws InvalidProductException if the rate is not one the catalog offers
     */
    static TaxRate tax(TaxRate tax) {
        if (!OFFERED_RATES_BP.contains(tax.bp())) {
            throw new InvalidProductException("tax rate must be 16%, 8%, 0% or exempt");
        }
        return tax;
    }

    /**
     * Checks the codes of a product.
     *
     * @param codes the codes as received, possibly {@code null}
     * @return the codes, never {@code null}
     * @throws InvalidProductException if there are too many, a code is empty, has spaces or is longer than 64
     *                                 characters, or a code is repeated
     */
    static List<ProductCode> codes(List<ProductCode> codes) {
        if (codes == null) {
            return List.of();
        }
        if (codes.size() > MAX_CODES) {
            throw new InvalidProductException("a product has at most " + MAX_CODES + " codes");
        }
        Set<String> seen = new HashSet<>();
        for (ProductCode code : codes) {
            if (code.code() == null || !CODE_PATTERN.matcher(code.code()).matches()) {
                throw new InvalidProductException("a code has 1 to 64 characters and no spaces");
            }
            if (!seen.add(code.code())) {
                throw new InvalidProductException("the code " + code.code() + " is repeated");
            }
        }
        return List.copyOf(codes);
    }

    /**
     * Reads and checks the presentations of a product.
     *
     * @param drafts the presentations as received, possibly {@code null}
     * @param unit   the base unit of the product, which gives meaning to the quantities
     * @return the presentations, never {@code null}
     * @throws InvalidProductException if there are too many, a name is blank, too long or repeated, or a quantity
     *                                 is not a positive number with up to 3 decimals (whole for pieces)
     */
    static List<Presentation> presentations(List<PresentationDraft> drafts, Unit unit) {
        if (drafts == null) {
            return List.of();
        }
        if (drafts.size() > MAX_PRESENTATIONS) {
            throw new InvalidProductException("a product has at most " + MAX_PRESENTATIONS + " presentations");
        }
        Set<String> seen = new HashSet<>();
        List<Presentation> clean = new ArrayList<>();
        for (PresentationDraft draft : drafts) {
            String name = draft.name() == null ? "" : draft.name().strip();
            if (name.isEmpty() || name.length() > MAX_PRESENTATION_NAME_LENGTH) {
                throw new InvalidProductException("a presentation name has 1 to " + MAX_PRESENTATION_NAME_LENGTH + " characters");
            }
            if (!seen.add(name.toLowerCase(Locale.ROOT))) {
                throw new InvalidProductException("the presentation " + name + " is repeated");
            }
            clean.add(new Presentation(name, quantity(name, draft.baseQuantity(), unit)));
        }
        return List.copyOf(clean);
    }

    private static Quantity quantity(String presentationName, String text, Unit unit) {
        Quantity quantity;
        try {
            quantity = Quantity.parse(text == null ? "" : text, unit);
        } catch (MoneyException e) {
            throw new InvalidProductException("the quantity of presentation " + presentationName + " is not valid: " + e.getMessage());
        }
        if (quantity.milli() < 1) {
            throw new InvalidProductException("the quantity of presentation " + presentationName + " must be greater than zero");
        }
        return quantity;
    }
}
