package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.identity.UserRoleService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Role management of the users of a business. Who may call it is decided by the permission matrix (ADR 0042). */
@RestController
@RequestMapping("/users")
class UsersController {

    private final UserDirectory directory;
    private final UserRoleService roles;

    UsersController(UserDirectory directory, UserRoleService roles) {
        this.directory = directory;
        this.roles = roles;
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
                .orElseThrow(() -> new InvalidRequestException("role must be owner, manager or cashier"));
        AppUser actor = directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
        Role previous = roles.changeRole(actor.id(), id, newRole);
        return new RoleChange(id, previous.value(), newRole.value());
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
}
