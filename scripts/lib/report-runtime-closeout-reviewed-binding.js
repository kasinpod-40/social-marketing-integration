import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { getReportLiveClosureDescriptor } from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  assertReviewedReportLiveClosureHandoff,
  sanitizeReportLiveClosureEvidence,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { buildReportRuntimeMultiwindowExecutionPlan } from './report-runtime-closeout-channel-binding.js';

export const REPORT_RUNTIME_REVIEWED_HANDOFF_ENV =
  'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF';
export const REPORT_RUNTIME_REVIEWED_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';

export async function loadReviewedReportRuntimeCloseoutHandoff(input = {}) {
  const env = input.env ?? {};
  const target = requireObject(input.target, 'target');
  const repository = requireObject(input.repository, 'repository');
  if (target.platformScope !== 'youtube' || target.capability !== 'organic') throw bindingError(
    'Reviewed Multichannel handoff is currently bound only to YouTube Organic',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_TARGET_INVALID',
    { platformScope: target.platformScope ?? null, capability: target.capability ?? null },
  );
  const configuredPath = requireText(env[REPORT_RUNTIME_REVIEWED_HANDOFF_ENV], REPORT_RUNTIME_REVIEWED_HANDOFF_ENV);
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
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  assertReviewedReportLiveClosureHandoff(handoff, { descriptor, repository });
  const accountId = requireText(handoff.youtubeIdentity?.accountId, 'youtubeIdentity.accountId');
  if (/READ_FROM|PLACEHOLDER|REPLACE_WITH/iu.test(accountId)) throw bindingError(
    'Retained Report closeout handoff lacks an exact YouTube account identity',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_IDENTITY_INVALID',
  );
  const sourceWatermark = requireText(
    handoff.youtubeReadiness?.evidence?.source?.sourceWatermark,
    'youtubeReadiness.evidence.source.sourceWatermark',
  );
  return Object.freeze({
    handoff: Object.freeze(handoff),
    accountId,
    sourceWatermark,
    reviewedWindows: Object.freeze(handoff.youtubeReadiness.assessment.windows.map((row) => Object.freeze({
      windowDays: Number(row.windowDays),
      action: row.action,
    }))),
  });
}

export function buildReportRuntimeOrganicPreflightSql(input = {}) {
  const target = requireObject(input.target, 'target');
  const contract = getReportPlatformContract(target.platformScope);
  if (contract.capability !== 'organic') throw bindingError(
    'Organic preflight SQL requires an Organic Report platform',
    'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_PLATFORM_INVALID',
    { platformScope: target.platformScope ?? null, capability: contract.capability },
  );
  const customerKey = sqlText(target.customerKey ?? 'chemistry_k');
  const accountKey = sqlText(target.accountKey);
  const platformScope = sqlText(contract.platformScope);
  const datasetKey = sqlText(contract.datasetKey);
  return compactSql(`
    WITH coverage AS (
      SELECT status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = '${customerKey}'
        AND platform = '${platformScope}'
        AND account_key = '${accountKey}'
        AND dataset_key = '${datasetKey}'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS period_end,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS content_state_count,
      (SELECT COUNT(*) FROM organic_content_observations
        WHERE customer_key = '${customerKey}' AND platform = '${platformScope}'
          AND account_key = '${accountKey}') AS observation_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = '${platformScope}' AND r.account_key = '${accountKey}'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate'
          AND status IN ('open', 'redrive_pending')) AS open_report_dlq;
  `);
}

export function buildReviewedReportRuntimeMultiwindowPlan(input = {}) {
  const candidates = input.candidates;
  const existingReportIds = input.existingReportIds ?? [];
  const reviewedHandoff = requireObject(input.reviewedHandoff, 'reviewedHandoff');
  return buildReportRuntimeMultiwindowExecutionPlan(
    candidates,
    existingReportIds,
    reviewedHandoff.youtubeReadiness?.assessment?.windows,
  );
}

function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replaceAll("'", "''"); }
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
