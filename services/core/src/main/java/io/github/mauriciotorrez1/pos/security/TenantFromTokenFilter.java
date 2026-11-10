package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Pins the {@code tenant_id} claim of the validated token in {@link TenantContext} for the whole
 * request, so row-level security and the logs receive it. A request without a token passes through
 * untouched (Spring Security answers 401 or lets a public path in); a valid token without a usable
 * tenant is answered with 403.
 */
final class TenantFromTokenFilter extends OncePerRequestFilter {

    /** Name of the claim that Keycloak adds to the token (see {@code infra/compose/keycloak}). */
    static final String TENANT_CLAIM = "tenant_id";

    private static final Logger LOG = LoggerFactory.getLogger(TenantFromTokenFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken token)) {
            chain.doFilter(request, response);
            return;
        }
        Optional<UUID> tenant = tenantOf(token.getToken());
        if (tenant.isEmpty()) {
            LOG.warn("Rejected a valid token without a usable {} claim", TENANT_CLAIM);
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"error\":\"tenant_required\"}");
            return;
        }
        runAs(tenant.get(), request, response, chain);
    }

    private static Optional<UUID> tenantOf(Jwt jwt) {
        String claim = jwt.getClaimAsString(TENANT_CLAIM);
        if (claim == null || claim.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(claim));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** Runs the rest of the chain inside the tenant, carrying the checked exceptions out of the lambda. */
    private static void runAs(UUID tenant, HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            TenantContext.runAs(tenant, () -> {
                try {
                    chain.doFilter(request, response);
                } catch (IOException | ServletException e) {
                    throw new ChainFailure(e);
                }
            });
        } catch (ChainFailure failure) {
            if (failure.getCause() instanceof ServletException servletException) {
                throw servletException;
            }
            throw (IOException) failure.getCause();
        }
    }

    private static final class ChainFailure extends RuntimeException {
        ChainFailure(Exception cause) {
            super(cause);
        }
    }
}
