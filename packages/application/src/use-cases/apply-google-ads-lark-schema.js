import { RuntimeError, permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  GOOGLE_ADS_LARK_SCHEMA,
  GOOGLE_ADS_LARK_SCHEMA_VERSION,
  GOOGLE_ADS_RELATIONS,
  GOOGLE_ADS_VIEW_CONTRACT,
  validateGoogleAdsLarkSchema,
} from '../../../config/src/google-ads-lark-schema.js';
import { applyLarkReportViews } from './install-lark-report-views.js';
import { previewGoogleAdsLarkSchema } from './preview-google-ads-lark-schema.js';

const BASE_ACTIONS = new Set(['create_table', 'create_field', 'update_field']);

/**
 * Apply Google Ads Schema แบบ Guarded:
 * 1) Fresh Preview และตรวจ Meta dependency
 * 2) สร้าง/เติม Base fields แบบ Sequential
 * 3) Preview ใหม่เพื่อ Resolve Table IDs แล้วสร้าง Relations
 * 4) Apply Views ผ่าน Resolver กลาง
 * 5) Read-back และบังคับ Zero drift
 */
export async function applyGoogleAdsLarkSchema(input = {}) {
  const client = requireApplyClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema ?? GOOGLE_ADS_LARK_SCHEMA;
  const relations = input.relations ?? GOOGLE_ADS_RELATIONS;
  const viewContract = input.viewContract ?? GOOGLE_ADS_VIEW_CONTRACT;
  const schemaVersion = input.schemaVersion ?? GOOGLE_ADS_LARK_SCHEMA_VERSION;
  const validateSchema = input.validateSchema ?? validateGoogleAdsLarkSchema;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  validateSchema(schema);
  const schemaByKey = new Map(schema.map((table) => [table.key, table]));
  const appliedActions = [];
  const createdTableIds = new Map();

  const initialPreview = await previewGoogleAdsLarkSchema({
    client, env, schema, relations, viewContract, schemaVersion, validateSchema,
  });
  assertApplyPreview(initialPreview, { stage: 'initial_preview', schemaByKey });

  const baseActions = initialPreview.actions
    .filter((action) => BASE_ACTIONS.has(action.kind))
    .sort(compareBaseActions);

  for (const action of baseActions) {
    onProgress({ stage: 'google_ads_schema_action_start', action: summarizeAction(action) });
    try {
      if (action.kind === 'create_table') {
        const created = await client.createTable({
          name: action.name,
          defaultViewName: action.defaultViewName,
          fields: action.fields,
        });
        const tableId = requireText(created?.tableId, 'created tableId');
        createdTableIds.set(action.tableKey, tableId);
        appliedActions.push({ ...summarizeAction(action), tableId, status: 'created' });
      } else if (action.kind === 'create_field') {
        const created = await client.createField({
          tableId: requireText(action.tableId, 'create_field.tableId'),
          field: action.field,
        });
        appliedActions.push({
          ...summarizeAction(action),
          tableId: action.tableId,
          fieldId: created?.fieldId ?? null,
          status: 'created',
        });
      } else if (action.kind === 'update_field') {
        await client.updateField({
          tableId: requireText(action.tableId, 'update_field.tableId'),
          fieldId: requireText(action.fieldId, 'update_field.fieldId'),
          field: action.field,
        });
        appliedActions.push({
          ...summarizeAction(action),
          tableId: action.tableId,
          fieldId: action.fieldId,
          status: 'updated',
          reason: action.reason ?? null,
        });
      } else {
        throw invalidAction(action);
      }
    } catch (error) {
      throw wrapActionError(error, action, appliedActions, 'base_schema');
    }
    onProgress({ stage: 'google_ads_schema_action_complete', action: summarizeAction(action) });
  }

  const postBaseEnv = { ...env, ...initialPreview.environmentUpdates };
  for (const tableContract of schema) {
    const tableId = createdTableIds.get(tableContract.key);
    if (tableId) postBaseEnv[tableContract.envName] = tableId;
  }

  const relationPreview = await previewGoogleAdsLarkSchema({
    client,
    env: postBaseEnv,
    schema,
    relations,
    viewContract,
    schemaVersion,
    validateSchema,
  });
  assertApplyPreview(relationPreview, { stage: 'relation_preview', schemaByKey });

  const remainingBaseActions = relationPreview.actions.filter((action) => BASE_ACTIONS.has(action.kind));
  if (remainingBaseActions.length > 0) {
    throw permanentError('Google Ads base schema did not reach zero drift before Relations', {
      code: 'GOOGLE_ADS_BASE_SCHEMA_VERIFICATION_FAILED',
      details: {
        remainingBaseActions: remainingBaseActions.map(summarizeAction),
        appliedActionCount: appliedActions.length,
      },
    });
  }

  const relationActions = relationPreview.actions
    .filter((action) => action.kind === 'create_relation_field');
  for (const action of relationActions) {
    if (action.deferredUntilTablesExist === true || !action.tableId || !action.targetTableId) {
      throw permanentError('Google Ads relation still lacks resolved live Table IDs', {
        code: 'GOOGLE_ADS_RELATION_DEFERRED_AFTER_BASE_APPLY',
        details: { action: summarizeAction(action), appliedActionCount: appliedActions.length },
      });
    }
    onProgress({ stage: 'google_ads_relation_action_start', action: summarizeAction(action) });
    try {
      const created = await client.createField({ tableId: action.tableId, field: action.field });
      appliedActions.push({
        ...summarizeAction(action),
        tableId: action.tableId,
        targetTableId: action.targetTableId,
        fieldId: created?.fieldId ?? null,
        status: 'created',
      });
    } catch (error) {
      throw wrapActionError(error, action, appliedActions, 'relation_schema');
    }
    onProgress({ stage: 'google_ads_relation_action_complete', action: summarizeAction(action) });
  }

  const postRelationPreview = await previewGoogleAdsLarkSchema({
    client,
    env: postBaseEnv,
    schema,
    relations,
    viewContract,
    schemaVersion,
    validateSchema,
  });
  assertApplyPreview(postRelationPreview, { stage: 'view_preview', schemaByKey });

  const preViewSchemaActions = postRelationPreview.actions.filter((action) => (
    BASE_ACTIONS.has(action.kind) || action.kind === 'create_relation_field'
  ));
  if (preViewSchemaActions.length > 0) {
    throw permanentError('Google Ads Schema/Relations did not reach zero drift before Views', {
      code: 'GOOGLE_ADS_RELATION_VERIFICATION_FAILED',
      details: {
        remainingActions: preViewSchemaActions.map(summarizeAction),
        appliedActionCount: appliedActions.length,
      },
    });
  }

  let viewApply;
  try {
    viewApply = await applyLarkReportViews({
      client,
      env: { ...postBaseEnv, ...postRelationPreview.environmentUpdates },
      contract: viewContract,
      includePermissionManualAction: false,
      onProgress: (event) => onProgress({
        stage: `google_ads_${event.stage}`,
        action: event.action ? summarizeAction(event.action) : null,
      }),
    });
  } catch (error) {
    throw wrapViewError(error, appliedActions);
  }

  for (const action of viewApply.appliedActions) {
    appliedActions.push({
      ...summarizeAction(action),
      tableId: action.tableId,
      viewId: action.viewId ?? null,
      status: action.status,
    });
  }

  const verification = await previewGoogleAdsLarkSchema({
    client,
    env: { ...postBaseEnv, ...postRelationPreview.environmentUpdates },
    schema,
    relations,
    viewContract,
    schemaVersion,
    validateSchema,
  });
  assertCleanVerification(verification, appliedActions);

  const createdTables = appliedActions.filter((action) => action.kind === 'create_table');
  const createdFields = appliedActions.filter((action) => (
    action.kind === 'create_field' || action.kind === 'create_relation_field'
  ));
  const updatedFields = appliedActions.filter((action) => action.kind === 'update_field');
  const schemaRoleByKey = new Map(
    schema.map((table) => [table.key, table.googleAds?.role ?? null]),
  );

  return deepFreeze({
    mode: 'apply',
    schemaVersion,
    ok: true,
    status: 'SCHEMA_APPLY_PASS',
    summary: {
      plannedInitialActions: initialPreview.actions.length,
      appliedActions: appliedActions.length,
      createdTables: createdTables.length,
      createdRawTables: createdTables
        .filter((action) => schemaRoleByKey.get(action.tableKey) === 'raw').length,
      createdCanonicalTables: createdTables
        .filter((action) => schemaRoleByKey.get(action.tableKey) === 'new_canonical').length,
      createdFields: createdFields.length,
      createdRelationFields: createdFields
        .filter((action) => action.kind === 'create_relation_field').length,
      updatedFields: updatedFields.length,
      addedSelectOptionUpdates: updatedFields
        .filter((action) => String(action.reason ?? '').includes('add_select_options')).length,
      createdViews: viewApply.summary.createdViews,
      updatedViews: viewApply.summary.updatedViews,
      remainingActions: verification.actions.length,
      conflicts: verification.conflicts.length,
      warnings: verification.warnings.length,
      blockingManualActions: verification.blockingManualActions.length,
      nonBlockingManualActions: verification.nonBlockingManualActions.length,
      protectedActions: verification.summary.protectedActions,
      renameActions: verification.summary.renameActions,
      deleteActions: verification.summary.deleteActions,
      recordWrites: verification.summary.recordWrites,
    },
    createdTables: createdTables.map((action) => ({
      logicalKey: action.tableKey,
      tableName: action.logicalName,
      tableId: action.tableId,
    })),
    canonicalFieldsAdded: createdFields
      .filter((action) => schemaRoleByKey.get(action.tableKey) === 'existing_canonical_extension')
      .map((action) => ({
        tableKey: action.tableKey,
        fieldName: action.fieldName,
        fieldId: action.fieldId,
      })),
    fieldsSkippedAsExisting: verification.skippedExistingFieldMutations,
    selectOptionsUpdated: updatedFields.map((action) => ({
      tableKey: action.tableKey,
      fieldName: action.fieldName,
      reason: action.reason,
    })),
    relationsCreated: createdFields
      .filter((action) => action.kind === 'create_relation_field')
      .map((action) => ({
        tableKey: action.tableKey,
        fieldName: action.fieldName,
        targetTableKey: action.targetTableKey,
      })),
    views: {
      summary: viewApply.summary,
      appliedActions: viewApply.appliedActions.map(summarizeAction),
    },
    appliedActions,
    verification,
    environmentUpdates: verification.environmentUpdates,
    nonBlockingManualActions: verification.nonBlockingManualActions,
    safety: {
      businessRecordRead: false,
      businessRecordWrite: false,
      sourceApiCalled: false,
      connectorChanged: false,
      workerEndpointChanged: false,
      scheduleChanged: false,
      renameAction: false,
      deleteAction: false,
      fieldTypeMutation: false,
      protectedTableMutation: false,
      productionMutation: false,
    },
  });
}

function assertApplyPreview(preview, input) {
  const problems = [];
  if (preview.readyForApplyAuthorization !== true) problems.push('preview_not_ready');
  if (preview.metaDependencyReady !== true) problems.push('meta_dependency_not_ready');
  if (preview.conflicts.length > 0) problems.push('conflicts_present');
  if (preview.warnings.length > 0) problems.push('warnings_present');
  if (preview.blockingManualActions.length > 0) problems.push('blocking_manual_actions_present');
  if (preview.summary.protectedActions !== 0) problems.push('protected_actions_present');
  if (preview.summary.renameActions !== 0) problems.push('rename_actions_present');
  if (preview.summary.deleteActions !== 0) problems.push('delete_actions_present');
  if (preview.summary.recordWrites !== 0) problems.push('record_writes_present');
  if (preview.protectedChecks.some((check) => (
    !check.found || check.ambiguous || check.plannedActions !== 0
  ))) problems.push('protected_table_check_failed');

  for (const action of preview.actions) {
    if (!new Set([
      'create_table', 'create_field', 'update_field',
      'create_relation_field', 'create_view', 'update_view',
    ]).has(action.kind)) {
      problems.push(`unsupported_action:${action.kind}`);
      continue;
    }
    const tableContract = input.schemaByKey.get(action.tableKey);
    if (!tableContract) {
      problems.push(`unknown_table_key:${action.tableKey}`);
      continue;
    }
    if (
      action.kind === 'create_table'
      && !new Set(['raw', 'new_canonical']).has(tableContract.googleAds?.role)
    ) problems.push(`canonical_create_forbidden:${action.tableKey}`);
    if (
      action.kind === 'update_field'
      && !String(action.reason ?? '').includes('add_select_options')
    ) problems.push(`non_additive_field_update:${action.tableKey}.${action.field?.fieldName}`);
    if (action.kind === 'create_relation_field' && Number(action.field?.type) !== 18) {
      problems.push(`invalid_relation_type:${action.tableKey}.${action.field?.fieldName}`);
    }
  }

  if (problems.length > 0) {
    throw permanentError(`Google Ads Schema Apply failed safety validation at ${input.stage}`, {
      code: 'GOOGLE_ADS_SCHEMA_APPLY_PLAN_INVALID',
      details: {
        stage: input.stage,
        problems: [...new Set(problems)],
        actionCount: preview.actions.length,
        conflictCount: preview.conflicts.length,
        warningCount: preview.warnings.length,
        blockingManualActionCount: preview.blockingManualActions.length,
      },
    });
  }
}

function assertCleanVerification(verification, appliedActions) {
  const unsafe = (
    verification.summary.protectedActions !== 0
    || verification.summary.renameActions !== 0
    || verification.summary.deleteActions !== 0
    || verification.summary.recordWrites !== 0
  );
  if (
    verification.actions.length > 0
    || verification.conflicts.length > 0
    || verification.warnings.length > 0
    || verification.blockingManualActions.length > 0
    || unsafe
  ) {
    throw permanentError('Google Ads Schema Apply finished but zero-drift verification failed', {
      code: 'GOOGLE_ADS_SCHEMA_APPLY_VERIFICATION_FAILED',
      details: {
        remainingActions: verification.actions.map(summarizeAction),
        conflicts: verification.conflicts,
        warnings: verification.warnings,
        blockingManualActions: verification.blockingManualActions,
        unsafe,
        appliedActionCount: appliedActions.length,
      },
    });
  }
}

function compareBaseActions(left, right) {
  const order = new Map([['create_table', 1], ['create_field', 2], ['update_field', 3]]);
  return (order.get(left.kind) ?? 99) - (order.get(right.kind) ?? 99);
}

function invalidAction(action) {
  return permanentError(`Unsupported Google Ads schema action: ${action?.kind}`, {
    code: 'GOOGLE_ADS_SCHEMA_ACTION_INVALID',
    details: { action: summarizeAction(action) },
  });
}

function wrapActionError(error, action, appliedActions, stage) {
  const details = {
    ...(error?.details ?? {}),
    stage,
    googleAdsSchemaAction: summarizeAction(action),
    appliedActionCount: appliedActions.length,
  };
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error,
      details,
    });
  }
  return permanentError(`Google Ads schema action failed: ${action?.kind}`, {
    code: 'GOOGLE_ADS_SCHEMA_ACTION_FAILED',
    cause: error,
    details,
  });
}

function wrapViewError(error, appliedActions) {
  const details = {
    ...(error?.details ?? {}),
    stage: 'google_ads_view_apply',
    appliedSchemaActionCount: appliedActions.length,
  };
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error,
      details,
    });
  }
  return permanentError('Google Ads View Apply failed', {
    code: 'GOOGLE_ADS_VIEW_APPLY_FAILED',
    cause: error,
    details,
  });
}

function summarizeAction(action) {
  return {
    kind: action?.kind ?? null,
    tableKey: action?.tableKey ?? null,
    logicalName: action?.logicalName ?? action?.tableName ?? null,
    fieldName: action?.field?.fieldName ?? null,
    targetTableKey: action?.targetTableKey ?? null,
    viewName: action?.viewName ?? null,
  };
}

function requireApplyClient(client) {
  for (const method of [
    'listTables', 'listFields', 'listViews', 'getView',
    'createTable', 'createField', 'updateField',
    'createView', 'updateView',
  ]) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Google Ads schema Apply requires client.${method}`);
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
