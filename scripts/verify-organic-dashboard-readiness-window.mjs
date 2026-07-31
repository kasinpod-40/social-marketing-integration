#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  planLarkReportSchema,
} from '../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../packages/config/src/lark-report-schema-v2.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readLarkNumber, readLarkText } from '../packages/connectors/src/shared/lark-cell-value.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION,
  assertOrganicDashboardReadinessCloseoutSummary,
  assertOrganicDashboardReadinessWindow,
} from './lib/organic-dashboard-readiness-refresh.js';

const execFileAsync = promisify(execFile);
const REPORT_METRIC_VALUES_ENV_NAME = 'LARK_TABLE_MKT_REPORT_METRIC_VALUES';
const evidenceRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR
    ?? 'outputs/organic-dashboard-readiness-refresh/window',
);
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const windowDays = Number(process.env.MKT_ORGANIC_DASHBOARD_READINESS_WINDOW_DAYS);
let currentStage = 'init';

try {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });

  currentStage = 'read-closeout-summary';
  const closeoutSummary = JSON.parse(await readFile(
    join(evidenceRoot, 'report-runtime-closeout-summary.json'),
    'utf8',
  ));
  const closeout = assertOrganicDashboardReadinessCloseoutSummary(closeoutSummary, windowDays);

  currentStage = 'read-d1-materialization';
  const d1Rows = await readD1Rows(closeout.reportId, env);
  if (d1Rows.length !== 1) throw verifierError(
    'Expected exactly one D1 Report materialization row',
    'ORGANIC_DASHBOARD_READINESS_D1_ROW_COUNT_INVALID',
    { windowDays, rowCount: d1Rows.length },
  );
  const d1 = d1Rows[0];
  if (String(d1.payload_checksum ?? '') !== closeout.payloadChecksum) throw verifierError(
    'Closeout and D1 payload checksums differ',
    'ORGANIC_DASHBOARD_READINESS_D1_CHECKSUM_DRIFT',
    { windowDays },
  );
  let payload;
  try {
    payload = JSON.parse(String(d1.payload_json ?? ''));
  } catch {
    throw verifierError(
      'D1 Report payload_json is invalid',
      'ORGANIC_DASHBOARD_READINESS_D1_PAYLOAD_INVALID',
      { windowDays },
    );
  }

  const client = createLarkBitableClientFromEnv(env);
  currentStage = 'resolve-lark-report-schema';
  const tableId = await resolveReportMetricValuesTableId({ client, env });

  currentStage = 'read-lark-metric-rows';
  const records = await client.searchRecords({
    tableId,
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'report_id', operator: 'is', value: [closeout.reportId] }],
    },
    pageSize: 500,
    maxPages: 1_000,
  });
  const larkRows = records.map(normalizeLarkMetricRow);

  currentStage = 'verify-d1-lark-readiness-parity';
  const readiness = assertOrganicDashboardReadinessWindow({
    windowDays,
    payload,
    larkRows,
  });

  const summary = Object.freeze({
    ok: true,
    contractVersion: ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION,
    decision: 'ORGANIC_DASHBOARD_READINESS_WINDOW_VERIFIED',
    windowDays,
    reportId: closeout.reportId,
    payloadChecksum: closeout.payloadChecksum,
    metricCount: readiness.metricCount,
    valueMismatchCount: readiness.valueMismatchCount,
    metadataMismatchCount: readiness.metadataMismatchCount,
    scopeCounts: readiness.scopeCounts,
    availabilityCounts: readiness.availabilityCounts,
    incompleteBaseline: readiness.incompleteBaseline,
    coverageRate: readiness.coverageRate,
    restoredAllFalse: true,
    finalWorkerVersion: closeout.finalWorkerVersion,
    remoteMutationDuringVerification: false,
    production: false,
  });
  const evidencePath = join(evidenceRoot, 'organic-dashboard-readiness-verification.json');
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'ORGANIC_DASHBOARD_READINESS_WINDOW_VERIFY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    remoteMutationDuringVerification: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function readD1Rows(reportId, env) {
  const sql = `SELECT report_id, payload_json, payload_checksum FROM report_materializations WHERE report_id = '${sqlText(reportId)}';`;
  const result = await execFileAsync('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--config', configPath,
    '--json', '--command', sql,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(result.stdout ?? ''));
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => Array.isArray(item?.results) ? item.results : []);
}

async function resolveReportMetricValuesTableId({ client, env }) {
  const preview = await planLarkReportSchema({
    client,
    env,
    schema: LARK_REPORT_SCHEMA_V2,
    schemaVersion: LARK_REPORT_SCHEMA_V2_VERSION,
    validateSchema: validateReportSchemaV2,
  });
  const actionCount = Array.isArray(preview?.actions) ? preview.actions.length : -1;
  const conflictCount = Array.isArray(preview?.conflicts) ? preview.conflicts.length : -1;
  if (preview?.readyToApply !== true || actionCount !== 0 || conflictCount !== 0) {
    throw verifierError(
      'Lark Report schema must be clean before readiness verification',
      'ORGANIC_DASHBOARD_READINESS_VERIFY_SCHEMA_NOT_CONVERGED',
      { actionCount, conflictCount },
    );
  }
  return requireText(
    preview.environmentUpdates?.[REPORT_METRIC_VALUES_ENV_NAME],
    REPORT_METRIC_VALUES_ENV_NAME,
  );
}

function normalizeLarkMetricRow(record) {
  const fields = record?.fields ?? {};
  return Object.freeze({
    metricKey: readLarkText(fields.metric_key, { allowNull: false, label: 'metric_key' }),
    currentValue: readLarkNumber(fields.current_value, { allowNull: true, label: 'current_value' }),
    metricScope: readLarkText(fields.metric_scope, { allowNull: false, label: 'metric_scope' }),
    availabilityStatus: readLarkText(
      fields.availability_status,
      { allowNull: false, label: 'availability_status' },
    ),
    availabilityMessage: readLarkText(
      fields.availability_message,
      { allowNull: false, label: 'availability_message' },
    ),
  });
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
function sqlText(value) { return String(value).replaceAll("'", "''"); }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw verifierError(
    `${fieldName} is required`,
    'ORGANIC_DASHBOARD_READINESS_VERIFY_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}
function verifierError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'OrganicDashboardReadinessWindowVerifierError';
  error.code = code;
  error.details = details;
  return error;
}
