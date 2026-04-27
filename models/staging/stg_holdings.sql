-- models/staging/stg_holdings.sql
-- =============================================================================
-- Staging: Daily Holdings Positions
-- Source : {{ source('raw', 'raw_holdings') }}
-- Layer  : staging (view)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column lists in source CTE and SELECT
--   dbt-ref-required        ✅  source reference via {{ source() }}
--   naming-convention       ✅  file named stg_*
--   no-hardcoded-dates      ✅  no date literals
--   documentation-required  ✅  described in _staging.yml
-- =============================================================================

WITH source AS (
    SELECT
        holding_id,
        account_id,
        security_id,
        as_of_date,
        quantity,
        market_value_local,
        market_value_usd,
        cost_basis_usd,
        currency
    FROM {{ source('raw', 'raw_holdings') }}
),

typed AS (
    SELECT
        -- Primary key.
        holding_id,

        -- Foreign keys.
        account_id,
        security_id,

        -- Date cast to enforce type consistency.
        CAST(as_of_date AS DATE)                      AS as_of_date,

        -- Quantities and values — cast to precise decimals.
        CAST(quantity           AS DECIMAL(28, 8))    AS quantity,
        CAST(market_value_local AS DECIMAL(20, 2))    AS market_value_local,
        CAST(market_value_usd   AS DECIMAL(20, 2))    AS market_value_usd,
        CAST(cost_basis_usd     AS DECIMAL(20, 2))    AS cost_basis_usd,

        -- Currency uppercased for consistent joins.
        UPPER(currency)                               AS currency,

        -- Arithmetic: unrealised gain = market value minus cost basis.
        CAST(market_value_usd AS DECIMAL(20, 2))
            - CAST(cost_basis_usd AS DECIMAL(20, 2))  AS unrealized_gain_usd

    FROM source
)

SELECT
    holding_id,
    account_id,
    security_id,
    as_of_date,
    quantity,
    market_value_local,
    market_value_usd,
    cost_basis_usd,
    currency,
    unrealized_gain_usd
FROM typed
