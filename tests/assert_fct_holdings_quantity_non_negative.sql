-- Singular test: fct_holdings should never have negative quantities
-- in the demo dataset.

SELECT
    holding_id,
    quantity
FROM {{ ref('fct_holdings') }}
WHERE quantity < 0
