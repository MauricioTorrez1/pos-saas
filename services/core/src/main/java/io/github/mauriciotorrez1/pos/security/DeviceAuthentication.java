package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.DeviceIdentity;
import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;

/** An enrolled register that proved itself with its device credential. It holds no roles and no permissions. */
final class DeviceAuthentication extends AbstractAuthenticationToken {

    private static final long serialVersionUID = 1L;

    private final transient DeviceIdentity device;

    DeviceAuthentication(DeviceIdentity device) {
        super(List.of());
        this.device = device;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        // The credential is never kept after it was checked.
        return null;
    }

    @Override
    public Object getPrincipal() {
        return device;
    }
}
