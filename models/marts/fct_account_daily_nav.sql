-- models/marts/fct_account_daily_nav.sql
-- =============================================================================
-- Fact: Account Daily Net Asset Value with Day-over-Day Return
-- Grain    : one row per (account_id, as_of_date)
-- Upstream : int_account_daily_nav
-- Layer    : mart (table)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column lists
--   dbt-ref-required        ✅  upstream ref uses {{ ref() }}
--   naming-convention       ✅  file named fct_*
--   no-distinct-as-dedup-fix ✅  grain is natural
--   documentation-required  ✅  described in _marts.yml
-- =============================================================================

WITH nav AS (
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
    FROM {{ ref('int_account_daily_nav') }}
),

with_return AS (
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
        fixed_income_market_value_usd,

        -- Equity weight within total NAV.
        CASE
            WHEN total_market_value_usd = 0 OR total_market_value_usd IS NULL THEN 0
            ELSE equity_market_value_usd / total_market_value_usd
        END                                                     AS equity_weight,

        -- Prior-day NAV via window function.
        LAG(total_market_value_usd) OVER (
            PARTITION BY account_id
            ORDER BY as_of_date
        )                                                       AS prior_total_market_value_usd,

        -- Day-over-day return: (today - yesterday) / yesterday.
        CASE
            WHEN LAG(total_market_value_usd) OVER (
                     PARTITION BY account_id ORDER BY as_of_date
                 ) IS NULL
                OR LAG(total_market_value_usd) OVER (
                     PARTITION BY account_id ORDER BY as_of_date
                 ) = 0
                THEN NULL
            ELSE (
                total_market_value_usd
                - LAG(total_market_value_usd) OVER (
                      PARTITION BY account_id ORDER BY as_of_date)
            ) / LAG(total_market_value_usd) OVER (
                      PARTITION BY account_id ORDER BY as_of_date)
        END                                                     AS daily_return

    FROM nav
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
    fixed_income_market_value_usd,
    equity_weight,
    prior_total_market_value_usd,
    daily_return
FROM with_return
