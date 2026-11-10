package io.github.mauriciotorrez1.pos.core.identity;

import java.util.Arrays;
import java.util.Optional;

/**
 * The role of a user inside a business. The stored value is the one the {@code app_user.role}
 * check constraint accepts (ADR 0042).
 */
public enum Role {

    /** The owner of the business: configures it, sets prices and sees everything. */
    OWNER("owner"),
    /** A trusted employee, such as the warehouse keeper or a shift manager: runs the daily operation. */
    MANAGER("manager"),
    /** Sells, charges and closes the register. */
    CASHIER("cashier");

    private final String value;

    Role(String value) {
        this.value = value;
    }

    /**
     * Returns the text stored in the database and shown in the API.
     *
     * @return the lowercase role name
     */
    public String value() {
        return value;
    }

    /**
     * Parses the stored text of a role.
     *
     * @param value the text to parse, such as {@code owner}
     * @return the role, or empty when the text is not a known role
     */
    public static Optional<Role> fromValue(String value) {
        return Arrays.stream(values()).filter(role -> role.value.equals(value)).findFirst();
    }
}
