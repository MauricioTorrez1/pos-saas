package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tells the caller who the core thinks it is: ids and the role, never names or emails. The role is the one
 * stored in {@code app_user}, so the panel and the register see the same role the authorization uses (ADR 0042).
 */
@RestController
class MeController {

    /**
     * Describes the authenticated caller.
     *
     * @param authentication the validated token, enriched with the user when one matches
     * @return the token subject, the tenant pinned for this request, and the role of the user
     *         (null when the token matches no active user of the business)
     */
    @GetMapping("/me")
    Me me(Authentication authentication) {
        UUID tenant = TenantContext.current().orElseThrow(() -> new IllegalStateException("No tenant pinned"));
        Jwt jwt = ((JwtAuthenticationToken) authentication).getToken();
        String role = authentication instanceof PosAuthentication known ? known.user().role().value() : null;
        return new Me(jwt.getSubject(), tenant, role);
    }

    /**
     * Response of {@code GET /me}.
     *
     * @param subject  the Keycloak user id ({@code sub})
     * @param tenantId the business of the caller
     * @param role     {@code owner}, {@code manager} or {@code cashier}; null when the caller has no active user
     */
    record Me(String subject, UUID tenantId, String role) {
    }
}
