-- models/intermediate/int_holdings_enriched.sql
-- =============================================================================
-- Intermediate: Holdings Enriched with Security and Account Context
-- Upstream: stg_holdings, stg_securities, stg_accounts
-- Layer   : intermediate (view)
-- Guardrail compliance:
--   no-select-star          ✅  all column lists explicit
--   dbt-ref-required        ✅  all upstream refs use {{ ref() }}
--   naming-convention       ✅  file named int_*
--   join-without-keys       ✅  joins on indexed PK columns (security_id, account_id)
--   no-cartesian-join       ✅  all joins have explicit ON predicates
--   documentation-required  ✅  described in _intermediate.yml
-- =============================================================================

WITH holdings AS (
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
    FROM {{ ref('stg_holdings') }}
),

securities AS (
    SELECT
        security_id,
        cusip,
        isin,
        ticker,
        name,
        asset_class,
        asset_class_display,
        country_code,
        currency_code
    FROM {{ ref('stg_securities') }}
),

accounts AS (
    SELECT
        account_id,
        name,
        account_type,
        base_currency,
        is_active
    FROM {{ ref('stg_accounts') }}
),

enriched AS (
    SELECT
        -- Grain key.
        h.holding_id,

        -- Account dimension columns.
        h.account_id,
        a.name                                          AS account_name,
        a.account_type,
        a.base_currency                                 AS account_base_currency,

        -- Security dimension columns.
        h.security_id,
        s.cusip,
        s.isin,
        s.ticker,
        s.name                                          AS security_name,
        s.asset_class,
        s.asset_class_display,
        s.country_code                                  AS security_country,
        s.currency_code                                 AS security_currency,

        -- Position facts.
        h.as_of_date,
        h.quantity,
        h.market_value_local,
        h.market_value_usd,
        h.cost_basis_usd,
        h.unrealized_gain_usd,
        h.currency                                      AS holding_currency,

        -- Cross-currency flag: 1 when holding currency differs from account base.
        CASE
            WHEN UPPER(h.currency) <> UPPER(a.base_currency) THEN 1
            ELSE 0
        END                                             AS is_cross_currency

    FROM holdings   h
    LEFT JOIN securities s ON s.security_id = h.security_id
    LEFT JOIN accounts   a ON a.account_id  = h.account_id
)

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
    security_country,
    security_currency,
    as_of_date,
    quantity,
    market_value_local,
    market_value_usd,
    cost_basis_usd,
    unrealized_gain_usd,
    holding_currency,
    is_cross_currency
FROM enriched
