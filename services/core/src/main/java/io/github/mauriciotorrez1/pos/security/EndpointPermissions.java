package io.github.mauriciotorrez1.pos.security;

import static io.github.mauriciotorrez1.pos.security.EndpointRule.authenticated;
import static io.github.mauriciotorrez1.pos.security.EndpointRule.open;
import static io.github.mauriciotorrez1.pos.security.EndpointRule.requires;
import static org.springframework.http.HttpMethod.DELETE;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.PATCH;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.http.HttpMethod.PUT;

import java.util.List;

/**
 * The endpoint table of the API (ADR 0042). Endpoints of later tasks are listed here before they
 * exist, so the business can review who may call them; until the code arrives they answer 404 to
 * whoever is allowed and 403 to whoever is not. {@code docs/permisos.md} shows this table.
 */
public final class EndpointPermissions {

    /** Every rule of the API, in the order the documentation shows them. */
    public static final List<EndpointRule> RULES = List.of(
            authenticated(GET, "/me"),
            requires(POST, "/sync/push", Permission.SYNC_PUSH),
            requires(PUT, "/users/{id}/role", Permission.USER_ROLE_CHANGE),
            requires(PUT, "/users/{id}/pin", Permission.PIN_SET),
            requires(POST, "/users/{id}/pin/verify", Permission.PIN_VERIFY),
            requires(POST, "/registers/enrollment-codes", Permission.REGISTER_ENROLLMENT_CODE_ISSUE),
            // The enrollment code is the credential: it works once and expires (ADR 0043).
            open(POST, "/registers/enroll"),
            requires(GET, "/products", Permission.PRODUCT_READ),
            requires(POST, "/products", Permission.PRODUCT_WRITE),
            requires(GET, "/products/{id}", Permission.PRODUCT_READ),
            requires(PATCH, "/products/{id}", Permission.PRODUCT_WRITE),
            requires(DELETE, "/products/{id}", Permission.PRODUCT_WRITE),
            requires(POST, "/imports/catalog", Permission.CATALOG_IMPORT),
            requires(POST, "/price-changes", Permission.PRICE_CHANGE),
            requires(GET, "/discrepancies", Permission.DISCREPANCY_VIEW),
            requires(POST, "/invoices", Permission.INVOICE_ISSUE),
            requires(POST, "/invoices/global", Permission.INVOICE_ISSUE),
            requires(POST, "/invoices/{id}/cancel", Permission.INVOICE_CANCEL),
            requires(GET, "/reports/sales", Permission.REPORT_VIEW));

    private EndpointPermissions() {
    }
}
