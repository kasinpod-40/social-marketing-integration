#!/usr/bin/env node

import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
  applyLarkBaseDocumentedVisibleFieldOrderParity,
  planLarkBaseDocumentedVisibleFieldOrderParity,
} from '../packages/application/src/use-cases/apply-lark-base-documented-view-parity.js';
import { printJson } from './lib/lark-runtime.js';

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub.base';
const SOURCE_EXPORT_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const TARGET_LABEL = '✨Marketing Content Calendar';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const REQUIRED_TARGET_ANCHORS = Object.freeze([
  PROTECTED_EXTERNAL_TABLE,
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);
const EXPECTED_SOURCE = Object.freeze({
  tables: 33,
  fields: 723,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
});
const EXPECTED_CLONE = Object.freeze({
  tables: 32,
  fields: 705,
  views: 110,
});

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_visible_field_order_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: redactDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveMode(process.argv.slice(2));
  const prodVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars';
  const fileEnv = await readDevVars(prodVarsFile);
  const env = { ...fileEnv, ...process.env };
  const sourceFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Desktop', SOURCE_EXPORT_FILENAME);
  const inspection = await inspectLarkBaseExport(sourceFile);
  assertCurrentSource(inspection);

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
    excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
  });
  const expectedTableNames = (await sourceClient.listTables())
    .map((table) => requireText(table?.name, 'Source clone table name'));
  assertUnique(expectedTableNames, 'Source clone table names');
  if (expectedTableNames.includes(PROTECTED_EXTERNAL_TABLE)) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PROTECTED_SCOPE_VIOLATION',
      'Protected external TikTok table must not be present in visible-field order scope',
    );
  }
  const cloneScope = await countCloneScope(sourceClient);
  assertExpectedScope(cloneScope, EXPECTED_CLONE, 'Source clone scope');

  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  });
  await assertTargetIdentity(targetClient, expectedTableNames);

  const preview = await planLarkBaseDocumentedVisibleFieldOrderParity({
    sourceClient,
    targetClient,
    expectedTableNames,
  });
  assertCompletePlan(preview);

  if (mode === 'preview') {
    printJson({
      ok: preview.ok,
      contractVersion: 'customer_base_visible_field_order_operator_v1',
      action: 'preview',
      stage: preview.ok
        ? 'documented-visible-fields-order-ready'
        : 'documented-visible-fields-order-blocked',
      status: preview.ok
        ? 'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PREVIEW_PASS'
        : 'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PREVIEW_BLOCKED',
      target: TARGET_LABEL,
      sourceAuthority: {
        fileName: basename(sourceFile),
        sha256: inspection.file.sha256,
        counts: inspection.counts,
      },
      cloneScope,
      documentedContract: {
        method: 'PUT',
        property: 'visible_fields',
        controls: ['visibility', 'visible-field-order'],
      },
      preview: summarizePreview(preview),
      safety: zeroMutationSafety(),
      next: preview.ok
        ? `CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION=${CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION} node scripts/customer-base-visible-field-order-parity.mjs --apply`
        : null,
    });
    if (!preview.ok) process.exitCode = 1;
    return;
  }

  const confirmation = requireText(
    env.CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
    'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION',
  );
  if (confirmation !== CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION_REQUIRED',
      'Exact visible-field order confirmation is required before Target mutation',
      { expected: CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION },
    );
  }

  const result = await applyLarkBaseDocumentedVisibleFieldOrderParity({
    confirmation,
    sourceClient,
    targetClient,
    expectedTableNames,
    onProgress: (event) => console.error(JSON.stringify(event)),
  });

  if (!result.ok || result.verifiedExactViews !== EXPECTED_CLONE.views) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_FINAL_VERIFY_FAILED',
      'Visible-field order apply did not finish with all cloned Views exact',
      {
        result,
        expectedExactViews: EXPECTED_CLONE.views,
      },
    );
  }

  printJson({
    ok: true,
    contractVersion: 'customer_base_visible_field_order_operator_v1',
    action: 'apply',
    stage: 'documented-visible-fields-order-applied-and-readback-verified',
    status: 'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PASS',
    target: TARGET_LABEL,
    sourceAuthority: {
      fileName: basename(sourceFile),
      sha256: inspection.file.sha256,
      counts: inspection.counts,
    },
    cloneScope,
    before: {
      exactViews: preview.exactViews,
      mismatchedViews: preview.mismatchedViews,
    },
    result,
    safety: {
      ...zeroMutationSafety(),
      viewVisibleFieldOrderMutationCount: result.remoteMutationCount,
      rollbackMutationCount: result.rollbackMutationCount,
    },
  });
}

function summarizePreview(preview) {
  return Object.freeze({
    representedViews: preview?.representedViews ?? 0,
    exactViews: preview?.exactViews ?? 0,
    mismatchedViews: preview?.mismatchedViews ?? 0,
    blockerCount: Array.isArray(preview?.blockers) ? preview.blockers.length : 0,
    blockers: Array.isArray(preview?.blockers)
      ? preview.blockers.map((item) => redactDetails(item))
      : [],
    changes: Array.isArray(preview?.steps)
      ? preview.steps
        .filter((step) => step?.needsUpdate === true)
        .map((step) => Object.freeze({
          tableName: step.tableName,
          viewName: step.viewName,
          beforeVisibleFields: [...step.beforeVisibleFields],
          desiredVisibleFields: [...step.desiredVisibleFields],
        }))
      : [],
  });
}

function resolveMode(argv) {
  const preview = argv.includes('--preview');
  const apply = argv.includes('--apply');
  if (preview && apply) throw new TypeError('Choose only one of --preview or --apply');
  const unknown = argv.filter((arg) => !['--preview', '--apply'].includes(arg));
  if (unknown.length > 0) throw new TypeError(`Unknown argument: ${unknown.join(', ')}`);
  return apply ? 'apply' : 'preview';
}

async function countCloneScope(client) {
  const tables = await client.listTables();
  let fields = 0;
  let views = 0;
  for (const table of tables) {
    const tableId = requireText(table?.tableId, `clone tableId ${table?.name ?? '<unknown>'}`);
    fields += (await client.listFields({ tableId })).length;
    views += (await client.listViews({ tableId })).length;
  }
  return Object.freeze({ tables: tables.length, fields, views });
}

async function assertTargetIdentity(client, expectedTableNames) {
  const tables = await client.listTables();
  const byName = new Map();
  for (const table of tables) {
    const name = requireText(table?.name, 'Target table name');
    if (byName.has(name)) {
      throw codedError('CUSTOMER_BASE_VISIBLE_FIELD_ORDER_TARGET_DUPLICATE_TABLE', `Target contains duplicate table name: ${name}`);
    }
    byName.set(name, table);
  }
  const missingAnchors = REQUIRED_TARGET_ANCHORS.filter((name) => !byName.has(name));
  const missingCloneTables = expectedTableNames.filter((name) => !byName.has(name));
  if (missingAnchors.length > 0 || missingCloneTables.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_TARGET_IDENTITY_MISMATCH',
      'Configured Target does not match the approved customer Base identity/scope',
      { missingAnchors, missingCloneTables },
    );
  }
}

function assertCurrentSource(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(EXPECTED_SOURCE)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  if (mismatches.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_SOURCE_AUTHORITY_MISMATCH',
      'Source export is not the approved current authority; no Target write is allowed',
      { mismatches },
    );
  }
}

function assertExpectedScope(actual, expected, label) {
  const mismatches = [];
  for (const [dimension, expectedValue] of Object.entries(expected)) {
    if (actual?.[dimension] !== expectedValue) {
      mismatches.push({ dimension, expected: expectedValue, actual: actual?.[dimension] ?? null });
    }
  }
  if (mismatches.length > 0) {
    throw codedError('CUSTOMER_BASE_VISIBLE_FIELD_ORDER_SCOPE_MISMATCH', `${label} is not the approved clone scope`, { mismatches });
  }
}

function assertCompletePlan(plan) {
  if (!plan?.ok) return;
  if (plan.representedViews !== EXPECTED_CLONE.views) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PLAN_COVERAGE_MISMATCH',
      'Visible-field order plan must cover exactly all 110 cloned Views before mutation',
      { expected: EXPECTED_CLONE.views, actual: plan?.representedViews ?? null },
    );
  }
  if (plan.exactViews + plan.mismatchedViews !== EXPECTED_CLONE.views) {
    throw codedError(
      'CUSTOMER_BASE_VISIBLE_FIELD_ORDER_PLAN_ACCOUNTING_MISMATCH',
      'Visible-field order plan accounting does not cover all cloned Views',
      {
        expected: EXPECTED_CLONE.views,
        exactViews: plan.exactViews,
        mismatchedViews: plan.mismatchedViews,
      },
    );
  }
}

function zeroMutationSafety() {
  return Object.freeze({
    sourceMutationCount: 0,
    tableMutationCount: 0,
    fieldMutationCount: 0,
    recordMutationCount: 0,
    filterMutationCount: 0,
    sortMutationCount: 0,
    groupMutationCount: 0,
    formulaMutationCount: 0,
    dashboardMutationCount: 0,
    automationMutationCount: 0,
    workerDeployCount: 0,
    d1MutationCount: 0,
    queueMutationCount: 0,
    scheduleMutationCount: 0,
    protectedTikTokMutationCount: 0,
  });
}

function redactDetails(value) {
  if (Array.isArray(value)) return value.map(redactDetails);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:target|source)?(?:table|view|field)?id$/iu.test(key)
      || /(?:table|view|field)Ids?$/iu.test(key)
      || key === 'targetAppToken') {
      continue;
    }
    output[key] = redactDetails(nested);
  }
  return output;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
