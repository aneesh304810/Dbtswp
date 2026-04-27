-- models/marts/dim_security.sql
-- =============================================================================
-- Dimension: Security Master
-- Upstream : stg_securities
-- Layer    : mart (table)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column list
--   dbt-ref-required        ✅  upstream ref uses {{ ref() }}
--   naming-convention       ✅  file named dim_*
--   documentation-required  ✅  described in _marts.yml
-- =============================================================================

WITH securities AS (
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
    FROM {{ ref('stg_securities') }}
),

final AS (
    SELECT
        -- Surrogate dimension key (same as NK in this demo — use hash in production).
        security_id                                         AS security_key,

        -- Natural key.
        security_id,

        -- Identifiers.
        cusip,
        isin,
        ticker,
        name                                                AS security_name,

        -- Classification.
        asset_class,
        asset_class_display,

        -- Geography.
        country_code,
        currency_code,

        -- Life cycle.
        issue_date,
        maturity_date,

        -- Derived convenience columns.
        preferred_identifier,
        country_currency_key,

        -- Maturity bucket for fixed-income reporting.
        CASE
            WHEN maturity_date IS NULL                                        THEN 'N/A'
            WHEN maturity_date < CURRENT_DATE + INTERVAL '1' YEAR            THEN 'Short  (< 1y)'
            WHEN maturity_date < CURRENT_DATE + INTERVAL '5' YEAR            THEN 'Medium (1–5y)'
            WHEN maturity_date < CURRENT_DATE + INTERVAL '10' YEAR           THEN 'Long   (5–10y)'
            ELSE                                                                   'Very Long (10y+)'
        END                                                 AS maturity_bucket

    FROM securities
)

SELECT
    security_key,
    security_id,
    cusip,
    isin,
    ticker,
    security_name,
    asset_class,
    asset_class_display,
    country_code,
    currency_code,
    issue_date,
    maturity_date,
    preferred_identifier,
    country_currency_key,
    maturity_bucket
FROM final
