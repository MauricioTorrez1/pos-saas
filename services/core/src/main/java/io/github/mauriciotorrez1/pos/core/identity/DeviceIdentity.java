package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/**
 * The register that a valid device credential belongs to.
 *
 * @param registerId the enrolled register
 * @param tenantId   its business, which the request runs in
 */
public record DeviceIdentity(UUID registerId, UUID tenantId) {
}
