-- models/marts/dim_account.sql
-- =============================================================================
-- Dimension: Client Portfolio Accounts
-- Upstream : stg_accounts
-- Layer    : mart (table)
-- Guardrail compliance:
--   no-select-star          ✅  explicit column list
--   dbt-ref-required        ✅  upstream ref uses {{ ref() }}
--   naming-convention       ✅  file named dim_*
--   documentation-required  ✅  described in _marts.yml
-- =============================================================================

WITH accounts AS (
    SELECT
        account_id,
        name,
        client_id,
        account_type,
        base_currency,
        inception_date,
        status,
        is_active
    FROM {{ ref('stg_accounts') }}
),

final AS (
    SELECT
        -- Surrogate dimension key.
        account_id          AS account_key,

        -- Natural key.
        account_id,

        -- Attributes.
        name                AS account_name,
        client_id,
        account_type,
        base_currency,
        inception_date,
        status,
        is_active
    FROM accounts
)

SELECT
    account_key,
    account_id,
    account_name,
    client_id,
    account_type,
    base_currency,
    inception_date,
    status,
    is_active
FROM final
