package io.github.mauriciotorrez1.pos.core;

import io.github.mauriciotorrez1.pos.events.BusinessEvent;

import java.util.UUID;
import org.springframework.modulith.events.Externalized;

/** Test event sent to Redpanda, keyed by tenant so one business keeps its order. */
@Externalized("pos.test.ping.v1::#{tenantId()}")
public record PingEvent(UUID eventId, UUID tenantId, int schemaVersion, String message) implements BusinessEvent {
}
