# swp_demo — dbt project for testing the Data Pipeline Intelligence extension

A self-contained dbt project that exercises every feature of the Data Pipeline Intelligence VS Code extension. Runs locally on DuckDB with no infrastructure; flip a target flag and the same models run on Oracle.

## What's in here

```
swp_demo/
├── dbt_project.yml             Project config (medallion layer materializations)
├── profiles.yml                Two targets: duckdb (default) + oracle
├── .pipeline-guardrails.yml    Extension config — sized for this project
├── .dbt-pipeline/
│   └── oracle-metadata.json    Oracle schema metadata for testing schema-aware rules
├── .vscode/settings.json       Pre-pointed at the metadata + guardrails files
├── seeds/                      Raw CSVs (loaded as the "raw" schema)
│   ├── raw_securities.csv      15 securities (equities, fixed income, fund)
│   ├── raw_accounts.csv        10 client accounts
│   ├── raw_holdings.csv        20 daily position snapshots
│   └── raw_transactions.csv    12 trades + corporate actions
├── models/
│   ├── sources/_sources.yml    Source declarations
│   ├── staging/                Cleaned + typed (4 models, view materialization)
│   ├── intermediate/           Joined/aggregated (2 models)
│   └── marts/                  Gold layer (4 models, table materialization)
│       └── fct_bad_examples.sql   ⚠️ Intentionally violates 9 guardrail rules
├── tests/                      One singular test
└── sample-explain-plan.txt     Paste-into-analyzer test fixture
```

## Setup — 5 minutes

### 1. Install dbt + DuckDB adapter

```bash
pip install dbt-core==1.8.7 dbt-duckdb==1.8.4
```

(Pinned versions tested with the extension. Newer minor versions should work.)

### 2. Tell dbt where to find profiles.yml

Easiest: set the env var to this folder so dbt picks up the bundled `profiles.yml`:

**PowerShell:**
```powershell
$env:DBT_PROFILES_DIR = (Get-Location).Path
```

**bash/zsh:**
```bash
export DBT_PROFILES_DIR=$(pwd)
```

Or copy to the standard location:
```bash
cp profiles.yml ~/.dbt/profiles.yml      # Linux/macOS
Copy-Item profiles.yml $env:USERPROFILE\.dbt\profiles.yml   # PowerShell
```

### 3. Build the project on DuckDB

```bash
dbt deps          # no packages in this demo, but harmless to run
dbt seed          # loads the 4 CSVs into the duckdb file
dbt run           # builds staging + intermediate + marts
dbt test          # runs the source tests + the singular test
dbt docs generate # produces target/manifest.json (the extension reads this)
```

You'll get `swp_demo.duckdb` in the project root with schemas `raw`, `staging`, `intermediate`, `marts` populated. **Crucially, `target/manifest.json` exists** — that's what the extension reads for lineage.

### 4. Open in VS Code with the extension installed

```bash
code .
```

The Data Lineage panel in the Explorer sidebar should populate immediately:
- Raw / Sources (4) — the 4 seeded source tables
- Staging (4) — stg_securities, stg_accounts, stg_holdings, stg_transactions
- Intermediate (2) — int_holdings_enriched, int_account_daily_nav
- Marts (Gold) (5) — dim_security, dim_account, fct_holdings, fct_account_daily_nav, fct_bad_examples

If the panel is empty, run `dbt compile` and click the refresh icon at the top of the panel.

---

## Switching to Oracle

When you're ready to test against a real Oracle:

### 1. Install the adapter

```bash
pip install dbt-oracle==1.8.3
```

### 2. Set Oracle credentials via env vars

```bash
export ORACLE_USER=your_user
export ORACLE_PASSWORD=your_password
export ORACLE_HOST=your-oracle-host.example.com
export ORACLE_SERVICE=CPDW
export ORACLE_SCHEMA=CPDW_DEV
```

(For wallet/TLS, uncomment the wallet lines in `profiles.yml` and set `TNS_ADMIN`, `WALLET_LOCATION`, `WALLET_PASSWORD`.)

### 3. Run with the oracle target

```bash
dbt seed --target oracle
dbt run --target oracle
dbt test --target oracle
```

Or set the default permanently in `profiles.yml`:
```yaml
swp_demo:
  target: oracle    # was: duckdb
```

The same models run on both targets. DuckDB syntax used here (`||` concat, `INTERVAL 1 YEAR`, `DATE - DATE`) is also valid Oracle SQL.

---

## Feature-by-feature test guide

Walk through these in order — each test takes 30 seconds and exercises a different extension feature.

### 1. Lineage tree (sidebar)

- Open the Explorer sidebar — the **DATA LINEAGE** panel groups models by layer
- Expand `Marts (Gold) (5)` → expand `fct_holdings` → see its columns
- Hover `adjusted_market_value_usd` → tooltip shows the SQL transformation `market_value_usd * 1.2`
- Click `fct_holdings` → opens `models/marts/fct_holdings.sql`
- Click a source like `raw_holdings` → opens `models/sources/_sources.yml` with cursor on the `name: raw_holdings` line

### 2. Lineage graph (Cytoscape)

- Command Palette → **`Data Pipeline: Open Lineage Graph`**
- You should see ~15 nodes connected left-to-right by layer
- Click `fct_holdings` → its 4 upstream models highlight, downstream dims; column transformation panel opens
- Click `Fit` button → re-centers the graph

### 3. Column-level lineage

- In the lineage tree, expand `fct_account_daily_nav`
- Hover `daily_return` → tooltip shows the window expression
- Right-click `daily_return` → `Show Column Lineage for Selection` (or use Command Palette)

### 4. Guardrails (the linter)

- Open `models/marts/fct_bad_examples.sql`
- Status bar: should show `Pipeline: FAIL`
- Problems pane (`Ctrl+Shift+M`): should show ~9 issues
- The squiggles include:
  - `SELECT *` — quick-fix available (`Ctrl+.`)
  - `UNION` without ALL — quick-fix to `UNION ALL`
  - `NOT IN (...)` — quick-fix to `NOT EXISTS`
  - leading `LIKE '%bond%'`
  - `UPPER(account_id)` flagged as function-on-indexed-column **once Oracle metadata is loaded**
  - bare `CPDW.RAW_HOLDINGS` reference flagged as missing `{{ ref() }}`
  - `DATE '2026-04-25'` flagged as hardcoded date

### 5. Workspace-wide guardrails scan

- Command Palette → **`Data Pipeline: Run Guardrails on Project`**
- Notification: error/warning/info counts across all `.sql` files
- `stg_accounts` should appear in the Problems pane: missing model description (info-level)

### 6. Schema-aware Oracle rules

- The `.vscode/settings.json` already points at `.dbt-pipeline/oracle-metadata.json`, so this loads automatically on activation.
- Verify in the Output panel ("Data Pipeline Intelligence" channel): you should see `Oracle metadata loaded: 5 tables from <path>`.
- Open `fct_bad_examples.sql` again — additional warnings appear:
  - `index-usage-check` on `UPPER(account_id) = 'ACC0001'` (account_id IS indexed; UPPER prevents the index)
  - `partition-pruning-required` somewhere lacking AS_OF_DATE filtering on RAW_HOLDINGS
  - `full-scan-risk-on-large-table` since RAW_HOLDINGS is in `largeTables`

### 7. Explain plan analyzer

- Command Palette → **`Data Pipeline: Analyze Pasted Explain Plan`**
- Open `sample-explain-plan.txt`, copy the whole file, paste into the input box
- A new Markdown report opens listing:
  - Cartesian join (error)
  - Multiple full table scans (warning)
  - Partition full scan (warning — no pruning)
  - High cost steps

### 8. Compiled SQL preview

- Open `models/marts/fct_holdings.sql` (the raw file with `{{ ref() }}`)
- Click the diff icon in the editor toolbar (top-right) — or Command Palette → **`Data Pipeline: Preview Compiled SQL (diff)`**
- Side-by-side: left shows the Jinja, right shows the compiled SQL with refs resolved to `swp_demo.marts.int_holdings_enriched` (or the Oracle equivalent)

### 9. Ctrl+click on ref/source

- Open `models/marts/fct_holdings.sql`
- Ctrl+click on `int_holdings_enriched` inside `{{ ref('int_holdings_enriched') }}`
- Jumps to `models/intermediate/int_holdings_enriched.sql`
- Open `models/staging/stg_securities.sql`
- Ctrl+click on `raw_securities` in `{{ source('raw', 'raw_securities') }}` → jumps to `_sources.yml`

### 10. Autocomplete for ref/source

- In any `.sql` file, type a new line: `SELECT * FROM {{ ref('` — completion list pops with all model names
- Type `{{ source('` — first arg shows source group names (just `raw`)
- Type `{{ source('raw', '` — second arg filters to the 4 raw_* tables

### 11. Run model / run tests from VS Code

- Open `models/marts/fct_holdings.sql`
- Click the play icon in the editor toolbar (or Command Palette → **`Data Pipeline: Run This Model`**)
- An integrated terminal named "dbt" opens and runs `dbt run --select fct_holdings --project-dir "..."`
- Click the beaker icon → runs `dbt test --select fct_holdings`
- Right-click → **`Run This Model + Children`** → runs `dbt run --select fct_holdings+`

### 12. Generate schema.yml skeleton

- Open `models/marts/fct_holdings.sql`
- Right-click → **`Generate schema.yml Skeleton`**
- An untitled YAML buffer opens with all columns from the manifest, `TODO` descriptions, `not_null+unique` tests on the `_key` column, `not_null` on `_id` columns
- (Doesn't overwrite your existing `_marts.yml` — copy/merge sections you want.)

---

## Resetting between tests

```bash
dbt clean        # removes target/ and dbt_packages/
rm swp_demo.duckdb*
dbt seed && dbt run && dbt docs generate
```

Then click refresh in the lineage tree.

---

## What's deliberately NOT realistic

- **Row counts.** The seeds are tiny (15-20 rows each) so you can read everything. The `oracle-metadata.json` reports 380M rows on RAW_HOLDINGS so the schema-aware rules treat it as "large" — that's intentional. The metadata file describes what your *production* Oracle would look like; the seeds describe what your *DuckDB sandbox* contains.
- **No incremental materializations.** All marts are full-refresh. In production you'd use `materialized='incremental'` with a partition-by `as_of_date`.
- **No snapshots, no exposures, no metrics.** Out of scope for an extension test fixture.
