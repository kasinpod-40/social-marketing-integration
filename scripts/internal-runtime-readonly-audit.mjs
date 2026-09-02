#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const CONFIRMATION = 'AUDIT_INTERNAL_RUNTIME_READONLY';
const TARGET_DATABASE = 'social-mkt-state-dev';
const TARGET_BINDING = 'MKT_STATE_DB';
const DEFAULT_CONFIG = 'wrangler.sync.jsonc';
const MAX_WORK_ROWS = 100;
const MAX_PHASE_ROWS = 100;
const MAX_LOCK_ROWS = 50;
const MAX_RUN_ROWS = 60;
const MAX_COVERAGE_ROWS = 120;
const MAX_REPORT_ROWS = 80;

const QUERIES = Object.freeze({
  sizeProbe: `SELECT 1 AS audit_probe`,
  lifecycleCounts: `
    SELECT lifecycle_status, COUNT(*) AS count
    FROM sync_work_runs
    GROUP BY lifecycle_status
    ORDER BY lifecycle_status
  `,
  latestWorkByCursor: `
    SELECT
      r.cursor_key,
      r.work_type,
      r.lifecycle_status,
      r.terminal_reason,
      r.generation,
      r.requested_at,
      r.completed_at,
      r.updated_at,
      CASE WHEN f.work_key=r.work_key AND f.generation=r.generation THEN 1 ELSE 0 END AS current_fence,
      (
        SELECT COUNT(*) FROM sync_locks AS lock
        WHERE lock.lock_key=r.cursor_key AND lock.expires_at>unixepoch()*1000
      ) AS active_lock_count
    FROM sync_work_runs AS r
    LEFT JOIN sync_generation_fences AS f ON f.cursor_key=r.cursor_key
    WHERE r.generation=(
      SELECT MAX(r2.generation)
      FROM sync_work_runs AS r2
      WHERE r2.cursor_key=r.cursor_key
    )
    ORDER BY r.requested_at DESC
    LIMIT ${MAX_WORK_ROWS}
  `,
  incompletePhases: `
    SELECT
      phase,
      COUNT(*) AS incomplete_work_count,
      SUM(CASE WHEN expected_items>processed_items THEN expected_items-processed_items ELSE 0 END) AS remaining_items,
      MAX(updated_at) AS latest_updated_at
    FROM sync_work_phases
    WHERE complete=0
    GROUP BY phase
    ORDER BY incomplete_work_count DESC, phase
    LIMIT ${MAX_PHASE_ROWS}
  `,
  activeLocks: `
    SELECT lock_key, acquired_at, expires_at, updated_at
    FROM sync_locks
    WHERE expires_at>unixepoch()*1000
    ORDER BY expires_at
    LIMIT ${MAX_LOCK_ROWS}
  `,
  dlqCounts: `
    SELECT status, COUNT(*) AS count, MAX(updated_at) AS latest_updated_at
    FROM dead_letter_jobs
    GROUP BY status
    ORDER BY status
  `,
  openAlerts: `
    SELECT severity, platform, alert_type, error_code, created_at, updated_at
    FROM system_alerts
    WHERE status='open'
    ORDER BY created_at DESC
    LIMIT 50
  `,
  pendingWarnings: `
    SELECT warning_type, source_key, delivery_attempts, last_error_code, created_at, updated_at
    FROM sync_warning_outbox
    WHERE status='pending'
    ORDER BY updated_at DESC
    LIMIT 50
  `,
  recentRuns: `
    SELECT
      customer_profile,
      platform,
      account_key,
      sync_type,
      status,
      started_at,
      finished_at,
      records_pulled,
      records_written,
      retry_count,
      error_code
    FROM sync_runs
    ORDER BY COALESCE(started_at, created_at) DESC
    LIMIT ${MAX_RUN_ROWS}
  `,
  latestCoverage: `
    WITH ranked AS (
      SELECT
        customer_key,
        platform,
        account_key,
        dataset_key,
        scope_mode,
        period_start,
        period_end,
        status,
        expected_entities,
        observed_entities,
        expected_rows,
        observed_rows,
        written_rows,
        failed_rows,
        source_watermark,
        started_at,
        completed_at,
        error_code,
        ROW_NUMBER() OVER (
          PARTITION BY customer_key, platform, account_key, dataset_key
          ORDER BY COALESCE(completed_at, started_at) DESC, updated_at DESC
        ) AS rank_number
      FROM data_coverage_runs
    )
    SELECT
      customer_key,
      platform,
      account_key,
      dataset_key,
      scope_mode,
      period_start,
      period_end,
      status,
      expected_entities,
      observed_entities,
      expected_rows,
      observed_rows,
      written_rows,
      failed_rows,
      source_watermark,
      started_at,
      completed_at,
      error_code
    FROM ranked
    WHERE rank_number=1
    ORDER BY platform, account_key, dataset_key
    LIMIT ${MAX_COVERAGE_ROWS}
  `,
  latestReports: `
    WITH ranked AS (
      SELECT
        customer_key,
        platform_scope,
        account_key,
        report_type,
        period_kind,
        period_start,
        period_end,
        data_status,
        coverage_rate,
        source_watermark,
        generated_at,
        expires_at,
        ROW_NUMBER() OVER (
          PARTITION BY customer_key, platform_scope, account_key, report_type, period_kind
          ORDER BY generated_at DESC, updated_at DESC
        ) AS rank_number
      FROM report_materializations
    )
    SELECT
      customer_key,
      platform_scope,
      account_key,
      report_type,
      period_kind,
      period_start,
      period_end,
      data_status,
      coverage_rate,
      source_watermark,
      generated_at,
      expires_at
    FROM ranked
    WHERE rank_number=1
    ORDER BY generated_at DESC
    LIMIT ${MAX_REPORT_ROWS}
  `,
});

const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) {
    throw auditError('Unsupported argument', 'INTERNAL_RUNTIME_AUDIT_ARGUMENT_INVALID');
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      status: 'INTERNAL_RUNTIME_READONLY_AUDIT_PLAN',
      targetDatabase: TARGET_DATABASE,
      defaultConfig: DEFAULT_CONFIG,
      providerReads: 0,
      d1Writes: 0,
      larkReads: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
      nextCommand: `CONFIRM_INTERNAL_RUNTIME_READONLY_AUDIT=${CONFIRMATION} node scripts/internal-runtime-readonly-audit.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_INTERNAL_RUNTIME_READONLY_AUDIT !== CONFIRMATION) {
    throw auditError('Confirmation is missing', 'INTERNAL_RUNTIME_AUDIT_CONFIRMATION_REQUIRED');
  }

  assertReviewedMain();
  const root = resolve(process.cwd());
  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, DEFAULT_CONFIG));
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const binding = (config.d1_databases ?? []).find((entry) => entry.binding === TARGET_BINDING);
  if (!binding || binding.database_name !== TARGET_DATABASE) {
    throw auditError('Wrangler config is not the internal DEV D1 target', 'INTERNAL_RUNTIME_AUDIT_TARGET_INVALID', {
      bindingFound: Boolean(binding),
      databaseName: binding?.database_name ?? null,
    });
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = buildWranglerOAuthEnvironment(Object.freeze({ ...fileEnv, ...process.env }));
  const results = {};
  let databaseBytes = 0;
  const queryDurationMs = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    assertReadOnlySql(sql, name);
    const query = runD1(env, configPath, sql);
    results[name] = query.rows;
    databaseBytes = Math.max(databaseBytes, query.databaseBytes);
    queryDurationMs[name] = query.queryDurationMs;
  }

  const latestWorkByCursor = results.latestWorkByCursor.map(normalizeWorkRow);
  const activeWork = latestWorkByCursor.filter((row) => row.lifecycleStatus === 'active');
  const terminalWork = latestWorkByCursor.filter((row) => row.lifecycleStatus === 'terminal');
  const staleFenceCandidates = latestWorkByCursor.filter((row) => row.currentFence === false);
  const coverageProblems = results.latestCoverage.filter((row) => !['complete', 'no_data_confirmed'].includes(row.status));
  const reportProblems = results.latestReports.filter((row) => !['complete', 'no_data_confirmed'].includes(row.data_status));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'INTERNAL_RUNTIME_READONLY_AUDIT',
    observedAt: new Date().toISOString(),
    target: {
      database: TARGET_DATABASE,
      binding: TARGET_BINDING,
      configFile: DEFAULT_CONFIG,
    },
    databaseBytes,
    work: {
      lifecycleCounts: results.lifecycleCounts.map((row) => ({ status: row.lifecycle_status, count: Number(row.count) })),
      latestByCursor: latestWorkByCursor,
      activeLatestCursorCount: activeWork.length,
      terminalLatestCursorCount: terminalWork.length,
      nonCurrentLatestCursorCount: staleFenceCandidates.length,
      incompletePhases: results.incompletePhases.map((row) => ({
        phase: row.phase,
        incompleteWorkCount: Number(row.incomplete_work_count),
        remainingItems: Number(row.remaining_items ?? 0),
        latestUpdatedAt: nullableNumber(row.latest_updated_at),
      })),
      activeLocks: results.activeLocks.map((row) => ({
        lockKey: row.lock_key,
        acquiredAt: nullableNumber(row.acquired_at),
        expiresAt: nullableNumber(row.expires_at),
        updatedAt: nullableNumber(row.updated_at),
      })),
    },
    reliability: {
      dlqCounts: results.dlqCounts.map((row) => ({
        status: row.status,
        count: Number(row.count),
        latestUpdatedAt: nullableNumber(row.latest_updated_at),
      })),
      openAlerts: results.openAlerts.map((row) => ({
        severity: row.severity,
        platform: row.platform,
        alertType: row.alert_type,
        errorCode: row.error_code ?? null,
        createdAt: nullableNumber(row.created_at),
        updatedAt: nullableNumber(row.updated_at),
      })),
      pendingWarnings: results.pendingWarnings.map((row) => ({
        warningType: row.warning_type,
        sourceKey: row.source_key,
        deliveryAttempts: Number(row.delivery_attempts ?? 0),
        lastErrorCode: row.last_error_code ?? null,
        createdAt: nullableNumber(row.created_at),
        updatedAt: nullableNumber(row.updated_at),
      })),
      recentRuns: results.recentRuns.map((row) => ({
        customerProfile: row.customer_profile ?? null,
        platform: row.platform,
        accountKey: row.account_key ?? null,
        syncType: row.sync_type,
        status: row.status,
        startedAt: nullableNumber(row.started_at),
        finishedAt: nullableNumber(row.finished_at),
        recordsPulled: Number(row.records_pulled ?? 0),
        recordsWritten: Number(row.records_written ?? 0),
        retryCount: Number(row.retry_count ?? 0),
        errorCode: row.error_code ?? null,
      })),
    },
    freshness: {
      latestCoverage: results.latestCoverage.map(normalizeCoverageRow),
      problematicCoverageCount: coverageProblems.length,
      latestReports: results.latestReports.map(normalizeReportRow),
      problematicReportCount: reportProblems.length,
    },
    queryDurationMs,
    providerReads: 0,
    d1Writes: 0,
    larkReads: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'INTERNAL_RUNTIME_READONLY_AUDIT_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    providerReads: 0,
    d1Writes: 0,
    larkReads: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runD1(env, configPath, sql) {
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', TARGET_DATABASE,
    '--remote', '--json', '--config', configPath, '--command', sql,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw auditError('Wrangler D1 read failed', 'INTERNAL_RUNTIME_AUDIT_D1_FAILED', {
      exitCode: result.status ?? null,
    });
  }
  const value = parseWranglerJsonSuffix(result.stdout);
  const envelopes = Array.isArray(value) ? value : [value];
  if (envelopes.length === 0 || envelopes.some((item) => item?.success === false)) {
    throw auditError('D1 query reported failure', 'INTERNAL_RUNTIME_AUDIT_D1_RESPONSE_FAILED');
  }
  return Object.freeze({
    rows: Object.freeze(envelopes.flatMap((item) => item?.results ?? [])),
    databaseBytes: Math.max(0, ...envelopes.map((item) => Number(item?.meta?.size_after ?? 0))),
    queryDurationMs: envelopes.reduce((sum, item) => sum + Number(item?.meta?.timings?.sql_duration_ms ?? 0), 0),
  });
}

function assertReadOnlySql(sql, name) {
  const text = String(sql).trim();
  if (!/^(?:SELECT|WITH)\b/iu.test(text)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA|ATTACH|DETACH)\b/iu.test(text)) {
    throw auditError('Audit query is not read-only', 'INTERNAL_RUNTIME_AUDIT_SQL_INVALID', { name });
  }
}

function normalizeWorkRow(row) {
  return Object.freeze({
    cursorKey: row.cursor_key,
    workType: row.work_type,
    lifecycleStatus: row.lifecycle_status,
    terminalReason: row.terminal_reason ?? null,
    generation: nullableNumber(row.generation),
    requestedAt: nullableNumber(row.requested_at),
    completedAt: nullableNumber(row.completed_at),
    updatedAt: nullableNumber(row.updated_at),
    currentFence: Number(row.current_fence) === 1,
    activeLockCount: Number(row.active_lock_count ?? 0),
  });
}

function normalizeCoverageRow(row) {
  return Object.freeze({
    customerKey: row.customer_key,
    platform: row.platform,
    accountKey: row.account_key,
    datasetKey: row.dataset_key,
    scopeMode: row.scope_mode,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    status: row.status,
    expectedEntities: nullableNumber(row.expected_entities),
    observedEntities: nullableNumber(row.observed_entities),
    expectedRows: nullableNumber(row.expected_rows),
    observedRows: nullableNumber(row.observed_rows),
    writtenRows: nullableNumber(row.written_rows),
    failedRows: Number(row.failed_rows ?? 0),
    sourceWatermark: row.source_watermark ?? null,
    startedAt: nullableNumber(row.started_at),
    completedAt: nullableNumber(row.completed_at),
    errorCode: row.error_code ?? null,
  });
}

function normalizeReportRow(row) {
  return Object.freeze({
    customerKey: row.customer_key,
    platformScope: row.platform_scope,
    accountKey: row.account_key,
    reportType: row.report_type,
    periodKind: row.period_kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dataStatus: row.data_status,
    coverageRate: row.coverage_rate === null || row.coverage_rate === undefined ? null : Number(row.coverage_rate),
    sourceWatermark: row.source_watermark ?? null,
    generatedAt: nullableNumber(row.generated_at),
    expiresAt: nullableNumber(row.expires_at),
  });
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseWranglerJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0
    ? Math.max(...starts)
    : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) {
    throw auditError('Wrangler D1 output has no JSON result', 'INTERNAL_RUNTIME_AUDIT_D1_JSON_INVALID');
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw auditError('Wrangler D1 output JSON is invalid', 'INTERNAL_RUNTIME_AUDIT_D1_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw auditError('Exact reviewed clean main is required', 'INTERNAL_RUNTIME_AUDIT_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw auditError('git preflight failed', 'INTERNAL_RUNTIME_AUDIT_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw auditError('git preflight returned empty output', 'INTERNAL_RUNTIME_AUDIT_GIT_FAILED');
  return value;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
