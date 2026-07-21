-- BDR Workload | camada analítica avançada sobre Commercial Intelligence.
-- Grão canônico: coorte company_id|bdr_id. Conversão nunca usa toque como denominador.
-- Região: southamerica-east1 | projeto: gen-lang-client-0423905839.

CREATE OR REPLACE VIEW `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_cohort_base_v1`
OPTIONS(description='1 linha por coorte Company x BDR para analytics observacional do BDR Workload.')
AS
WITH valid_touch AS (
  SELECT
    cohort_key,
    bdr_id,
    company_id,
    contact_id,
    channel,
    atividade_tipo,
    occurred_at,
    first_touch_at,
    deal_sql_date,
    sql_30d_same_bdr,
    LOWER(COALESCE(NULLIF(porte_derivado, ''), 'desconhecido')) AS porte,
    is_engaged_touch
  FROM `gen-lang-client-0423905839.axenya_commercial_intel_prd.fact_touch`
  WHERE is_valid_ts = TRUE
    AND cohort_key IS NOT NULL
    AND bdr_id IS NOT NULL
    AND company_id IS NOT NULL
),
meta AS (
  SELECT
    cohort_key,
    ANY_VALUE(bdr_id) AS bdr_id,
    ANY_VALUE(company_id) AS company_id,
    MIN(first_touch_at) AS first_touch_at,
    MIN(deal_sql_date) AS sql_date,
    MAX(COALESCE(sql_30d_same_bdr, 0)) AS converted_30d,
    ARRAY_AGG(porte IGNORE NULLS ORDER BY occurred_at LIMIT 1)[SAFE_OFFSET(0)] AS porte
  FROM valid_touch
  GROUP BY cohort_key
)
SELECT
  m.cohort_key,
  m.bdr_id,
  m.company_id,
  DATE(m.first_touch_at, 'America/Sao_Paulo') AS first_touch_date,
  m.first_touch_at,
  COALESCE(m.porte, 'desconhecido') AS porte,
  m.converted_30d,
  COUNT(*) AS touches_observed,
  COUNTIF(v.is_engaged_touch = TRUE) AS touches_engaged,
  COUNTIF(
    v.atividade_tipo IN ('mensagem_enviada', 'call_conectada', 'reuniao')
    AND (m.sql_date IS NULL OR DATE(v.occurred_at, 'America/Sao_Paulo') <= m.sql_date)
  ) AS touches_real_until_sql_date,
  COUNT(DISTINCT IF(v.atividade_tipo IN ('mensagem_enviada', 'call_conectada', 'reuniao'), v.channel, NULL)) AS real_channels,
  COUNT(DISTINCT v.contact_id) AS contacts_observed,
  COUNT(DISTINCT IF(v.atividade_tipo IN ('mensagem_enviada', 'call_conectada', 'reuniao'), v.contact_id, NULL)) AS contacts_real,
  MAX(DATE(v.occurred_at, 'America/Sao_Paulo')) AS last_touch_date
FROM meta m
JOIN valid_touch v USING (cohort_key)
GROUP BY m.cohort_key, m.bdr_id, m.company_id, first_touch_date, m.first_touch_at, porte, m.converted_30d;

CREATE OR REPLACE VIEW `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_effort_sql_v1`
OPTIONS(description='Coortes BDR bucketizadas por esforço real até a data do SQL; associação observacional, não causal.')
AS
SELECT
  *,
  CASE
    WHEN touches_real_until_sql_date <= 1 THEN '1'
    WHEN touches_real_until_sql_date <= 3 THEN '2-3'
    WHEN touches_real_until_sql_date <= 6 THEN '4-6'
    WHEN touches_real_until_sql_date <= 12 THEN '7-12'
    ELSE '13+'
  END AS effort_band,
  CASE
    WHEN touches_real_until_sql_date <= 1 THEN 1
    WHEN touches_real_until_sql_date <= 3 THEN 2
    WHEN touches_real_until_sql_date <= 6 THEN 3
    WHEN touches_real_until_sql_date <= 12 THEN 4
    ELSE 5
  END AS effort_band_order
FROM `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_cohort_base_v1`;

CREATE OR REPLACE VIEW `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_penetration_v1`
OPTIONS(description='Profundidade e cobertura observada por Company x BDR; inserção sem toque real permanece visível.')
AS
SELECT
  cohort_key,
  bdr_id,
  company_id,
  first_touch_date,
  porte,
  converted_30d,
  touches_observed,
  touches_real_until_sql_date,
  contacts_observed,
  contacts_real,
  IF(touches_real_until_sql_date > 0, 1, 0) AS company_with_real_touch,
  CASE
    WHEN touches_real_until_sql_date = 0 THEN '0'
    WHEN touches_real_until_sql_date = 1 THEN '1'
    WHEN touches_real_until_sql_date <= 3 THEN '2-3'
    ELSE '4+'
  END AS depth_band,
  last_touch_date
FROM `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_cohort_base_v1`;

CREATE OR REPLACE VIEW `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_sql_by_porte_v1`
OPTIONS(description='Coortes Company x BDR para conversão SQL 30d por porte; inclui desconhecido.')
AS
SELECT
  cohort_key,
  bdr_id,
  company_id,
  first_touch_date,
  porte,
  converted_30d
FROM `gen-lang-client-0423905839.axenya_commercial_intel_prd.vw_dash_bdr_cohort_base_v1`;
