import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { escapeReportIdentityPart } from '../../packages/application/src/use-cases/build-report-snapshot.js';
import { pollReportRuntimeLarkIntegrity } from './report-runtime-lark-integrity-recovery.js';
import {
  closeoutFailure,
  compactSql,
  positiveInteger,
  sha256,
  sleep,
  sqlText,
  stableJson,
} from './report-runtime-closeout-reviewed-process.js';

const DEFAULT_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});
const LARK_REPORT_METRIC_DECIMAL_PLACES = 4;

export function createReviewedStateRuntime(input) {
  const {
    run, runText, repositoryRoot, outputRoot, configPath, env,
    target, requiredLarkKeyFields,
  } = input;
  const keyFields = Object.freeze({
    ...DEFAULT_LARK_KEY_FIELDS,
    ...(requiredLarkKeyFields ?? {}),
  });

  async function verifyLarkInventory(client, tableIds) {
    const remoteTables = await client.listTables();
    const remoteIds = new Set(remoteTables
      .map((item) => String(item?.table_id ?? item?.tableId ?? item?.id ?? ''))
      .filter(Boolean));
    const fieldCounts = {};
    for (const [key, tableId] of Object.entries(tableIds)) {
      if (!remoteIds.has(tableId)) throw closeoutFailure(
        `Report closeout Lark table is missing: ${key}`,
        'REPORT_RUNTIME_CLOSEOUT_LARK_TABLE_MISSING',
        { tableKey: key },
      );
      const fields = await client.listFields({ tableId });
      fieldCounts[key] = fields.length;
      const keyField = keyFields[key];
      if (!keyField || !fields.some((field) => (
        field?.field_name ?? field?.fieldName ?? field?.name
      ) === keyField)) {
        throw closeoutFailure(
          `Report closeout Lark key field is missing: ${key}.${keyField ?? 'unknown'}`,
          'REPORT_RUNTIME_CLOSEOUT_LARK_KEY_FIELD_MISSING',
          { tableKey: key, fieldName: keyField ?? null },
        );
      }
    }
    return Object.freeze({
      tableCount: Object.keys(tableIds).length,
      fieldCountFingerprint: sha256(stableJson(fieldCounts)),
      metadataMutationCount: 0,
    });
  }

  async function readD1Rows(sql) {
    const maxAttempts = positiveInteger(
      env.MKT_REPORT_RUNTIME_CLOSEOUT_D1_READ_MAX_ATTEMPTS ?? 3,
      'd1ReadMaxAttempts',
    );
    const retryIntervalMs = positiveInteger(
      env.MKT_REPORT_RUNTIME_CLOSEOUT_D1_READ_RETRY_INTERVAL_MS ?? 2_000,
      'd1ReadRetryIntervalMs',
    );
    let output = null;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        output = await runText('npx', [
          'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
          '--config', configPath, '--command', sql,
        ], { env });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) await sleep(retryIntervalMs);
      }
    }

    if (lastError) throw closeoutFailure(
      'Report closeout D1 read failed after bounded retries',
      'REPORT_RUNTIME_CLOSEOUT_D1_READ_FAILED',
      {
        attemptCount: maxAttempts,
        sourceCode: normalizeCommandCode(lastError?.code),
        sourceSignal: normalizeCommandCode(lastError?.signal),
        stderr: normalizeCommandDiagnostic(lastError?.stderr),
        stdout: normalizeCommandDiagnostic(lastError?.stdout),
      },
    );

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw closeoutFailure(
        'Report closeout D1 read returned invalid JSON',
        'REPORT_RUNTIME_CLOSEOUT_D1_RESPONSE_INVALID',
        { responseBytes: Buffer.byteLength(String(output ?? '')) },
      );
    }
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => item?.results ?? [])
      : (parsed?.results ?? []);
  }

  async function readD1Row(sql) {
    const rows = await readD1Rows(sql);
    if (rows.length !== 1) throw closeoutFailure(
      'Report closeout D1 query returned an unexpected row count',
      'REPORT_RUNTIME_CLOSEOUT_D1_QUERY_SHAPE_INVALID',
      { rowCount: rows.length },
    );
    return Object.freeze({ ...rows[0] });
  }

  async function readExistingReportIds(reportIds) {
    const quoted = reportIds.map((value) => `'${sqlText(value)}'`).join(', ');
    const rows = await readD1Rows(`SELECT report_id FROM report_materializations WHERE report_id IN (${quoted});`);
    return rows.map((row) => String(row.report_id));
  }

  async function readD1Snapshot(selected, requestedAt) {
    const reportId = sqlText(selected.reportId);
    const platformScope = sqlText(target.platformScope);
    const accountKey = sqlText(target.accountKey);
    return readD1Row(compactSql(`
      SELECT
        (SELECT report_id FROM report_materializations WHERE report_id = '${reportId}') AS report_id,
        (SELECT data_status FROM report_materializations WHERE report_id = '${reportId}') AS data_status,
        (SELECT payload_checksum FROM report_materializations WHERE report_id = '${reportId}') AS payload_checksum,
        (SELECT payload_json FROM report_materializations WHERE report_id = '${reportId}') AS payload_json,
        (SELECT generated_at FROM report_materializations WHERE report_id = '${reportId}') AS generated_at,
        (SELECT COUNT(*) FROM report_materializations WHERE report_id = '${reportId}') AS materialization_count,
        (SELECT status FROM sync_runs
          WHERE platform = '${platformScope}' AND account_key = '${accountKey}'
            AND sync_type = 'dashboard_performance_report' AND started_at >= ${requestedAt}
          ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS sync_status,
        (SELECT COUNT(*) FROM sync_runs
          WHERE platform = '${platformScope}' AND account_key = '${accountKey}'
            AND sync_type = 'dashboard_performance_report' AND status = 'success'
            AND started_at >= ${requestedAt}) AS successful_sync_count,
        (SELECT COUNT(*) FROM sync_locks l
          JOIN sync_runs r ON r.sync_run_id = l.owner_id
          WHERE r.platform = '${platformScope}' AND r.account_key = '${accountKey}'
            AND r.sync_type = 'dashboard_performance_report'
            AND r.started_at >= ${requestedAt}
            AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
        (SELECT COUNT(*) FROM dead_letter_jobs
          WHERE job_type = 'report.materialization.generate' AND created_at >= ${requestedAt}) AS new_dlq_count;
    `));
  }

  async function pollD1Completion(selected, requestedAt, minimumSuccessfulRuns) {
    const maxPolls = positiveInteger(env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 24, 'maxPolls');
    const intervalMs = positiveInteger(
      env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000,
      'pollIntervalMs',
    );
    let row = null;
    for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
      row = await readD1Snapshot(selected, requestedAt);
      if (row.report_id === selected.reportId
        && row.sync_status === 'success'
        && Number(row.successful_sync_count ?? 0) >= minimumSuccessfulRuns
        && Number(row.active_lock_count ?? 0) === 0) return row;
      if (attempt < maxPolls) await sleep(intervalMs);
    }
    throw closeoutFailure(
      'Bounded verification did not observe completed Report materialization',
      'REPORT_RUNTIME_CLOSEOUT_VERIFY_TIMEOUT',
      { minimumSuccessfulRuns, rowPresent: row !== null },
    );
  }

  async function readLarkReportState(client, tableIds, reportId) {
    const targets = [
      ['snapshots', 'mktReportSnapshots'],
      ['metrics', 'mktReportMetricValues'],
      ['topContent', 'mktReportTopContent'],
      ['topAds', 'mktReportTopAds'],
    ];
    const recordsByName = {};
    for (const [name, key] of targets) {
      recordsByName[name] = await client.searchRecords({
        tableId: tableIds[key],
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: 'report_id', operator: 'is', value: [reportId] }],
        },
        pageSize: 500,
        maxPages: 1_000,
      });
    }
    const metricValues = {};
    let duplicateMetricKeys = 0;
    for (const record of recordsByName.metrics) {
      const reportMetricKey = normalizeLarkText(record?.fields?.report_metric_key);
      if (!reportMetricKey) throw closeoutFailure(
        'Lark Report metric row lacks report_metric_key',
        'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_KEY_MISSING',
      );
      if (Object.hasOwn(metricValues, reportMetricKey)) duplicateMetricKeys += 1;
      metricValues[reportMetricKey] = normalizeLarkNumber(record?.fields?.current_value);
    }
    return Object.freeze({
      snapshots: recordsByName.snapshots.length,
      metrics: recordsByName.metrics.length,
      topContent: recordsByName.topContent.length,
      topAds: recordsByName.topAds.length,
      duplicateMetricKeys,
      metricValues: Object.freeze(metricValues),
    });
  }

  async function pollLarkIntegrity(client, tableIds, reportId, d1) {
    return pollReportRuntimeLarkIntegrity({
      readState: () => readLarkReportState(client, tableIds, reportId),
      assertComplete: assertLarkCompletion,
      assertIntegrity: (state) => assertD1LarkIntegrity(d1, state),
    });
  }

  async function readPendingMigrations() {
    const output = await runText('npx', [
      'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote', '--config', configPath,
    ], { env });
    return [...new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
      .map((match) => match[0]))].sort();
  }

  async function createD1Backup(label = 'youtube-before-multiwindow') {
    const backupDir = join(outputRoot, 'backups');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const safeLabel = String(label).replace(/[^a-z0-9-]/giu, '-');
    const path = join(backupDir, `report-closeout-${safeLabel}-${Date.now()}.sql`);
    await run('npx', [
      'wrangler', 'd1', 'export', 'MKT_STATE_DB', '--remote', '--config', configPath, '--output', path,
    ], { env });
    await chmod(path, 0o600);
    const bytes = await readFile(path);
    if (bytes.length === 0) throw closeoutFailure(
      'Report closeout D1 backup is empty',
      'REPORT_RUNTIME_CLOSEOUT_BACKUP_EMPTY',
    );
    return Object.freeze({
      file: relative(repositoryRoot, path),
      bytes: bytes.length,
      sha256: sha256(bytes),
      remoteMutationCount: 0,
    });
  }

  return Object.freeze({
    verifyLarkInventory,
    readD1Row,
    readExistingReportIds,
    readD1Snapshot,
    pollD1Completion,
    readLarkReportState,
    pollLarkIntegrity,
    readPendingMigrations,
    createD1Backup,
  });
}

export function assertD1LarkIntegrity(d1, lark) {
  let payload;
  try { payload = JSON.parse(String(d1.payload_json ?? '')); } catch {
    throw closeoutFailure(
      'Report materialization payload_json is invalid',
      'REPORT_RUNTIME_CLOSEOUT_PAYLOAD_JSON_INVALID',
    );
  }
  if (lark.duplicateMetricKeys !== 0) throw closeoutFailure(
    'Lark Report metric rows contain duplicate report_metric_key values',
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_DUPLICATE',
    { duplicateMetricKeys: lark.duplicateMetricKeys },
  );
  return assertStableReportMetricIntegrity({
    reportId: d1.report_id,
    payload,
    larkMetrics: lark.metricValues,
  });
}
export function assertLarkCompletion(state) {
  if (state.snapshots !== 1
    || state.metrics <= 0
    || state.topContent < 0
    || state.topAds < 0
    || state.duplicateMetricKeys !== 0) {
    throw closeoutFailure(
      'Report closeout Lark materialization is incomplete',
      'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
      { state: summarizeLarkState(state) },
    );
  }
}
export function assertLarkReplay(before, after) {
  if (stableJson(before) !== stableJson(after)) throw closeoutFailure(
    'Report closeout replay changed Lark Stable-key rows or values',
    'REPORT_RUNTIME_CLOSEOUT_LARK_REPLAY_DRIFT',
    { before: summarizeLarkState(before), after: summarizeLarkState(after) },
  );
}
export function summarizeLarkState(lark) {
  return Object.freeze({
    snapshots: lark.snapshots,
    metrics: lark.metrics,
    topContent: lark.topContent,
    topAds: lark.topAds,
    duplicateMetricKeys: lark.duplicateMetricKeys,
  });
}

function assertStableReportMetricIntegrity(input) {
  const reportId = requireMetricText(input.reportId, 'reportId');
  const payload = requireMetricObject(input.payload, 'payload');
  const larkMetrics = requireMetricObject(input.larkMetrics, 'larkMetrics');
  const expected = collectExpectedStableMetricValues(reportId, payload);
  const expectedKeys = Object.keys(expected.values).sort();
  const observedKeys = Object.keys(larkMetrics).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(observedKeys)) throw closeoutFailure(
    'D1 and Lark Report stable metric key sets differ',
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_KEY_DRIFT',
    {
      expectedCount: expectedKeys.length,
      observedCount: observedKeys.length,
      summaryMetricCount: expected.summaryMetricCount,
      dimensionMetricCount: expected.dimensionMetricCount,
    },
  );

  let mismatchCount = 0;
  for (const key of expectedKeys) {
    if (canonicalizeMetricValue(expected.values[key]) !== canonicalizeMetricValue(larkMetrics[key])) {
      mismatchCount += 1;
    }
  }
  if (mismatchCount !== 0) throw closeoutFailure(
    'D1 and Lark Report stable metric values differ',
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_VALUE_DRIFT',
    {
      metricCount: expectedKeys.length,
      mismatchCount,
      summaryMetricCount: expected.summaryMetricCount,
      dimensionMetricCount: expected.dimensionMetricCount,
    },
  );
  return Object.freeze({
    metricCount: expectedKeys.length,
    summaryMetricCount: expected.summaryMetricCount,
    dimensionMetricCount: expected.dimensionMetricCount,
    mismatchCount,
  });
}

function collectExpectedStableMetricValues(reportId, payload) {
  const metricPayload = requireMetricObject(payload.metricPayload, 'payload.metricPayload');
  const values = {};
  let summaryMetricCount = 0;
  let dimensionMetricCount = 0;

  for (const [fallbackKey, value] of Object.entries(metricPayload)) {
    const metric = requireMetricObject(value, `payload.metricPayload.${fallbackKey}`);
    const metricKey = optionalMetricText(metric.metricKey) ?? requireMetricText(fallbackKey, 'summary metric key');
    const reportMetricKey = buildStableReportMetricKey(reportId, metric, metricKey);
    addExpectedStableMetric(values, reportMetricKey, metric.current);
    summaryMetricCount += 1;
  }

  const dimensionMetrics = payload.collections?.dimension_metrics ?? [];
  if (!Array.isArray(dimensionMetrics)) throw closeoutFailure(
    'payload.collections.dimension_metrics must be an array',
    'REPORT_RUNTIME_CLOSEOUT_DIMENSION_METRICS_INVALID',
  );
  for (const value of dimensionMetrics) {
    const metric = requireMetricObject(value, 'payload.collections.dimension_metrics row');
    const metricKey = requireMetricText(metric.metricKey, 'dimension metric key');
    const reportMetricKey = buildStableReportMetricKey(reportId, metric, metricKey);
    addExpectedStableMetric(values, reportMetricKey, metric.current);
    dimensionMetricCount += 1;
  }

  return Object.freeze({
    values: Object.freeze(values),
    summaryMetricCount,
    dimensionMetricCount,
  });
}

function buildStableReportMetricKey(reportId, metric, metricKey) {
  const stableMetricKey = optionalMetricText(metric.stableMetricKey ?? metric.stable_metric_key) ?? metricKey;
  const dimensionType = optionalMetricText(metric.dimensionType ?? metric.dimension_type) ?? 'summary';
  const dimensionValue = optionalMetricText(metric.dimensionValue ?? metric.dimension_value) ?? 'all';
  return [
    reportId,
    escapeReportIdentityPart(stableMetricKey),
    escapeReportIdentityPart(dimensionType),
    escapeReportIdentityPart(dimensionValue),
  ].join('::');
}

function addExpectedStableMetric(values, reportMetricKey, current) {
  if (Object.hasOwn(values, reportMetricKey)) throw closeoutFailure(
    'Report payload contains duplicate stable report metric identities',
    'REPORT_RUNTIME_CLOSEOUT_PAYLOAD_METRIC_DUPLICATE',
    { reportMetricKey },
  );
  values[reportMetricKey] = normalizeExpectedMetricNumber(current);
}

function canonicalizeMetricValue(value) {
  const number = normalizeExpectedMetricNumber(value);
  if (number === null) return null;
  const canonical = Number(number.toFixed(LARK_REPORT_METRIC_DECIMAL_PLACES));
  return Object.is(canonical, -0) ? 0 : canonical;
}

function normalizeExpectedMetricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw closeoutFailure(
    'Report metric must be finite or null',
    'REPORT_RUNTIME_CLOSEOUT_METRIC_VALUE_INVALID',
  );
  return number;
}

function optionalMetricText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireMetricText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw closeoutFailure(
    `${fieldName} is required`,
    'REPORT_RUNTIME_CLOSEOUT_METRIC_IDENTITY_INVALID',
    { fieldName },
  );
  return value.trim();
}
function requireMetricObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw closeoutFailure(
    `${fieldName} is required`,
    'REPORT_RUNTIME_CLOSEOUT_METRIC_IDENTITY_INVALID',
    { fieldName },
  );
  return value;
}
function normalizeLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(normalizeLarkText).filter(Boolean).join('') || null;
  if (value && typeof value === 'object') return normalizeLarkText(value.text ?? value.value ?? value.name);
  return value == null ? null : String(value).trim() || null;
}
function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object' ? scalar.value ?? scalar.text : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  if (!Number.isFinite(number)) throw closeoutFailure(
    'Lark Report metric current_value is not finite or null',
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_VALUE_INVALID',
  );
  return number;
}
function normalizeCommandCode(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).slice(0, 128);
}
function normalizeCommandDiagnostic(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text === '' ? null : text.slice(0, 2_000);
}