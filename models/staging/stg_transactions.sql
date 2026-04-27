-- models/staging/stg_transactions.sql
-- =============================================================================
-- Staging: Trade and Corporate-Action Transactions
-- Source : {{ source('raw', 'raw_transactions') }}
-- Layer  : staging (view)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column lists everywhere
--   dbt-ref-required        ✅  source reference via {{ source() }}
--   naming-convention       ✅  file named stg_*
--   no-hardcoded-dates      ✅  no date literals
--   documentation-required  ✅  described in _staging.yml
-- =============================================================================

WITH source AS (
    SELECT
        transaction_id,
        account_id,
        security_id,
        trade_date,
        settle_date,
        transaction_type,
        quantity,
        price_local,
        gross_amount_local,
        gross_amount_usd,
        currency,
        broker
    FROM {{ source('raw', 'raw_transactions') }}
),

typed AS (
    SELECT
        -- Primary key.
        transaction_id,

        -- Foreign keys.
        account_id,
        security_id,

        -- Dates cast to DATE.
        CAST(trade_date  AS DATE)                       AS trade_date,
        CAST(settle_date AS DATE)                       AS settle_date,

        -- Codes uppercased for consistent lookups.
        UPPER(transaction_type)                         AS transaction_type,
        UPPER(currency)                                 AS currency,
        UPPER(broker)                                   AS broker,

        -- Numeric columns cast to precise decimals.
        CAST(quantity           AS DECIMAL(28, 8))      AS quantity,
        CAST(price_local        AS DECIMAL(20, 8))      AS price_local,
        CAST(gross_amount_local AS DECIMAL(20, 2))      AS gross_amount_local,
        CAST(gross_amount_usd   AS DECIMAL(20, 2))      AS gross_amount_usd,

        -- Signed quantity: positive for buys and income, negative for sells.
        CASE
            WHEN UPPER(transaction_type) = 'SELL'
                THEN -CAST(quantity AS DECIMAL(28, 8))
            ELSE
                 CAST(quantity AS DECIMAL(28, 8))
        END                                             AS signed_quantity,

        -- Settlement lag in calendar days.
        CAST(settle_date AS DATE) - CAST(trade_date AS DATE) AS settlement_lag_days,

        -- High-level category for grouping in reports.
        CASE
            WHEN UPPER(transaction_type) IN ('BUY', 'SELL')          THEN 'TRADE'
            WHEN UPPER(transaction_type) IN ('DIVIDEND', 'INTEREST')  THEN 'INCOME'
            WHEN UPPER(transaction_type) = 'TRANSFER'                 THEN 'TRANSFER'
            ELSE                                                            'OTHER'
        END                                             AS transaction_category

    FROM source
)

SELECT
    transaction_id,
    account_id,
    security_id,
    trade_date,
    settle_date,
    transaction_type,
    currency,
    broker,
    quantity,
    price_local,
    gross_amount_local,
    gross_amount_usd,
    signed_quantity,
    settlement_lag_days,
    transaction_category
FROM typed
