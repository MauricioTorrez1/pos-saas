package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.InvalidRequestDataException;
import io.github.mauriciotorrez1.pos.core.identity.PinCheck;
import io.github.mauriciotorrez1.pos.core.identity.PinService;
import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.core.identity.UserRoleService;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Roles and PINs of the users of a business. Who may call each endpoint is decided by the permission matrix (ADR 0042). */
@RestController
@RequestMapping("/users")
class UsersController {

    private final CurrentActor currentActor;
    private final UserRoleService roles;
    private final PinService pins;

    UsersController(CurrentActor currentActor, UserRoleService roles, PinService pins) {
        this.currentActor = currentActor;
        this.roles = roles;
        this.pins = pins;
    }

    /**
     * Gives a user a new role.
     *
     * @param id      the user whose role changes
     * @param request the new role
     * @param jwt     the token of the caller
     * @return the role before and after the change
     */
    @PutMapping("/{id}/role")
    RoleChange changeRole(@PathVariable UUID id, @RequestBody ChangeRoleRequest request, @AuthenticationPrincipal Jwt jwt) {
        Role newRole = Role.fromValue(request.role())
                .orElseThrow(() -> new InvalidRequestDataException("role must be owner, manager or cashier"));
        AppUser actor = currentActor.of(jwt);
        Role previous = roles.changeRole(actor.id(), id, newRole);
        return new RoleChange(id, previous.value(), newRole.value());
    }

    /**
     * Sets or replaces the PIN of a user. The PIN is hashed with Argon2id and never returned or logged.
     *
     * @param id      the user whose PIN is set
     * @param request the new PIN
     * @param jwt     the token of the caller
     */
    @PutMapping("/{id}/pin")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void setPin(@PathVariable UUID id, @RequestBody PinRequest request, @AuthenticationPrincipal Jwt jwt) {
        pins.setPin(currentActor.of(jwt), id, request.pin());
    }

    /**
     * Checks a PIN. A wrong PIN is a normal answer ({@code valid: false}), not an error; a locked PIN is 423.
     *
     * @param id      the user whose PIN is checked
     * @param request the PIN to check
     * @param jwt     the token of the caller
     * @return 200 with the result, 423 while locked, or 404 when the user has no PIN
     */
    @PostMapping("/{id}/pin/verify")
    ResponseEntity<Map<String, Object>> verifyPin(@PathVariable UUID id, @RequestBody PinRequest request,
                                                  @AuthenticationPrincipal Jwt jwt) {
        PinCheck result = pins.verifyPin(currentActor.of(jwt), id, request.pin());
        return switch (result) {
            case PinCheck.Valid valid -> ResponseEntity.ok(Map.of("valid", true));
            case PinCheck.Invalid invalid -> ResponseEntity.ok(Map.of("valid", false, "attemptsLeft", invalid.attemptsLeft()));
            case PinCheck.Locked locked -> {
                long seconds = Math.max(1, locked.retryAfter().toSeconds());
                yield ResponseEntity.status(HttpStatus.LOCKED).header(HttpHeaders.RETRY_AFTER, Long.toString(seconds))
                        .body(Map.of("error", "pin_locked", "retryAfterSeconds", seconds));
            }
            case PinCheck.NotSet notSet -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "pin_not_set"));
        };
    }

    /**
     * Body of {@code PUT /users/{id}/role}.
     *
     * @param role one of {@code owner}, {@code manager} or {@code cashier}
     */
    record ChangeRoleRequest(String role) {
    }

    /**
     * Answer of {@code PUT /users/{id}/role}.
     *
     * @param userId   the user that changed
     * @param previous the role before the change
     * @param role     the role now
     */
    record RoleChange(UUID userId, String previous, String role) {
    }

    /**
     * Body of the PIN endpoints. It hides the PIN from {@code toString}, so a log line or a stack
     * trace that prints the request cannot leak it.
     *
     * @param pin 4 to 8 digits
     */
    record PinRequest(String pin) {

        @Override
        public String toString() {
            return "PinRequest[pin=<redacted>]";
        }
    }
}
