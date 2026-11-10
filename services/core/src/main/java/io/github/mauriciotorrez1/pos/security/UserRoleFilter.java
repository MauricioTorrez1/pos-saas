package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Looks up the user of the token once the tenant is pinned and gives the request the authorities of
 * its role. A token whose subject matches no active user of the business keeps no authorities, so
 * every endpoint that needs a permission denies it (ADR 0042).
 */
final class UserRoleFilter extends OncePerRequestFilter {

    private final UserDirectory directory;

    UserRoleFilter(UserDirectory directory) {
        this.directory = directory;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken token && !(authentication instanceof PosAuthentication)) {
            Optional<AppUser> user = directory.findActiveBySubject(token.getToken().getSubject());
            user.ifPresent(found -> SecurityContextHolder.getContext()
                    .setAuthentication(new PosAuthentication(token.getToken(), found)));
        }
        chain.doFilter(request, response);
    }
}
