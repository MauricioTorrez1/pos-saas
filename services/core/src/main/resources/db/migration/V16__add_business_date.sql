-- E1-60: a register may capture the sales of a recent past day the next morning (ADR 0075). The sale and its cash
-- session keep the moment they were recorded (completed_at, opened_at), which still orders the audit trail and the sync,
-- and add the business day they count on. A NULL day belongs to a row written before E1-60: its day is the local day
-- of its moment in America/Mexico_City, which is what readers fall back to. The tables stay append-only: nothing is
-- backfilled, because the append-only trigger refuses UPDATE and the fallback already gives the same answer.
ALTER TABLE sale ADD COLUMN business_date date;
ALTER TABLE cash_session ADD COLUMN business_date date;

CREATE INDEX sale_business_date_idx ON sale (tenant_id, business_date);
