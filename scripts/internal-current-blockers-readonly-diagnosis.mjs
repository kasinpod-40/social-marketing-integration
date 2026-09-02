#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const CONFIRMATION = 'DIAGNOSE_INTERNAL_CURRENT_BLOCKERS_READONLY';
const CONFIGURED_DATABASE_NAME = 'social-mkt-state-dev';
const TARGET_BINDING = 'MKT_STATE_DB';
const DEFAULT_CONFIG = 'wrangler.sync.jsonc';
const REQUIRED_SCHEMA = Object.freeze([
  'd1_migrations',
  'sync_generation_fences',
  'sync_locks',
  'sync_runs',
  'sync_work_phases',
  'sync_work_runs',
]);
const TARGET_CURSORS = Object.freeze([
  'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k2',
  'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k3',
  'chatwoot:chemistry_k:analytics',
  'chemistry_k:youtube:chemistry_k:organic_sync',
  'chemistry_k:google_ads:chemistry_k:paid_ads_delivery',
  'chemistry_k:facebook:chemistry_k:scheduled_end_to_end',
]);
const TARGET_PLATFORMS = Object.freeze(['meta_ads', 'chatwoot', 'youtube', 'google_ads', 'facebook']);

const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) {
    throw diagnosisError('Unsupported argument', 'INTERNAL_BLOCKER_DIAG_ARGUMENT_INVALID');
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      status: 'INTERNAL_CURRENT_BLOCKERS_READONLY_DIAGNOSIS_PLAN',
      configuredDatabaseName: CONFIGURED_DATABASE_NAME,
      targetCursorCount: TARGET_CURSORS.length,
      targetPlatforms: TARGET_PLATFORMS,
      payloadReads: 0,
      providerReads: 0,
      d1Writes: 0,
      larkReads: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
      persistentConfigWrites: 0,
      nextCommand: `CONFIRM_INTERNAL_CURRENT_BLOCKERS_READONLY=${CONFIRMATION} node scripts/internal-current-blockers-readonly-diagnosis.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_INTERNAL_CURRENT_BLOCKERS_READONLY !== CONFIRMATION) {
    throw diagnosisError('Confirmation is missing', 'INTERNAL_BLOCKER_DIAG_CONFIRMATION_REQUIRED');
  }

  assertReviewedMain();
  const root = resolve(process.cwd());
  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, DEFAULT_CONFIG));
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const bindingIndex = (config.d1_databases ?? []).findIndex((entry) => entry.binding === TARGET_BINDING);
  const binding = bindingIndex >= 0 ? config.d1_databases[bindingIndex] : null;
  if (!binding || binding.database_name !== CONFIGURED_DATABASE_NAME) {
    throw diagnosisError('Wrangler config is not the reviewed internal binding', 'INTERNAL_BLOCKER_DIAG_TARGET_INVALID', {
      bindingFound: Boolean(binding),
      configuredDatabaseName: binding?.database_name ?? null,
    });
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = buildWranglerOAuthEnvironment(Object.freeze({ ...fileEnv, ...process.env }));
  const databases = listDatabases(env, configPath);
  const exactMatches = databases.filter((item) => item?.name === CONFIGURED_DATABASE_NAME);
  let candidate = null;
  let resolutionMode = null;
  if (exactMatches.length === 1) {
    candidate = exactMatches[0];
    resolutionMode = 'wrangler-d1-list-exact-name';
  } else if (exactMatches.length === 0 && databases.length === 1) {
    candidate = databases[0];
    resolutionMode = 'wrangler-d1-list-sole-schema-fingerprint';
  } else {
    throw diagnosisError('Internal D1 candidate is ambiguous', 'INTERNAL_BLOCKER_DIAG_D1_AMBIGUOUS', {
      exactNameMatchCount: exactMatches.length,
      listedDatabaseCount: databases.length,
    });
  }

  const resolvedId = String(candidate?.uuid ?? candidate?.id ?? '').trim();
  const resolvedDatabaseName = String(candidate?.name ?? '').trim();
  if (!isUuid(resolvedId) || !resolvedDatabaseName) {
    throw diagnosisError('Resolved D1 candidate metadata is invalid', 'INTERNAL_BLOCKER_DIAG_D1_METADATA_INVALID');
  }

  const tempConfigPath = resolve(root, `.tmp-internal-current-blockers-${process.pid}.jsonc`);
  const tempConfig = structuredClone(config);
  tempConfig.d1_databases[bindingIndex] = {
    ...tempConfig.d1_databases[bindingIndex],
    database_id: resolvedId,
  };

  try {
    await writeFile(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, { mode: 0o600 });
    await chmod(tempConfigPath, 0o600);

    const schemaRows = runReadOnlyQuery(env, tempConfigPath, `
      SELECT name
      FROM sqlite_master
      WHERE type='table'
        AND name IN (${REQUIRED_SCHEMA.map(sqlString).join(', ')})
      ORDER BY name
    `, 'schemaFingerprint');
    const observedSchema = new Set(schemaRows.map((row) => row.name));
    const missingSchema = REQUIRED_SCHEMA.filter((name) => !observedSchema.has(name));
    if (missingSchema.length > 0) {
      throw diagnosisError('Sole D1 candidate does not match the internal runtime schema', 'INTERNAL_BLOCKER_DIAG_SCHEMA_MISMATCH', {
        requiredTableCount: REQUIRED_SCHEMA.length,
        matchedTableCount: REQUIRED_SCHEMA.length - missingSchema.length,
        missingTables: missingSchema,
      });
    }

    const cursorSql = TARGET_CURSORS.map(sqlString).join(', ');
    const platformSql = TARGET_PLATFORMS.map(sqlString).join(', ');
    const currentWorkPhases = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        r.cursor_key,
        r.work_type,
        r.lifecycle_status,
        r.terminal_reason,
        r.generation,
        r.requested_at,
        r.completed_at,
        r.updated_at AS work_updated_at,
        CASE WHEN f.work_key=r.work_key AND f.generation=r.generation THEN 1 ELSE 0 END AS current_fence,
        (
          SELECT COUNT(*)
          FROM sync_locks AS lock
          WHERE lock.lock_key=r.cursor_key
            AND lock.expires_at>unixepoch()*1000
        ) AS active_lock_count,
        p.phase,
        p.expected_items,
        p.processed_items,
        p.pages_processed,
        p.chunks_processed,
        p.complete,
        p.updated_at AS phase_updated_at,
        CASE WHEN json_valid(p.state_json) THEN json_extract(p.state_json, '$.stage') ELSE NULL END AS state_stage,
        CASE WHEN json_valid(p.state_json) THEN json_extract(p.state_json, '$.status') ELSE NULL END AS state_status,
        CASE WHEN json_valid(p.state_json) THEN COALESCE(json_extract(p.state_json, '$.errorCode'), json_extract(p.state_json, '$.code')) ELSE NULL END AS state_code
      FROM sync_generation_fences AS f
      JOIN sync_work_runs AS r
        ON r.work_key=f.work_key
       AND r.generation=f.generation
      LEFT JOIN sync_work_phases AS p
        ON p.work_key=r.work_key
      WHERE f.cursor_key IN (${cursorSql})
      ORDER BY r.cursor_key, p.updated_at, p.phase
    `, 'currentWorkPhases');

    const recentNonReportRuns = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        platform,
        sync_type,
        status,
        started_at,
        finished_at,
        records_pulled,
        records_written,
        retry_count,
        error_code
      FROM sync_runs
      WHERE customer_profile='chemistry_k'
        AND platform IN (${platformSql})
        AND sync_type<>'dashboard_performance_report'
      ORDER BY COALESCE(started_at, created_at) DESC
      LIMIT 100
    `, 'recentNonReportRuns');

    const dlqBuckets = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        status,
        job_type,
        error_code,
        COUNT(*) AS item_count,
        MIN(created_at) AS oldest_created_at,
        MAX(created_at) AS newest_created_at,
        MAX(retry_count) AS max_retry_count
      FROM dead_letter_jobs
      WHERE status IN ('open', 'redrive_pending')
      GROUP BY status, job_type, error_code
      ORDER BY item_count DESC, newest_created_at DESC
      LIMIT 80
    `, 'dlqBuckets');

    const alertBuckets = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        severity,
        platform,
        alert_type,
        error_code,
        COUNT(*) AS alert_count,
        MAX(created_at) AS newest_created_at
      FROM system_alerts
      WHERE status='open'
        AND platform IN ('meta_ads', 'chatwoot', 'youtube', 'google_ads', 'facebook', 'system')
      GROUP BY severity, platform, alert_type, error_code
      ORDER BY alert_count DESC, newest_created_at DESC
      LIMIT 80
    `, 'alertBuckets');

    const stagedUnitMetadata = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        r.cursor_key,
        r.lifecycle_status,
        COUNT(*) AS unit_count,
        COUNT(DISTINCT u.work_key) AS work_count,
        MIN(u.created_at) AS oldest_created_at,
        MAX(u.updated_at) AS newest_updated_at
      FROM sync_work_units AS u
      JOIN sync_work_runs AS r ON r.work_key=u.work_key
      GROUP BY r.cursor_key, r.lifecycle_status
      ORDER BY unit_count DESC
      LIMIT 80
    `, 'stagedUnitMetadata');

    const dlqRetention = runReadOnlyQuery(env, tempConfigPath, `
      SELECT
        status,
        COUNT(*) AS item_count,
        SUM(CASE WHEN created_at < (unixepoch()-7*86400)*1000 THEN 1 ELSE 0 END) AS older_than_7d,
        SUM(CASE WHEN created_at < (unixepoch()-14*86400)*1000 THEN 1 ELSE 0 END) AS older_than_14d,
        MIN(created_at) AS oldest_created_at,
        MAX(created_at) AS newest_created_at
      FROM dead_letter_jobs
      GROUP BY status
      ORDER BY status
    `, 'dlqRetention');

    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'INTERNAL_CURRENT_BLOCKERS_READONLY_DIAGNOSIS',
      observedAt: new Date().toISOString(),
      resolution: {
        mode: resolutionMode,
        listedDatabaseCount: databases.length,
        exactNameMatchCount: exactMatches.length,
        resolvedDatabaseName,
        databaseNameRenamed: resolvedDatabaseName !== CONFIGURED_DATABASE_NAME,
        configuredDatabaseIdStale: String(binding.database_id ?? '').trim() !== resolvedId,
        schemaFingerprintMatched: true,
        schemaFingerprintTableCount: REQUIRED_SCHEMA.length,
        temporaryConfigUsed: true,
        persistentConfigChanged: false,
      },
      blockers: summarizeBlockers(currentWorkPhases),
      currentWorkPhases: currentWorkPhases.map(normalizeCurrentPhase),
      recentNonReportRuns: recentNonReportRuns.map(normalizeRun),
      dlqBuckets: dlqBuckets.map(normalizeDlqBucket),
      alertBuckets: alertBuckets.map(normalizeAlertBucket),
      capacityMetadata: {
        stagedUnitsByCursorLifecycle: stagedUnitMetadata.map(normalizeUnitMetadata),
        dlqRetention: dlqRetention.map(normalizeDlqRetention),
      },
      payloadReads: 0,
      providerReads: 0,
      d1Writes: 0,
      larkReads: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
      persistentConfigWrites: 0,
    }, null, 2)}\n`);
  } finally {
    await rm(tempConfigPath, { force: true });
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'INTERNAL_CURRENT_BLOCKERS_READONLY_DIAGNOSIS_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    payloadReads: 0,
    providerReads: 0,
    d1Writes: 0,
    larkReads: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
    persistentConfigWrites: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function listDatabases(env, configPath) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'list', '--json', '--config', configPath], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw diagnosisError('Wrangler D1 list failed', 'INTERNAL_BLOCKER_DIAG_D1_LIST_FAILED', {
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  const value = parseJsonSuffix(result.stdout);
  if (!Array.isArray(value)) {
    throw diagnosisError('Wrangler D1 list output is not an array', 'INTERNAL_BLOCKER_DIAG_D1_LIST_INVALID');
  }
  return value;
}

function runReadOnlyQuery(env, configPath, sql, queryName) {
  assertReadOnlySql(sql, queryName);
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', CONFIGURED_DATABASE_NAME,
    '--remote', '--json', '--config', configPath, '--command', sql,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw diagnosisError('Wrangler D1 read failed', 'INTERNAL_BLOCKER_DIAG_D1_QUERY_FAILED', {
      queryName,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  const value = parseJsonSuffix(result.stdout);
  const envelopes = Array.isArray(value) ? value : [value];
  if (envelopes.length === 0 || envelopes.some((item) => item?.success === false)) {
    throw diagnosisError('D1 query reported failure', 'INTERNAL_BLOCKER_DIAG_D1_RESPONSE_FAILED', { queryName });
  }
  return envelopes.flatMap((item) => item?.results ?? []);
}

function assertReadOnlySql(sql, queryName) {
  const text = String(sql).trim();
  if (!/^(?:SELECT|WITH)\b/iu.test(text)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA|ATTACH|DETACH)\b/iu.test(text)) {
    throw diagnosisError('Diagnosis query is not read-only', 'INTERNAL_BLOCKER_DIAG_SQL_INVALID', { queryName });
  }
}

function summarizeBlockers(rows) {
  const byCursor = new Map();
  for (const row of rows) {
    if (!byCursor.has(row.cursor_key)) {
      byCursor.set(row.cursor_key, {
        cursorKey: row.cursor_key,
        workType: row.work_type,
        lifecycleStatus: row.lifecycle_status,
        terminalReason: row.terminal_reason ?? null,
        generation: nullableNumber(row.generation),
        requestedAt: nullableNumber(row.requested_at),
        workUpdatedAt: nullableNumber(row.work_updated_at),
        currentFence: Number(row.current_fence) === 1,
        activeLockCount: Number(row.active_lock_count ?? 0),
        phaseCount: 0,
        incompletePhaseCount: 0,
        remainingItems: 0,
        latestPhaseUpdatedAt: null,
      });
    }
    if (!row.phase) continue;
    const item = byCursor.get(row.cursor_key);
    item.phaseCount += 1;
    if (Number(row.complete) !== 1) {
      item.incompletePhaseCount += 1;
      item.remainingItems += Math.max(0, Number(row.expected_items ?? 0) - Number(row.processed_items ?? 0));
    }
    const updated = nullableNumber(row.phase_updated_at);
    if (updated !== null && (item.latestPhaseUpdatedAt === null || updated > item.latestPhaseUpdatedAt)) {
      item.latestPhaseUpdatedAt = updated;
    }
  }
  return Array.from(byCursor.values());
}

function normalizeCurrentPhase(row) {
  return {
    cursorKey: row.cursor_key,
    workType: row.work_type,
    lifecycleStatus: row.lifecycle_status,
    terminalReason: row.terminal_reason ?? null,
    generation: nullableNumber(row.generation),
    requestedAt: nullableNumber(row.requested_at),
    completedAt: nullableNumber(row.completed_at),
    workUpdatedAt: nullableNumber(row.work_updated_at),
    currentFence: Number(row.current_fence) === 1,
    activeLockCount: Number(row.active_lock_count ?? 0),
    phase: row.phase ?? null,
    expectedItems: nullableNumber(row.expected_items),
    processedItems: nullableNumber(row.processed_items),
    pagesProcessed: nullableNumber(row.pages_processed),
    chunksProcessed: nullableNumber(row.chunks_processed),
    complete: Number(row.complete ?? 0) === 1,
    phaseUpdatedAt: nullableNumber(row.phase_updated_at),
    stateStage: row.state_stage ?? null,
    stateStatus: row.state_status ?? null,
    stateCode: row.state_code ?? null,
  };
}

function normalizeRun(row) {
  return {
    platform: row.platform,
    syncType: row.sync_type,
    status: row.status,
    startedAt: nullableNumber(row.started_at),
    finishedAt: nullableNumber(row.finished_at),
    recordsPulled: Number(row.records_pulled ?? 0),
    recordsWritten: Number(row.records_written ?? 0),
    retryCount: Number(row.retry_count ?? 0),
    errorCode: row.error_code ?? null,
  };
}

function normalizeDlqBucket(row) {
  return {
    status: row.status,
    jobType: row.job_type ?? null,
    errorCode: row.error_code ?? null,
    itemCount: Number(row.item_count ?? 0),
    oldestCreatedAt: nullableNumber(row.oldest_created_at),
    newestCreatedAt: nullableNumber(row.newest_created_at),
    maxRetryCount: Number(row.max_retry_count ?? 0),
  };
}

function normalizeAlertBucket(row) {
  return {
    severity: row.severity,
    platform: row.platform,
    alertType: row.alert_type,
    errorCode: row.error_code ?? null,
    alertCount: Number(row.alert_count ?? 0),
    newestCreatedAt: nullableNumber(row.newest_created_at),
  };
}

function normalizeUnitMetadata(row) {
  return {
    cursorKey: row.cursor_key,
    lifecycleStatus: row.lifecycle_status,
    unitCount: Number(row.unit_count ?? 0),
    workCount: Number(row.work_count ?? 0),
    oldestCreatedAt: nullableNumber(row.oldest_created_at),
    newestUpdatedAt: nullableNumber(row.newest_updated_at),
  };
}

function normalizeDlqRetention(row) {
  return {
    status: row.status,
    itemCount: Number(row.item_count ?? 0),
    olderThan7d: Number(row.older_than_7d ?? 0),
    olderThan14d: Number(row.older_than_14d ?? 0),
    oldestCreatedAt: nullableNumber(row.oldest_created_at),
    newestCreatedAt: nullableNumber(row.newest_created_at),
  };
}

function parseJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0
    ? Math.max(...starts)
    : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw diagnosisError('Wrangler output has no JSON result', 'INTERNAL_BLOCKER_DIAG_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw diagnosisError('Wrangler output JSON is invalid', 'INTERNAL_BLOCKER_DIAG_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw diagnosisError('Exact reviewed clean main is required', 'INTERNAL_BLOCKER_DIAG_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw diagnosisError('git preflight failed', 'INTERNAL_BLOCKER_DIAG_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw diagnosisError('git preflight returned empty output', 'INTERNAL_BLOCKER_DIAG_GIT_FAILED');
  return value;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeText(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:token|secret|authorization)\s*[:=]\s*[^\s,}\]]+/giu, '$1=[REDACTED]')
    .slice(0, 6000);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|databaseId|uuid/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function diagnosisError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
