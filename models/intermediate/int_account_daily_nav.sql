-- models/intermediate/int_account_daily_nav.sql
-- =============================================================================
-- Intermediate: Per-Account Daily Net Asset Value
-- Upstream: int_holdings_enriched
-- Layer   : intermediate (view)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column lists
--   dbt-ref-required        ✅  upstream ref uses {{ ref() }}
--   naming-convention       ✅  file named int_*
--   no-distinct-as-dedup-fix ✅  no DISTINCT — grain is (account, date) naturally
--   documentation-required  ✅  described in _intermediate.yml
-- =============================================================================

WITH holdings AS (
    SELECT
        account_id,
        account_name,
        account_type,
        account_base_currency,
        security_id,
        asset_class,
        as_of_date,
        market_value_usd,
        cost_basis_usd,
        unrealized_gain_usd,
        is_cross_currency
    FROM {{ ref('int_holdings_enriched') }}
),

aggregated AS (
    SELECT
        account_id,
        account_name,
        account_type,
        account_base_currency,
        as_of_date,

        -- Security and lot counts.
        COUNT(DISTINCT security_id)                                         AS security_count,
        COUNT(*)                                                            AS lot_count,

        -- Market value aggregations.
        SUM(market_value_usd)                                               AS total_market_value_usd,
        SUM(cost_basis_usd)                                                 AS total_cost_basis_usd,
        SUM(unrealized_gain_usd)                                            AS total_unrealized_gain_usd,

        -- Cross-currency exposure.
        SUM(CASE WHEN is_cross_currency = 1 THEN market_value_usd ELSE 0 END) AS cross_currency_exposure_usd,

        -- Asset-class splits.
        SUM(CASE WHEN asset_class = 'EQUITY'       THEN market_value_usd ELSE 0 END) AS equity_market_value_usd,
        SUM(CASE WHEN asset_class = 'FIXED_INCOME' THEN market_value_usd ELSE 0 END) AS fixed_income_market_value_usd

    FROM holdings
    GROUP BY
        account_id,
        account_name,
        account_type,
        account_base_currency,
        as_of_date
)

SELECT
    account_id,
    account_name,
    account_type,
    account_base_currency,
    as_of_date,
    security_count,
    lot_count,
    total_market_value_usd,
    total_cost_basis_usd,
    total_unrealized_gain_usd,
    cross_currency_exposure_usd,
    equity_market_value_usd,
    fixed_income_market_value_usd
FROM aggregated
