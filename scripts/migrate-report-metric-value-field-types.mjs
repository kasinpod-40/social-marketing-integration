#!/usr/bin/env node

import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from './lib/report-metric-value-field-migration.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { createVerifiedFieldMutationClient } from './lib/lark-verified-field-mutation-client.js';
import { assertReportRuntimeFinalizeEnvironment } from './lib/report-runtime-finalize-operator.js';
import { readDevVars } from './lib/dev-vars.js';

try {
  const apply = parseArgs(process.argv.slice(2));
  const env = await readRuntimeEnvironment();
  assertReportRuntimeFinalizeEnvironment(env);
  const baseClient = createLarkBitableClientFromEnv(env);
  const client = apply ? createVerifiedFieldMutationClient(baseClient) : baseClient;
  const result = apply
    ? await applyReportMetricValueFieldMigration({ client, env })
    : await planReportMetricValueFieldMigration({ client, env });
  const safe = safeReportMetricValueFieldMigrationEvidence(result);
  process.stdout.write(`${JSON.stringify({
    ...safe,
    ok: true,
    mode: apply ? 'apply' : 'preview',
    ...(apply ? {} : {
      remoteMutationCount: 0,
      legacyValueMutationCount: 0,
      deleteCount: 0,
      nextCommand: `CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION=${REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION} node scripts/migrate-report-metric-value-field-types.mjs --apply`,
    }),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'REPORT_METRIC_FIELD_MIGRATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportMetricValueFieldMigrationEvidence(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const unknown = argv.filter((argument) => argument !== '--apply');
  if (unknown.length > 0) {
    throw new TypeError(`Unsupported Report Metric field migration arguments: ${unknown.join(', ')}`);
  }
  return argv.includes('--apply');
}

async function readRuntimeEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = { ...fileEnv, ...process.env };
  if (!env.LARK_APP_TOKEN && env.LARK_BASE_APP_TOKEN) env.LARK_APP_TOKEN = env.LARK_BASE_APP_TOKEN;
  return Object.freeze(env);
}
