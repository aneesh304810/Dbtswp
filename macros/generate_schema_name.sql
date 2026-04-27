-- macros/generate_schema_name.sql
-- =============================================================================
-- Schema name generator — BBH / swp_demo standard.
--
-- Behaviour:
--   dbt default: <target.schema>_<custom_schema> (e.g. DEV_staging).
--   This macro: <custom_schema> directly in prod (staging, marts),
--               <target.schema>_<custom_schema> in non-prod (dev_staging).
--
-- Profile targets:
--   duckdb  — schemas are virtual schemas inside the single .duckdb file.
--   oracle  — schemas map to Oracle schemas (must exist before dbt run).
--
-- Controlled via dbt_project.yml +schema: keys per model directory.
-- =============================================================================

{% macro generate_schema_name(custom_schema_name, node) -%}

    {%- set default_schema = target.schema -%}

    {%- if custom_schema_name is none -%}
        {{ default_schema }}
    {%- elif target.name == 'prod' -%}
        {{ custom_schema_name | trim }}
    {%- else -%}
        {{ default_schema }}_{{ custom_schema_name | trim }}
    {%- endif -%}

{%- endmacro %}
