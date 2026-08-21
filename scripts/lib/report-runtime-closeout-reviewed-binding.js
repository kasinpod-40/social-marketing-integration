import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  REPORT_LIVE_CLOSURE_WINDOWS,
  getReportLiveClosureDescriptor,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  sanitizeReportLiveClosureEvidence,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  buildReportRuntimeMultiwindowExecutionPlan,
} from './report-runtime-closeout-channel-binding.js';

export const REPORT_RUNTIME_REVIEWED_HANDOFF_ENV =
  'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF';
export const REPORT_RUNTIME_REVIEWED_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';

const REVIEWED_OPERATOR_PATHS = new Set([
  'scripts/report-runtime-closeout-reviewed-multiwindow.mjs',
  'scripts/report-runtime-closeout-operator.mjs',
]);

export async function loadReviewedReportRuntimeCloseoutHandoff(input = {}) {
  const env = input.env ?? {};
  const target = requireObject(input.target, 'target');
  const repository = requireObject(input.repository, 'repository');
  if (!REPORT_RUNTIME_REVIEWED_CHANNELS.includes(target.platformScope)) throw bindingError(
    'Reviewed Multichannel handoff target is unsupported',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_TARGET_INVALID',
    { platformScope: target.platformScope ?? null, capability: target.capability ?? null },
  );
  const configuredPath = requireText(
    env[REPORT_RUNTIME_REVIEWED_HANDOFF_ENV],
    REPORT_RUNTIME_REVIEWED_HANDOFF_ENV,
  );
  let handoff;
  try {
    handoff = JSON.parse(await readFile(resolve(configuredPath), 'utf8'));
  } catch (error) {
    throw bindingError(
      'Unable to load retained Report closeout reviewed handoff',
      'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_LOAD_FAILED',
      { sourceCode: error?.code ?? null },
    );
  }
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)
    || handoff.contractVersion !== REPORT_RUNTIME_REVIEWED_HANDOFF_CONTRACT) throw bindingError(
    'Retained Report closeout reviewed handoff has an invalid contract',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_INVALID',
  );
  if (JSON.stringify(sanitizeReportLiveClosureEvidence(handoff)) !== JSON.stringify(handoff)) throw bindingError(
    'Retained Report closeout reviewed handoff is not sanitized',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_NOT_SANITIZED',
  );
  const descriptor = getReportLiveClosureDescriptor(target.platformScope, target.capability);
  assertReviewedChannelCloseoutHandoff(handoff, { descriptor, repository });
  const readiness = resolveReviewedChannelReadiness(handoff, target.platformScope);
  const sourceWatermark = requireText(
    readiness.evidence?.source?.sourceWatermark,
    `channelReadiness.${target.platformScope}.evidence.source.sourceWatermark`,
  );
  return Object.freeze({
    handoff: Object.freeze(handoff),
    readiness: Object.freeze(readiness),
    accountKey: target.accountKey,
    sourceWatermark,
    reviewedWindows: Object.freeze(readiness.assessment.windows.map((row) => Object.freeze({
      windowDays: Number(row.windowDays),
      action: row.action,
    }))),
  });
}

export function assertReviewedChannelCloseoutHandoff(handoff, { descriptor, repository }) {
  const value = requireObject(handoff, 'handoff');
  const readiness = resolveReviewedChannelReadiness(value, descriptor.platform);
  const evidenceTarget = readiness.evidence?.target ?? {};
  const windows = readiness.assessment?.windows;
  const exactWindows = Array.isArray(windows)
    ? windows.map((entry) => Number(entry.windowDays)).sort((a, b) => a - b)
    : [];
  const readinessContract = String(readiness.contractVersion ?? '');
  const contractAccepted = readinessContract === 'report_channel_remote_readiness_reviewed_terminal_v1'
    || (descriptor.platform === 'youtube'
      && readinessContract === 'youtube_report_remote_readiness_reviewed_terminal_v1');
  const authority = value.closeoutAuthorities?.[descriptor.platform] ?? value.closeoutAuthority;
  const operator = authority?.operator;

  if (value.contractVersion !== REPORT_RUNTIME_REVIEWED_HANDOFF_CONTRACT
    || value.liveMaterializationAuthorized !== true
    || value.metaRemoteLock?.released !== true
    || !isCommitSha(value.metaRemoteLock?.auditHead)
    || value.repository?.branch !== 'main'
    || value.repository?.clean !== true
    || value.repository?.head !== repository.head
    || value.repository?.reviewedHead !== repository.head
    || !contractAccepted
    || readiness.ok !== true
    || readiness.assessment?.readyForLive !== true
    || readiness.assessment?.repositoryReady !== true
    || readiness.assessment?.sourceReady !== true
    || evidenceTarget.platformScope !== descriptor.platform
    || evidenceTarget.customerProfile !== 'integration_workspace'
    || evidenceTarget.accountKey !== 'chemistry_k'
    || JSON.stringify(exactWindows) !== JSON.stringify(REPORT_LIVE_CLOSURE_WINDOWS)
    || !REVIEWED_OPERATOR_PATHS.has(operator)
    || authority?.contractVersion !== 'report_runtime_closeout_uat_v1'
    || authority?.platformScope !== descriptor.platform
    || authority?.capability !== descriptor.capability) throw bindingError(
    'Reviewed handoff does not prove exact-head lock release and selected-channel readiness',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_INVALID',
    { platformScope: descriptor.platform, capability: descriptor.capability },
  );
  return true;
}

export function resolveReviewedChannelReadiness(handoff, platformScope) {
  const channelReadiness = handoff?.channelReadiness?.[platformScope];
  if (channelReadiness && typeof channelReadiness === 'object' && !Array.isArray(channelReadiness)) {
    return channelReadiness;
  }
  if (platformScope === 'youtube'
    && handoff?.youtubeReadiness
    && typeof handoff.youtubeReadiness === 'object'
    && !Array.isArray(handoff.youtubeReadiness)) {
    return handoff.youtubeReadiness;
  }
  throw bindingError(
    `Retained handoff lacks reviewed readiness for ${platformScope}`,
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_CHANNEL_MISSING',
    { platformScope },
  );
}

export function buildReportRuntimePreflightSql(input = {}) {
  const target = requireObject(input.target, 'target');
  const contract = getReportPlatformContract(target.platformScope);
  const customerKey = sqlText(target.customerKey ?? 'chemistry_k');
  const accountKey = sqlText(target.accountKey);
  const platformScope = sqlText(contract.platformScope);

  if (contract.capability === 'organic') return buildOrganicPreflightSql({
    contract,
    customerKey,
    accountKey,
    platformScope,
  });
  if (contract.capability === 'paid_ads') return buildPaidAdsPreflightSql({
    contract,
    customerKey,
    accountKey,
    platformScope,
  });
  if (contract.capability === 'commerce') return buildCommercePreflightSql({
    customerKey,
    accountKey,
    platformScope,
  });
  if (contract.capability === 'customer_service') return buildCustomerServicePreflightSql({
    contract,
    customerKey,
    accountKey,
    platformScope,
  });

  throw bindingError(
    'Reviewed Report preflight supports Organic, Paid Ads, Commerce and Customer Service only',
    'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_PLATFORM_INVALID',
    { platformScope: contract.platformScope, capability: contract.capability },
  );
}

/** Backward-compatible Organic helper retained for existing callers. */
export function buildReportRuntimeOrganicPreflightSql(input = {}) {
  const target = requireObject(input.target, 'target');
  const contract = getReportPlatformContract(target.platformScope);
  if (contract.capability !== 'organic') throw bindingError(
    'Organic preflight SQL requires an Organic Report platform',
    'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_PLATFORM_INVALID',
    { platformScope: target.platformScope ?? null, capability: contract.capability },
  );
  return buildReportRuntimePreflightSql(input);
}

export function buildReviewedReportRuntimeMultiwindowPlan(input = {}) {
  const candidates = input.candidates;
  const existingReportIds = input.existingReportIds ?? [];
  const reviewedHandoff = requireObject(input.reviewedHandoff, 'reviewedHandoff');
  const platformScope = requireText(input.platformScope ?? 'youtube', 'platformScope');
  const readiness = resolveReviewedChannelReadiness(reviewedHandoff, platformScope);
  return buildReportRuntimeMultiwindowExecutionPlan(
    candidates,
    existingReportIds,
    readiness.assessment?.windows,
  );
}

function buildOrganicPreflightSql({ contract, customerKey, accountKey, platformScope }) {
  const contentDatasetKey = sqlText(contract.coverageDatasetKeys[0]);
  const accountDatasetKey = contract.accountDailyDatasetKey
    ? sqlText(contract.accountDailyDatasetKey)
    : null;
  const accountFallback = contract.organicReadinessMode === 'account_or_content' && accountDatasetKey;
  const useAccountSql = accountFallback
    ? `(SELECT COUNT(*) FROM organic_content_observations
         WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
           AND account_key = '${accountKey}') = 0`
    : '0';
  const coverageStatusSql = accountFallback
    ? `CASE WHEN ${useAccountSql}
        THEN (SELECT status FROM account_coverage)
        ELSE (SELECT status FROM content_coverage) END`
    : '(SELECT status FROM content_coverage)';
  const coverageDatasetSql = accountFallback
    ? `CASE WHEN ${useAccountSql}
        THEN (SELECT dataset_key FROM account_coverage)
        ELSE (SELECT dataset_key FROM content_coverage) END`
    : '(SELECT dataset_key FROM content_coverage)';
  const watermarkSql = accountFallback
    ? `CASE WHEN ${useAccountSql}
        THEN (SELECT source_watermark FROM account_coverage)
        ELSE (SELECT source_watermark FROM content_coverage) END`
    : '(SELECT source_watermark FROM content_coverage)';
  const periodEndSql = accountFallback
    ? `CASE WHEN ${useAccountSql}
        THEN (SELECT MAX(metric_date) FROM organic_account_daily_facts
          WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
            AND account_key = '${accountKey}')
        ELSE (SELECT MAX(metric_date) FROM organic_content_observations
          WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
            AND account_key = '${accountKey}') END`
    : `(SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}')`;
  const accountCoverageCte = accountDatasetKey
    ? `, account_coverage AS (
        SELECT dataset_key, status, source_watermark, completed_at
        FROM data_coverage_runs
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}' AND dataset_key = '${accountDatasetKey}'
          AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
      )`
    : '';

  return compactSql(`
    WITH content_coverage AS (
      SELECT dataset_key, status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
        AND account_key = '${accountKey}' AND dataset_key = '${contentDatasetKey}'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )${accountCoverageCte}
    SELECT
      ${coverageStatusSql} AS coverage_status,
      ${coverageDatasetSql} AS coverage_dataset_key,
      NULL AS coverage_scope_mode,
      ${watermarkSql} AS source_watermark,
      ${periodEndSql} AS period_end,
      CASE WHEN ${useAccountSql} THEN 'account' ELSE 'content' END AS source_scope,
      CASE WHEN ${coverageDatasetSql} IS NULL THEN 0 ELSE 1 END AS coverage_required_count,
      CASE WHEN ${watermarkSql} IS NULL OR ${watermarkSql} = '' THEN 0 ELSE 1 END
        AS coverage_watermark_count,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS content_state_count,
      (SELECT COUNT(*) FROM organic_content_observations
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS observation_count,
      0 AS ads_summary_fact_count,
      0 AS ads_ranking_fact_count,
      0 AS ads_entity_count,
      0 AS ads_ranking_required,
      0 AS daily_fact_count,
      0 AS order_state_count,
      0 AS conversation_fact_count,
      (SELECT COUNT(*) FROM organic_account_daily_facts
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS account_fact_count,
      ${runtimeSafetySql(platformScope, accountKey)};
  `);
}

function buildPaidAdsPreflightSql({ contract, customerKey, accountKey, platformScope }) {
  const coverageDatasets = sqlList(contract.coverageDatasetKeys);
  const summaryCondition = adsFactCondition(contract.summaryReportLevels, {
    breakdownFamily: contract.summaryBreakdownFamily,
    segmentFamily: contract.summarySegmentFamily,
  });
  const rankingCondition = contract.rankingReportLevels.length === 0
    ? '0 = 1'
    : adsFactCondition(contract.rankingReportLevels, {
      breakdownFamily: contract.rankingBreakdownFamily,
      segmentFamily: contract.rankingSegmentFamily,
    });

  return compactSql(`
    WITH coverage AS (
      SELECT dataset_key, status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
        AND account_key = '${accountKey}' AND dataset_key IN (${coverageDatasets})
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT dataset_key FROM coverage) AS coverage_dataset_key,
      NULL AS coverage_scope_mode,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM ads_daily_facts
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}' AND ${summaryCondition}) AS period_end,
      'account_summary' AS source_scope,
      (SELECT COUNT(*) FROM coverage) AS coverage_required_count,
      (SELECT COUNT(*) FROM coverage WHERE source_watermark IS NOT NULL AND source_watermark <> '')
        AS coverage_watermark_count,
      0 AS content_state_count,
      0 AS observation_count,
      (SELECT COUNT(*) FROM ads_daily_facts
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}' AND ${summaryCondition}) AS ads_summary_fact_count,
      (SELECT COUNT(*) FROM ads_daily_facts
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}' AND ${rankingCondition}) AS ads_ranking_fact_count,
      (SELECT COUNT(*) FROM ads_entity_state
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}' AND entity_type = 'ad') AS ads_entity_count,
      ${contract.topAdsRequired ? 1 : 0} AS ads_ranking_required,
      0 AS daily_fact_count,
      0 AS order_state_count,
      0 AS conversation_fact_count,
      0 AS account_fact_count,
      ${runtimeSafetySql(platformScope, accountKey)};
  `);
}

function buildCommercePreflightSql({ accountKey, platformScope }) {
  return compactSql(`
    WITH coverage AS (
      SELECT dataset_key, status, scope_mode, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE account_key = '${accountKey}' AND platform = '${platformScope}'
        AND dataset_key = 'woocommerce_orders' AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT dataset_key FROM coverage) AS coverage_dataset_key,
      (SELECT scope_mode FROM coverage) AS coverage_scope_mode,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM commerce_daily_sales_facts
        WHERE account_key = '${accountKey}') AS period_end,
      'commerce_daily' AS source_scope,
      (SELECT COUNT(*) FROM coverage) AS coverage_required_count,
      (SELECT COUNT(*) FROM coverage WHERE source_watermark IS NOT NULL AND source_watermark <> '')
        AS coverage_watermark_count,
      0 AS content_state_count,
      0 AS observation_count,
      0 AS ads_summary_fact_count,
      0 AS ads_ranking_fact_count,
      0 AS ads_entity_count,
      0 AS ads_ranking_required,
      (SELECT COUNT(*) FROM commerce_daily_sales_facts
        WHERE account_key = '${accountKey}') AS daily_fact_count,
      (SELECT COUNT(*) FROM commerce_order_state
        WHERE account_key = '${accountKey}') AS order_state_count,
      0 AS conversation_fact_count,
      0 AS account_fact_count,
      ${runtimeSafetySql(platformScope, accountKey)};
  `);
}

function buildCustomerServicePreflightSql({ contract, customerKey, accountKey, platformScope }) {
  const requiredDatasets = sqlList(contract.requiredCoverageDatasetKeys);
  const primaryDataset = sqlText(contract.datasetKey);
  return compactSql(`
    WITH required_coverage AS (
      SELECT dataset_key, status, source_watermark, completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY dataset_key
          ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC
        ) AS dataset_rank
      FROM data_coverage_runs
      WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
        AND account_key = '${accountKey}' AND dataset_key IN (${requiredDatasets})
        AND completed_at IS NOT NULL
    ), selected_coverage AS (
      SELECT * FROM required_coverage WHERE dataset_rank = 1
    )
    SELECT
      (SELECT status FROM selected_coverage WHERE dataset_key = '${primaryDataset}')
        AS coverage_status,
      '${primaryDataset}' AS coverage_dataset_key,
      NULL AS coverage_scope_mode,
      (SELECT source_watermark FROM selected_coverage WHERE dataset_key = '${primaryDataset}')
        AS source_watermark,
      (SELECT MAX(metric_date) FROM (
        SELECT metric_date FROM chatwoot_conversation_daily_facts
          WHERE customer_key = '${customerKey}' AND account_key = '${accountKey}'
        UNION ALL
        SELECT metric_date FROM chatwoot_account_daily_facts
          WHERE customer_key = '${customerKey}' AND account_key = '${accountKey}'
      )) AS period_end,
      'customer_service_daily' AS source_scope,
      (SELECT COUNT(*) FROM selected_coverage
        WHERE LOWER(status) IN ('complete', 'completed', 'partial', 'revisable', 'no_data_confirmed'))
        AS coverage_required_count,
      (SELECT COUNT(*) FROM selected_coverage
        WHERE source_watermark IS NOT NULL AND source_watermark <> '') AS coverage_watermark_count,
      0 AS content_state_count,
      0 AS observation_count,
      0 AS ads_summary_fact_count,
      0 AS ads_ranking_fact_count,
      0 AS ads_entity_count,
      0 AS ads_ranking_required,
      0 AS daily_fact_count,
      0 AS order_state_count,
      (SELECT COUNT(*) FROM chatwoot_conversation_daily_facts
        WHERE customer_key = '${customerKey}' AND account_key = '${accountKey}')
        AS conversation_fact_count,
      (SELECT COUNT(*) FROM chatwoot_account_daily_facts
        WHERE customer_key = '${customerKey}' AND account_key = '${accountKey}')
        AS account_fact_count,
      ${runtimeSafetySql(platformScope, accountKey)};
  `);
}

function adsFactCondition(reportLevels, options) {
  return [
    `report_level IN (${sqlList(reportLevels)})`,
    familyCondition('breakdown_key', options.breakdownFamily),
    familyCondition('segment_key', options.segmentFamily),
  ].join(' AND ');
}

function familyCondition(column, value) {
  const family = sqlText(value);
  return `(${column} = '${family}' OR ${column} LIKE '${family}=%')`;
}

function runtimeSafetySql(platformScope, accountKey) {
  const currentReportIncidentSql = `
    SELECT 1 FROM sync_runs current_report
    WHERE current_report.sync_run_id = a.sync_run_id
      AND current_report.platform = '${platformScope}'
      AND current_report.account_key = '${accountKey}'
      AND current_report.sync_type = 'dashboard_performance_report'
      AND current_report.status IN ('pending', 'running', 'failed')
  `;
  return `
    (SELECT COUNT(*) FROM sync_runs
      WHERE platform = '${platformScope}' AND account_key = '${accountKey}'
        AND sync_type = 'dashboard_performance_report'
        AND status IN ('pending', 'running')) AS active_report_work_count,
    (SELECT COUNT(*) FROM sync_locks l
      JOIN sync_runs r ON r.sync_run_id = l.owner_id
      WHERE r.platform = '${platformScope}' AND r.account_key = '${accountKey}'
        AND r.sync_type = 'dashboard_performance_report'
        AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
    (SELECT COUNT(*) FROM dead_letter_jobs
      WHERE job_type = 'report.materialization.generate'
        AND status IN ('open', 'redrive_pending')
        AND (
          json_valid(payload_json) = 0
          OR json_extract(payload_json, '$.platformScope') IS NULL
          OR json_extract(payload_json, '$.platformScope') = '${platformScope}'
        )) AS open_report_dlq,
    (SELECT COUNT(*) FROM system_alerts a
      WHERE a.platform = '${platformScope}' AND a.severity = 'critical' AND a.status = 'open'
        AND EXISTS (${currentReportIncidentSql})) AS open_report_critical_alerts,
    (SELECT COUNT(*) FROM system_alerts a
      WHERE a.platform = '${platformScope}' AND a.severity = 'critical' AND a.status = 'open'
        AND NOT EXISTS (${currentReportIncidentSql})) AS historical_connector_critical_alerts
  `;
}
function sqlList(values) { return values.map((value) => `'${sqlText(value)}'`).join(', '); }
function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replaceAll("'", "''"); }
function isCommitSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value); }
function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bindingError(
    `${field} must be an object`,
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_BINDING_INPUT_INVALID',
    { field },
  );
  return value;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bindingError(
    `${field} is required`,
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_BINDING_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function bindingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutReviewedBindingError';
  error.code = code;
  error.details = details;
  return error;
}
