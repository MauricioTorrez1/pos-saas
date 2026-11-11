package io.github.mauriciotorrez1.pos.core.sync;

import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.JSON;
import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.batch;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.security.DeviceFixtures;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;

/**
 * A register sends with the device credential it received when it enrolled (E1-41, ADR 0054): the
 * credential gives the business and the register, a batch that names another register is refused, and
 * a revoked register stops sending. The database is a real PostgreSQL; only the token of the owner who
 * revokes is faked, because real Keycloak tokens are covered by KeycloakResourceServerTest.
 */
@SpringBootTest(classes = CoreApplication.class)
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class DeviceCredentialTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private final UUID register = Uuid7.next();
    private final UUID otherRegister = Uuid7.next();

    private String credential() {
        return DeviceFixtures.enroll(admin, tenant, register);
    }

    private String otherCredential() {
        return DeviceFixtures.enroll(admin, otherTenant, otherRegister);
    }

    private int push(String authorization, UUID registerId) throws Exception {
        return mvc.perform(post("/sync/push").header("Authorization", authorization).contentType(MediaType.APPLICATION_JSON)
                        .content(batch(registerId, SyncFixtures.sale(Uuid7.next())).toString()))
                .andReturn().getResponse().getStatus();
    }

    private RequestPostProcessor personOf(UUID business, String role) {
        String subject = role + "-" + UUID.randomUUID();
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Test business') ON CONFLICT DO NOTHING", business);
        admin.update("INSERT INTO app_user (id, tenant_id, display_name, role, keycloak_subject) VALUES (?, ?, ?, ?, ?)",
                Uuid7.next(), business, role, role, subject);
        return jwt().jwt(token -> token.subject(subject).claim("tenant_id", business.toString()));
    }

    private long sales(UUID business) {
        return admin.queryForObject("SELECT count(*) FROM sale WHERE tenant_id = ?", Long.class, business);
    }

    @Test
    void aValidCredentialSendsBatchesForItsOwnRegister() throws Exception {
        assertThat(push("Device " + credential(), register)).isEqualTo(200);

        assertThat(sales(tenant)).isOne();
    }

    @Test
    void withoutCredentialOrWithAnInvalidOneTheAnswerIs401AndNothingIsStored() throws Exception {
        String valid = credential();
        String wrongSecret = tenant + "." + "A".repeat(43);
        String otherBusinessPrefix = otherTenant + valid.substring(valid.indexOf('.'));

        assertThat(mvc.perform(post("/sync/push").contentType(MediaType.APPLICATION_JSON)
                .content(batch(register, SyncFixtures.sale(Uuid7.next())).toString())).andReturn().getResponse().getStatus()).isEqualTo(401);
        for (String bad : new String[] {"Device ", "Device garbage", "Device " + wrongSecret, "Device " + otherBusinessPrefix, "Basic " + valid}) {
            assertThat(push(bad, register)).as(bad.substring(0, Math.min(bad.length(), 12))).isEqualTo(401);
        }
        assertThat(sales(tenant)).isZero();
    }

    @Test
    void aRevokedRegisterStopsSendingAtOnceAndTheRevocationIsAudited() throws Exception {
        String credential = credential();
        assertThat(push("Device " + credential, register)).isEqualTo(200);
        RequestPostProcessor owner = personOf(tenant, "owner");

        mvc.perform(post("/registers/{id}/revoke", register).with(owner)).andExpect(status().isNoContent());
        mvc.perform(post("/registers/{id}/revoke", register).with(owner)).andExpect(status().isNoContent());

        assertThat(push("Device " + credential, register)).isEqualTo(401);
        assertThat(sales(tenant)).as("only the batch sent before the revocation").isOne();
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND entity_id = ? AND action = 'register.revoked'",
                Long.class, tenant, register)).as("revoking twice is audited once").isOne();
        assertThat(admin.queryForObject("SELECT revoked_at IS NOT NULL AND revoked_by IS NOT NULL FROM register_device WHERE register_id = ?",
                Boolean.class, register)).isTrue();
    }

    @Test
    void aCashierCannotRevokeAndAnUnknownOrForeignRegisterIs404() throws Exception {
        String credential = credential();
        otherCredential();

        mvc.perform(post("/registers/{id}/revoke", register).with(personOf(tenant, "cashier"))).andExpect(status().isForbidden());
        assertThat(push("Device " + credential, register)).isEqualTo(200);

        RequestPostProcessor owner = personOf(tenant, "owner");
        mvc.perform(post("/registers/{id}/revoke", UUID.randomUUID()).with(owner)).andExpect(status().isNotFound());
        mvc.perform(post("/registers/{id}/revoke", otherRegister).with(owner)).andExpect(status().isNotFound());
    }

    @Test
    void aBatchThatNamesAnotherRegisterIs403IsAuditedAndStoresNothing() throws Exception {
        String credential = credential();
        otherCredential();

        assertThat(push("Device " + credential, otherRegister)).as("a register of another business").isEqualTo(403);
        assertThat(push("Device " + credential, Uuid7.next())).as("a register nobody enrolled").isEqualTo(403);

        assertThat(sales(tenant)).isZero();
        assertThat(sales(otherTenant)).isZero();
        String detail = admin.queryForObject("SELECT string_agg(new_value::text, ' ') FROM audit_log WHERE tenant_id = ? AND entity_id = ? AND action = 'sync.register_mismatch'",
                String.class, tenant, register);
        assertThat(detail).contains(otherRegister.toString()).doesNotContain(credential);
    }

    @Test
    void twoBusinessesSendWithTheirOwnCredentialsAndNeverSeeEachOther() throws Exception {
        String credential = credential();
        String otherCredential = otherCredential();
        UUID opId = Uuid7.next();
        UUID saleId = Uuid7.next();
        UUID lineId = Uuid7.next();

        for (String[] run : new String[][] {{credential, register.toString()}, {otherCredential, otherRegister.toString()}}) {
            JsonNode response = JSON.readTree(mvc.perform(post("/sync/push").header("Authorization", "Device " + run[0])
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(batch(UUID.fromString(run[1]), SyncFixtures.sale(opId, saleId, lineId)).toString()))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            assertThat(response.get("results").get(0).get("status").asString()).as("the same ids in another business are new").isEqualTo("accepted");
        }

        assertThat(sales(tenant)).isOne();
        assertThat(sales(otherTenant)).isOne();
    }

    @Test
    void aPersonCannotSendAndARegisterCannotCallPersonEndpoints() throws Exception {
        String credential = credential();
        String body = batch(register, SyncFixtures.sale(Uuid7.next())).toString();

        mvc.perform(post("/sync/push").with(personOf(tenant, "owner")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mvc.perform(post("/registers/{id}/revoke", register).header("Authorization", "Device " + credential))
                .andExpect(status().isForbidden());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/me").header("Authorization", "Device " + credential))
                .andExpect(status().isForbidden());
        assertThat(sales(tenant)).isZero();
    }

    @Test
    void theCredentialReceivedAtEnrollmentSendsBatchesAndNeverAppearsInLogsOrTheAuditLog(CapturedOutput output) throws Exception {
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Test business') ON CONFLICT DO NOTHING", tenant);
        admin.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, 'MAIN', 'Main branch') ON CONFLICT DO NOTHING", Uuid7.next(), tenant);
        UUID branch = admin.queryForObject("SELECT id FROM branch WHERE tenant_id = ?", UUID.class, tenant);
        RequestPostProcessor owner = personOf(tenant, "owner");
        String issued = mvc.perform(post("/registers/enrollment-codes").with(owner).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"branchId\": \"" + branch + "\", \"registerCode\": \"E41\", \"registerName\": \"Counter\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String code = JSON.readTree(issued).get("code").asString();
        String enrolled = mvc.perform(post("/registers/enroll").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\": \"" + tenant + "\", \"code\": \"" + code + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        JsonNode body = JSON.readTree(enrolled);
        String token = body.get("deviceToken").asString();
        UUID enrolledRegister = UUID.fromString(body.get("registerId").asString());

        assertThat(token).startsWith(tenant + ".");
        assertThat(push("Device " + token, enrolledRegister)).isEqualTo(200);
        assertThat(push("Device " + token, enrolledRegister)).isEqualTo(200);

        assertThat(output.getAll()).doesNotContain(token.substring(token.indexOf('.') + 1));
        assertThat(admin.queryForObject("SELECT coalesce(string_agg(coalesce(new_value::text, ''), ' '), '') FROM audit_log WHERE tenant_id = ?",
                String.class, tenant)).doesNotContain(token.substring(token.indexOf('.') + 1));
    }
}
