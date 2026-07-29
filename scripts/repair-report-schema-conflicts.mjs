#!/usr/bin/env node

import {
  applyLarkReportSchemaConflictRepair,
  planLarkReportSchemaConflictRepair,
  safeReportSchemaConflictRepairEvidence,
} from '../packages/application/src/use-cases/repair-lark-report-schema-conflicts.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { assertReportRuntimeFinalizeEnvironment } from './lib/report-runtime-finalize-operator.js';
import { readDevVars } from './lib/dev-vars.js';

try {
  const apply = parseArgs(process.argv.slice(2));
  const env = await readRuntimeEnvironment();
  assertReportRuntimeFinalizeEnvironment(env);
  const client = createLarkBitableClientFromEnv(env);
  const result = apply
    ? await applyLarkReportSchemaConflictRepair({ client, env })
    : await planLarkReportSchemaConflictRepair({ client, env });
  const safe = safeReportSchemaConflictRepairEvidence(result);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ...safe,
    ...(apply ? {
      remoteMutationCount: result.appliedRepairCount,
      businessValueMutationCount: 0,
      deleteCount: 0,
    } : {
      remoteMutationCount: 0,
      businessValueMutationCount: 0,
      deleteCount: 0,
    }),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'REPORT_SCHEMA_CONFLICT_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportSchemaConflictRepairEvidence(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const unknown = argv.filter((argument) => argument !== '--apply');
  if (unknown.length > 0) throw new TypeError(
    `Unsupported Report schema conflict recovery arguments: ${unknown.join(', ')}`,
  );
  return argv.includes('--apply');
}

async function readRuntimeEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = { ...fileEnv, ...process.env };
  if (!env.LARK_APP_TOKEN && env.LARK_BASE_APP_TOKEN) env.LARK_APP_TOKEN = env.LARK_BASE_APP_TOKEN;
  return Object.freeze(env);
}
