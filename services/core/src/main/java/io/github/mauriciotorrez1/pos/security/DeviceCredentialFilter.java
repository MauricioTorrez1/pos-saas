package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.DeviceCredentialService;
import io.github.mauriciotorrez1.pos.core.identity.DeviceIdentity;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates a request that carries {@code Authorization: Device <credential>} (ADR 0054). A valid
 * credential pins the business of the register in {@link io.github.mauriciotorrez1.pos.tenant.TenantContext}
 * for the rest of the request, so row-level security and the logs work as for a person. An invalid,
 * unknown or revoked credential is answered with 401 right away, and the credential is never logged.
 */
final class DeviceCredentialFilter extends OncePerRequestFilter {

    private static final String SCHEME = "Device ";

    private final DeviceCredentialService devices;

    DeviceCredentialFilter(DeviceCredentialService devices) {
        this.devices = devices;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, SCHEME, 0, SCHEME.length())) {
            chain.doFilter(request, response);
            return;
        }
        Optional<DeviceIdentity> device = devices.authenticate(header.substring(SCHEME.length()).strip());
        if (device.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Device");
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"error\":\"invalid_device_credential\"}");
            return;
        }
        SecurityContextHolder.getContext().setAuthentication(new DeviceAuthentication(device.get()));
        TenantFromTokenFilter.runAs(device.get().tenantId(), request, response, chain);
    }
}
