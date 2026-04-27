-- models/staging/stg_accounts.sql
-- =============================================================================
-- Staging: Client Portfolio Accounts
-- Source : {{ source('raw', 'raw_accounts') }}
-- Layer  : staging (view)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column list in source CTE and final SELECT
--   dbt-ref-required        ✅  source reference via {{ source() }}
--   naming-convention       ✅  file named stg_*
--   no-hardcoded-dates      ✅  no date literals
--   documentation-required  ✅  described in _staging.yml
-- =============================================================================

WITH source AS (
    SELECT
        account_id,
        account_name,
        client_id,
        account_type,
        base_currency,
        inception_date,
        status
    FROM {{ source('raw', 'raw_accounts') }}
),

renamed AS (
    SELECT
        -- Primary key.
        account_id,

        -- Descriptive attributes.
        account_name                        AS name,
        client_id,
        UPPER(account_type)                 AS account_type,
        UPPER(base_currency)                AS base_currency,
        CAST(inception_date AS DATE)        AS inception_date,
        UPPER(status)                       AS status,

        -- Derived flag for active filtering.
        CASE
            WHEN UPPER(status) = 'ACTIVE' THEN 1
            ELSE 0
        END                                 AS is_active

    FROM source
    WHERE status IS NOT NULL
)

SELECT
    account_id,
    name,
    client_id,
    account_type,
    base_currency,
    inception_date,
    status,
    is_active
FROM renamed
