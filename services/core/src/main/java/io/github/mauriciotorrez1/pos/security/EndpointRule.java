package io.github.mauriciotorrez1.pos.security;

import java.util.Objects;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * One line of the endpoint table: who may call a method and path. A request that matches no line is
 * denied, so a new endpoint is closed until someone decides who may use it (ADR 0042).
 *
 * @param method     the HTTP method
 * @param pattern    the path pattern, such as {@code /products/{id}}
 * @param access     how the caller is checked
 * @param permission the permission required, only when {@code access} is {@link Access#PERMISSION}
 */
public record EndpointRule(HttpMethod method, String pattern, Access access, Permission permission) {

    /** How a rule checks the caller. */
    public enum Access {
        /** Nobody has to sign in; the endpoint checks its own credential (such as an enrollment code). */
        PUBLIC,
        /** Any signed-in user of a business, whatever the role. */
        AUTHENTICATED,
        /** Only the roles that hold {@link EndpointRule#permission()}. */
        PERMISSION
    }

    /** Checks that the rule is consistent. */
    public EndpointRule {
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(pattern, "pattern");
        Objects.requireNonNull(access, "access");
        if ((access == Access.PERMISSION) != (permission != null)) {
            throw new IllegalArgumentException("A permission is required exactly when access is PERMISSION");
        }
    }

    /**
     * Creates a rule for the roles that hold a permission.
     *
     * @param method     the HTTP method
     * @param pattern    the path pattern
     * @param permission the permission required
     * @return the rule
     */
    public static EndpointRule requires(HttpMethod method, String pattern, Permission permission) {
        return new EndpointRule(method, pattern, Access.PERMISSION, permission);
    }

    /**
     * Creates a rule for any signed-in user.
     *
     * @param method  the HTTP method
     * @param pattern the path pattern
     * @return the rule
     */
    public static EndpointRule authenticated(HttpMethod method, String pattern) {
        return new EndpointRule(method, pattern, Access.AUTHENTICATED, null);
    }

    /**
     * Creates a rule for an endpoint without sign-in.
     *
     * @param method  the HTTP method
     * @param pattern the path pattern
     * @return the rule
     */
    public static EndpointRule open(HttpMethod method, String pattern) {
        return new EndpointRule(method, pattern, Access.PUBLIC, null);
    }

    /**
     * Builds the matcher of this rule.
     *
     * @return a matcher for the method and path of the rule
     */
    RequestMatcher matcher() {
        return PathPatternRequestMatcher.withDefaults().matcher(method, pattern);
    }
}
