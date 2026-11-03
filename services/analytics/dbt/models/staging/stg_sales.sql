select
    -- Text instead of uuid, because dbt unit tests only accept primitive column types.
    cast(sale_id as varchar) as sale_id,
    cast(tenant_id as varchar) as tenant_id,
    sold_on,
    payment_method,
    total_cents
from {{ ref('sample_sales') }}
