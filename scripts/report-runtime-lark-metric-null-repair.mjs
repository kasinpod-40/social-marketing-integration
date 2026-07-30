#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertReportRuntimeCloseoutRecoveryEvidence,
} from './lib/report-runtime-lark-integrity-recovery.js';
import {
  buildReportRuntimeMetricNullRepairPlan,
  assertReportRuntimeMetricNullRepairReadback,
  summarizeReportRuntimeMetricNullRepairPlan,
} from './lib/report-runtime-lark-metric-null-repair.js';
import {
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';

const execFileAsync = promisify(execFile);
const CONFIRMATION = 'EXECUTE_EXACT_REPORT_METRIC_NULL_REPAIR';
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR ?? 'outputs/report-runtime-window-repair/3d-refresh',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-window-repair/finalizer/report-runtime-finalize-summary.json',
);
const ATTEMPT_PATH = join(outputRoot, 'metric-null-repair.attempt.json');
const SUMMARY_PATH = join(outputRoot, 'metric-null-repair-summary.json');
const APPROVED_PLATFORM = 'tiktok';
const APPROVED_WINDOW_DAYS = 3;
let currentStage = 'init';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_METRIC_NULL_REPAIR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    workerDeploymentAttempted: false,
    queueMessageSent: false,
    remoteD1Mutated: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_REPORT_RUNTIME_METRIC_NULL_REPAIR !== CONFIRMATION) throw failure(
    `Execution requires CONFIRM_REPORT_RUNTIME_METRIC_NULL_REPAIR=${CONFIRMATION}`,
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_CONFIRMATION_REQUIRED',
  );
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'repository-finalizer-and-config';
  const repository = await assertRepositoryState();
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository.head !== repository.head) throw failure(
    'Report metric null repair requires Finalizer evidence from current main',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_FINALIZER_HEAD_MISMATCH',
  );

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const configText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(configText);
  await verifyRemoteSafe(config, env);

  const existingSummary = await readJsonIfExists(SUMMARY_PATH);
  if (existingSummary) {
    assertCompletedSummary(existingSummary, repository.head);
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: SUMMARY_PATH }, null, 2)}\n`);
    return;
  }

  currentStage = 'validate-exact-incident-evidence';
  const deployAttempt = await readRequiredJson(join(outputRoot, 'deploy-active.attempt.json'));
  const sendFirstAttempt = await readRequiredJson(join(outputRoot, 'send-first.attempt.json'));
  const restoreAttempt = await readRequiredJson(join(outputRoot, 'restore-safe.attempt.json'));
  const replayAttempt = await readJsonIfExists(join(outputRoot, 'send-replay.attempt.json'));
  if (replayAttempt) throw failure(
    'Metric null repair is approved only before the missing replay is recorded',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_REPLAY_ALREADY_RECORDED',
  );
  const requestedAt = positiveInteger(sendFirstAttempt.requestedAt, 'requestedAt');
  const preflight = await readD1Preflight(env);
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: preflight.period_end,
    sourceWatermark: preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: APPROVED_PLATFORM,
    accountKey: 'chemistry_k',
    formulaVersion: 'tiktok-organic-v1',
  });
  const candidate = candidates.find((item) => item.reportId === deployAttempt.selectedReportId);
  if (!candidate) throw failure(
    'Exact 3D Report candidate cannot be regenerated from current coverage evidence',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_CANDIDATE_MISSING',
  );
  const selected = Object.freeze({ ...candidate, operation: 'refresh' });
  const recoveryEvidence = assertReportRuntimeCloseoutRecoveryEvidence({
    deployAttempt,
    sendFirstAttempt,
    restoreAttempt,
    replayAttempt: null,
    summaryExists: false,
    candidate: selected,
    activeConfigSha256: config.activeSha256,
    safeConfigSha256: config.safeSha256,
    jobSha256: sha256(stableJson(selected.job)),
  });
  if (selected.windowDays !== APPROVED_WINDOW_DAYS) throw failure(
    'Report metric null repair is approved only for the exact 3D incident',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_TARGET_INVALID',
  );

  currentStage = 'read-authoritative-d1-and-lark';
  const materialization = await readD1Materialization(env, selected.reportId);
  if (materialization.report_id !== selected.reportId || !materialization.payload_checksum) throw failure(
    'Authoritative D1 Report materialization is missing or invalid',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_D1_INVALID',
  );
  const payload = parsePayload(materialization.payload_json);
  if (payload.platformScope !== APPROVED_PLATFORM || payload.capability !== 'organic') throw failure(
    'Report metric null repair D1 payload is outside the approved Organic TikTok scope',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_TARGET_INVALID',
  );
  const client = createLarkBitableClientFromEnv(env);
  const records = await readMetricRecords(client, config.tableIds.mktReportMetricValues, selected.reportId);

  const priorAttempt = await readJsonIfExists(ATTEMPT_PATH);
  if (priorAttempt) {
    assertAttemptIdentity(priorAttempt, {
      repositoryHead: repository.head,
      reportId: selected.reportId,
      payloadChecksum: materialization.payload_checksum,
    });
    currentStage = 'verification-only-after-recorded-attempt';
    const readback = await pollMetricReadback({
      client,
      tableId: config.tableIds.mktReportMetricValues,
      reportId: selected.reportId,
      payload,
    });
    const summary = buildSummary({
      repository,
      selected,
      materialization,
      recoveryEvidence,
      planSummary: priorAttempt.plan,
      backup: priorAttempt.backup,
      readback,
      verificationOnly: true,
      updateResponseCount: priorAttempt.updateCount,
    });
    await writePrivateJson(SUMMARY_PATH, summary);
    process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: SUMMARY_PATH }, null, 2)}\n`);
    return;
  }

  currentStage = 'plan-exact-stale-null-repair';
  const plan = buildReportRuntimeMetricNullRepairPlan({ payload, records });
  const planSummary = summarizeReportRuntimeMetricNullRepairPlan(plan);

  currentStage = 'backup-exact-lark-metric-rows';
  const backup = await writeMetricBackup({
    reportId: selected.reportId,
    payloadChecksum: materialization.payload_checksum,
    records,
  });
  const attempt = Object.freeze({
    contractVersion: 'report_runtime_metric_null_repair_v1',
    repositoryHead: repository.head,
    originalRepositoryHead: recoveryEvidence.originalRepositoryHead,
    reportId: selected.reportId,
    windowDays: selected.windowDays,
    operation: selected.operation,
    payloadChecksum: materialization.payload_checksum,
    updateFingerprint: sha256(stableJson(plan.updates.map((record) => record.fields))),
    plan: planSummary,
    backup,
    updateCount: plan.updates.length,
    attemptedAt: new Date().toISOString(),
  });
  await writePrivateJson(ATTEMPT_PATH, attempt);

  currentStage = 'apply-exact-lark-metric-null-repair';
  const updateResult = await client.batchUpdateRecords({
    tableId: config.tableIds.mktReportMetricValues,
    records: plan.updates,
  });
  const updated = Number(updateResult?.updated ?? 0);
  if (updated !== plan.updates.length) throw failure(
    'Lark metric null repair did not confirm every planned row update',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_WRITE_COUNT_MISMATCH',
    { expected: plan.updates.length, observed: updated },
  );

  currentStage = 'bounded-post-write-readback';
  const readback = await pollMetricReadback({
    client,
    tableId: config.tableIds.mktReportMetricValues,
    reportId: selected.reportId,
    payload,
  });
  const summary = buildSummary({
    repository,
    selected,
    materialization,
    recoveryEvidence,
    planSummary,
    backup,
    readback,
    verificationOnly: false,
    updateResponseCount: updated,
  });
  await writePrivateJson(SUMMARY_PATH, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: SUMMARY_PATH }, null, 2)}\n`);
}

async function readD1Preflight(env) {
  return readD1Row(compactSql(`
    WITH coverage AS (
      SELECT status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k'
        AND platform = 'tiktok'
        AND account_key = 'chemistry_k'
        AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok' AND account_key = 'chemistry_k') AS period_end;
  `), env);
}

async function readD1Materialization(env, reportId) {
  return readD1Row(compactSql(`
    SELECT report_id, payload_checksum, payload_json, generated_at, data_status
    FROM report_materializations
    WHERE report_id = '${sqlText(reportId)}';
  `), env);
}

async function readD1Row(sql, env) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', sql,
  ], { env });
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
  if (rows.length !== 1) throw failure(
    'Report metric null repair D1 query returned an unexpected row count',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_D1_QUERY_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readMetricRecords(client, tableId, reportId) {
  return client.searchRecords({
    tableId,
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'report_id', operator: 'is', value: [reportId] }],
    },
    pageSize: 500,
    maxPages: 1_000,
  });
}

async function pollMetricReadback(input) {
  const delays = [0, 1_000, 2_000, 4_000, 8_000];
  let lastError = null;
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    const records = await readMetricRecords(input.client, input.tableId, input.reportId);
    try {
      const integrity = assertReportRuntimeMetricNullRepairReadback({ payload: input.payload, records });
      return Object.freeze({
        ...integrity,
        attemptCount: index + 1,
        elapsedDelayMs: delays.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
      });
    } catch (error) {
      if (error?.code !== 'REPORT_RUNTIME_METRIC_NULL_REPAIR_READBACK_DRIFT') throw error;
      lastError = error;
    }
  }
  throw failure(
    'Bounded Lark metric null repair readback did not converge',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_READBACK_NOT_CONVERGED',
    {
      attemptCount: delays.length,
      elapsedDelayMs: delays.reduce((sum, value) => sum + value, 0),
      mismatchCount: Number(lastError?.details?.mismatchCount ?? 0),
      mismatchFieldCounts: lastError?.details?.mismatchFieldCounts ?? {},
    },
  );
}

async function writeMetricBackup(input) {
  const backupDirectory = join(outputRoot, 'backups');
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const filename = `report-metric-null-repair-${Date.now()}.json`;
  const path = join(backupDirectory, filename);
  const value = {
    contractVersion: 'report_runtime_metric_null_repair_backup_v1',
    reportId: input.reportId,
    payloadChecksum: input.payloadChecksum,
    records: input.records.map((record) => ({
      recordId: record?.recordId ?? record?.record_id ?? null,
      fields: {
        report_metric_key: record?.fields?.report_metric_key ?? null,
        report_id: record?.fields?.report_id ?? null,
        metric_key: record?.fields?.metric_key ?? null,
        current_value: record?.fields?.current_value ?? null,
        compare_value: record?.fields?.compare_value ?? null,
        change_value: record?.fields?.change_value ?? null,
        change_percent: record?.fields?.change_percent ?? null,
      },
    })),
    backedUpAt: new Date().toISOString(),
  };
  await writePrivateJson(path, value);
  const bytes = await readFile(path);
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: sha256(bytes),
    recordCount: input.records.length,
  });
}

function buildSummary(input) {
  return Object.freeze({
    ok: true,
    contractVersion: 'report_runtime_metric_null_repair_v1',
    decision: 'EXACT_REPORT_METRIC_NULLS_REPAIRED',
    repository: input.repository,
    target: {
      platform: APPROVED_PLATFORM,
      capability: 'organic',
      operation: input.selected.operation,
      windowDays: input.selected.windowDays,
      reportId: input.selected.reportId,
    },
    materialization: {
      payloadChecksum: input.materialization.payload_checksum,
      dataStatus: input.materialization.data_status,
    },
    repair: {
      ...input.planSummary,
      updateResponseCount: input.updateResponseCount,
      verificationOnly: input.verificationOnly,
      firstMaterializationRetried: false,
      queueMessageSent: false,
      workerDeploymentAttempted: false,
      remoteD1Mutated: false,
    },
    backup: input.backup,
    readback: input.readback,
    recoveryEvidence: {
      originalRepositoryHead: input.recoveryEvidence.originalRepositoryHead,
      replayAttempted: input.recoveryEvidence.replayAttempted,
    },
    production: false,
  });
}

async function verifyRemoteSafe(config, env) {
  const status = JSON.parse(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', 'social-mkt-sync-worker',
    '--config', configPath, '--json',
  ], { env }));
  const activeVersion = resolveActiveVersion(status);
  const versionView = JSON.parse(await runText('npx', [
    'wrangler', 'versions', 'view', activeVersion, '--name', 'social-mkt-sync-worker',
    '--config', configPath, '--json',
  ], { env }));
  const bindings = collectBindings(versionView);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), readRemoteBoolean(binding?.text ?? binding?.value)])
    .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled)
    .map(([name]) => name)
    .sort();
  if (trueFlags.length !== 0) throw failure(
    'Report metric null repair requires the Remote Worker to remain all-false',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_REMOTE_NOT_SAFE',
    { observedTrue: trueFlags },
  );
  const d1 = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
  ), 'MKT_STATE_DB');
  const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
  if (databaseId !== config.databaseId) throw failure(
    'Report metric null repair Remote D1 UUID differs from reviewed config',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_REMOTE_D1_MISMATCH',
  );
  return Object.freeze({ activeVersion, trueFlags: Object.freeze(trueFlags) });
}

async function assertRepositoryState() {
  await run('git', ['fetch', 'origin', 'main', '--quiet']);
  const [branch, head, originMainHead, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['rev-parse', 'origin/main']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  if (branch !== 'main' || head !== originMainHead || dirty.trim() !== '') throw failure(
    'Report metric null repair requires clean current main equal to origin/main',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_REPOSITORY_INVALID',
    { branch, head, originMainHead, clean: dirty.trim() === '' },
  );
  return Object.freeze({ branch, head, originMainHead, clean: true });
}

function assertCompletedSummary(value, repositoryHead) {
  if (value?.ok !== true
    || value?.decision !== 'EXACT_REPORT_METRIC_NULLS_REPAIRED'
    || value?.repository?.head !== repositoryHead
    || Number(value?.target?.windowDays) !== APPROVED_WINDOW_DAYS
    || value?.readback?.mismatchCount !== 0
    || value?.repair?.firstMaterializationRetried !== false
    || value?.repair?.queueMessageSent !== false
    || value?.repair?.workerDeploymentAttempted !== false
    || value?.repair?.remoteD1Mutated !== false) {
    throw failure(
      'Existing Report metric null repair summary is invalid for current main',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_SUMMARY_INVALID',
    );
  }
}

function assertAttemptIdentity(value, expected) {
  if (value?.contractVersion !== 'report_runtime_metric_null_repair_v1'
    || value?.repositoryHead !== expected.repositoryHead
    || value?.reportId !== expected.reportId
    || value?.payloadChecksum !== expected.payloadChecksum) {
    throw failure(
      'Recorded Report metric null repair attempt differs from current exact target',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_ATTEMPT_MISMATCH',
    );
  }
}

function parsePayload(value) {
  try {
    const payload = JSON.parse(String(value ?? ''));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('not object');
    return payload;
  } catch {
    throw failure(
      'Report metric null repair payload_json is invalid',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_PAYLOAD_INVALID',
    );
  }
}

function resolveActiveVersion(value) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) throw failure(
    'Report metric null repair requires exactly one Worker version at 100% traffic',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_TRAFFIC_INVALID',
    { activeVersionCount: unique.length },
  );
  return unique[0];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const percentage = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (percentage === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push(versionId);
    Object.values(nested).forEach(visit);
  }
}

function collectBindings(value) {
  const arrays = [];
  visit(value);
  return arrays.find((items) => items.some((item) => readBindingName(item))) ?? [];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) arrays.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw failure(
    `Report metric null repair requires exactly one ${label} binding`,
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}

async function readRequiredJson(path) {
  const value = await readJsonIfExists(path);
  if (value === null) throw failure(
    `Required Report metric null repair evidence is missing: ${relative(outputRoot, path)}`,
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_EVIDENCE_MISSING',
  );
  return value;
}

async function readJsonIfExists(path) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|credential|payload|recordId|record_id|tableId|table_id/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
}

function readBindingName(binding) { return String(binding?.name ?? binding?.binding ?? '').trim() || null; }
function normalizeBindingType(value) { return String(value ?? '').trim().toLowerCase().replaceAll('-', '_'); }
function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replaceAll("'", "''"); }
function stableJson(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw failure(
    `${fieldName} must be a positive integer`,
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_VALUE_INVALID',
    { fieldName },
  );
  return number;
}
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeMetricNullRepairOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
async function run(command, args, options = {}) { await runCapture(command, args, options); }
async function runText(command, args, options = {}) {
  const result = await runCapture(command, args, options);
  return options.trim === false ? result.stdout : result.stdout.trim();
}
async function runCapture(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
}
