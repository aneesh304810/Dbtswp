-- models/staging/stg_securities.sql
-- =============================================================================
-- Staging: Securities Reference Data
-- Source : {{ source('raw', 'raw_securities') }}
-- Layer  : staging (view)
-- Pattern: source CTE → renamed CTE → final SELECT (all explicit column lists)
-- Guardrail compliance:
--   no-select-star          ✅  all column lists are explicit
--   dbt-ref-required        ✅  source reference via {{ source() }}
--   naming-convention       ✅  file named stg_*
--   no-hardcoded-dates      ✅  no date literals
--   no-cross-schema-without-source ✅ no bare schema.table refs
--   documentation-required  ✅  described in _staging.yml
-- =============================================================================

WITH source AS (
    SELECT
        security_id,
        cusip,
        isin,
        ticker,
        security_name,
        asset_class,
        country,
        currency,
        issue_date,
        maturity_date
    FROM {{ source('raw', 'raw_securities') }}
),

renamed AS (
    SELECT
        -- Primary key — passed through unchanged.
        security_id,

        -- Identifiers uppercased for consistent lookups.
        UPPER(cusip)                                                AS cusip,
        UPPER(isin)                                                 AS isin,
        UPPER(ticker)                                               AS ticker,

        -- Descriptive attributes.
        security_name                                               AS name,
        UPPER(asset_class)                                          AS asset_class,

        -- Geography and currency.
        country                                                     AS country_code,
        currency                                                    AS currency_code,

        -- Dates cast to DATE to enforce consistent type.
        CAST(issue_date    AS DATE)                                 AS issue_date,
        CAST(maturity_date AS DATE)                                 AS maturity_date,

        -- Derived display label for reporting layers.
        CASE
            WHEN asset_class = 'EQUITY'       THEN 'Equity'
            WHEN asset_class = 'FIXED_INCOME' THEN 'Fixed Income'
            WHEN asset_class = 'FUND'         THEN 'Pooled Vehicle'
            WHEN asset_class = 'DERIVATIVE'   THEN 'Derivative'
            ELSE                                   'Other'
        END                                                         AS asset_class_display,

        -- Preferred identifier waterfall: CUSIP → ISIN → ticker.
        COALESCE(UPPER(cusip), UPPER(isin), UPPER(ticker))          AS preferred_identifier,

        -- Composite key used for cross-currency joins.
        COALESCE(country, 'XX') || '-' || COALESCE(currency, 'XXX') AS country_currency_key

    FROM source
)

SELECT
    security_id,
    cusip,
    isin,
    ticker,
    name,
    asset_class,
    asset_class_display,
    country_code,
    currency_code,
    issue_date,
    maturity_date,
    preferred_identifier,
    country_currency_key
FROM renamed
