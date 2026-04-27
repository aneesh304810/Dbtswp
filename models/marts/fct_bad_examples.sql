-- fct_bad_examples.sql
-- ⚠️ THIS MODEL IS INTENTIONALLY BAD.
--
-- It exists to give the Data Pipeline Intelligence guardrail engine
-- something to flag. Open this file with the extension installed and
-- you should see warnings/errors in the Problems pane for:
--   - no-select-star
--   - no-implicit-join          (comma join with WHERE)
--   - no-leading-wildcard-like
--   - no-function-on-indexed-column
--   - prefer-union-all-over-union
--   - avoid-not-in-with-nullable
--   - dbt-ref-required          (bare table reference)
--   - no-hardcoded-dates
--   - no-distinct-as-dedup-fix
--
-- You can run quick-fixes (Ctrl+.) on the highlighted lines for the
-- three rules with auto-fix support.

-- 1. SELECT * + implicit join + bare table ref + leading wildcard LIKE.
SELECT DISTINCT
    h.*,
    s.security_name
FROM CPDW.RAW_HOLDINGS h, {{ ref('stg_securities') }} s   -- implicit join + ok ref
WHERE h.security_id = s.security_id
  AND s.security_name LIKE '%bond%'                       -- leading wildcard
  AND UPPER(h.account_id) = 'ACC0001'                     -- function on indexed col
  AND h.as_of_date = DATE '2026-04-25'                    -- hardcoded date

UNION                                                     -- prefer UNION ALL

-- 2. NOT IN with nullable column.
SELECT DISTINCT
    h.holding_id, h.account_id, h.security_id, h.as_of_date,
    h.quantity, h.market_value_usd, h.cost_basis_usd, NULL AS security_name
FROM {{ ref('stg_holdings') }} h
WHERE h.security_id NOT IN (                              -- NOT IN with nullable
    SELECT security_id FROM {{ ref('stg_securities') }}
    WHERE asset_class = 'EQUITY'
)
