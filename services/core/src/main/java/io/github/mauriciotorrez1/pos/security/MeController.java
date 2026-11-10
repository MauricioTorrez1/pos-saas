package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Tells the caller who the core thinks it is. It returns ids only, never names or emails. */
@RestController
class MeController {

    /**
     * Describes the authenticated caller.
     *
     * @param jwt the validated access token
     * @return the token subject and the tenant pinned for this request
     */
    @GetMapping("/me")
    Me me(@AuthenticationPrincipal Jwt jwt) {
        UUID tenant = TenantContext.current().orElseThrow(() -> new IllegalStateException("No tenant pinned"));
        return new Me(jwt.getSubject(), tenant);
    }

    /**
     * Response of {@code GET /me}.
     *
     * @param subject  the Keycloak user id ({@code sub})
     * @param tenantId the business of the caller
     */
    record Me(String subject, UUID tenantId) {
    }
}
