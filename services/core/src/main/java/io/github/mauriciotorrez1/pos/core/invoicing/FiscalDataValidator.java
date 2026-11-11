package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks the fiscal data of a receiver before anything is sent to the provider (RF-035, ADR 0050). It is a first
 * filter with the rules that are the same for everyone: the shape of the RFC, the SAT catalogs of regime and CFDI
 * use, and which regimes and uses fit a natural person or a company. The provider and the SAT have the last word:
 * they also check the name, the ZIP code against the SAT catalog and the RFC against the taxpayer list.
 */
public final class FiscalDataValidator {

    private static final Pattern RFC = Pattern.compile("^([A-ZÑ&]{3,4})(\\d{2})(\\d{2})(\\d{2})([A-Z0-9]{3})$");
    private static final Pattern ZIP = Pattern.compile("^\\d{5}$");
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Pattern PAYMENT_FORM = Pattern.compile("^(0[1-9]|1[0-9]|2[0-9]|3[01]|99)$");
    private static final Pattern PRODUCT_KEY = Pattern.compile("^\\d{8}$");

    /** The generic RFCs of the public and of foreigners; they belong to the global invoice, not to this flow. */
    private static final Set<String> GENERIC_RFC = Set.of("XAXX010101000", "XEXX010101000");

    private static final Set<String> NATURAL_REGIMES =
            Set.of("605", "606", "607", "608", "610", "611", "612", "614", "615", "616", "621", "625", "626");
    private static final Set<String> COMPANY_REGIMES = Set.of("601", "603", "610", "620", "622", "623", "624", "626");

    private static final Set<String> GENERAL_USES = Set.of("G01", "G02", "G03", "I01", "I02", "I03", "I04", "I05",
            "I06", "I07", "I08", "S01", "CP01");
    /** Personal deductions (D01 to D10) exist only for natural persons. */
    private static final Set<String> PERSONAL_USES =
            Set.of("D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10");

    private FiscalDataValidator() {
    }

    /**
     * Validates a receiver.
     *
     * @param receiver the data to check; {@code null} fields are reported, not thrown
     * @return every broken rule, empty when the data is valid
     */
    public static List<FieldError> validate(Receiver receiver) {
        List<FieldError> errors = new ArrayList<>();
        if (receiver == null) {
            errors.add(new FieldError("receiver", "required"));
            return errors;
        }
        validateName(receiver.legalName(), errors);
        Boolean company = validateTaxId(receiver.taxId(), errors);
        validateRegime(receiver.taxRegime(), company, errors);
        validateUse(receiver.cfdiUse(), receiver.taxRegime(), company, errors);
        if (isBlank(receiver.zipCode())) {
            errors.add(new FieldError("receiver.zipCode", "required"));
        } else if (!ZIP.matcher(receiver.zipCode().trim()).matches()) {
            errors.add(new FieldError("receiver.zipCode", "invalid_format"));
        }
        if (!isBlank(receiver.email()) && !EMAIL.matcher(receiver.email().trim()).matches()) {
            errors.add(new FieldError("receiver.email", "invalid_format"));
        }
        return errors;
    }

    /**
     * Validates an optional SAT payment form code.
     *
     * @param code the code to check
     * @return {@code true} if it has the shape of a SAT payment form ({@code 01} to {@code 31}, or {@code 99})
     */
    public static boolean isPaymentForm(String code) {
        return code != null && PAYMENT_FORM.matcher(code).matches();
    }

    /**
     * Validates a SAT product or service key.
     *
     * @param key the key to check
     * @return {@code true} if it has the eight digits of the SAT catalog
     */
    public static boolean isProductKey(String key) {
        return key != null && PRODUCT_KEY.matcher(key).matches();
    }

    private static void validateName(String name, List<FieldError> errors) {
        if (isBlank(name)) {
            errors.add(new FieldError("receiver.legalName", "required"));
        } else if (name.trim().length() > 254) {
            errors.add(new FieldError("receiver.legalName", "too_long"));
        }
    }

    /** @return {@code true} for a company, {@code false} for a natural person, {@code null} when the RFC is invalid */
    private static Boolean validateTaxId(String taxId, List<FieldError> errors) {
        if (isBlank(taxId)) {
            errors.add(new FieldError("receiver.taxId", "required"));
            return null;
        }
        String rfc = taxId.trim().toUpperCase();
        Matcher matcher = RFC.matcher(rfc);
        if (!matcher.matches() || !validDate(matcher)) {
            errors.add(new FieldError("receiver.taxId", "invalid_format"));
            return null;
        }
        if (GENERIC_RFC.contains(rfc)) {
            errors.add(new FieldError("receiver.taxId", "generic_rfc_not_allowed"));
            return null;
        }
        return matcher.group(1).length() == 3;
    }

    /** The RFC carries a date; a two-digit year is read in this century, which is enough to test that it exists. */
    private static boolean validDate(Matcher matcher) {
        try {
            LocalDate.of(2000 + Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(3)),
                    Integer.parseInt(matcher.group(4)));
            return true;
        } catch (DateTimeException invalidDate) {
            // 29 February of a year that is not a leap year in this century is rare but real in the 1900s: retry as 19xx.
            try {
                LocalDate.of(1900 + Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(3)),
                        Integer.parseInt(matcher.group(4)));
                return true;
            } catch (DateTimeException stillInvalid) {
                return false;
            }
        }
    }

    private static void validateRegime(String regime, Boolean company, List<FieldError> errors) {
        if (isBlank(regime)) {
            errors.add(new FieldError("receiver.taxRegime", "required"));
            return;
        }
        String code = regime.trim();
        if (!NATURAL_REGIMES.contains(code) && !COMPANY_REGIMES.contains(code)) {
            errors.add(new FieldError("receiver.taxRegime", "unknown_regime"));
        } else if (company != null && !(company ? COMPANY_REGIMES : NATURAL_REGIMES).contains(code)) {
            errors.add(new FieldError("receiver.taxRegime", "regime_does_not_fit_taxpayer_type"));
        }
    }

    private static void validateUse(String use, String regime, Boolean company, List<FieldError> errors) {
        if (isBlank(use)) {
            errors.add(new FieldError("receiver.cfdiUse", "required"));
            return;
        }
        String code = use.trim().toUpperCase();
        boolean personal = PERSONAL_USES.contains(code);
        if (!GENERAL_USES.contains(code) && !personal && !"CN01".equals(code)) {
            errors.add(new FieldError("receiver.cfdiUse", "unknown_cfdi_use"));
        } else if (personal && Boolean.TRUE.equals(company)) {
            errors.add(new FieldError("receiver.cfdiUse", "use_does_not_fit_taxpayer_type"));
        } else if ("CN01".equals(code) && (regime == null || !"605".equals(regime.trim()))) {
            errors.add(new FieldError("receiver.cfdiUse", "use_does_not_fit_regime"));
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
