package io.github.mauriciotorrez1.pos.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpMethod;

/** PINs on the server (F0-15, RF-009): hashed, locked after 5 failures for 5 minutes, and never leaked. */
@ExtendWith(OutputCaptureExtension.class)
class PinEndpointsTest extends SecuredApiTest {

    private static final String PIN = "73920164";
    private static final String WRONG = "11223344";

    private UUID tenant;
    private Actor owner;
    private Actor manager;

    @BeforeAll
    void seed() {
        tenant = seedTenant();
        owner = seedActor(tenant, Role.OWNER, true);
        manager = seedActor(tenant, Role.MANAGER, true);
    }

    private String pinBody(String pin) {
        return "{\"pin\": \"" + pin + "\"}";
    }

    private Actor cashierWithPin() {
        Actor cashier = seedActor(tenant, Role.CASHIER, true);
        assertThat(status(owner, HttpMethod.PUT, "/users/" + cashier.id() + "/pin", pinBody(PIN))).isEqualTo(204);
        return cashier;
    }

    private Reply verify(Actor caller, Actor target, String pin) {
        return call(caller, HttpMethod.POST, "/users/" + target.id() + "/pin/verify", pinBody(pin));
    }

    @Test
    void onlyTheArgon2idHashIsStored() {
        Actor cashier = cashierWithPin();

        String stored = admin.queryForObject("SELECT pin_hash FROM user_pin WHERE user_id = ?", String.class, cashier.id());

        assertThat(stored).startsWith("$argon2id$v=19$m=19456,t=2,p=1$").doesNotContain(PIN);
    }

    @Test
    void aRightPinIsValidAndAWrongOneCountsDown() {
        Actor cashier = cashierWithPin();

        assertThat(verify(cashier, cashier, PIN).body()).contains("\"valid\":true");
        Reply wrong = verify(cashier, cashier, WRONG);
        assertThat(wrong.status()).isEqualTo(200);
        assertThat(wrong.body()).contains("\"valid\":false").contains("\"attemptsLeft\":4");
    }

    @Test
    void fiveWrongPinsLockTheUserForFiveMinutesEvenAgainstTheRightPin() {
        Actor cashier = cashierWithPin();
        for (int attempt = 1; attempt <= 4; attempt++) {
            assertThat(verify(cashier, cashier, WRONG).status()).isEqualTo(200);
        }

        Reply fifth = verify(cashier, cashier, WRONG);

        assertThat(fifth.status()).isEqualTo(423);
        assertThat(fifth.headers().getFirst("Retry-After")).isEqualTo("300");
        // The lock is in the database, so a restart of the core would not clear it.
        assertThat(admin.queryForObject("SELECT locked_until IS NOT NULL FROM user_pin WHERE user_id = ?", Boolean.class, cashier.id())).isTrue();
        assertThat(verify(cashier, cashier, PIN).status()).as("the right PIN during the lock").isEqualTo(423);

        clock.advance(Duration.ofMinutes(4));
        assertThat(verify(cashier, cashier, PIN).status()).as("still locked after 4 minutes").isEqualTo(423);

        clock.advance(Duration.ofMinutes(2));
        assertThat(verify(cashier, cashier, PIN).body()).contains("\"valid\":true");
    }

    @Test
    void aRightPinResetsTheCountOfFailures() {
        Actor cashier = cashierWithPin();
        for (int attempt = 1; attempt <= 4; attempt++) {
            verify(cashier, cashier, WRONG);
        }
        assertThat(verify(cashier, cashier, PIN).body()).contains("\"valid\":true");

        for (int attempt = 1; attempt <= 4; attempt++) {
            assertThat(verify(cashier, cashier, WRONG).status()).as("attempt %d after the reset", attempt).isEqualTo(200);
        }
    }

    @Test
    void theLockIsAuditedWithoutThePin() {
        Actor cashier = cashierWithPin();
        for (int attempt = 1; attempt <= 5; attempt++) {
            verify(cashier, cashier, WRONG);
        }

        Long locked = admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ? AND action = 'user.pin_locked'", Long.class, cashier.id());
        assertThat(locked).isEqualTo(1);
        String everything = admin.queryForObject(
                "SELECT coalesce(string_agg(coalesce(old_value::text, '') || coalesce(new_value::text, ''), ' '), '') FROM audit_log WHERE tenant_id = ?",
                String.class, tenant);
        assertThat(everything).doesNotContain(PIN).doesNotContain(WRONG).doesNotContain("argon2");
    }

    @Test
    void settingANewPinClearsTheLock() {
        Actor cashier = cashierWithPin();
        for (int attempt = 1; attempt <= 5; attempt++) {
            verify(cashier, cashier, WRONG);
        }

        assertThat(status(owner, HttpMethod.PUT, "/users/" + cashier.id() + "/pin", pinBody("5566"))).isEqualTo(204);

        assertThat(verify(cashier, cashier, "5566").body()).contains("\"valid\":true");
    }

    @Test
    void aUserWithoutPinAnswers404() {
        Actor cashier = seedActor(tenant, Role.CASHIER, true);

        assertThat(verify(cashier, cashier, PIN).status()).isEqualTo(404);
    }

    @Test
    void aPinThatIsNotFourToEightDigitsIs400() {
        Actor cashier = seedActor(tenant, Role.CASHIER, true);

        for (String bad : new String[] {"123", "123456789", "12ab", ""}) {
            assertThat(status(owner, HttpMethod.PUT, "/users/" + cashier.id() + "/pin", pinBody(bad))).as(bad).isEqualTo(400);
        }
    }

    @Test
    void aManagerSetsPinsOfCashiersButNotOfTheOwner() {
        Actor cashier = seedActor(tenant, Role.CASHIER, true);

        assertThat(status(manager, HttpMethod.PUT, "/users/" + cashier.id() + "/pin", pinBody(PIN))).isEqualTo(204);
        assertThat(status(manager, HttpMethod.PUT, "/users/" + owner.id() + "/pin", pinBody(PIN))).isEqualTo(403);
    }

    @Test
    void aCashierCannotSetPinsNorCheckThoseOfOthers() {
        Actor cashier = cashierWithPin();
        Actor other = cashierWithPin();

        assertThat(status(cashier, HttpMethod.PUT, "/users/" + cashier.id() + "/pin", pinBody(PIN))).isEqualTo(403);
        assertThat(verify(cashier, other, PIN).status()).isEqualTo(403);
        assertThat(verify(owner, other, PIN).body()).as("an owner approves with the PIN of another").contains("\"valid\":true");
    }

    @Test
    void aUserOfAnotherBusinessIsNotFound() {
        Actor stranger = seedActor(seedTenant(), Role.CASHIER, true);

        assertThat(status(owner, HttpMethod.PUT, "/users/" + stranger.id() + "/pin", pinBody(PIN))).isEqualTo(404);
    }

    @Test
    void neitherThePinNorItsHashAppearsInTheLogs(CapturedOutput output) {
        Actor cashier = cashierWithPin();
        verify(cashier, cashier, WRONG);
        verify(cashier, cashier, PIN);
        String hash = admin.queryForObject("SELECT pin_hash FROM user_pin WHERE user_id = ?", String.class, cashier.id());

        assertThat(output.getAll()).doesNotContain(PIN).doesNotContain(WRONG).doesNotContain(hash);
    }
}
