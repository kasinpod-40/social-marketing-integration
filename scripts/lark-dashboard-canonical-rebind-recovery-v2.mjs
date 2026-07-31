#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CANONICAL_REPORT_FIELD_NAMES,
  LEGACY_REPORT_FIELD_NAMES,
  ORGANIC_DASHBOARD_NAME,
  ORGANIC_METRIC_BINDINGS,
  ORGANIC_PERIOD_METRIC_KEYS,
  REPORT_METRIC_TABLE_NAME,
  assertCanonicalOrganicMetricBinding,
  assertOrganicMetricBlockNames,
  collectLegacyFieldReferences,
  hasComputedDashboardValue,
  hasDashboardProtocol,
  rewriteDashboardBlockDataConfig,
} from './lib/lark-dashboard-canonical-rebind-v1.js';
import {
  LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
  assertDashboardRecoveryScopeConfirmation,
  buildFullDashboardBlockUpdateBody,
  classifyDashboardBlockMutation,
  stableDashboardConfigString,
} from './lib/lark-dashboard-canonical-rebind-recovery-v2.js';

const execFileAsync = promisify(execFile);
const EXECUTION_CONFIRMATION = 'REBIND_EXISTING_DASHBOARDS_AND_REMOVE_LEGACY_FIELDS';
const EXPECTED_DASHBOARD_NAMES = Object.freeze([
  '📊 Executive Marketing Overview',
  '🌱 Organic Performance',
  '💰 Paid Ads Performance',
  '🛒 Commerce & Conversion',
  '💬 Customer Service & Leads',
  '🛡️ Data Quality & Operations',
]);
const CANONICAL_FIELD_TYPES = Object.freeze({
  [CANONICAL_REPORT_FIELD_NAMES.metricKey]: 1,
  [CANONICAL_REPORT_FIELD_NAMES.displayName]: 1,
  [CANONICAL_REPORT_FIELD_NAMES.windowDays]: 2,
  [CANONICAL_REPORT_FIELD_NAMES.currentValue]: 2,
});
const LEGACY_FIELD_SET = new Set(LEGACY_REPORT_FIELD_NAMES);
const PERIOD_METRIC_KEY_SET = new Set(ORGANIC_PERIOD_METRIC_KEYS);
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let currentAction = null;
let confirmedBlockMutations = 0;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_CANONICAL_REBIND_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-canonical-rebind-v1'),
  );
  const attemptRoot = join(
    evidenceRoot,
    `recovery-v2-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    currentStage = 'confirm-execution';
    assertExecutionConfirmation();
    assertDashboardRecoveryScopeConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_RECOVERY_SCOPE_CONTRACT,
    );
    await assertExactMain(repositoryRoot);
  }

  currentStage = 'read-private-environment';
  const fileEnv = await readDevVars(
    resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'),
  );
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const baseToken = requireText(
    env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN,
    'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN',
  );
  const client = createLarkBitableClientFromEnv(env);

  currentStage = 'resolve-report-table';
  const tables = await client.listTables();
  const reportTable = uniqueByName(tables, REPORT_METRIC_TABLE_NAME, 'Report Metric table');
  const tableId = requireText(reportTable.tableId, 'Report Metric tableId');

  currentStage = 'inspect-report-fields';
  const fieldsBefore = await client.listFields({ tableId });
  assertCanonicalFields(fieldsBefore);
  assertNoUnknownLegacyFields(fieldsBefore);
  const retainedLegacyFields = fieldsBefore.filter((field) => LEGACY_FIELD_SET.has(field.fieldName));

  currentStage = 'read-dashboard-state';
  const dashboardsBefore = await readDashboardState({ client, baseToken });
  assertDashboardSet(dashboardsBefore);
  const plan = buildRebindPlan(dashboardsBefore);
  await writePrivateJson(join(attemptRoot, 'dashboard-state-before.json'), {
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    dashboards: dashboardsBefore.map(safeDashboardEvidence),
  });
  await writePrivateJson(join(attemptRoot, 'recovery-plan.json'), safePlanEvidence(plan));

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    decision: execute
      ? 'LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_EXECUTION_AUTHORIZED'
      : 'LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_PREVIEW_READY',
    dashboardCount: dashboardsBefore.length,
    organicMetricBlockCount: plan.organicMetricBlockCount,
    affectedBlockCount: plan.affectedBlockCount,
    pendingBlockUpdateCount: plan.pendingBlockUpdateCount,
    convergedBlockCount: plan.convergedBlockCount,
    legacyFieldCount: retainedLegacyFields.length,
    legacyReferenceCount: plan.legacyReferenceCount,
    fullDataConfigWrite: true,
    perBlockCheckpoint: true,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  currentStage = 'backup-legacy-values';
  await writePrivateJson(
    join(attemptRoot, 'legacy-values-before-delete.json'),
    await buildLegacyValueBackup({ client, tableId, fields: retainedLegacyFields }),
  );

  currentStage = 'apply-dashboard-rebind';
  const updateEvidence = [];
  for (let index = 0; index < plan.actions.length; index += 1) {
    const planned = plan.actions[index];
    currentAction = safeActionIdentity(planned, index);

    const currentBlock = await getDashboardBlock({
      client,
      baseToken,
      dashboardId: planned.dashboardId,
      blockId: planned.blockId,
    });
    const rewrite = rewriteDashboardBlockDataConfig({
      dashboardName: planned.dashboardName,
      blockName: planned.blockName,
      dataConfig: currentBlock.dataConfig,
    });
    const checkpointBase = {
      contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
      ...currentAction,
      metricKey: rewrite.metricKey,
      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),
      beforeChecksum: checksumConfig(currentBlock.dataConfig),
      targetChecksum: checksumConfig(rewrite.dataConfig),
    };

    if (!rewrite.changed) {
      verifyActionReadback({ ...planned, metricKey: rewrite.metricKey }, currentBlock);
      const checkpoint = Object.freeze({
        ...checkpointBase,
        outcome: 'already_converged',
        patchAttempted: false,
        verified: true,
      });
      await writePrivateJson(actionEvidencePath(attemptRoot, index, 'converged'), checkpoint);
      updateEvidence.push(checkpoint);
      continue;
    }

    await writePrivateJson(actionEvidencePath(attemptRoot, index, 'before'), {
      ...checkpointBase,
      outcome: 'pending_full_config_patch',
      patchAttempted: false,
      fullDataConfigWrite: true,
    });

    let patchError = null;
    try {
      await updateDashboardBlockFull({
        client,
        baseToken,
        dashboardId: planned.dashboardId,
        blockId: planned.blockId,
        dataConfig: rewrite.dataConfig,
      });
    } catch (error) {
      patchError = error;
    }

    let readback;
    try {
      readback = await getDashboardBlock({
        client,
        baseToken,
        dashboardId: planned.dashboardId,
        blockId: planned.blockId,
      });
    } catch (readbackError) {
      throw operatorError(
        'Dashboard Block PATCH outcome is unknown because readback failed',
        'LARK_DASHBOARD_RECOVERY_PATCH_READBACK_FAILED',
        {
          ...currentAction,
          patchErrorCode: patchError?.code ?? null,
          patchErrorMessage: patchError instanceof Error ? patchError.message : null,
          readbackErrorCode: readbackError?.code ?? null,
          readbackErrorMessage: readbackError instanceof Error
            ? readbackError.message
            : String(readbackError),
          currentBlockMayHaveWritten: true,
          confirmedBlockMutations,
        },
      );
    }

    const mutationOutcome = classifyDashboardBlockMutation({
      before: currentBlock.dataConfig,
      target: rewrite.dataConfig,
      after: readback.dataConfig,
    });
    const checkpoint = Object.freeze({
      ...checkpointBase,
      outcome: mutationOutcome,
      patchAttempted: true,
      patchReturnedError: patchError !== null,
      patchErrorCode: patchError?.code ?? null,
      patchLarkCode: patchError?.details?.larkCode ?? null,
      afterChecksum: checksumConfig(readback.dataConfig),
      verified: mutationOutcome === 'target_converged',
    });
    await writePrivateJson(actionEvidencePath(attemptRoot, index, 'after'), checkpoint);

    if (mutationOutcome === 'target_converged') {
      verifyActionReadback({ ...planned, metricKey: rewrite.metricKey }, readback);
      confirmedBlockMutations += 1;
      updateEvidence.push(checkpoint);
      continue;
    }

    if (mutationOutcome === 'rejected_unchanged') {
      throw operatorError(
        'Lark rejected the full Dashboard Block data_config without changing the Block',
        'LARK_DASHBOARD_RECOVERY_FULL_CONFIG_PATCH_REJECTED',
        {
          ...currentAction,
          patchErrorCode: patchError?.code ?? null,
          patchErrorMessage: patchError instanceof Error ? patchError.message : null,
          larkCode: patchError?.details?.larkCode ?? null,
          currentBlockMayHaveWritten: false,
          confirmedBlockMutations,
        },
      );
    }

    throw operatorError(
      'Dashboard Block state drifted to neither the original nor canonical target configuration',
      'LARK_DASHBOARD_RECOVERY_PATCH_STATE_DRIFT',
      {
        ...currentAction,
        patchErrorCode: patchError?.code ?? null,
        patchErrorMessage: patchError instanceof Error ? patchError.message : null,
        currentBlockMayHaveWritten: true,
        confirmedBlockMutations,
      },
    );
  }

  await writePrivateJson(join(attemptRoot, 'dashboard-block-checkpoints.json'), {
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    updates: updateEvidence,
  });

  currentStage = 'verify-dashboard-bindings';
  currentAction = null;
  const reboundState = await readDashboardState({ client, baseToken });
  const reboundPlan = buildRebindPlan(reboundState);
  if (reboundPlan.pendingBlockUpdateCount !== 0 || reboundPlan.legacyReferenceCount !== 0) {
    throw operatorError(
      'Dashboard canonical rebind did not converge before Legacy field deletion',
      'LARK_DASHBOARD_RECOVERY_NOT_CONVERGED',
      {
        pendingBlockUpdateCount: reboundPlan.pendingBlockUpdateCount,
        legacyReferenceCount: reboundPlan.legacyReferenceCount,
        confirmedBlockMutations,
      },
    );
  }

  currentStage = 'verify-organic-dashboard-data';
  const organicVerification = await verifyOrganicDashboardData({
    client,
    baseToken,
    dashboards: reboundState,
  });
  await writePrivateJson(
    join(attemptRoot, 'organic-dashboard-computed-data-verification.json'),
    organicVerification,
  );

  currentStage = 'delete-legacy-fields';
  const deletedFields = [];
  for (let index = 0; index < retainedLegacyFields.length; index += 1) {
    const field = retainedLegacyFields[index];
    const currentFields = await client.listFields({ tableId });
    const current = currentFields.find((candidate) => candidate.fieldName === field.fieldName);
    if (!current) {
      await writePrivateJson(join(attemptRoot, `legacy-field-${index + 1}-already-absent.json`), {
        contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
        fieldName: field.fieldName,
        outcome: 'already_absent',
      });
      continue;
    }
    await client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}`
        + `/tables/${encodeURIComponent(tableId)}`
        + `/fields/${encodeURIComponent(requireText(current.fieldId, 'legacy fieldId'))}`,
      { method: 'DELETE' },
    );
    const readback = await client.listFields({ tableId });
    if (readback.some((candidate) => candidate.fieldName === field.fieldName)) {
      throw operatorError(
        'Legacy Report field remained after delete response',
        'LARK_DASHBOARD_RECOVERY_FIELD_DELETE_NOT_CONVERGED',
        { fieldName: field.fieldName, deletedFieldCount: deletedFields.length },
      );
    }
    deletedFields.push(field.fieldName);
    await writePrivateJson(join(attemptRoot, `legacy-field-${index + 1}-deleted.json`), {
      contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
      fieldName: field.fieldName,
      outcome: 'deleted_and_verified',
    });
  }

  currentStage = 'final-readback';
  const finalFields = await client.listFields({ tableId });
  assertCanonicalFields(finalFields);
  assertNoUnknownLegacyFields(finalFields);
  const remainingLegacyFields = finalFields.filter((field) => LEGACY_FIELD_SET.has(field.fieldName));
  if (remainingLegacyFields.length !== 0) {
    throw operatorError(
      'Legacy Report fields remain after cleanup',
      'LARK_DASHBOARD_RECOVERY_FIELD_CLEANUP_INCOMPLETE',
      { remainingLegacyFieldCount: remainingLegacyFields.length },
    );
  }

  const finalDashboards = await readDashboardState({ client, baseToken });
  const finalPlan = buildRebindPlan(finalDashboards);
  if (finalPlan.pendingBlockUpdateCount !== 0 || finalPlan.legacyReferenceCount !== 0) {
    throw operatorError(
      'Dashboard binding drifted after Legacy field cleanup',
      'LARK_DASHBOARD_RECOVERY_FINAL_BINDING_DRIFT',
      {
        pendingBlockUpdateCount: finalPlan.pendingBlockUpdateCount,
        legacyReferenceCount: finalPlan.legacyReferenceCount,
      },
    );
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    decision: 'LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_COMPLETED_SAFE',
    dashboardCount: finalDashboards.length,
    organicMetricBlockCount: finalPlan.organicMetricBlockCount,
    affectedBlockCount: plan.affectedBlockCount,
    confirmedBlockMutationCount: confirmedBlockMutations,
    alreadyConvergedBlockCount: updateEvidence.filter(
      (entry) => entry.outcome === 'already_converged',
    ).length,
    deletedLegacyFieldCount: deletedFields.length,
    remainingLegacyFieldCount: 0,
    remainingLegacyReferenceCount: 0,
    computedOrganicMetricCount: organicVerification.computedMetricCount,
    baselineIncompleteMetricCount: organicVerification.baselineIncompleteMetricCount,
    fullDataConfigWrite: true,
    dashboardIdsPreserved: true,
    blockIdsPreserved: true,
    layoutMutationCount: 0,
    recordDeleteCount: 0,
    businessFactMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: {
      ...(error?.details ?? {}),
      currentAction,
      confirmedBlockMutations,
    },
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function buildRebindPlan(dashboards) {
  const organic = uniqueByName(dashboards, ORGANIC_DASHBOARD_NAME, 'Organic dashboard');
  assertOrganicMetricBlockNames(organic.blocks.map((block) => block.name));
  const actions = [];
  let legacyReferenceCount = 0;

  for (const dashboard of dashboards) {
    for (const block of dashboard.blocks) {
      const legacyReferences = collectLegacyFieldReferences(block.dataConfig);
      const isOrganicMetric = dashboard.name === ORGANIC_DASHBOARD_NAME
        && Object.hasOwn(ORGANIC_METRIC_BINDINGS, block.name);
      if (!isOrganicMetric && legacyReferences.length === 0) continue;
      const rewrite = rewriteDashboardBlockDataConfig({
        dashboardName: dashboard.name,
        blockName: block.name,
        dataConfig: block.dataConfig,
      });
      legacyReferenceCount += legacyReferences.length;
      actions.push(Object.freeze({
        dashboardId: dashboard.dashboardId,
        dashboardName: dashboard.name,
        blockId: block.blockId,
        blockName: block.name,
        blockType: block.type,
        metricKey: rewrite.metricKey,
        changed: rewrite.changed,
        patch: rewrite.patch,
        dataConfig: rewrite.dataConfig,
        legacyReferencesBefore: rewrite.legacyReferencesBefore,
      }));
    }
  }

  const organicActions = actions.filter(
    (action) => action.dashboardName === ORGANIC_DASHBOARD_NAME && action.metricKey,
  );
  if (organicActions.length !== Object.keys(ORGANIC_METRIC_BINDINGS).length) {
    throw operatorError(
      'Organic Dashboard action plan does not cover all canonical KPI Blocks',
      'LARK_DASHBOARD_RECOVERY_ORGANIC_PLAN_INCOMPLETE',
      {
        expectedCount: Object.keys(ORGANIC_METRIC_BINDINGS).length,
        actualCount: organicActions.length,
      },
    );
  }

  return Object.freeze({
    actions: Object.freeze(actions),
    organicMetricBlockCount: organicActions.length,
    affectedBlockCount: actions.length,
    pendingBlockUpdateCount: actions.filter((action) => action.changed).length,
    convergedBlockCount: actions.filter((action) => !action.changed).length,
    legacyReferenceCount,
  });
}

async function readDashboardState({ client, baseToken }) {
  const dashboards = (await listBaseV3Items({
    client,
    path: `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}/dashboards`,
  })).map(normalizeDashboard);
  const output = [];
  for (const dashboard of dashboards) {
    const blocks = await listBaseV3Items({
      client,
      path: `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
        + `/dashboards/${encodeURIComponent(dashboard.dashboardId)}/blocks`,
    });
    const details = [];
    for (const candidate of blocks) {
      const blockId = requireText(
        candidate?.block_id ?? candidate?.blockId ?? candidate?.id,
        'dashboard blockId',
      );
      details.push(await getDashboardBlock({
        client,
        baseToken,
        dashboardId: dashboard.dashboardId,
        blockId,
      }));
    }
    output.push(Object.freeze({ ...dashboard, blocks: Object.freeze(details) }));
  }
  return Object.freeze(output);
}

async function listBaseV3Items({ client, path }) {
  const items = [];
  let pageToken = '';
  const seenTokens = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(`${path}?${params.toString()}`, { method: 'GET' });
    const data = response?.data ?? {};
    const pageItems = data?.items ?? data?.dashboards ?? data?.blocks ?? [];
    if (!Array.isArray(pageItems)) throw operatorError(
      'Lark Base v3 list response items are invalid',
      'LARK_DASHBOARD_RECOVERY_LIST_RESPONSE_INVALID',
    );
    items.push(...pageItems);
    const hasMore = data?.has_more === true || data?.hasMore === true;
    if (!hasMore) return items;
    const next = requireText(data?.page_token ?? data?.pageToken, 'dashboard page_token');
    if (seenTokens.has(next)) throw operatorError(
      'Lark Dashboard pagination returned a repeated page token',
      'LARK_DASHBOARD_RECOVERY_PAGE_TOKEN_REPEATED',
    );
    seenTokens.add(next);
    pageToken = next;
  }
  throw operatorError(
    'Lark Dashboard pagination exceeded the reviewed page bound',
    'LARK_DASHBOARD_RECOVERY_PAGE_BOUND_EXCEEDED',
    { maxPages: MAX_PAGES },
  );
}

async function getDashboardBlock({ client, baseToken, dashboardId, blockId }) {
  const response = await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
      + `/dashboards/${encodeURIComponent(dashboardId)}`
      + `/blocks/${encodeURIComponent(blockId)}`,
    { method: 'GET' },
  );
  return normalizeBlock(response?.data?.block ?? response?.data ?? response, dashboardId);
}

async function updateDashboardBlockFull({ client, baseToken, dashboardId, blockId, dataConfig }) {
  const body = buildFullDashboardBlockUpdateBody(dataConfig);
  await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
      + `/dashboards/${encodeURIComponent(dashboardId)}`
      + `/blocks/${encodeURIComponent(blockId)}`,
    { method: 'PATCH', body, retryMode: 'none' },
  );
}

async function verifyOrganicDashboardData({ client, baseToken, dashboards }) {
  const organic = uniqueByName(dashboards, ORGANIC_DASHBOARD_NAME, 'Organic dashboard');
  const results = [];
  let computedMetricCount = 0;
  let baselineIncompleteMetricCount = 0;
  for (const [blockName, metricKey] of Object.entries(ORGANIC_METRIC_BINDINGS)) {
    const block = uniqueByName(organic.blocks, blockName, `Organic KPI Block ${blockName}`);
    assertCanonicalOrganicMetricBinding({ blockName, dataConfig: block.dataConfig });
    const response = await client.requestBitableJson(
      `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
        + `/dashboards/blocks/${encodeURIComponent(block.blockId)}/data`,
      { method: 'GET' },
    );
    const protocol = response?.data ?? response;
    if (!hasDashboardProtocol(protocol)) throw operatorError(
      'Organic KPI Block did not return the Dashboard computed-data protocol',
      'LARK_DASHBOARD_RECOVERY_COMPUTED_DATA_PROTOCOL_INVALID',
      { blockName, metricKey },
    );
    const hasValue = hasComputedDashboardValue(protocol);
    if (PERIOD_METRIC_KEY_SET.has(metricKey)) {
      baselineIncompleteMetricCount += 1;
    } else {
      if (!hasValue) throw operatorError(
        'Organic KPI Block has no computed numeric value after canonical rebind',
        'LARK_DASHBOARD_RECOVERY_COMPUTED_VALUE_MISSING',
        { blockName, metricKey },
      );
      computedMetricCount += 1;
    }
    results.push(Object.freeze({ blockName, metricKey, hasComputedValue: hasValue }));
  }
  return Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    metricCount: results.length,
    computedMetricCount,
    baselineIncompleteMetricCount,
    results: Object.freeze(results),
  });
}

function verifyActionReadback(action, block) {
  const remaining = collectLegacyFieldReferences(block.dataConfig);
  if (remaining.length > 0) throw operatorError(
    'Dashboard Block readback still contains Legacy Report references',
    'LARK_DASHBOARD_RECOVERY_READBACK_LEGACY_REFERENCE',
    { dashboardName: action.dashboardName, blockName: action.blockName, remaining },
  );
  if (action.metricKey) {
    assertCanonicalOrganicMetricBinding({ blockName: action.blockName, dataConfig: block.dataConfig });
  }
}

async function buildLegacyValueBackup({ client, tableId, fields }) {
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  return Object.freeze({
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    tableName: REPORT_METRIC_TABLE_NAME,
    recordCount: records.length,
    fieldNames: Object.freeze(fields.map((field) => field.fieldName).sort()),
    rows: Object.freeze(records.map((record) => Object.freeze({
      recordId: record.recordId,
      metricKey: readTextCell(record.fields?.[CANONICAL_REPORT_FIELD_NAMES.metricKey]),
      legacy: Object.freeze(Object.fromEntries(fields.map((field) => [
        field.fieldName,
        record.fields?.[field.fieldName] ?? null,
      ]))),
    }))),
  });
}

function normalizeDashboard(value) {
  return Object.freeze({
    dashboardId: requireText(
      value?.dashboard_id ?? value?.dashboardId ?? value?.block_id ?? value?.id,
      'dashboardId',
    ),
    name: requireText(value?.name ?? value?.dashboard_name ?? value?.dashboardName, 'dashboard name'),
  });
}

function normalizeBlock(value, dashboardId) {
  const dataConfig = value?.data_config ?? value?.dataConfig ?? {};
  return Object.freeze({
    dashboardId,
    blockId: requireText(value?.block_id ?? value?.blockId ?? value?.id, 'blockId'),
    name: requireText(value?.name ?? value?.block_name ?? value?.blockName, 'block name'),
    type: requireText(value?.type ?? value?.block_type ?? value?.blockType ?? 'unknown', 'block type'),
    dataConfig: parseDataConfig(dataConfig),
  });
}

function parseDataConfig(value) {
  if (typeof value !== 'string') return clone(value ?? {});
  try {
    return JSON.parse(value);
  } catch (error) {
    throw operatorError(
      'Lark Dashboard Block returned invalid data_config JSON',
      'LARK_DASHBOARD_RECOVERY_DATA_CONFIG_INVALID',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function assertDashboardSet(dashboards) {
  const names = dashboards.map((dashboard) => dashboard.name);
  const missing = EXPECTED_DASHBOARD_NAMES.filter((name) => !names.includes(name));
  const duplicates = EXPECTED_DASHBOARD_NAMES.filter(
    (name) => names.filter((candidate) => candidate === name).length !== 1,
  );
  const unexpected = names.filter((name) => !EXPECTED_DASHBOARD_NAMES.includes(name));
  if (missing.length > 0 || duplicates.length > 0 || unexpected.length > 0
    || dashboards.length !== EXPECTED_DASHBOARD_NAMES.length) throw operatorError(
    'Lark Base does not contain the exact six reviewed Dashboards',
    'LARK_DASHBOARD_RECOVERY_DASHBOARD_SET_INVALID',
    { expectedCount: EXPECTED_DASHBOARD_NAMES.length, actualCount: dashboards.length, missing, duplicates, unexpected },
  );
}

function assertCanonicalFields(fields) {
  for (const [fieldName, expectedType] of Object.entries(CANONICAL_FIELD_TYPES)) {
    const field = uniqueByName(fields, fieldName, `canonical field ${fieldName}`, 'fieldName');
    if (Number(field.type) !== expectedType) throw operatorError(
      'Canonical Report field type is invalid',
      'LARK_DASHBOARD_RECOVERY_CANONICAL_FIELD_INVALID',
      { fieldName, expectedType, actualType: field.type },
    );
  }
}

function assertNoUnknownLegacyFields(fields) {
  const unknown = fields
    .map((field) => field.fieldName)
    .filter((name) => typeof name === 'string' && name.startsWith('__mkt_legacy_'))
    .filter((name) => !LEGACY_FIELD_SET.has(name));
  if (unknown.length > 0) throw operatorError(
    'Unreviewed Legacy Report fields exist outside the cleanup contract',
    'LARK_DASHBOARD_RECOVERY_UNKNOWN_LEGACY_FIELDS',
    { fieldNames: unknown.sort() },
  );
}

function safeDashboardEvidence(dashboard) {
  return Object.freeze({
    dashboardId: dashboard.dashboardId,
    name: dashboard.name,
    blocks: Object.freeze(dashboard.blocks.map((block) => Object.freeze({
      blockId: block.blockId,
      name: block.name,
      type: block.type,
      dataConfigChecksum: checksumConfig(block.dataConfig),
      legacyReferences: collectLegacyFieldReferences(block.dataConfig),
    }))),
  });
}

function safePlanEvidence(plan) {
  return Object.freeze({
    contractVersion: LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION,
    affectedBlockCount: plan.affectedBlockCount,
    pendingBlockUpdateCount: plan.pendingBlockUpdateCount,
    convergedBlockCount: plan.convergedBlockCount,
    organicMetricBlockCount: plan.organicMetricBlockCount,
    legacyReferenceCount: plan.legacyReferenceCount,
    actions: Object.freeze(plan.actions.map((action, index) => Object.freeze({
      ...safeActionIdentity(action, index),
      metricKey: action.metricKey,
      changed: action.changed,
      legacyReferencesBefore: action.legacyReferencesBefore,
      changedTopLevelKeys: Object.keys(action.patch).sort(),
      targetChecksum: checksumConfig(action.dataConfig),
    }))),
  });
}

function safeActionIdentity(action, index) {
  return Object.freeze({
    actionIndex: index + 1,
    dashboardId: action.dashboardId,
    dashboardName: action.dashboardName,
    blockId: action.blockId,
    blockName: action.blockName,
    blockType: action.blockType,
  });
}

function actionEvidencePath(root, index, suffix) {
  return join(root, `block-${String(index + 1).padStart(3, '0')}-${suffix}.json`);
}

function checksumConfig(value) {
  return createHash('sha256').update(stableDashboardConfigString(value)).digest('hex');
}

async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return resolve(requireText(result.stdout, 'repository root'));
}

async function assertExactMain(repositoryRoot) {
  const status = await git(repositoryRoot, ['status', '--porcelain']);
  if (status.trim() !== '') throw operatorError(
    'Repository must be clean before Live Dashboard mutation',
    'LARK_DASHBOARD_RECOVERY_REPOSITORY_DIRTY',
  );
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  if (head !== originMain) throw operatorError(
    'Repository HEAD must equal origin/main exactly',
    'LARK_DASHBOARD_RECOVERY_MAIN_MISMATCH',
    { head, originMain },
  );
}

async function git(cwd, args) {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return String(result.stdout ?? '');
}

function assertExecutionConfirmation() {
  if (process.env.CONFIRM_LARK_DASHBOARD_CANONICAL_REBIND !== EXECUTION_CONFIRMATION) {
    throw operatorError(
      'Explicit Dashboard canonical rebind confirmation is required',
      'LARK_DASHBOARD_RECOVERY_CONFIRMATION_REQUIRED',
      { envName: 'CONFIRM_LARK_DASHBOARD_CANONICAL_REBIND' },
    );
  }
}

async function writePrivateJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, { mode: 0o600 });
  await writeFile(
    `${path}.sha256`,
    `${createHash('sha256').update(text).digest('hex')}  ${path.split('/').at(-1)}\n`,
    { mode: 0o600 },
  );
}

function readTextCell(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => item?.text ?? item).join('').trim() || null;
  return value?.text ?? null;
}

function uniqueByName(items, name, label, property = 'name') {
  const matches = items.filter((item) => item?.[property] === name);
  if (matches.length !== 1) throw operatorError(
    `${label} must resolve exactly once`,
    'LARK_DASHBOARD_RECOVERY_IDENTITY_AMBIGUOUS',
    { label, name, matchCount: matches.length },
  );
  return matches[0];
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw operatorError(
    `${fieldName} is required`,
    'LARK_DASHBOARD_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardCanonicalRebindRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
