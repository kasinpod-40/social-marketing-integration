#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';
import { assertReportRuntimeMetricIntegrity } from './lib/report-runtime-window-repair.js';
import {
  WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD,
  WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION,
  assessWooCommerceReportLiveReadiness,
  assertWooCommerceReportLiveReadinessConfirmation,
  parseWooCommerceReportLiveReadinessArgs,
  safeWooCommerceReportReadinessEvidence,
} from './lib/woocommerce-report-live-readiness-audit.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_WOOCOMMERCE_REPORT_READINESS_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_WOOCOMMERCE_REPORT_READINESS_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const evidencePath = resolve(
  process.env.MKT_WOOCOMMERCE_REPORT_READINESS_EVIDENCE
    ?? 'outputs/woocommerce-report-live-readiness/readiness-summary.json',
);
const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_ACCOUNT_KEY = 'chemistry_k';
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let stage = 'init';

try {
  const options = parseWooCommerceReportLiveReadinessArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeAudit();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeWooCommerceReportReadinessEvidence(error?.details ?? {}),
    remoteMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'woocommerce_report_live_readiness_audit_v1',
    command: `CONFIRM_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT=${WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION} node scripts/woocommerce-report-live-readiness-audit.mjs --execute`,
    stages: [
      'repository-and-finalizer-evidence',
      'local-config-contract',
      'remote-worker-read-only',
      'remote-d1-select-only',
      'pending-migration-read-only',
      'lark-schema-and-record-read-only',
      'aggregate-all-blockers-and-window-actions',
    ],
    windows: [1, 3, 7, 30],
    expectedRowsPerWindow: 58,
    safety: {
      providerRequests: 0,
      queueMessages: 0,
      remoteD1Mutations: 0,
      remoteLarkMutations: 0,
      workerDeployments: 0,
      scheduleChanges: 0,
      production: 'BLOCKED',
    },
  }, null, 2)}\n`);
}

async function executeAudit() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertWooCommerceReportLiveReadinessConfirmation(env);

  const repository = await collectRepositoryState();
  const finalizerEvidence = await collectJsonFile(finalizerEvidencePath);

  stage = 'local-config-contract';
  const sourceText = await readFile(configPath, 'utf8');
  let configWindow = null;
  let configAssessment = {
    valid: false,
    safeTrueFlags: null,
    activeTrueFlags: null,
    tableMappingsReady: false,
  };
  try {
    configWindow = buildReportRuntimeCloseoutConfigWindow(sourceText, {
      activeTrueFlags: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    });
    configAssessment = {
      valid: true,
      safeTrueFlags: configWindow.safeTrueFlags,
      activeTrueFlags: configWindow.activeTrueFlags,
      tableMappingsReady: true,
    };
  } catch (error) {
    configAssessment = {
      ...configAssessment,
      errorCode: error?.code ?? 'REPORT_CONFIG_INVALID',
    };
  }

  const remoteWorker = configWindow
    ? await collectSafely('remote-worker-read-only', () => collectRemoteWorker(configWindow, env), {
      verified: false,
      trueFlags: null,
      d1BindingMatches: false,
      queueBindingMatches: false,
      tableMappingsMatch: false,
    })
    : {
      verified: false,
      trueFlags: null,
      d1BindingMatches: false,
      queueBindingMatches: false,
      tableMappingsMatch: false,
      skipped: 'local_config_invalid',
    };

  const d1Preflight = configWindow
    ? await collectSafely('remote-d1-select-only', () => readWooCommerceD1Preflight(env), {})
    : {};
  const pendingMigrations = configWindow
    ? await collectSafely('pending-migration-read-only', () => readPendingMigrations(env), ['READ_FAILED'])
    : ['LOCAL_CONFIG_INVALID'];

  const periodEnd = String(d1Preflight?.period_end ?? '');
  const sourceWatermark = String(d1Preflight?.source_watermark ?? '');
  const candidates = /^\d{4}-\d{2}-\d{2}$/u.test(periodEnd) && sourceWatermark
    ? buildReportRuntimeCloseoutCandidates({
      requestedAt: Date.now(),
      periodEnd,
      sourceWatermark,
      timeZone: 'Asia/Bangkok',
      platformScope: 'woocommerce',
      accountKey: EXPECTED_ACCOUNT_KEY,
      formulaVersion: 'woocommerce-commerce-v1',
    }).filter((candidate) => [1, 3, 7, 30].includes(candidate.windowDays))
    : [];

  const d1Windows = candidates.length > 0
    ? await collectSafely('remote-d1-window-read-only', () => readD1Windows(candidates, env), [])
    : [];

  const lark = configWindow
    ? await collectSafely(
      'lark-schema-and-record-read-only',
      () => collectLarkReadiness(env, configWindow.tableIds, candidates, d1Windows),
      {
        schema: {
          tablesReady: false,
          stableKeyFieldsReady: false,
          windowField: null,
        },
        windows: [],
      },
    )
    : {
      schema: {
        tablesReady: false,
        stableKeyFieldsReady: false,
        windowField: null,
      },
      windows: [],
    };

  stage = 'aggregate-all-blockers-and-window-actions';
  const result = assessWooCommerceReportLiveReadiness({
    repository,
    finalizerEvidence,
    config: configAssessment,
    d1Preflight,
    pendingMigrations,
    remoteWorker,
    larkSchema: lark.schema,
    d1Windows,
    larkWindows: lark.windows,
  });
  const summary = safeWooCommerceReportReadinessEvidence({
    ...result,
    repository,
    d1Preflight: {
      coverageStatus: d1Preflight?.coverage_status ?? null,
      coverageScopeMode: d1Preflight?.coverage_scope_mode ?? null,
      periodEnd: d1Preflight?.period_end ?? null,
      dailyFactCount: Number(d1Preflight?.daily_fact_count ?? 0),
      orderStateCount: Number(d1Preflight?.order_state_count ?? 0),
      activeReportLocks: Number(d1Preflight?.active_report_locks ?? 0),
      openReportDlq: Number(d1Preflight?.open_report_dlq ?? 0),
    },
    pendingMigrations,
    remoteWorker,
    larkSchema: lark.schema,
  });
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

async function collectRepositoryState() {
  stage = 'repository-and-finalizer-evidence';
  await run('git', ['fetch', 'origin', 'main', '--quiet']);
  const [branch, head, originMainHead, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['rev-parse', 'origin/main']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  return Object.freeze({
    branch,
    head,
    originMainHead,
    clean: dirty.trim() === '',
  });
}

async function collectRemoteWorker(config, env) {
  const status = parseJsonOutput(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const activeVersion = resolveActiveVersion(status);
  const versionView = parseJsonOutput(await runText('npx', [
    'wrangler', 'versions', 'view', activeVersion, '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const bindings = collectBindings(versionView);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), readRemoteBoolean(binding?.text ?? binding?.value)])
    .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled === true)
    .map(([name]) => name)
    .sort();

  const d1Matches = exactlyOneMatch(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
  ), (binding) => String(binding.database_id ?? binding.databaseId ?? binding.id ?? '').toLowerCase()
      === config.databaseId);
  const queueMatches = exactlyOneMatch(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE' && normalizeBindingType(binding?.type) === 'queue'
  ), (binding) => String(binding.queue_name ?? binding.queueName ?? binding.queue ?? '')
      === config.mainQueueName);
  const tableMappingsMatch = Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES).every(([key, envName]) => (
    exactlyOneMatch(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), (binding) => String(binding.text ?? binding.value ?? '').trim() === config.tableIds[key])
  ));

  return Object.freeze({
    verified: true,
    trueFlags: Object.freeze(trueFlags),
    d1BindingMatches: d1Matches,
    queueBindingMatches: queueMatches,
    tableMappingsMatch,
  });
}

async function readWooCommerceD1Preflight(env) {
  return readD1Row(compactSql(`
    WITH coverage AS (
      SELECT status, scope_mode, period_start, period_end, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE account_key = '${sqlText(EXPECTED_ACCOUNT_KEY)}'
        AND platform = 'woocommerce'
        AND dataset_key = 'woocommerce_orders'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT scope_mode FROM coverage) AS coverage_scope_mode,
      (SELECT period_start FROM coverage) AS coverage_period_start,
      (SELECT period_end FROM coverage) AS coverage_period_end,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM commerce_daily_sales_facts
        WHERE account_key = '${sqlText(EXPECTED_ACCOUNT_KEY)}') AS period_end,
      (SELECT COUNT(*) FROM commerce_daily_sales_facts
        WHERE account_key = '${sqlText(EXPECTED_ACCOUNT_KEY)}') AS daily_fact_count,
      (SELECT COUNT(*) FROM commerce_order_state
        WHERE account_key = '${sqlText(EXPECTED_ACCOUNT_KEY)}') AS order_state_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'woocommerce' AND r.account_key = '${sqlText(EXPECTED_ACCOUNT_KEY)}'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate'
          AND status IN ('open', 'redrive_pending')) AS open_report_dlq;
  `), env);
}

async function readPendingMigrations(env) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB',
    '--remote', '--config', configPath,
  ], { env });
  return [...new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]))].sort();
}

async function readD1Windows(candidates, env) {
  const ids = candidates.map((candidate) => `'${sqlText(candidate.reportId)}'`).join(', ');
  const rows = await readD1Rows(compactSql(`
    SELECT report_id, data_status, payload_json
    FROM report_materializations
    WHERE report_id IN (${ids})
    ORDER BY report_id ASC;
  `), env);
  return candidates.map((candidate) => {
    const matches = rows.filter((row) => row.report_id === candidate.reportId);
    const payload = matches.length === 1 ? parsePayload(matches[0].payload_json) : null;
    return Object.freeze({
      windowDays: candidate.windowDays,
      reportId: candidate.reportId,
      materializationCount: matches.length,
      dataStatus: matches[0]?.data_status ?? null,
      payloadMetricCount: payload
        ? Object.keys(payload.metricPayload ?? {}).length
          + (Array.isArray(payload.collections?.dimension_metrics)
            ? payload.collections.dimension_metrics.length
            : 0)
        : 0,
      payload,
    });
  });
}

async function collectLarkReadiness(env, tableIds, candidates, d1Windows) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map((table) => table.tableId).filter(Boolean));
  const fieldsByKey = {};
  let tablesReady = true;
  let stableKeyFieldsReady = true;
  for (const [key, tableId] of Object.entries(tableIds)) {
    if (!remoteIds.has(tableId)) {
      tablesReady = false;
      fieldsByKey[key] = [];
      continue;
    }
    const fields = await client.listFields({ tableId });
    fieldsByKey[key] = fields;
    const stableKey = REQUIRED_LARK_KEY_FIELDS[key];
    if (!fields.some((field) => field.fieldName === stableKey)) stableKeyFieldsReady = false;
  }

  const metricFields = fieldsByKey.mktReportMetricValues ?? [];
  const windowField = metricFields.find(
    (field) => field.fieldId === WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.fieldId,
  ) ?? null;
  const options = Array.isArray(windowField?.property?.options) ? windowField.property.options : [];
  const optionNames = options.map((option) => String(option?.name ?? option?.value ?? '').trim()).filter(Boolean);
  const optionIds = options.map((option) => String(option?.id ?? option?.option_id ?? '').trim()).filter(Boolean);

  const windows = [];
  for (const candidate of candidates) {
    const snapshots = await client.searchRecords({
      tableId: tableIds.mktReportSnapshots,
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: 'report_id', operator: 'is', value: [candidate.reportId] }],
      },
      pageSize: 500,
      maxPages: 1_000,
    });
    const metrics = await client.searchRecords({
      tableId: tableIds.mktReportMetricValues,
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: 'report_id', operator: 'is', value: [candidate.reportId] }],
      },
      pageSize: 500,
      maxPages: 1_000,
    });
    const metricValues = {};
    const reportMetricKeys = new Set();
    let duplicateMetricKeys = 0;
    let duplicateReportMetricKeys = 0;
    for (const record of metrics) {
      const metricKey = normalizeLarkText(record?.fields?.metric_key);
      const reportMetricKey = normalizeLarkText(record?.fields?.report_metric_key);
      if (!metricKey) continue;
      if (Object.hasOwn(metricValues, metricKey)) duplicateMetricKeys += 1;
      metricValues[metricKey] = normalizeLarkNumber(record?.fields?.current_value);
      if (reportMetricKey) {
        if (reportMetricKeys.has(reportMetricKey)) duplicateReportMetricKeys += 1;
        reportMetricKeys.add(reportMetricKey);
      }
    }
    const d1 = d1Windows.find((window) => window.windowDays === candidate.windowDays);
    let parity = false;
    let parityCode = null;
    if (d1?.payload && duplicateMetricKeys === 0 && duplicateReportMetricKeys === 0) {
      try {
        assertReportRuntimeMetricIntegrity({ payload: d1.payload, larkMetrics: metricValues });
        parity = true;
      } catch (error) {
        parityCode = error?.code ?? 'REPORT_PARITY_FAILED';
      }
    }
    windows.push(Object.freeze({
      windowDays: candidate.windowDays,
      snapshotCount: snapshots.length,
      metricCount: metrics.length,
      duplicateMetricKeys: duplicateMetricKeys + duplicateReportMetricKeys,
      parity,
      parityCode,
    }));
  }

  return Object.freeze({
    schema: Object.freeze({
      tablesReady,
      stableKeyFieldsReady,
      windowField: windowField ? Object.freeze({
        fieldId: windowField.fieldId,
        fieldName: windowField.fieldName,
        optionNames: Object.freeze(optionNames),
        optionIdsUnique: optionIds.length === optionNames.length
          && new Set(optionIds).size === optionIds.length,
      }) : null,
    }),
    windows: Object.freeze(windows),
  });
}

async function readD1Row(sql, env) {
  const rows = await readD1Rows(sql, env);
  if (rows.length !== 1) throw auditFailure(
    'WooCommerce Report readiness D1 query returned an unexpected row count',
    'WOOCOMMERCE_REPORT_LIVE_READINESS_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readD1Rows(sql, env) {
  if (!/^SELECT\b|^WITH\b/iu.test(sql.trim())) throw auditFailure(
    'WooCommerce Report readiness permits SELECT-only D1 statements',
    'WOOCOMMERCE_REPORT_LIVE_READINESS_D1_NON_SELECT_BLOCKED',
  );
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', sql,
  ], { env });
  const parsed = parseJsonOutput(output);
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
}

async function collectJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return Object.freeze({
      ok: false,
      errorCode: error?.code === 'ENOENT' ? 'EVIDENCE_MISSING' : 'EVIDENCE_INVALID',
    });
  }
}

async function collectSafely(nextStage, operation, fallback) {
  stage = nextStage;
  try {
    return await operation();
  } catch (error) {
    return Object.freeze({
      ...(Array.isArray(fallback) ? {} : fallback),
      ...(Array.isArray(fallback) ? { values: fallback } : {}),
      readErrorCode: error?.code ?? 'READ_FAILED',
    });
  }
}

function resolveActiveVersion(value) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) throw auditFailure(
    'WooCommerce Report readiness requires one Worker version at 100% traffic',
    'WOOCOMMERCE_REPORT_LIVE_READINESS_TRAFFIC_INVALID',
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

function exactlyOneMatch(values, predicate, verifier) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  return matches.length === 1 && verifier(matches[0]) === true;
}

function parseJsonOutput(value) {
  const text = String(value ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0).sort((a, b) => a - b);
    for (const start of starts) {
      try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
    }
  }
  throw auditFailure(
    'Wrangler output did not contain valid JSON',
    'WOOCOMMERCE_REPORT_LIVE_READINESS_WRANGLER_JSON_INVALID',
  );
}

function parsePayload(value) {
  try { return JSON.parse(String(value ?? '')); } catch { return null; }
}

function normalizeLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const texts = value.map((item) => normalizeLarkText(item)).filter(Boolean);
    return texts.length === 0 ? null : texts.join('');
  }
  if (value && typeof value === 'object') return normalizeLarkText(
    value.text ?? value.value ?? value.name ?? null,
  );
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object'
    ? (scalar.value ?? scalar.text ?? null)
    : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function readBindingName(binding) {
  return String(binding?.name ?? binding?.binding ?? '').trim() || null;
}
function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
}
function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replaceAll("'", "''"); }

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function auditFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceReportLiveReadinessAuditError';
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
