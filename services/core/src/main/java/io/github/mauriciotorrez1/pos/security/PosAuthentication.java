package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * A validated token together with the user it belongs to and what that user may do. The role comes
 * from {@code app_user}, not from the token, so a role change applies on the next request (ADR 0042).
 */
final class PosAuthentication extends JwtAuthenticationToken {

    private static final long serialVersionUID = 1L;

    private final transient AppUser user;

    PosAuthentication(Jwt jwt, AppUser user) {
        super(jwt, authoritiesOf(user), jwt.getSubject());
        this.user = user;
    }

    /**
     * Returns the user of the token.
     *
     * @return the active user with the role it has now
     */
    AppUser user() {
        return user;
    }

    private static Collection<GrantedAuthority> authoritiesOf(AppUser user) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + user.role().value()));
        Permission.of(user.role()).forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission.id())));
        return authorities;
    }
}
