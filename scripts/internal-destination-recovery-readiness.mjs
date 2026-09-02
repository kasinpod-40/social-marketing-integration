#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { loadCustomerRuntimeConfig } from '../packages/config/src/customer-profiles.js';
import { LARK_TABLE_ENV } from '../packages/config/src/lark-table-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

const CONFIRMATION = 'VERIFY_INTERNAL_DESTINATION_RECOVERY_READINESS_READONLY';
const CONFIGURED_DATABASE_NAME = 'social-mkt-state-dev';
const TARGET_BINDING = 'MKT_STATE_DB';
const DEFAULT_CONFIG = 'wrangler.sync.jsonc';
const REQUIRED_SCHEMA = Object.freeze([
  'd1_migrations',
  'dead_letter_jobs',
  'sync_generation_fences',
  'sync_locks',
  'sync_work_phases',
  'sync_work_runs',
]);
const TARGETS = Object.freeze([
  Object.freeze({
    key: 'facebook',
    cursorKey: 'chemistry_k:facebook:chemistry_k:scheduled_end_to_end',
    workType: 'facebook.page.organic.sync',
    terminalReason: 'QUEUE_RETRY_EXHAUSTED',
    requiredCompletePhases: Object.freeze([
      'meta_end_to_end_source_staging_v1',
      'meta_end_to_end_destination_preflight_v1',
      'meta_end_to_end_d1_write_v1',
    ]),
    requiredIncompletePhase: 'meta_end_to_end_lark_write_v1',
  }),
  Object.freeze({
    key: 'youtube',
    cursorKey: 'chemistry_k:youtube:chemistry_k:organic_sync',
    workType: 'youtube_organic_sync',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    requiredCompletePhases: Object.freeze([
      'youtube_content_inventory',
      'youtube_content_resources',
      'youtube_owner_analytics',
      'youtube_d1_storage_v1',
      'youtube_destination_content_v1',
    ]),
    requiredIncompletePhase: 'youtube_destination_daily_v1',
  }),
]);
const REQUIRED_LARK_TABLE_KEYS = Object.freeze([
  'mktAccounts',
  'mktContent',
  'mktContentDaily',
  'mktAccountDaily',
]);

const execute = process.argv.slice(2).includes('--execute');
let internalLarkReads = 0;
let exactQueueEnvelopeReads = 0;

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) {
    throw readinessError('Unsupported argument', 'INTERNAL_DESTINATION_READINESS_ARGUMENT_INVALID');
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      status: 'INTERNAL_DESTINATION_RECOVERY_READINESS_PLAN',
      targetCursors: TARGETS.map((item) => item.cursorKey),
      requiredRuntime: {
        environment: 'development',
        profileKey: 'integration_workspace',
        infrastructureOwner: 'developer',
      },
      providerReads: 0,
      d1Writes: 0,
      larkWrites: 0,
      queueSends: 0,
      customerBaseReads: 0,
      customerBaseWrites: 0,
      persistentConfigWrites: 0,
      nextCommand: `CONFIRM_INTERNAL_DESTINATION_RECOVERY_READINESS=${CONFIRMATION} node scripts/internal-destination-recovery-readiness.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_INTERNAL_DESTINATION_RECOVERY_READINESS !== CONFIRMATION) {
    throw readinessError('Confirmation is missing', 'INTERNAL_DESTINATION_READINESS_CONFIRMATION_REQUIRED');
  }

  assertReviewedMain();
  const root = resolve(process.cwd());
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const runtimeEnv = Object.freeze({ ...fileEnv, ...process.env });
  const runtime = assertInternalIntegrationRuntime(runtimeEnv);
  const larkIdentity = await verifyInternalLarkTarget(runtimeEnv);
  internalLarkReads += 1;

  const configPath = resolve(process.env.WRANGLER_CONFIG ?? resolve(root, DEFAULT_CONFIG));
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const bindingIndex = (config.d1_databases ?? []).findIndex((entry) => entry.binding === TARGET_BINDING);
  const binding = bindingIndex >= 0 ? config.d1_databases[bindingIndex] : null;
  if (!binding || binding.database_name !== CONFIGURED_DATABASE_NAME) {
    throw readinessError('Wrangler config is not the reviewed internal binding', 'INTERNAL_DESTINATION_READINESS_TARGET_INVALID', {
      bindingFound: Boolean(binding),
      configuredDatabaseName: binding?.database_name ?? null,
    });
  }

  const wranglerEnv = buildWranglerOAuthEnvironment(runtimeEnv);
  const databases = listDatabases(wranglerEnv, configPath);
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
    throw readinessError('Internal D1 candidate is ambiguous', 'INTERNAL_DESTINATION_READINESS_D1_AMBIGUOUS', {
      exactNameMatchCount: exactMatches.length,
      listedDatabaseCount: databases.length,
    });
  }

  const resolvedId = String(candidate?.uuid ?? candidate?.id ?? '').trim();
  const resolvedDatabaseName = String(candidate?.name ?? '').trim();
  if (!isUuid(resolvedId) || !resolvedDatabaseName) {
    throw readinessError('Resolved D1 candidate metadata is invalid', 'INTERNAL_DESTINATION_READINESS_D1_METADATA_INVALID');
  }

  const tempConfigPath = resolve(root, `.tmp-internal-destination-readiness-${process.pid}.jsonc`);
  const tempConfig = structuredClone(config);
  tempConfig.d1_databases[bindingIndex] = {
    ...tempConfig.d1_databases[bindingIndex],
    database_id: resolvedId,
  };

  try {
    await writeFile(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, { mode: 0o600 });
    await chmod(tempConfigPath, 0o600);

    assertSchemaFingerprint(wranglerEnv, tempConfigPath);
    const currentRows = readCurrentTargetRows(wranglerEnv, tempConfigPath);
    const targetReadiness = TARGETS.map((target) => validateTarget(target, currentRows));
    const envelopes = readExactQueueEnvelopeIdentities(wranglerEnv, tempConfigPath, targetReadiness);
    exactQueueEnvelopeReads = 1;
    const queueIdentityByWorkKey = new Map(envelopes.map((item) => [item.work_key, item]));

    const targets = targetReadiness.map((target) => {
      const envelope = queueIdentityByWorkKey.get(target.workKey) ?? null;
      return Object.freeze({
        ...target,
        durableQueueIdentity: envelope ? normalizeEnvelope(envelope) : null,
        durableQueueIdentityAvailable: Boolean(envelope),
        recoveryReady: target.phaseContractReady && Boolean(envelope),
      });
    });
    const recoveryReady = targets.every((item) => item.recoveryReady === true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'INTERNAL_DESTINATION_RECOVERY_READINESS',
      observedAt: new Date().toISOString(),
      recoveryReady,
      runtime: {
        environment: runtime.environment,
        profileKey: runtime.profileKey,
        requestedProfileKey: runtime.requestedProfileKey,
        infrastructureOwner: runtime.infrastructureOwner,
        dataMode: runtime.dataMode,
      },
      larkIdentity,
      d1Resolution: {
        mode: resolutionMode,
        listedDatabaseCount: databases.length,
        exactNameMatchCount: exactMatches.length,
        resolvedDatabaseName,
        databaseNameRenamed: resolvedDatabaseName !== CONFIGURED_DATABASE_NAME,
        configuredDatabaseIdStale: String(binding.database_id ?? '').trim() !== resolvedId,
        schemaFingerprintMatched: true,
        temporaryConfigUsed: true,
        persistentConfigChanged: false,
      },
      targets,
      businessPayloadReads: 0,
      exactQueueEnvelopeReads,
      providerReads: 0,
      d1Writes: 0,
      internalLarkReads,
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
    code: error?.code ?? 'INTERNAL_DESTINATION_RECOVERY_READINESS_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    businessPayloadReads: 0,
    exactQueueEnvelopeReads,
    providerReads: 0,
    d1Writes: 0,
    internalLarkReads,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
    persistentConfigWrites: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function assertInternalIntegrationRuntime(env) {
  if (env.MKT_ENV !== 'development' || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') {
    throw readinessError('Exact Integration Workspace runtime is required before any Lark read', 'INTERNAL_DESTINATION_READINESS_RUNTIME_INVALID', {
      environment: env.MKT_ENV ?? null,
      requestedProfileKey: env.MKT_CUSTOMER_PROFILE ?? null,
    });
  }
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'development'
    || runtime.profileKey !== 'integration_workspace'
    || runtime.requestedProfileKey !== 'integration_workspace'
    || runtime.infrastructureOwner !== 'developer'
    || runtime.dataMode !== 'integration_workspace_mixed_sources') {
    throw readinessError('Runtime ownership contract is not the developer Integration Workspace', 'INTERNAL_DESTINATION_READINESS_RUNTIME_OWNERSHIP_INVALID', {
      environment: runtime.environment,
      profileKey: runtime.profileKey,
      requestedProfileKey: runtime.requestedProfileKey,
      infrastructureOwner: runtime.infrastructureOwner,
      dataMode: runtime.dataMode,
    });
  }
  return runtime;
}

async function verifyInternalLarkTarget(env) {
  const expected = REQUIRED_LARK_TABLE_KEYS.map((key) => {
    const envName = LARK_TABLE_ENV[key];
    const tableId = String(env?.[envName] ?? '').trim();
    if (!tableId) {
      throw readinessError('Integration Workspace table identity is incomplete', 'INTERNAL_DESTINATION_READINESS_LARK_TABLE_CONFIG_MISSING', {
        tableKey: key,
        envName,
      });
    }
    return Object.freeze({ key, tableId });
  });
  const client = createLarkBitableClientFromEnv(env);
  const tables = await client.listTables();
  const observedIds = new Set(tables.map((table) => String(table?.tableId ?? '').trim()).filter(Boolean));
  const missing = expected.filter((item) => !observedIds.has(item.tableId)).map((item) => item.key);
  if (missing.length > 0) {
    throw readinessError('Configured Integration Workspace table IDs do not belong to the configured Lark Base', 'INTERNAL_DESTINATION_READINESS_LARK_IDENTITY_MISMATCH', {
      requiredTableCount: expected.length,
      matchedTableCount: expected.length - missing.length,
      missingLogicalTables: missing,
    });
  }
  const digest = createHash('sha256')
    .update(tables.map((table) => `${table.tableId}:${table.name ?? ''}`).sort().join('\n'))
    .digest('hex');
  return Object.freeze({
    verified: true,
    authority: 'developer',
    profileKey: 'integration_workspace',
    tableCount: tables.length,
    requiredLogicalTables: REQUIRED_LARK_TABLE_KEYS,
    matchedRequiredTableCount: expected.length,
    tableInventorySha256: digest,
  });
}

function assertSchemaFingerprint(env, configPath) {
  const rows = runReadOnlyQuery(env, configPath, `
    SELECT name
    FROM sqlite_master
    WHERE type='table'
      AND name IN (${REQUIRED_SCHEMA.map(sqlString).join(', ')})
    ORDER BY name
  `, 'schemaFingerprint');
  const observed = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_SCHEMA.filter((name) => !observed.has(name));
  if (missing.length > 0) {
    throw readinessError('D1 candidate does not match the internal runtime schema', 'INTERNAL_DESTINATION_READINESS_SCHEMA_MISMATCH', {
      requiredTableCount: REQUIRED_SCHEMA.length,
      matchedTableCount: REQUIRED_SCHEMA.length - missing.length,
      missingTables: missing,
    });
  }
}

function readCurrentTargetRows(env, configPath) {
  const cursors = TARGETS.map((item) => sqlString(item.cursorKey)).join(', ');
  return runReadOnlyQuery(env, configPath, `
    SELECT
      r.work_key,
      r.cursor_key,
      r.work_type,
      r.operation_fingerprint,
      r.lifecycle_status,
      r.terminal_reason,
      r.generation,
      r.requested_at,
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
      p.complete,
      p.updated_at AS phase_updated_at,
      CASE WHEN json_valid(p.state_json) THEN json_extract(p.state_json, '$.stage') ELSE NULL END AS state_stage
    FROM sync_generation_fences AS f
    JOIN sync_work_runs AS r
      ON r.work_key=f.work_key
     AND r.generation=f.generation
    LEFT JOIN sync_work_phases AS p ON p.work_key=r.work_key
    WHERE f.cursor_key IN (${cursors})
    ORDER BY r.cursor_key, p.updated_at, p.phase
  `, 'currentTargetRows');
}

function validateTarget(target, rows) {
  const selected = rows.filter((row) => row.cursor_key === target.cursorKey);
  if (selected.length === 0) {
    throw readinessError('Current target Work is missing', 'INTERNAL_DESTINATION_READINESS_WORK_MISSING', { target: target.key });
  }
  const head = selected[0];
  if (head.work_type !== target.workType
    || head.lifecycle_status !== 'terminal'
    || head.terminal_reason !== target.terminalReason
    || Number(head.current_fence) !== 1
    || Number(head.active_lock_count ?? 0) !== 0) {
    throw readinessError('Current target Work is not in the reviewed recovery lifecycle', 'INTERNAL_DESTINATION_READINESS_WORK_STATE_INVALID', {
      target: target.key,
      workType: head.work_type,
      lifecycleStatus: head.lifecycle_status,
      terminalReason: head.terminal_reason ?? null,
      currentFence: Number(head.current_fence) === 1,
      activeLockCount: Number(head.active_lock_count ?? 0),
    });
  }
  const phases = new Map(selected.filter((row) => row.phase).map((row) => [row.phase, row]));
  for (const phaseName of target.requiredCompletePhases) {
    const phase = phases.get(phaseName);
    if (!phase || Number(phase.complete) !== 1 || Number(phase.processed_items) !== Number(phase.expected_items)) {
      throw readinessError('Required retained phase is not complete', 'INTERNAL_DESTINATION_READINESS_PHASE_INVALID', {
        target: target.key,
        phase: phaseName,
        expectedItems: nullableNumber(phase?.expected_items),
        processedItems: nullableNumber(phase?.processed_items),
        complete: Number(phase?.complete ?? 0) === 1,
      });
    }
  }
  const incomplete = phases.get(target.requiredIncompletePhase);
  if (!incomplete
    || Number(incomplete.complete) === 1
    || Number(incomplete.processed_items) >= Number(incomplete.expected_items)) {
    throw readinessError('Expected destination continuation phase is not incomplete', 'INTERNAL_DESTINATION_READINESS_DESTINATION_PHASE_INVALID', {
      target: target.key,
      phase: target.requiredIncompletePhase,
      expectedItems: nullableNumber(incomplete?.expected_items),
      processedItems: nullableNumber(incomplete?.processed_items),
      complete: Number(incomplete?.complete ?? 0) === 1,
    });
  }
  return Object.freeze({
    target: target.key,
    cursorKey: target.cursorKey,
    workKey: head.work_key,
    workType: head.work_type,
    generation: Number(head.generation),
    requestedAt: Number(head.requested_at),
    operationFingerprint: head.operation_fingerprint,
    lifecycleStatus: head.lifecycle_status,
    terminalReason: head.terminal_reason,
    currentFence: true,
    activeLockCount: 0,
    phaseContractReady: true,
    continuationPhase: target.requiredIncompletePhase,
    expectedItems: Number(incomplete.expected_items),
    processedItems: Number(incomplete.processed_items),
    remainingItems: Number(incomplete.expected_items) - Number(incomplete.processed_items),
    phaseUpdatedAt: nullableNumber(incomplete.phase_updated_at),
  });
}

function readExactQueueEnvelopeIdentities(env, configPath, targets) {
  const jobTypes = TARGETS.map((item) => sqlString(item.workType)).join(', ');
  const workKeys = targets.map((item) => sqlString(item.workKey)).join(', ');
  return runReadOnlyQuery(env, configPath, `
    WITH envelopes AS (
      SELECT
        dlq_id,
        message_id,
        job_type,
        status,
        error_code,
        retry_count,
        created_at,
        updated_at,
        CASE WHEN json_valid(replay_payload_json) THEN replay_payload_json ELSE NULL END AS replay_json,
        CASE WHEN json_valid(payload_json) THEN payload_json ELSE NULL END AS payload_json_valid
      FROM dead_letter_jobs
      WHERE job_type IN (${jobTypes})
    ), extracted AS (
      SELECT
        dlq_id,
        message_id,
        job_type,
        status,
        error_code,
        retry_count,
        created_at,
        updated_at,
        COALESCE(
          json_extract(replay_json, '$.workKey'),
          json_extract(replay_json, '$.payload.workKey'),
          json_extract(replay_json, '$.job.workKey'),
          json_extract(replay_json, '$.body.workKey'),
          json_extract(replay_json, '$.data.workKey'),
          json_extract(payload_json_valid, '$.workKey'),
          json_extract(payload_json_valid, '$.payload.workKey'),
          json_extract(payload_json_valid, '$.job.workKey'),
          json_extract(payload_json_valid, '$.body.workKey'),
          json_extract(payload_json_valid, '$.data.workKey')
        ) AS work_key,
        COALESCE(
          json_extract(replay_json, '$.operationId'),
          json_extract(replay_json, '$.payload.operationId'),
          json_extract(replay_json, '$.job.operationId'),
          json_extract(replay_json, '$.body.operationId'),
          json_extract(payload_json_valid, '$.operationId'),
          json_extract(payload_json_valid, '$.payload.operationId'),
          json_extract(payload_json_valid, '$.job.operationId'),
          json_extract(payload_json_valid, '$.body.operationId')
        ) AS operation_id,
        COALESCE(
          json_extract(replay_json, '$.generation'),
          json_extract(replay_json, '$.payload.generation'),
          json_extract(replay_json, '$.job.generation'),
          json_extract(replay_json, '$.body.generation'),
          json_extract(payload_json_valid, '$.generation'),
          json_extract(payload_json_valid, '$.payload.generation'),
          json_extract(payload_json_valid, '$.job.generation'),
          json_extract(payload_json_valid, '$.body.generation')
        ) AS envelope_generation,
        COALESCE(
          json_extract(replay_json, '$.requestedAt'),
          json_extract(replay_json, '$.payload.requestedAt'),
          json_extract(replay_json, '$.job.requestedAt'),
          json_extract(replay_json, '$.body.requestedAt'),
          json_extract(payload_json_valid, '$.requestedAt'),
          json_extract(payload_json_valid, '$.payload.requestedAt'),
          json_extract(payload_json_valid, '$.job.requestedAt'),
          json_extract(payload_json_valid, '$.body.requestedAt')
        ) AS envelope_requested_at,
        COALESCE(
          json_extract(replay_json, '$.periodStart'),
          json_extract(replay_json, '$.payload.periodStart'),
          json_extract(replay_json, '$.body.periodStart'),
          json_extract(payload_json_valid, '$.periodStart'),
          json_extract(payload_json_valid, '$.payload.periodStart'),
          json_extract(payload_json_valid, '$.body.periodStart')
        ) AS period_start,
        COALESCE(
          json_extract(replay_json, '$.periodEnd'),
          json_extract(replay_json, '$.payload.periodEnd'),
          json_extract(replay_json, '$.body.periodEnd'),
          json_extract(payload_json_valid, '$.periodEnd'),
          json_extract(payload_json_valid, '$.payload.periodEnd'),
          json_extract(payload_json_valid, '$.body.periodEnd')
        ) AS period_end
      FROM envelopes
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY work_key ORDER BY updated_at DESC, created_at DESC) AS rn
      FROM extracted
      WHERE work_key IN (${workKeys})
    )
    SELECT
      message_id,
      job_type,
      status,
      error_code,
      retry_count,
      created_at,
      updated_at,
      work_key,
      operation_id,
      envelope_generation,
      envelope_requested_at,
      period_start,
      period_end
    FROM ranked
    WHERE rn=1
    ORDER BY work_key
  `, 'exactQueueEnvelopeIdentities');
}

function normalizeEnvelope(row) {
  return Object.freeze({
    messageId: row.message_id ?? null,
    jobType: row.job_type,
    status: row.status,
    errorCode: row.error_code ?? null,
    retryCount: Number(row.retry_count ?? 0),
    createdAt: nullableNumber(row.created_at),
    updatedAt: nullableNumber(row.updated_at),
    workKey: row.work_key,
    operationId: row.operation_id ?? null,
    generation: nullableNumber(row.envelope_generation),
    requestedAt: nullableNumber(row.envelope_requested_at),
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
  });
}

function listDatabases(env, configPath) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'list', '--json', '--config', configPath], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw readinessError('Wrangler D1 list failed', 'INTERNAL_DESTINATION_READINESS_D1_LIST_FAILED', {
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  const value = parseJsonSuffix(result.stdout);
  if (!Array.isArray(value)) throw readinessError('Wrangler D1 list output is not an array', 'INTERNAL_DESTINATION_READINESS_D1_LIST_INVALID');
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
    throw readinessError('Wrangler D1 read failed', 'INTERNAL_DESTINATION_READINESS_D1_QUERY_FAILED', {
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
    throw readinessError('D1 query reported failure', 'INTERNAL_DESTINATION_READINESS_D1_RESPONSE_FAILED', { queryName });
  }
  return envelopes.flatMap((item) => item?.results ?? []);
}

function assertReadOnlySql(sql, queryName) {
  const text = String(sql).trim();
  if (!/^(?:SELECT|WITH)\b/iu.test(text)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA|ATTACH|DETACH)\b/iu.test(text)) {
    throw readinessError('Readiness query is not read-only', 'INTERNAL_DESTINATION_READINESS_SQL_INVALID', { queryName });
  }
}

function parseJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.max(...starts) : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw readinessError('Wrangler output has no JSON result', 'INTERNAL_DESTINATION_READINESS_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw readinessError('Wrangler output JSON is invalid', 'INTERNAL_DESTINATION_READINESS_JSON_INVALID');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw readinessError('Exact reviewed clean main is required', 'INTERNAL_DESTINATION_READINESS_REPOSITORY_INVALID', {
      branch,
      clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw readinessError('git preflight failed', 'INTERNAL_DESTINATION_READINESS_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw readinessError('git preflight returned empty output', 'INTERNAL_DESTINATION_READINESS_GIT_FAILED');
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
    .filter(([key]) => !/token|secret|authorization|payload|databaseId|uuid|tableId/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
