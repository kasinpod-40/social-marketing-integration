#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { createVerifiedFieldMutationClient } from './lib/lark-verified-field-mutation-client.js';
import {
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
import { stableDashboardConfigString } from './lib/lark-dashboard-canonical-rebind-recovery-v2.js';
import {
  LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
  REPORT_METRIC_FIELD_IDENTITIES,
  assertFieldIdentityRecoveryConfirmation,
  assertFieldIdentityScopeConfirmation,
  assertPreservedWindowSelectConverged,
  assertSupportedOrganicMetricBlockType,
  buildPreservedWindowSelectFieldMutation,
  buildRetiredNumberFieldMutation,
  planPreservedWindowSelectBackfill,
} from './lib/lark-dashboard-field-identity-recovery-v3.js';
import {
  EXECUTIVE_DASHBOARD_NAME,
  EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,
  assertReviewedExecutiveWindowChartSet,
  hasNumberWindowReference,
  hasPreservedWindowReference,
  rewriteNumberWindowChartToPreservedSelect,
} from './lib/lark-dashboard-window-chart-rebind-v3-2.js';

const execFileAsync = promisify(execFile);
const EXPECTED_DASHBOARD_NAMES = Object.freeze([
  '📊 Executive Marketing Overview',
  '🌱 Organic Performance',
  '💰 Paid Ads Performance',
  '🛒 Commerce & Conversion',
  '💬 Customer Service & Leads',
  '🛡️ Data Quality & Operations',
]);
const PERIOD_METRIC_KEY_SET = new Set(ORGANIC_PERIOD_METRIC_KEYS);
const KNOWN_LEGACY_FIELD_NAMES = new Set(LEGACY_REPORT_FIELD_NAMES);
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let currentAction = null;
let confirmedBlockMutations = 0;
let confirmedStatisticsMutations = 0;
let confirmedWindowChartMutations = 0;
let confirmedRecordUpdates = 0;
let confirmedFieldMutations = 0;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_CANONICAL_REBIND_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-field-identity-recovery-v3'),
  );
  const attemptRoot = join(
    evidenceRoot,
    `field-identity-v3-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  if (execute) {
    currentStage = 'confirm-execution';
    assertFieldIdentityScopeConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONTRACT,
    );
    assertFieldIdentityRecoveryConfirmation(
      process.env.CONFIRM_LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY,
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
  const rawClient = createLarkBitableClientFromEnv(env);
  const fieldClient = createVerifiedFieldMutationClient(rawClient);

  currentStage = 'resolve-report-table';
  const tables = await rawClient.listTables();
  const reportTable = uniqueByName(tables, REPORT_METRIC_TABLE_NAME, 'Report Metric table');
  const tableId = requireText(reportTable.tableId, 'Report Metric tableId');

  currentStage = 'read-live-state';
  const fieldsBefore = await rawClient.listFields({ tableId });
  const fieldStateBefore = inspectFieldState(fieldsBefore);
  const recordsBefore = await rawClient.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const dashboardsBefore = await readDashboardState({ client: rawClient, baseToken });
  assertDashboardSet(dashboardsBefore);
  const dashboardPlan = buildDashboardPlan(dashboardsBefore, fieldStateBefore);
  const windowPlan = buildWindowPlan({ records: recordsBefore, fieldState: fieldStateBefore });

  await writePrivateJson(join(attemptRoot, 'field-state-before.json'), safeFieldState(fieldStateBefore));
  await writePrivateJson(join(attemptRoot, 'dashboard-state-before.json'), {
    dashboards: dashboardsBefore.map(safeDashboardEvidence),
  });
  await writePrivateJson(join(attemptRoot, 'recovery-plan.json'), {
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    dashboardPlan: safeDashboardPlan(dashboardPlan),
    windowPlan,
  });

  const preview = Object.freeze({
    ok: true,
    mode: execute ? 'execute' : 'preview',
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    decision: execute
      ? 'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_EXECUTION_AUTHORIZED'
      : 'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_PREVIEW_READY',
    dashboardCount: dashboardsBefore.length,
    organicMetricBlockCount: dashboardPlan.organicMetricBlockCount,
    pendingStatisticsUpdateCount: dashboardPlan.pendingStatisticsUpdateCount,
    convergedStatisticsCount: dashboardPlan.convergedStatisticsCount,
    preservedSlicerCount: dashboardPlan.preservedSlicerCount,
    preservedWindowChartCount: dashboardPlan.preservedWindowChartCount,
    alreadyPreservedWindowChartCount: dashboardPlan.alreadyPreservedWindowChartCount,
    numberWindowChartCount: dashboardPlan.numberWindowChartCount,
    pendingWindowChartRebindCount: dashboardPlan.pendingWindowChartRebindCount,
    convergedWindowChartCount: dashboardPlan.convergedWindowChartCount,
    legacyReferenceCount: dashboardPlan.legacyReferenceCount,
    recordCount: recordsBefore.length,
    pendingWindowBackfillCount: windowPlan.pendingUpdateCount,
    windowConflictCount: windowPlan.conflictCount,
    legacyFieldCount: fieldStateBefore.legacyFields.length,
    slicerPatchCount: 0,
    recordDeleteCount: 0,
    layoutMutationCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!execute) process.exit(0);

  if (windowPlan.conflictCount !== 0) {
    throw operatorError(
      'Window field values conflict before recovery',
      'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_CONFLICT',
      { conflicts: windowPlan.conflicts },
    );
  }

  currentStage = 'backup-business-values';
  await writePrivateJson(join(attemptRoot, 'report-field-values-backup.json'), {
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    tableId,
    recordCount: recordsBefore.length,
    fields: safeFieldState(fieldStateBefore),
    rows: recordsBefore.map((record) => ({
      recordId: record.recordId,
      metricKey: record.fields?.metric_key ?? null,
      displayName: record.fields?.display_name ?? null,
      canonicalWindowNumber: readNamedField(record.fields, fieldStateBefore.numberWindow?.fieldName),
      preservedWindowSelect: readNamedField(record.fields, fieldStateBefore.preservedWindow.fieldName),
      windowSelectV2: readNamedField(record.fields, fieldStateBefore.windowV2?.fieldName),
      displaySelectV1: readNamedField(record.fields, fieldStateBefore.displayV1?.fieldName),
      displaySelectV2: readNamedField(record.fields, fieldStateBefore.displayV2?.fieldName),
    })),
  });

  currentStage = 'rebind-organic-statistics';
  const blockCheckpoints = [];
  for (let index = 0; index < dashboardPlan.actions.length; index += 1) {
    const planned = dashboardPlan.actions[index];
    currentAction = safeActionIdentity(planned, index);
    const liveBlock = await getDashboardBlock({
      client: rawClient,
      baseToken,
      dashboardId: planned.dashboardId,
      blockId: planned.blockId,
    });
    const rewrite = rewriteDashboardBlockDataConfig({
      dashboardName: planned.dashboardName,
      blockName: planned.blockName,
      dataConfig: liveBlock.dataConfig,
    });
    if (!rewrite.changed) {
      verifyMetricBlock(planned, liveBlock);
      const checkpoint = {
        ...currentAction,
        outcome: 'already_converged',
        patchAttempted: false,
      };
      blockCheckpoints.push(checkpoint);
      await writePrivateJson(actionPath(attemptRoot, index, 'converged'), checkpoint);
      continue;
    }

    assertSupportedOrganicMetricBlockType(liveBlock.type, currentAction);
    const beforeChecksum = checksum(liveBlock.dataConfig);
    const targetChecksum = checksum(rewrite.dataConfig);
    await writePrivateJson(actionPath(attemptRoot, index, 'before'), {
      ...currentAction,
      beforeChecksum,
      targetChecksum,
      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),
      slicerPatch: false,
    });

    let patchError = null;
    try {
      await rawClient.requestBitableJson(
        blockPath(baseToken, planned.dashboardId, planned.blockId),
        {
          method: 'PATCH',
          retryMode: 'none',
          body: { data_config: rewrite.patch },
        },
      );
    } catch (error) {
      patchError = error;
    }

    const readback = await getDashboardBlock({
      client: rawClient,
      baseToken,
      dashboardId: planned.dashboardId,
      blockId: planned.blockId,
    });
    const outcome = classifyConfig({
      before: liveBlock.dataConfig,
      target: rewrite.dataConfig,
      after: readback.dataConfig,
    });
    const checkpoint = {
      ...currentAction,
      outcome,
      patchAttempted: true,
      patchReturnedError: patchError !== null,
      patchErrorCode: patchError?.code ?? null,
      patchLarkCode: patchError?.details?.larkCode ?? null,
      beforeChecksum,
      targetChecksum,
      afterChecksum: checksum(readback.dataConfig),
    };
    await writePrivateJson(actionPath(attemptRoot, index, 'after'), checkpoint);

    if (outcome !== 'target_converged') {
      throw operatorError(
        outcome === 'rejected_unchanged'
          ? 'Lark rejected a supported Statistics filter update without changing the Block'
          : 'Statistics Block drifted to an unreviewed configuration',
        outcome === 'rejected_unchanged'
          ? 'LARK_DASHBOARD_FIELD_IDENTITY_STATISTICS_PATCH_REJECTED'
          : 'LARK_DASHBOARD_FIELD_IDENTITY_STATISTICS_STATE_DRIFT',
        {
          ...currentAction,
          patchErrorCode: patchError?.code ?? null,
          patchErrorMessage: patchError instanceof Error ? patchError.message : null,
          larkCode: patchError?.details?.larkCode ?? null,
          currentBlockMayHaveWritten: outcome !== 'rejected_unchanged',
          confirmedBlockMutations,
        },
      );
    }
    verifyMetricBlock(planned, readback);
    confirmedBlockMutations += 1;
    confirmedStatisticsMutations += 1;
    blockCheckpoints.push(checkpoint);
  }
  currentAction = null;
  await writePrivateJson(join(attemptRoot, 'statistics-checkpoints.json'), {
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    checkpoints: blockCheckpoints,
  });

  currentStage = 'rebind-number-window-charts';
  const windowChartCheckpoints = [];
  for (let index = 0; index < dashboardPlan.windowChartActions.length; index += 1) {
    const planned = dashboardPlan.windowChartActions[index];
    currentAction = safeWindowActionIdentity(planned, index);
    const liveBlock = await getDashboardBlock({
      client: rawClient,
      baseToken,
      dashboardId: planned.dashboardId,
      blockId: planned.blockId,
    });

    if (!hasNumberWindowReference(liveBlock.dataConfig)) {
      if (!hasPreservedWindowReference(liveBlock.dataConfig)) {
        throw operatorError(
          'Executive window chart no longer references either reviewed window field',
          'LARK_DASHBOARD_WINDOW_CHART_STATE_DRIFT',
          currentAction,
        );
      }
      const checkpoint = {
        ...currentAction,
        outcome: 'already_converged',
        patchAttempted: false,
      };
      windowChartCheckpoints.push(checkpoint);
      await writePrivateJson(windowActionPath(attemptRoot, index, 'converged'), checkpoint);
      continue;
    }

    const rewrite = rewriteNumberWindowChartToPreservedSelect({
      dashboardName: planned.dashboardName,
      blockName: planned.blockName,
      blockType: liveBlock.type,
      dataConfig: liveBlock.dataConfig,
    });
    const beforeChecksum = checksum(liveBlock.dataConfig);
    const targetChecksum = checksum(rewrite.dataConfig);
    await writePrivateJson(windowActionPath(attemptRoot, index, 'before'), {
      ...currentAction,
      beforeChecksum,
      targetChecksum,
      sourceReferenceCount: rewrite.sourceReferenceCount,
      numericPresetConversionCount: rewrite.numericPresetConversionCount,
      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),
      slicerPatch: false,
    });

    let patchError = null;
    try {
      await rawClient.requestBitableJson(
        blockPath(baseToken, planned.dashboardId, planned.blockId),
        {
          method: 'PATCH',
          retryMode: 'none',
          body: { data_config: rewrite.patch },
        },
      );
    } catch (error) {
      patchError = error;
    }

    const readback = await getDashboardBlock({
      client: rawClient,
      baseToken,
      dashboardId: planned.dashboardId,
      blockId: planned.blockId,
    });
    const outcome = classifyConfig({
      before: liveBlock.dataConfig,
      target: rewrite.dataConfig,
      after: readback.dataConfig,
    });
    const checkpoint = {
      ...currentAction,
      outcome,
      patchAttempted: true,
      patchReturnedError: patchError !== null,
      patchErrorCode: patchError?.code ?? null,
      patchLarkCode: patchError?.details?.larkCode ?? null,
      beforeChecksum,
      targetChecksum,
      afterChecksum: checksum(readback.dataConfig),
    };
    await writePrivateJson(windowActionPath(attemptRoot, index, 'after'), checkpoint);

    if (outcome !== 'target_converged') {
      throw operatorError(
        outcome === 'rejected_unchanged'
          ? 'Lark rejected a reviewed Executive Column window-field update without changing the Block'
          : 'Executive window chart drifted to an unreviewed configuration',
        outcome === 'rejected_unchanged'
          ? 'LARK_DASHBOARD_WINDOW_CHART_PATCH_REJECTED'
          : 'LARK_DASHBOARD_WINDOW_CHART_STATE_DRIFT',
        {
          ...currentAction,
          patchErrorCode: patchError?.code ?? null,
          patchErrorMessage: patchError instanceof Error ? patchError.message : null,
          larkCode: patchError?.details?.larkCode ?? null,
          currentBlockMayHaveWritten: outcome !== 'rejected_unchanged',
          confirmedBlockMutations,
        },
      );
    }
    if (hasNumberWindowReference(readback.dataConfig)
      || !hasPreservedWindowReference(readback.dataConfig)) {
      throw operatorError(
        'Executive window chart readback did not retain the preserved Select identity',
        'LARK_DASHBOARD_WINDOW_CHART_READBACK_INVALID',
        currentAction,
      );
    }
    confirmedBlockMutations += 1;
    confirmedWindowChartMutations += 1;
    windowChartCheckpoints.push(checkpoint);
  }
  currentAction = null;
  await writePrivateJson(join(attemptRoot, 'window-chart-checkpoints.json'), {
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    checkpoints: windowChartCheckpoints,
  });

  const dashboardsAfterWindowChartRebind = await readDashboardState({
    client: rawClient,
    baseToken,
  });
  const windowChartRebindPlan = buildDashboardPlan(
    dashboardsAfterWindowChartRebind,
    fieldStateBefore,
  );
  if (windowChartRebindPlan.pendingWindowChartRebindCount !== 0
    || windowChartRebindPlan.numberWindowChartCount !== 0
    || windowChartRebindPlan.alreadyPreservedWindowChartCount !== 7) {
    throw operatorError(
      'Executive Number-window charts did not converge before Record or Field mutation',
      'LARK_DASHBOARD_WINDOW_CHART_REBIND_NOT_CONVERGED',
      safeDashboardPlan(windowChartRebindPlan),
    );
  }
  await writePrivateJson(
    join(attemptRoot, 'window-chart-rebind-verification.json'),
    safeDashboardPlan(windowChartRebindPlan),
  );

  currentStage = 'backfill-preserved-window-select';
  if (windowPlan.pendingUpdateCount > 0) {
    const result = await rawClient.batchUpdateRecords({ tableId, records: windowPlan.updates });
    if (Number(result?.updated) !== windowPlan.pendingUpdateCount) {
      throw operatorError(
        'Lark did not confirm every preserved window Select backfill',
        'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_BATCH_COUNT_MISMATCH',
        { expected: windowPlan.pendingUpdateCount, actual: result?.updated ?? null },
      );
    }
    confirmedRecordUpdates += windowPlan.pendingUpdateCount;
  }
  const recordsAfterBackfill = await rawClient.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const convergedWindowPlan = fieldStateBefore.numberWindow
    ? assertPreservedWindowSelectConverged({
      records: recordsAfterBackfill,
      numberFieldName: fieldStateBefore.numberWindow.fieldName,
      preservedFieldName: fieldStateBefore.preservedWindow.fieldName,
      v2FieldName: fieldStateBefore.windowV2?.fieldName
        ?? REPORT_METRIC_FIELD_IDENTITIES.windowSelectV2.fieldName,
    })
    : windowPlan;
  await writePrivateJson(join(attemptRoot, 'window-backfill-verification.json'), convergedWindowPlan);

  currentStage = 'promote-slicer-field-identity';
  let fieldState = inspectFieldState(await rawClient.listFields({ tableId }));
  if (fieldState.numberWindow
    && fieldState.numberWindow.fieldName === REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.fieldName) {
    await fieldClient.updateField({
      tableId,
      fieldId: fieldState.numberWindow.fieldId,
      field: buildRetiredNumberFieldMutation(fieldState.numberWindow),
    });
    confirmedFieldMutations += 1;
    fieldState = inspectFieldState(await rawClient.listFields({ tableId }));
  }
  if (fieldState.preservedWindow.fieldName
    === REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.legacyName) {
    await fieldClient.updateField({
      tableId,
      fieldId: fieldState.preservedWindow.fieldId,
      field: buildPreservedWindowSelectFieldMutation(
        fieldState.preservedWindow,
        REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.canonicalName,
      ),
    });
    confirmedFieldMutations += 1;
    fieldState = inspectFieldState(await rawClient.listFields({ tableId }));
  }
  if (fieldState.preservedWindow.fieldName !== 'window_days'
    || Number(fieldState.preservedWindow.type) !== 3) {
    throw operatorError(
      'Slicer-bound field identity was not promoted to canonical window_days SingleSelect',
      'LARK_DASHBOARD_FIELD_IDENTITY_PROMOTION_NOT_CONVERGED',
      safeFieldState(fieldState),
    );
  }

  currentStage = 'verify-dashboard-field-identity';
  const reboundDashboards = await readDashboardState({ client: rawClient, baseToken });
  const reboundPlan = buildDashboardPlan(reboundDashboards, fieldState);
  if (reboundPlan.pendingStatisticsUpdateCount !== 0
    || reboundPlan.pendingWindowChartRebindCount !== 0
    || reboundPlan.numberWindowChartCount !== 0
    || reboundPlan.legacyReferenceCount !== 0) {
    throw operatorError(
      'Dashboard did not converge after preserving the slicer-bound Field ID',
      'LARK_DASHBOARD_FIELD_IDENTITY_DASHBOARD_NOT_CONVERGED',
      {
        pendingStatisticsUpdateCount: reboundPlan.pendingStatisticsUpdateCount,
        pendingWindowChartRebindCount: reboundPlan.pendingWindowChartRebindCount,
        numberWindowChartCount: reboundPlan.numberWindowChartCount,
        legacyReferenceCount: reboundPlan.legacyReferenceCount,
      },
    );
  }

  currentStage = 'verify-organic-dashboard-data';
  const organicVerification = await verifyOrganicDashboardData({
    client: rawClient,
    baseToken,
    dashboards: reboundDashboards,
  });
  await writePrivateJson(
    join(attemptRoot, 'organic-dashboard-computed-data-verification.json'),
    organicVerification,
  );

  currentStage = 'delete-retired-fields';
  const deletionOrder = ['displayV1', 'displayV2', 'windowV2', 'numberWindow'];
  const deletedFields = [];
  for (const key of deletionOrder) {
    fieldState = inspectFieldState(await rawClient.listFields({ tableId }));
    const field = fieldState[key];
    if (!field) continue;
    if (key === 'numberWindow'
      && field.fieldName !== REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.retiredName) {
      throw operatorError(
        'Number window field cannot be deleted before it is retired',
        'LARK_DASHBOARD_FIELD_IDENTITY_NUMBER_DELETE_BLOCKED',
        { fieldName: field.fieldName, fieldId: field.fieldId },
      );
    }
    await rawClient.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}`
        + `/tables/${encodeURIComponent(tableId)}`
        + `/fields/${encodeURIComponent(field.fieldId)}`,
      { method: 'DELETE', retryMode: 'none' },
    );
    const readback = await rawClient.listFields({ tableId });
    if (readback.some((candidate) => candidate.fieldId === field.fieldId)) {
      throw operatorError(
        'Retired field remained after delete response',
        'LARK_DASHBOARD_FIELD_IDENTITY_FIELD_DELETE_NOT_CONVERGED',
        { fieldName: field.fieldName, fieldId: field.fieldId },
      );
    }
    confirmedFieldMutations += 1;
    deletedFields.push(field.fieldName);
  }

  currentStage = 'final-readback';
  const finalFields = await rawClient.listFields({ tableId });
  const finalFieldState = inspectFieldState(finalFields);
  if (finalFieldState.numberWindow
    || finalFieldState.displayV1
    || finalFieldState.displayV2
    || finalFieldState.windowV2
    || finalFieldState.legacyFields.length !== 0
    || finalFieldState.preservedWindow.fieldName !== 'window_days'
    || Number(finalFieldState.preservedWindow.type) !== 3) {
    throw operatorError(
      'Final Report Metric field state is not canonical',
      'LARK_DASHBOARD_FIELD_IDENTITY_FINAL_FIELD_STATE_INVALID',
      safeFieldState(finalFieldState),
    );
  }
  const finalDashboards = await readDashboardState({ client: rawClient, baseToken });
  const finalDashboardPlan = buildDashboardPlan(finalDashboards, finalFieldState);
  if (finalDashboardPlan.pendingStatisticsUpdateCount !== 0
    || finalDashboardPlan.pendingWindowChartRebindCount !== 0
    || finalDashboardPlan.numberWindowChartCount !== 0
    || finalDashboardPlan.legacyReferenceCount !== 0) {
    throw operatorError(
      'Dashboard binding drifted after retired-field deletion',
      'LARK_DASHBOARD_FIELD_IDENTITY_FINAL_DASHBOARD_DRIFT',
      safeDashboardPlan(finalDashboardPlan),
    );
  }
  const finalRecords = await rawClient.listRecords({ tableId, includeRecordMetadata: false });
  if (finalRecords.length !== recordsBefore.length) {
    throw operatorError(
      'Report Metric record count changed during field-identity recovery',
      'LARK_DASHBOARD_FIELD_IDENTITY_RECORD_COUNT_CHANGED',
      { before: recordsBefore.length, after: finalRecords.length },
    );
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    decision: 'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_COMPLETED_SAFE',
    dashboardCount: finalDashboards.length,
    organicMetricBlockCount: finalDashboardPlan.organicMetricBlockCount,
    confirmedStatisticsMutationCount: confirmedStatisticsMutations,
    confirmedWindowChartMutationCount: confirmedWindowChartMutations,
    confirmedBlockMutationCount: confirmedBlockMutations,
    alreadyConvergedStatisticsCount: blockCheckpoints.filter(
      (checkpoint) => checkpoint.outcome === 'already_converged',
    ).length,
    preservedSlicerCount: finalDashboardPlan.preservedSlicerCount,
    preservedWindowChartCount: finalDashboardPlan.preservedWindowChartCount,
    pendingWindowChartRebindCount: finalDashboardPlan.pendingWindowChartRebindCount,
    numberWindowChartCount: finalDashboardPlan.numberWindowChartCount,
    preservedWindowFieldId: finalFieldState.preservedWindow.fieldId,
    canonicalWindowFieldType: finalFieldState.preservedWindow.type,
    recordCount: finalRecords.length,
    confirmedRecordUpdateCount: confirmedRecordUpdates,
    confirmedFieldMutationCount: confirmedFieldMutations,
    deletedRetiredFieldCount: deletedFields.length,
    remainingLegacyFieldCount: 0,
    remainingLegacyReferenceCount: 0,
    computedOrganicMetricCount: organicVerification.computedMetricCount,
    baselineIncompleteMetricCount: organicVerification.baselineIncompleteMetricCount,
    slicerPatchCount: 0,
    dashboardIdsPreserved: true,
    blockIdsPreserved: true,
    layoutMutationCount: 0,
    recordDeleteCount: 0,
    businessFactDeleteCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: {
      ...(error?.details ?? {}),
      currentAction,
      confirmedBlockMutations,
      confirmedStatisticsMutations,
      confirmedWindowChartMutations,
      confirmedRecordUpdates,
      confirmedFieldMutations,
    },
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function inspectFieldState(fields) {
  const byId = new Map(fields.map((field) => [field.fieldId, field]));
  const identity = REPORT_METRIC_FIELD_IDENTITIES;
  const metricKey = requireIdentity(byId, identity.metricKey);
  const displayName = requireIdentity(byId, identity.displayName);
  const preservedWindow = requireIdentity(byId, identity.preservedWindowSelect, {
    allowedNames: [identity.preservedWindowSelect.legacyName, identity.preservedWindowSelect.canonicalName],
  });
  const numberWindow = optionalIdentity(byId, identity.canonicalWindowNumber, {
    allowedNames: [identity.canonicalWindowNumber.fieldName, identity.canonicalWindowNumber.retiredName],
  });
  const windowV2 = optionalIdentity(byId, identity.windowSelectV2);
  const displayV1 = optionalIdentity(byId, identity.displaySelectV1);
  const displayV2 = optionalIdentity(byId, identity.displaySelectV2);

  const legacyFields = fields.filter((field) => (
    typeof field.fieldName === 'string' && field.fieldName.startsWith('__mkt_legacy_')
  ));
  const unknownLegacy = legacyFields.filter(
    (field) => !KNOWN_LEGACY_FIELD_NAMES.has(field.fieldName),
  );
  if (unknownLegacy.length > 0) {
    throw operatorError(
      'Unreviewed Legacy fields exist outside the recovery contract',
      'LARK_DASHBOARD_FIELD_IDENTITY_UNKNOWN_LEGACY_FIELD',
      { fields: unknownLegacy.map((field) => ({ fieldId: field.fieldId, fieldName: field.fieldName })) },
    );
  }

  const canonicalWindowByName = fields.filter((field) => field.fieldName === 'window_days');
  const isBoundedPromotionGap = canonicalWindowByName.length === 0
    && numberWindow?.fieldName === identity.canonicalWindowNumber.retiredName
    && preservedWindow.fieldName === identity.preservedWindowSelect.legacyName;
  if (canonicalWindowByName.length !== 1 && !isBoundedPromotionGap) {
    throw operatorError(
      'Window field naming is outside the reviewed initial/transitional/final states',
      'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_NAME_AMBIGUOUS',
      {
        matchCount: canonicalWindowByName.length,
        numberWindowName: numberWindow?.fieldName ?? null,
        preservedWindowName: preservedWindow.fieldName,
      },
    );
  }
  if (preservedWindow.fieldName === 'window_days' && numberWindow
    && numberWindow.fieldName === 'window_days') {
    throw operatorError(
      'Number and slicer-bound fields cannot both use window_days',
      'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_NAME_COLLISION',
    );
  }
  return Object.freeze({
    metricKey,
    displayName,
    preservedWindow,
    numberWindow,
    windowV2,
    displayV1,
    displayV2,
    legacyFields: Object.freeze(legacyFields),
  });
}

function buildWindowPlan({ records, fieldState }) {
  if (!fieldState.numberWindow) {
    if (fieldState.preservedWindow.fieldName !== 'window_days') {
      throw operatorError(
        'Canonical Number is absent before the slicer-bound field is promoted',
        'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_SOURCE_MISSING',
      );
    }
    return Object.freeze({
      recordCount: records.length,
      populatedNumberCount: 0,
      populatedPreservedCount: 0,
      populatedV2Count: 0,
      pendingUpdateCount: 0,
      conflictCount: 0,
      updates: Object.freeze([]),
      expectedByRecord: Object.freeze([]),
      conflicts: Object.freeze([]),
      sourceAlreadyRetired: true,
    });
  }
  return planPreservedWindowSelectBackfill({
    records,
    numberFieldName: fieldState.numberWindow.fieldName,
    preservedFieldName: fieldState.preservedWindow.fieldName,
    v2FieldName: fieldState.windowV2?.fieldName
      ?? REPORT_METRIC_FIELD_IDENTITIES.windowSelectV2.fieldName,
  });
}

function buildDashboardPlan(dashboards, fieldState) {
  const organic = uniqueByName(dashboards, ORGANIC_DASHBOARD_NAME, 'Organic dashboard');
  assertOrganicMetricBlockNames(organic.blocks.map((block) => block.name));
  if (!fieldState?.preservedWindow) {
    throw operatorError(
      'Dashboard planning requires the current Report Metric field state',
      'LARK_DASHBOARD_FIELD_IDENTITY_FIELD_STATE_REQUIRED',
    );
  }

  const canonicalWindowTargetsPreserved = fieldState.preservedWindow.fieldName === 'window_days';
  const canonicalWindowTargetsNumber = fieldState.numberWindow?.fieldName === 'window_days';
  const actions = [];
  const windowChartActions = [];
  let legacyReferenceCount = 0;
  let preservedSlicerCount = 0;
  let alreadyPreservedWindowChartCount = 0;
  let numberWindowChartCount = 0;
  const executiveWindowChartNames = [];

  for (const dashboard of dashboards) {
    for (const block of dashboard.blocks) {
      const legacyReferences = collectLegacyFieldReferences(block.dataConfig);
      legacyReferenceCount += legacyReferences.length;
      const isOrganicMetric = dashboard.name === ORGANIC_DASHBOARD_NAME
        && Object.hasOwn(ORGANIC_METRIC_BINDINGS, block.name);
      const hasDisplayLegacy = legacyReferences.some((name) => name.includes('display_name'));
      const hasWindowLegacy = legacyReferences.some((name) => name.includes('window_days'));
      const hasCanonicalWindow = containsText(block.dataConfig, 'window_days');

      if (isOrganicMetric) {
        assertSupportedOrganicMetricBlockType(block.type, {
          dashboardName: dashboard.name,
          blockName: block.name,
        });
        const rewrite = rewriteDashboardBlockDataConfig({
          dashboardName: dashboard.name,
          blockName: block.name,
          dataConfig: block.dataConfig,
        });
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
        }));
        continue;
      }

      if (hasDisplayLegacy) {
        throw operatorError(
          'A non-Organic-Statistics block references Legacy display fields',
          'LARK_DASHBOARD_FIELD_IDENTITY_DISPLAY_REFERENCE_UNSUPPORTED',
          { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },
        );
      }
      if (!hasWindowLegacy && !hasCanonicalWindow) continue;
      if (hasWindowLegacy && hasCanonicalWindow) {
        throw operatorError(
          'A Dashboard block references both Legacy and canonical window fields',
          'LARK_DASHBOARD_WINDOW_CHART_REFERENCE_AMBIGUOUS',
          { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },
        );
      }

      const type = String(block.type).trim().toLowerCase();
      if (type === 'slicer') {
        if (hasCanonicalWindow && canonicalWindowTargetsNumber) {
          throw operatorError(
            'A Slicer is bound to the retiring Number window field',
            'LARK_DASHBOARD_WINDOW_NUMBER_SLICER_UNSUPPORTED',
            { dashboardName: dashboard.name, blockName: block.name },
          );
        }
        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {
          preservedSlicerCount += 1;
          continue;
        }
      } else if (type === 'column') {
        if (dashboard.name === EXECUTIVE_DASHBOARD_NAME) {
          executiveWindowChartNames.push(block.name);
        }
        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {
          alreadyPreservedWindowChartCount += 1;
          continue;
        }
        if (hasCanonicalWindow && canonicalWindowTargetsNumber) {
          const rewrite = rewriteNumberWindowChartToPreservedSelect({
            dashboardName: dashboard.name,
            blockName: block.name,
            blockType: block.type,
            dataConfig: block.dataConfig,
          });
          numberWindowChartCount += 1;
          windowChartActions.push(Object.freeze({
            dashboardId: dashboard.dashboardId,
            dashboardName: dashboard.name,
            blockId: block.blockId,
            blockName: block.name,
            blockType: block.type,
            changed: rewrite.changed,
            patch: rewrite.patch,
            dataConfig: rewrite.dataConfig,
          }));
          continue;
        }
      }

      throw operatorError(
        'Window binding exists on an unreviewed block or field state',
        'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_REFERENCE_UNSUPPORTED',
        { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },
      );
    }
  }

  const reviewedExecutiveWindowChartNames =
    assertReviewedExecutiveWindowChartSet(executiveWindowChartNames);
  const preservedWindowChartCount = alreadyPreservedWindowChartCount + numberWindowChartCount;
  const pendingNames = windowChartActions.map((action) => action.blockName);
  const unexpectedPendingNames = pendingNames.filter(
    (name) => !EXECUTIVE_NUMBER_WINDOW_CHART_NAMES.includes(name),
  );
  const duplicatePendingCount = pendingNames.length - new Set(pendingNames).size;
  if (actions.length !== 17
    || preservedSlicerCount !== 5
    || preservedWindowChartCount !== 7
    || unexpectedPendingNames.length > 0
    || duplicatePendingCount !== 0) {
    throw operatorError(
      'Dashboard field-identity plan does not match the reviewed 17/5/7 block contract',
      'LARK_DASHBOARD_FIELD_IDENTITY_PLAN_SCOPE_MISMATCH',
      {
        organicMetricBlockCount: actions.length,
        preservedSlicerCount,
        preservedWindowChartCount,
        alreadyPreservedWindowChartCount,
        numberWindowChartCount,
        pendingNames,
        unexpectedPendingNames,
        duplicatePendingCount,
      },
    );
  }

  return Object.freeze({
    actions: Object.freeze(actions),
    windowChartActions: Object.freeze(windowChartActions),
    organicMetricBlockCount: actions.length,
    pendingStatisticsUpdateCount: actions.filter((action) => action.changed).length,
    convergedStatisticsCount: actions.filter((action) => !action.changed).length,
    preservedSlicerCount,
    preservedWindowChartCount,
    alreadyPreservedWindowChartCount,
    numberWindowChartCount,
    pendingWindowChartRebindCount: windowChartActions.length,
    convergedWindowChartCount: preservedWindowChartCount - windowChartActions.length,
    reviewedExecutiveWindowChartCount: reviewedExecutiveWindowChartNames.length,
    reviewedExecutiveWindowChartNames,
    legacyReferenceCount,
  });
}

function containsText(value, expected) {
  if (typeof value === 'string') return value.trim() === expected;
  if (Array.isArray(value)) return value.some((item) => containsText(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsText(item, expected));
  }
  return false;
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
      const blockId = requireText(candidate?.block_id ?? candidate?.blockId ?? candidate?.id, 'blockId');
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
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(`${path}?${params.toString()}`, { method: 'GET' });
    const data = response?.data ?? {};
    const pageItems = data.items ?? data.dashboards ?? data.blocks ?? [];
    if (!Array.isArray(pageItems)) {
      throw operatorError(
        'Lark Base v3 list response is invalid',
        'LARK_DASHBOARD_FIELD_IDENTITY_LIST_RESPONSE_INVALID',
      );
    }
    items.push(...pageItems);
    if (data.has_more !== true && data.hasMore !== true) return items;
    const next = requireText(data.page_token ?? data.pageToken, 'page_token');
    if (seen.has(next)) {
      throw operatorError(
        'Lark pagination repeated a page token',
        'LARK_DASHBOARD_FIELD_IDENTITY_PAGE_TOKEN_REPEATED',
      );
    }
    seen.add(next);
    pageToken = next;
  }
  throw operatorError(
    'Lark Dashboard pagination exceeded the reviewed bound',
    'LARK_DASHBOARD_FIELD_IDENTITY_PAGE_BOUND_EXCEEDED',
    { maxPages: MAX_PAGES },
  );
}

async function getDashboardBlock({ client, baseToken, dashboardId, blockId }) {
  const response = await client.requestBitableJson(
    blockPath(baseToken, dashboardId, blockId),
    { method: 'GET' },
  );
  return normalizeBlock(response?.data?.block ?? response?.data ?? response, dashboardId);
}

async function verifyOrganicDashboardData({ client, baseToken, dashboards }) {
  const organic = uniqueByName(dashboards, ORGANIC_DASHBOARD_NAME, 'Organic dashboard');
  const results = [];
  let computedMetricCount = 0;
  let baselineIncompleteMetricCount = 0;
  for (const [blockName, metricKey] of Object.entries(ORGANIC_METRIC_BINDINGS)) {
    const block = uniqueByName(organic.blocks, blockName, `Organic KPI ${blockName}`);
    assertCanonicalOrganicMetricBinding({ blockName, dataConfig: block.dataConfig });
    const response = await client.requestBitableJson(
      `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
        + `/dashboards/blocks/${encodeURIComponent(block.blockId)}/data`,
      { method: 'GET' },
    );
    const protocol = response?.data ?? response;
    if (!hasDashboardProtocol(protocol)) {
      throw operatorError(
        'Organic KPI did not return the Dashboard computed-data protocol',
        'LARK_DASHBOARD_FIELD_IDENTITY_COMPUTED_PROTOCOL_INVALID',
        { blockName, metricKey },
      );
    }
    const hasValue = hasComputedDashboardValue(protocol);
    if (PERIOD_METRIC_KEY_SET.has(metricKey)) {
      baselineIncompleteMetricCount += 1;
    } else {
      if (!hasValue) {
        throw operatorError(
          'Organic current-total KPI has no computed numeric value',
          'LARK_DASHBOARD_FIELD_IDENTITY_COMPUTED_VALUE_MISSING',
          { blockName, metricKey },
        );
      }
      computedMetricCount += 1;
    }
    results.push(Object.freeze({ blockName, metricKey, hasComputedValue: hasValue }));
  }
  return Object.freeze({
    ok: true,
    metricCount: results.length,
    computedMetricCount,
    baselineIncompleteMetricCount,
    results: Object.freeze(results),
  });
}

function verifyMetricBlock(action, block) {
  const remaining = collectLegacyFieldReferences(block.dataConfig)
    .filter((name) => name.includes('display_name'));
  if (remaining.length > 0) {
    throw operatorError(
      'Organic Statistics readback still references Legacy display fields',
      'LARK_DASHBOARD_FIELD_IDENTITY_STATISTICS_LEGACY_REMAINS',
      { dashboardName: action.dashboardName, blockName: action.blockName, remaining },
    );
  }
  assertCanonicalOrganicMetricBinding({ blockName: action.blockName, dataConfig: block.dataConfig });
}

function requireIdentity(byId, contract, options = {}) {
  const field = byId.get(contract.fieldId);
  if (!field) {
    throw operatorError(
      'Required Report Metric field identity is missing',
      'LARK_DASHBOARD_FIELD_IDENTITY_FIELD_MISSING',
      { fieldId: contract.fieldId },
    );
  }
  assertIdentity(field, contract, options);
  return field;
}
function optionalIdentity(byId, contract, options = {}) {
  const field = byId.get(contract.fieldId) ?? null;
  if (field) assertIdentity(field, contract, options);
  return field;
}
function assertIdentity(field, contract, options = {}) {
  const allowedNames = options.allowedNames ?? [contract.fieldName];
  if (!allowedNames.includes(field.fieldName) || Number(field.type) !== Number(contract.type)) {
    throw operatorError(
      'Report Metric field identity does not match the reviewed contract',
      'LARK_DASHBOARD_FIELD_IDENTITY_FIELD_MISMATCH',
      {
        fieldId: contract.fieldId,
        expectedNames: allowedNames,
        actualName: field.fieldName,
        expectedType: contract.type,
        actualType: field.type,
      },
    );
  }
}

function classifyConfig({ before, target, after }) {
  const beforeText = stableDashboardConfigString(before);
  const targetText = stableDashboardConfigString(target);
  const afterText = stableDashboardConfigString(after);
  if (afterText === targetText) return 'target_converged';
  if (afterText === beforeText) return 'rejected_unchanged';
  return 'state_drift';
}

function normalizeDashboard(value) {
  return Object.freeze({
    dashboardId: requireText(value.dashboard_id ?? value.dashboardId ?? value.id, 'dashboardId'),
    name: requireText(value.name ?? value.dashboard_name ?? value.dashboardName, 'dashboard name'),
  });
}
function normalizeBlock(value, dashboardId) {
  return Object.freeze({
    dashboardId,
    blockId: requireText(value.block_id ?? value.blockId ?? value.id, 'blockId'),
    name: requireText(value.name ?? value.block_name ?? value.blockName, 'block name'),
    type: requireText(value.type ?? value.block_type ?? value.blockType ?? 'unknown', 'block type').toLowerCase(),
    dataConfig: parseDataConfig(value.data_config ?? value.dataConfig ?? {}),
  });
}
function parseDataConfig(value) {
  if (typeof value !== 'string') return clone(value ?? {});
  try { return JSON.parse(value); } catch (error) {
    throw operatorError(
      'Dashboard Block returned invalid data_config JSON',
      'LARK_DASHBOARD_FIELD_IDENTITY_DATA_CONFIG_INVALID',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
function assertDashboardSet(dashboards) {
  const names = dashboards.map((dashboard) => dashboard.name);
  const missing = EXPECTED_DASHBOARD_NAMES.filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !EXPECTED_DASHBOARD_NAMES.includes(name));
  const duplicates = EXPECTED_DASHBOARD_NAMES.filter(
    (name) => names.filter((candidate) => candidate === name).length !== 1,
  );
  if (dashboards.length !== 6 || missing.length || unexpected.length || duplicates.length) {
    throw operatorError(
      'Lark Base does not contain the exact six reviewed Dashboards',
      'LARK_DASHBOARD_FIELD_IDENTITY_DASHBOARD_SET_INVALID',
      { names, missing, unexpected, duplicates },
    );
  }
}
function uniqueByName(items, name, label, property = 'name') {
  const matches = items.filter((item) => item?.[property] === name);
  if (matches.length !== 1) {
    throw operatorError(
      `${label} must resolve exactly once`,
      'LARK_DASHBOARD_FIELD_IDENTITY_IDENTITY_AMBIGUOUS',
      { label, name, matchCount: matches.length },
    );
  }
  return matches[0];
}
function blockPath(baseToken, dashboardId, blockId) {
  return `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
    + `/dashboards/${encodeURIComponent(dashboardId)}`
    + `/blocks/${encodeURIComponent(blockId)}`;
}
function safeActionIdentity(action, index) {
  return Object.freeze({
    actionIndex: index + 1,
    dashboardId: action.dashboardId,
    dashboardName: action.dashboardName,
    blockId: action.blockId,
    blockName: action.blockName,
    blockType: action.blockType,
    metricKey: action.metricKey,
  });
}
function safeWindowActionIdentity(action, index) {
  return Object.freeze({
    actionIndex: index + 1,
    dashboardId: action.dashboardId,
    dashboardName: action.dashboardName,
    blockId: action.blockId,
    blockName: action.blockName,
    blockType: action.blockType,
  });
}
function actionPath(root, index, suffix) {
  return join(root, `statistics-${String(index + 1).padStart(2, '0')}-${suffix}.json`);
}
function windowActionPath(root, index, suffix) {
  return join(root, `window-chart-${String(index + 1).padStart(2, '0')}-${suffix}.json`);
}
function safeFieldState(state) {
  return Object.freeze({
    metricKey: safeField(state.metricKey),
    displayName: safeField(state.displayName),
    preservedWindow: safeField(state.preservedWindow),
    numberWindow: safeField(state.numberWindow),
    windowV2: safeField(state.windowV2),
    displayV1: safeField(state.displayV1),
    displayV2: safeField(state.displayV2),
    legacyFields: state.legacyFields.map(safeField),
  });
}
function safeField(field) {
  if (!field) return null;
  return Object.freeze({
    fieldId: field.fieldId,
    fieldName: field.fieldName,
    type: field.type,
    uiType: field.uiType ?? null,
    isPrimary: field.isPrimary === true,
  });
}
function safeDashboardEvidence(dashboard) {
  return Object.freeze({
    dashboardId: dashboard.dashboardId,
    name: dashboard.name,
    blocks: dashboard.blocks.map((block) => ({
      blockId: block.blockId,
      name: block.name,
      type: block.type,
      legacyReferences: collectLegacyFieldReferences(block.dataConfig),
      dataConfigChecksum: checksum(block.dataConfig),
    })),
  });
}
function safeDashboardPlan(plan) {
  return Object.freeze({
    organicMetricBlockCount: plan.organicMetricBlockCount,
    pendingStatisticsUpdateCount: plan.pendingStatisticsUpdateCount,
    convergedStatisticsCount: plan.convergedStatisticsCount,
    preservedSlicerCount: plan.preservedSlicerCount,
    preservedWindowChartCount: plan.preservedWindowChartCount,
    alreadyPreservedWindowChartCount: plan.alreadyPreservedWindowChartCount,
    numberWindowChartCount: plan.numberWindowChartCount,
    pendingWindowChartRebindCount: plan.pendingWindowChartRebindCount,
    convergedWindowChartCount: plan.convergedWindowChartCount,
    reviewedExecutiveWindowChartCount: plan.reviewedExecutiveWindowChartCount,
    reviewedExecutiveWindowChartNames: plan.reviewedExecutiveWindowChartNames,
    legacyReferenceCount: plan.legacyReferenceCount,
    actions: plan.actions.map((action, index) => safeActionIdentity(action, index)),
    windowChartActions: plan.windowChartActions.map(
      (action, index) => safeWindowActionIdentity(action, index),
    ),
  });
}
function readNamedField(fields, name) {
  return name ? fields?.[name] ?? null : null;
}
async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return resolve(requireText(result.stdout, 'repository root'));
}
async function assertExactMain(repositoryRoot) {
  const status = await git(repositoryRoot, ['status', '--porcelain']);
  if (status.trim()) {
    throw operatorError(
      'Repository must be clean before Live field-identity recovery',
      'LARK_DASHBOARD_FIELD_IDENTITY_REPOSITORY_DIRTY',
    );
  }
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const originMain = (await git(repositoryRoot, ['rev-parse', 'origin/main'])).trim();
  if (head !== originMain) {
    throw operatorError(
      'Repository HEAD must equal sealed origin/main',
      'LARK_DASHBOARD_FIELD_IDENTITY_MAIN_MISMATCH',
      { head, originMain },
    );
  }
}
async function git(cwd, command) {
  const result = await execFileAsync('git', command, { cwd, encoding: 'utf8' });
  return String(result.stdout ?? '');
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
function checksum(value) {
  return createHash('sha256').update(stableDashboardConfigString(value)).digest('hex');
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw operatorError(
      `${fieldName} is required`,
      'LARK_DASHBOARD_FIELD_IDENTITY_VALUE_INVALID',
      { fieldName },
    );
  }
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
  error.name = 'LarkDashboardFieldIdentityRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
