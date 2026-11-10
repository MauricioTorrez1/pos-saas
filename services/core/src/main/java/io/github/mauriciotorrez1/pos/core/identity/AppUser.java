package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/**
 * A person who can act inside a business.
 *
 * @param id       the id of the user
 * @param tenantId the business of the user
 * @param role     what the user is allowed to do
 */
public record AppUser(UUID id, UUID tenantId, Role role) {
}
