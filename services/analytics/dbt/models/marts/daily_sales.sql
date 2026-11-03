select
    tenant_id,
    sold_on,
    count(*) as sales_count,
    -- The sum of a DuckDB bigint is a hugeint, so the cast keeps the column a plain integer.
    cast(sum(total_cents) as bigint) as total_cents
from {{ ref('stg_sales') }}
group by tenant_id, sold_on
