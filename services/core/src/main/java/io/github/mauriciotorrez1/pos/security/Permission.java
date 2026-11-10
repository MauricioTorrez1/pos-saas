package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.Set;

/**
 * One thing a user may be allowed to do. Each permission lists the roles that hold it, so this
 * enum is the whole role-to-permission matrix (ADR 0042). The business reviews the same matrix in
 * {@code docs/permisos.md}, which a test keeps in step with this code.
 */
public enum Permission {

    /** See products, their codes and their prices. */
    PRODUCT_READ("product.read", Role.OWNER, Role.MANAGER, Role.CASHIER),
    /** Create and edit products (not their price). */
    PRODUCT_WRITE("product.write", Role.OWNER, Role.MANAGER),
    /** Change a price, one by one or in bulk (RF-008). */
    PRICE_CHANGE("price.change", Role.OWNER),
    /** Load the catalog from a file. */
    CATALOG_IMPORT("catalog.import", Role.OWNER, Role.MANAGER),
    /** Review the differences between the registers and the core. */
    DISCREPANCY_VIEW("discrepancy.view", Role.OWNER, Role.MANAGER),
    /** Issue an invoice. */
    INVOICE_ISSUE("invoice.issue", Role.OWNER, Role.MANAGER),
    /** Cancel an invoice before the tax authority. */
    INVOICE_CANCEL("invoice.cancel", Role.OWNER),
    /** See the sales reports. */
    REPORT_VIEW("report.view", Role.OWNER, Role.MANAGER),
    /** Change the role of a user. */
    USER_ROLE_CHANGE("user.role.change", Role.OWNER),
    /** Upload the operations of a register (E1-17). The register acts as the staff member that signed in on it. */
    SYNC_PUSH("sync.push", Role.OWNER, Role.MANAGER, Role.CASHIER);

    private final String id;
    private final Set<Role> roles;

    Permission(String id, Role first, Role... others) {
        this.id = id;
        this.roles = EnumSet.of(first, others);
    }

    /**
     * Returns the stable name of the permission, which is also its authority in Spring Security.
     *
     * @return the lowercase id with dots, such as {@code price.change}
     */
    public String id() {
        return id;
    }

    /**
     * Tells whether a role holds this permission.
     *
     * @param role the role to check
     * @return {@code true} if the role is allowed
     */
    public boolean grantedTo(Role role) {
        return roles.contains(role);
    }

    /**
     * Lists the permissions of a role.
     *
     * @param role the role to look up
     * @return the permissions the role holds
     */
    public static Set<Permission> of(Role role) {
        Set<Permission> held = EnumSet.noneOf(Permission.class);
        Arrays.stream(values()).filter(permission -> permission.grantedTo(role)).forEach(held::add);
        return held;
    }
}
