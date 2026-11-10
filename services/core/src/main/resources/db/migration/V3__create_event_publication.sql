-- F0-10: outbox of Spring Modulith (ADR 0005, ADR 0036). An event is saved here in the same transaction
-- as the business change and published to Redpanda after the commit; if the broker is down, the row
-- stays incomplete until it is resubmitted. The columns are the ones Modulith 2.1 expects (schema v2).
-- This table is infrastructure: it has no tenant_id and no RLS, because the relay that completes
-- publications works for every business. Each event carries its own tenant_id inside the payload.
CREATE TABLE event_publication
(
    id                     uuid        NOT NULL,
    listener_id            text        NOT NULL,
    event_type             text        NOT NULL,
    serialized_event       text        NOT NULL,
    publication_date       timestamptz NOT NULL,
    completion_date        timestamptz,
    status                 text,
    completion_attempts    int,
    last_resubmission_date timestamptz,
    PRIMARY KEY (id)
);

CREATE INDEX event_publication_serialized_event_hash_idx ON event_publication USING hash (serialized_event);
CREATE INDEX event_publication_by_completion_date_idx ON event_publication (completion_date);
