package io.github.mauriciotorrez1.pos.core.identity;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Looks users up. Every query runs in a transaction pinned to the tenant of the request (ADR 0035),
 * so a user of another business is never found.
 */
@Service
public class UserDirectory {

    private final JdbcTemplate jdbc;

    UserDirectory(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Finds the active user that a Keycloak token belongs to.
     *
     * @param subject the {@code sub} claim of the token
     * @return the user, or empty when there is none in the current business or it is deactivated
     */
    @Transactional(readOnly = true)
    public Optional<AppUser> findActiveBySubject(String subject) {
        return jdbc.query("""
                        SELECT id, tenant_id, role FROM app_user
                        WHERE keycloak_subject = ? AND active
                        """,
                (rs, row) -> new AppUser(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                        Role.fromValue(rs.getString("role")).orElseThrow()),
                subject).stream().findFirst();
    }
}
