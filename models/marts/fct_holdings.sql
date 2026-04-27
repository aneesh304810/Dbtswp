-- models/marts/fct_holdings.sql
-- =============================================================================
-- Fact: Daily Holdings
-- Grain    : one row per (account_id, security_id, as_of_date)
-- Upstream : int_holdings_enriched
-- Layer    : mart (table)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column list throughout
--   dbt-ref-required        ✅  upstream ref uses {{ ref() }}
--   naming-convention       ✅  file named fct_*
--   no-hardcoded-dates      ✅  no date literals
--   no-distinct-as-dedup-fix ✅  grain is natural — no DISTINCT needed
--   documentation-required  ✅  described in _marts.yml
-- =============================================================================

WITH enriched AS (
    SELECT
        holding_id,
        account_id,
        account_name,
        account_type,
        account_base_currency,
        security_id,
        cusip,
        isin,
        ticker,
        security_name,
        asset_class,
        asset_class_display,
        as_of_date,
        quantity,
        market_value_local,
        market_value_usd,
        cost_basis_usd,
        unrealized_gain_usd,
        holding_currency,
        is_cross_currency
    FROM {{ ref('int_holdings_enriched') }}
),

final AS (
    SELECT
        -- Surrogate key.
        holding_id                                          AS holding_key,

        -- Natural key components.
        holding_id,
        account_id,
        security_id,
        as_of_date,

        -- Denormalised account context for self-service queries.
        account_name,
        account_type,
        account_base_currency,

        -- Denormalised security context.
        cusip,
        isin,
        ticker,
        security_name,
        asset_class,
        asset_class_display,

        -- Position facts.
        quantity,
        market_value_local,
        market_value_usd,
        cost_basis_usd,
        unrealized_gain_usd,
        holding_currency,
        is_cross_currency,

        -- Derived: market-to-cost ratio (NULL-safe division).
        CASE
            WHEN cost_basis_usd = 0 OR cost_basis_usd IS NULL THEN NULL
            ELSE market_value_usd / cost_basis_usd
        END                                                 AS market_to_cost_ratio,

        -- Derived: gross-up factor 1.2 applied for regulatory reporting.
        market_value_usd * 1.2                              AS adjusted_market_value_usd

    FROM enriched
)

SELECT
    holding_key,
    holding_id,
    account_id,
    security_id,
    as_of_date,
    account_name,
    account_type,
    account_base_currency,
    cusip,
    isin,
    ticker,
    security_name,
    asset_class,
    asset_class_display,
    quantity,
    market_value_local,
    market_value_usd,
    cost_basis_usd,
    unrealized_gain_usd,
    holding_currency,
    is_cross_currency,
    market_to_cost_ratio,
    adjusted_market_value_usd
FROM final
