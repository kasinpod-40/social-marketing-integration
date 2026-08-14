import { RuntimeError, permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  buildSharedTableViewInstallerContract,
  validateSharedTableLarkSchema,
} from '../../../config/src/shared-table-lark-schema.js';
import {
  applyLarkReportViews,
  planLarkReportViews,
} from './install-lark-report-views.js';
import { previewSharedTableLarkSchema } from './preview-shared-table-lark-schema.js';

const SUPPORTED_SCHEMA_ACTIONS = new Set([
  'rename_table',
  'update_primary_field',
  'create_table',
  'create_field',
  'update_field',
  'create_view',
]);

/**
 * Apply Shared-table schema แบบ Guarded และ Idempotent สำหรับ developer-owned DEV เท่านั้น.
 * Caller ต้องยืนยัน Environment/Confirmation ก่อนเรียกฟังก์ชันนี้; ฟังก์ชันจะ Preview ซ้ำ
 * ก่อนเขียน และยืนยัน Zero-drift อีกครั้งหลังทุก Schema/View action สำเร็จ.
 */
export async function applySharedTableLarkSchema(input = {}) {
  const client = requireApplyClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema;
  const views = Array.isArray(input.views) ? input.views : [];
  const schemaVersion = input.schemaVersion ?? 'shared-table-lark-schema-apply';
  const validateSchema = input.validateSchema ?? validateSharedTableLarkSchema;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  validateSchema(schema);
  const preview = await previewSharedTableLarkSchema({
    client,
    env,
    schema,
    views,
    schemaVersion,
    validateSchema,
  });
  assertGuardedApplyPlan({ preview, schema, views });

  const appliedActions = [];
  const createdTableIds = new Map();
  const schemaActions = orderSchemaActions(preview.actions);

  for (const action of schemaActions) {
    onProgress(Object.freeze({ stage: 'shared_schema_action_start', action: summarizeAction(action) }));
    try {
      const result = await applyOneSchemaAction({ client, action });
      if (action.kind === 'create_table') {
        createdTableIds.set(action.tableKey, requireText(result?.tableId, 'created tableId'));
      }
      const applied = Object.freeze({
        ...summarizeAction(action),
        status: actionStatus(action.kind),
      });
      appliedActions.push(applied);
      onProgress(Object.freeze({ stage: 'shared_schema_action_complete', action: applied }));
    } catch (error) {
      throw wrapSharedSchemaActionError(error, action, appliedActions);
    }
  }

  const postSchemaEnv = {
    ...env,
    ...preview.environmentUpdates,
  };
  for (const tableContract of schema) {
    const tableId = createdTableIds.get(tableContract.key);
    if (tableId) postSchemaEnv[tableContract.envName] = tableId;
  }

  const viewContract = buildSharedTableViewInstallerContract({ schema, views });
  let viewApply = emptyViewApplyResult();
  if (viewContract.length > 0) {
    try {
      viewApply = await applyLarkReportViews({
        client,
        env: postSchemaEnv,
        contract: viewContract,
        includePermissionManualAction: false,
        onProgress: (event) => onProgress(Object.freeze({
          stage: `shared_${event.stage}`,
          action: event.action ? summarizeAction(event.action) : null,
        })),
      });
    } catch (error) {
      throw wrapSharedViewApplyError(error, appliedActions);
    }
  }

  const verification = await previewSharedTableLarkSchema({
    client,
    env: postSchemaEnv,
    schema,
    views,
    schemaVersion,
    validateSchema,
  });
  const viewVerification = viewContract.length > 0
    ? await planLarkReportViews({
      client,
      env: postSchemaEnv,
      contract: viewContract,
      includePermissionManualAction: false,
    })
    : emptyViewPreviewResult();
  assertCleanVerification({ verification, viewVerification });

  return deepFreeze({
    mode: 'apply',
    schemaVersion,
    ok: true,
    summary: {
      plannedSchemaActions: schemaActions.length,
      appliedSchemaActions: appliedActions.length,
      renamedTables: appliedActions.filter((action) => action.kind === 'rename_table').length,
      createdTables: appliedActions.filter((action) => action.kind === 'create_table').length,
      createdFields: appliedActions.filter((action) => action.kind === 'create_field').length,
      updatedFields: appliedActions.filter((action) => action.kind === 'update_field').length,
      updatedPrimaryFields: appliedActions.filter((action) => action.kind === 'update_primary_field').length,
      createdViews: viewApply.summary.createdViews,
      updatedViews: viewApply.summary.updatedViews,
      remainingActions: verification.actions.length + viewVerification.actions.length,
      conflicts: verification.conflicts.length + viewVerification.conflicts.length,
      warnings: verification.warnings.length + viewVerification.warnings.length,
      manualActions: verification.manualActions.length + viewVerification.manualActions.length,
      protectedActions: verification.summary.protectedActions,
      deleteActions: verification.summary.deleteActions,
      recordWrites: verification.summary.recordWrites,
    },
    appliedActions,
    viewApply: {
      summary: viewApply.summary,
      appliedActions: viewApply.appliedActions.map(summarizeAction),
    },
    verification,
    viewVerification,
    environmentUpdates: Object.freeze({ ...verification.environmentUpdates }),
    safety: Object.freeze({
      businessRecordWrite: false,
      deleteAction: false,
      protectedTableMutation: false,
      sourceApiCalled: false,
    }),
  });
}

function emptyViewApplyResult() {
  return deepFreeze({
    mode: 'apply',
    ok: true,
    summary: { plannedActions: 0, appliedActions: 0, createdViews: 0, updatedViews: 0, manualActions: 0 },
    appliedActions: [],
    verification: emptyViewPreviewResult(),
  });
}

function emptyViewPreviewResult() {
  return deepFreeze({
    mode: 'preview',
    readyToApply: true,
    summary: { tablesInScope: 0, createViews: 0, updateViews: 0, conflicts: 0, warnings: 0, manualActions: 0 },
    resolvedTables: [], actions: [], conflicts: [], warnings: [], manualActions: [],
  });
}

function assertGuardedApplyPlan({ preview, schema, views }) {
  const problems = [];
  const schemaByKey = new Map(schema.map((tableContract) => [tableContract.key, tableContract]));
  const expectedReuse = schema.filter((tableContract) => tableContract.sharedTable.physicalAction === 'rename_reuse_in_place');
  const expectedCreate = schema.filter((tableContract) => tableContract.sharedTable.physicalAction === 'create_new');
  const expectedViews = new Set(views.map((view) => `${view.table}\u0000${view.viewName}`));

  if (preview.readyForApplyAuthorization !== true) problems.push('preview_not_ready');
  if (preview.requiresManualSchemaResolution === true || preview.manualActions.length > 0) problems.push('manual_actions_present');
  if (preview.conflicts.length > 0) problems.push('conflicts_present');
  if (preview.warnings.length > 0) problems.push('warnings_present');
  if (preview.summary.reuseTables !== expectedReuse.length) problems.push('reuse_table_count_mismatch');
  if (preview.resolvedTables.length !== schema.length) problems.push('resolved_table_count_mismatch');
  if (preview.summary.deleteActions !== 0) problems.push('delete_actions_present');
  if (preview.summary.recordWrites !== 0) problems.push('record_writes_present');
  if (preview.summary.protectedActions !== 0) problems.push('protected_actions_present');
  if (preview.protectedChecks.length === 0 || preview.protectedChecks.some((check) => (
    check.found !== true || check.ambiguous === true || check.plannedActions !== 0
  ))) problems.push('protected_table_check_failed');

  const protectedTableIds = new Set(preview.protectedChecks.map((check) => check.tableId).filter(Boolean));
  const resolvedByKey = new Map(preview.resolvedTables.map((table) => [table.tableKey, table]));
  const signatures = new Set();
  for (const action of preview.actions) {
    if (!SUPPORTED_SCHEMA_ACTIONS.has(action.kind)) {
      problems.push(`unsupported_action:${action.kind}`);
      continue;
    }
    const signature = actionSignature(action);
    if (signatures.has(signature)) problems.push(`duplicate_action:${signature}`);
    signatures.add(signature);

    if (action.tableId && protectedTableIds.has(action.tableId)) {
      problems.push(`protected_table_targeted:${action.kind}`);
    }

    const tableContract = schemaByKey.get(action.tableKey);
    if (!tableContract) {
      problems.push(`unknown_table_key:${action.tableKey}`);
      continue;
    }
    const resolved = resolvedByKey.get(action.tableKey);
    if (action.kind !== 'create_table' && resolved?.tableId && action.tableId !== resolved.tableId) {
      problems.push(`resolved_table_id_mismatch:${action.tableKey}.${action.kind}`);
    }
    if (action.kind === 'rename_table') {
      if (tableContract.sharedTable.physicalAction !== 'rename_reuse_in_place'
        || action.toName !== tableContract.logicalName
        || action.preserveTableId !== true) problems.push(`invalid_rename:${action.tableKey}`);
    } else if (action.kind === 'update_primary_field') {
      const primary = tableContract.fields.find((field) => field.primary === true);
      if (tableContract.sharedTable.physicalAction !== 'rename_reuse_in_place'
        || !primary
        || action.toName !== primary.fieldName
        || action.fieldId == null
        || action.preservePrimary !== true) problems.push(`invalid_primary_update:${action.tableKey}`);
    } else if (action.kind === 'create_table') {
      const expectedFieldNames = tableContract.fields.map((field) => field.fieldName);
      const actionFieldNames = Array.isArray(action.fields) ? action.fields.map((field) => field.fieldName) : [];
      if (tableContract.sharedTable.physicalAction !== 'create_new'
        || action.logicalName !== tableContract.logicalName
        || action.name !== tableContract.createName
        || JSON.stringify(actionFieldNames) !== JSON.stringify(expectedFieldNames)) {
        problems.push(`invalid_create_table:${action.tableKey}`);
      }
    } else if (action.kind === 'create_field' || action.kind === 'update_field') {
      if (!tableContract.fields.some((field) => field.fieldName === action.field?.fieldName)) {
        problems.push(`unknown_field:${action.tableKey}.${action.field?.fieldName}`);
      }
    } else if (action.kind === 'create_view') {
      if (!expectedViews.has(`${action.tableName}\u0000${action.viewName}`)) {
        problems.push(`unknown_view:${action.tableName}.${action.viewName}`);
      }
    }
  }

  const createTableActions = preview.actions.filter((action) => action.kind === 'create_table');
  if (createTableActions.length > expectedCreate.length) problems.push('too_many_create_tables');

  const renameByKey = new Map(preview.actions.filter((action) => action.kind === 'rename_table').map((action) => [action.tableKey, action]));
  const primaryByKey = new Map(preview.actions.filter((action) => action.kind === 'update_primary_field').map((action) => [action.tableKey, action]));
  for (const check of preview.reuseChecks) {
    if (!schemaByKey.has(check.tableKey)) problems.push(`unknown_reuse_check:${check.tableKey}`);
    if (check.alreadyTarget === false && (check.empty !== true || !renameByKey.has(check.tableKey))) {
      problems.push(`unsafe_reuse_state:${check.tableKey}`);
    }
    if (check.alreadyTarget === true && renameByKey.has(check.tableKey)) {
      problems.push(`redundant_rename:${check.tableKey}`);
    }
    if (check.primaryFieldResolution === 'rename_planned' && !primaryByKey.has(check.tableKey)) {
      problems.push(`missing_primary_update:${check.tableKey}`);
    }
    if (!new Set(['rename_planned', 'already_aligned']).has(check.primaryFieldResolution)) {
      problems.push(`unsafe_primary_state:${check.tableKey}`);
    }
  }
  if (problems.length > 0) {
    throw permanentError('Shared-table schema Apply plan failed safety validation', {
      code: 'SHARED_TABLE_APPLY_PLAN_INVALID',
      details: {
        problems: Object.freeze([...new Set(problems)]),
        actionCount: preview.actions.length,
        conflictCount: preview.conflicts.length,
        warningCount: preview.warnings.length,
        manualActionCount: preview.manualActions.length,
      },
    });
  }
}

function orderSchemaActions(actions) {
  const order = new Map([
    ['rename_table', 1],
    ['update_primary_field', 2],
    ['create_field', 3],
    ['update_field', 4],
    ['create_table', 5],
  ]);
  return Object.freeze(actions
    .filter((action) => action.kind !== 'create_view')
    .sort((left, right) => (order.get(left.kind) ?? 99) - (order.get(right.kind) ?? 99)));
}

async function applyOneSchemaAction({ client, action }) {
  if (action.kind === 'rename_table') {
    return client.renameTable({ tableId: action.tableId, name: action.toName });
  }
  if (action.kind === 'update_primary_field') {
    return client.updateField({ tableId: action.tableId, fieldId: action.fieldId, field: action.field });
  }
  if (action.kind === 'create_field') {
    return client.createField({ tableId: action.tableId, field: action.field });
  }
  if (action.kind === 'update_field') {
    return client.updateField({ tableId: action.tableId, fieldId: action.fieldId, field: action.field });
  }
  if (action.kind === 'create_table') {
    return client.createTable({
      name: action.name,
      defaultViewName: action.defaultViewName,
      fields: action.fields,
    });
  }
  throw permanentError(`Unsupported Shared-table schema action: ${action.kind}`, {
    code: 'SHARED_TABLE_APPLY_ACTION_INVALID',
    details: { kind: action.kind },
  });
}

function assertCleanVerification({ verification, viewVerification }) {
  const remainingActions = verification.actions.length + viewVerification.actions.length;
  const conflicts = verification.conflicts.length + viewVerification.conflicts.length;
  const warnings = verification.warnings.length + viewVerification.warnings.length;
  const manualActions = verification.manualActions.length + viewVerification.manualActions.length;
  const unsafe = verification.summary.protectedActions !== 0
    || verification.summary.deleteActions !== 0
    || verification.summary.recordWrites !== 0;
  if (remainingActions > 0 || conflicts > 0 || warnings > 0 || manualActions > 0 || unsafe) {
    throw permanentError('Shared-table schema Apply finished but zero-drift verification failed', {
      code: 'SHARED_TABLE_APPLY_VERIFICATION_FAILED',
      details: { remainingActions, conflicts, warnings, manualActions, unsafe },
    });
  }
}

function wrapSharedSchemaActionError(error, action, appliedActions) {
  const details = {
    ...(error?.details ?? {}),
    sharedSchemaAction: summarizeAction(action),
    appliedActionCount: appliedActions.length,
  };
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error.cause,
      details,
    });
  }
  return permanentError(`Shared-table schema action failed: ${action.kind}`, {
    code: 'SHARED_TABLE_APPLY_ACTION_FAILED',
    cause: error,
    details,
  });
}

function wrapSharedViewApplyError(error, appliedActions) {
  const details = {
    ...(error?.details ?? {}),
    appliedSchemaActionCount: appliedActions.length,
    stage: 'shared_view_apply',
  };
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error.cause,
      details,
    });
  }
  return permanentError('Shared-table View Apply failed', {
    code: 'SHARED_TABLE_VIEW_APPLY_FAILED',
    cause: error,
    details,
  });
}

function summarizeAction(action) {
  return Object.freeze({
    kind: action?.kind ?? null,
    tableKey: action?.tableKey ?? null,
    logicalName: action?.logicalName ?? action?.tableName ?? null,
    fieldName: action?.field?.fieldName ?? action?.toName ?? null,
    viewName: action?.viewName ?? null,
  });
}

function actionSignature(action) {
  return [
    action.kind,
    action.tableKey,
    action.field?.fieldName ?? action.fieldId ?? '',
    action.viewName ?? '',
    action.toName ?? '',
  ].join('\u0000');
}

function actionStatus(kind) {
  if (kind === 'rename_table') return 'renamed';
  if (kind === 'create_table' || kind === 'create_field') return 'created';
  return 'updated';
}

function requireApplyClient(client) {
  for (const method of [
    'listTables', 'listFields', 'listViews', 'getView', 'listRecordsPage',
    'renameTable', 'createTable', 'createField', 'updateField',
    'createView', 'updateView',
  ]) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Shared-table schema Apply requires client.${method}`);
    }
  }
  return client;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
