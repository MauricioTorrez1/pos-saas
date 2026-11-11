package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.identity.DeviceToken;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.security.SecureRandom;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Seeds enrolled registers straight into the database, for the tests that call {@code /sync/push}. */
public final class DeviceFixtures {

    private static final SecureRandom RANDOM = new SecureRandom();

    private DeviceFixtures() {
    }

    /**
     * Creates a business (if missing), a branch, a register and its device credential.
     *
     * @param admin      a template of the migration role, which sees every business
     * @param tenantId   the business
     * @param registerId the id of the new register
     * @return the device credential, as the register would store it
     */
    public static String enroll(JdbcTemplate admin, UUID tenantId, UUID registerId) {
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Test business') ON CONFLICT DO NOTHING", tenantId);
        admin.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, 'MAIN', 'Main branch') ON CONFLICT DO NOTHING",
                Uuid7.next(), tenantId);
        UUID branchId = admin.queryForObject("SELECT id FROM branch WHERE tenant_id = ? AND code = 'MAIN'", UUID.class, tenantId);
        String code = "R" + registerId.toString().replace("-", "").substring(12, 20).toUpperCase();
        admin.update("INSERT INTO register (id, tenant_id, branch_id, code, name) VALUES (?, ?, ?, ?, 'Counter')",
                registerId, tenantId, branchId, code);
        String token = DeviceToken.generate(tenantId, RANDOM);
        admin.update("INSERT INTO register_device (register_id, tenant_id, token_hash) VALUES (?, ?, ?)",
                registerId, tenantId, DeviceToken.hash(token));
        return token;
    }

    /**
     * Adds the device credential to a MockMvc request.
     *
     * @param token the credential
     * @return the post processor to pass to {@code with(...)}
     */
    public static RequestPostProcessor device(String token) {
        return request -> {
            request.addHeader("Authorization", "Device " + token);
            return request;
        };
    }
}
