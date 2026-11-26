package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.LocalDate;
import java.util.Locale;
import java.util.Optional;

/**
 * How often the business issues its global invoice (ADR 0079). Monthly is the default until the accountant says
 * otherwise; daily and biweekly are offered because the SAT allows them and the change is only a setting.
 */
public enum GlobalPeriodicity {
    /** One global per day (SAT {@code 01}). */
    DAILY("01"),
    /** One global per half month: days 1 to 15 and 16 to the end (SAT {@code 03}). */
    BIWEEKLY("03"),
    /** One global per calendar month (SAT {@code 04}). */
    MONTHLY("04");

    private final String satCode;

    GlobalPeriodicity(String satCode) {
        this.satCode = satCode;
    }

    /** @return the two-digit SAT periodicity code */
    public String satCode() {
        return satCode;
    }

    /**
     * Reads the name the API uses ({@code daily}, {@code biweekly}, {@code monthly}).
     *
     * @param name the name, case-insensitive; {@code null} means the default, monthly
     * @return the periodicity, or empty when the name is unknown
     */
    public static Optional<GlobalPeriodicity> parse(String name) {
        if (name == null || name.isBlank()) {
            return Optional.of(MONTHLY);
        }
        for (GlobalPeriodicity candidate : values()) {
            if (candidate.name().equalsIgnoreCase(name.trim())) {
                return Optional.of(candidate);
            }
        }
        return Optional.empty();
    }

    /**
     * Finds the period that contains a day.
     *
     * @param day any day of the period
     * @return the first and last day of the period, both included
     */
    public Period periodOf(LocalDate day) {
        return switch (this) {
            case DAILY -> new Period(this, day, day);
            case BIWEEKLY -> day.getDayOfMonth() <= 15
                    ? new Period(this, day.withDayOfMonth(1), day.withDayOfMonth(15))
                    : new Period(this, day.withDayOfMonth(16), day.withDayOfMonth(day.lengthOfMonth()));
            case MONTHLY -> new Period(this, day.withDayOfMonth(1), day.withDayOfMonth(day.lengthOfMonth()));
        };
    }

    /** @return the name the API uses */
    public String apiName() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * A closed range of days covered by one global invoice. None of the offered periodicities crosses a month, so the
     * SAT month code is the month of the period.
     *
     * @param periodicity how the period was cut
     * @param start first day, included
     * @param end last day, included
     */
    public record Period(GlobalPeriodicity periodicity, LocalDate start, LocalDate end) {

        /** @return the {@code global} node sent to the provider */
        public GlobalPeriod toSat() {
            return new GlobalPeriod(periodicity.satCode(), "%02d".formatted(start.getMonthValue()), start.getYear());
        }

        /**
         * Tells whether every day of the period is over.
         *
         * @param today the current day in the business time zone
         * @return {@code true} when the period ended before today
         */
        public boolean closedOn(LocalDate today) {
            return end.isBefore(today);
        }

        /**
         * The SAT asks for the global within 72 hours after the period ends (RMF 2.7.1.21, to confirm with the
         * accountant). The panel shows it as a reminder; the core does not refuse a late one.
         *
         * @return the last day to issue it on time
         */
        public LocalDate deadline() {
            return end.plusDays(3);
        }
    }
}
