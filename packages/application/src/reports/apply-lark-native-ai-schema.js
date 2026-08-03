import {
  LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_COUNTS,
} from '../../../config/src/lark-native-ai-schema-apply-contract.js';
import { collectLarkNativeAiSchemaInventory } from './collect-lark-native-ai-schema-inventory.js';
import {
  assertAcceptedLarkNativeAiSchemaApplyEvidence,
  calculateInventorySha256,
} from './lark-native-ai-schema-apply-evidence.js';
import {
  assertAdditiveDescendant,
  assertAllowedActions,
  assertRawStateMatchesInventory,
  buildCreateFieldMutation,
  buildExpectedViewFilter,
  buildSelectOptionMutation,
  buildViewPlans,
  canonicalSchemaValue,
  freezeSchemaValue,
  isEmptyFilter,
  normalizeComparableFilter,
  readRawTargetState,
  requireUniqueRawField,
  safeProgress,
  safeSchemaBlockers,
  schemaApplyFailure,
  schemaViewConflict,
  wrapActionFailure,
} from './lark-native-ai-schema-apply-model.js';

export { assertAcceptedLarkNativeAiSchemaApplyEvidence, calculateInventorySha256 };

export async function planLarkNativeAiSchemaAdditiveApply(input = {}) {
  const client = requireClient(input.client, false);
  const accepted = await assertAcceptedLarkNativeAiSchemaApplyEvidence(input.retainedEvidence);
  const live = await collectLarkNativeAiSchemaInventory({ client, baseName: input.baseName ?? null });
  if (!live.ok || live.preview.status === 'blocked') throw schemaApplyFailure(
    'Current Lark Native AI schema Preview is blocked',
    'LARK_NATIVE_AI_SCHEMA_APPLY_CURRENT_PREVIEW_BLOCKED',
    { blockers: safeSchemaBlockers(live.preview.blockers) },
  );
  assertAdditiveDescendant(accepted.inventory, live.inventory);
  assertAllowedActions(accepted.preview.actions, live.preview.actions);

  const raw = await readRawTargetState(client);
  assertRawStateMatchesInventory(raw, live.inventory);
  const viewPlans = await buildViewPlans(client, raw);
  const fieldActions = live.preview.actions.filter(({ action }) => action !== 'create_view');
  const remainingLogicalActionCount = fieldActions.length
    + viewPlans.filter(({ state }) => state !== 'complete').length;
  if (remainingLogicalActionCount > LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_COUNTS.totalActions) {
    throw schemaApplyFailure(
      'Current Apply plan exceeds the accepted action count',
      'LARK_NATIVE_AI_SCHEMA_APPLY_ACTION_COUNT_EXCEEDED',
      { observed: remainingLogicalActionCount },
    );
  }
  return freezeSchemaValue({
    ok: true,
    status: remainingLogicalActionCount === 0
      ? 'zero_drift'
      : (live.inventory.sourceSha256 === accepted.inventorySha256 ? 'ready_to_apply' : 'resume_ready'),
    accepted,
    live,
    raw,
    fieldActions,
    viewPlans,
    remainingLogicalActionCount,
  });
}

export async function applyLarkNativeAiSchemaAdditive(input = {}) {
  const client = requireClient(input.client, true);
  const progress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const plan = await planLarkNativeAiSchemaAdditiveApply({ ...input, client });
  const appliedActions = [];
  if (plan.remainingLogicalActionCount === 0) return freezeSchemaValue({
    ok: true,
    mode: 'already_zero_drift',
    acceptedInventorySha256: plan.accepted.inventorySha256,
    plannedLogicalActionCount: 0,
    appliedLogicalActionCount: 0,
    appliedActions,
    verification: { status: 'zero_drift', remainingLogicalActionCount: 0 },
  });

  let raw = plan.raw;
  for (const action of plan.fieldActions) {
    progress(safeProgress('schema_action_start', action));
    try {
      if (action.action === 'add_field') {
        await client.createField({
          tableId: raw.table.tableId,
          field: buildCreateFieldMutation(action),
        });
        appliedActions.push(freezeSchemaValue({
          action: 'add_field',
          fieldName: action.fieldName,
          fieldType: action.fieldType,
          status: 'created',
        }));
      } else if (action.action === 'extend_select_options') {
        const field = requireUniqueRawField(raw.fields, action.fieldName);
        await client.updateField({
          tableId: raw.table.tableId,
          fieldId: requireText(field.fieldId, `${action.fieldName}.fieldId`),
          field: buildSelectOptionMutation(field, action.optionsToAdd),
        });
        appliedActions.push(freezeSchemaValue({
          action: 'extend_select_options',
          fieldName: action.fieldName,
          optionsAdded: [...action.optionsToAdd],
          status: 'updated',
        }));
      } else throw schemaApplyFailure(
        'Unsupported accepted Field action',
        'LARK_NATIVE_AI_SCHEMA_APPLY_ACTION_UNSUPPORTED',
        { action: action.action },
      );
    } catch (error) {
      throw wrapSchemaActionFailure(error, action, appliedActions.length);
    }
    progress(safeProgress('schema_action_complete', action));
  }

  raw = await readRawTargetState(client);
  for (const item of await buildViewPlans(client, raw)) {
    if (item.state === 'complete') continue;
    const action = { action: 'create_view', viewName: item.viewName };
    progress(safeProgress('schema_action_start', action));
    try {
      let view = item.view;
      if (item.state === 'create') view = await client.createView({
        tableId: raw.table.tableId,
        viewName: item.viewName,
        viewType: 'grid',
      });
      const viewId = requireText(view?.viewId, `${item.viewName}.viewId`);
      const expected = buildExpectedViewFilter(item.contract, raw.fields);
      const hydrated = await client.getView({ tableId: raw.table.tableId, viewId });
      const actual = normalizeComparableFilter(hydrated?.property?.filterInfo);
      if (expected === null) {
        if (!isEmptyFilter(actual)) throw schemaViewConflict(item.viewName);
      } else if (canonicalSchemaValue(actual) !== canonicalSchemaValue(expected.comparable)) {
        if (!isEmptyFilter(actual)) throw schemaViewConflict(item.viewName);
        await client.updateView({
          tableId: raw.table.tableId,
          viewId,
          viewName: item.viewName,
          filterInfo: expected.mutation,
        });
      }
      appliedActions.push(freezeSchemaValue({
        action: 'create_view',
        viewName: item.viewName,
        status: item.state === 'create' ? 'created_and_configured' : 'configured_existing',
      }));
    } catch (error) {
      throw wrapSchemaActionFailure(error, action, appliedActions.length);
    }
    progress(safeProgress('schema_action_complete', action));
    raw = await readRawTargetState(client);
  }

  const verification = await collectLarkNativeAiSchemaInventory({
    client,
    baseName: input.baseName ?? null,
  });
  if (!verification.ok || verification.preview.status !== 'zero_drift'
    || verification.preview.actions.length !== 0 || verification.preview.blockers.length !== 0) {
    throw schemaApplyFailure(
      'Lark Native AI schema Apply did not reach zero drift',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VERIFICATION_FAILED',
      { status: verification.preview.status, remainingActions: verification.preview.actions.length },
    );
  }
  assertAdditiveDescendant(plan.accepted.inventory, verification.inventory);
  raw = await readRawTargetState(client);
  const finalViews = await buildViewPlans(client, raw);
  const incomplete = finalViews.filter(({ state }) => state !== 'complete');
  if (incomplete.length > 0) throw schemaApplyFailure(
    'Required Views did not reach exact filter parity',
    'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_VERIFICATION_FAILED',
    { views: incomplete.map(({ viewName, state }) => ({ viewName, state })) },
  );
  return freezeSchemaValue({
    ok: true,
    mode: plan.status === 'resume_ready' ? 'resume_apply' : 'apply',
    acceptedInventorySha256: plan.accepted.inventorySha256,
    plannedLogicalActionCount: plan.remainingLogicalActionCount,
    appliedLogicalActionCount: appliedActions.length,
    appliedActions,
    verification: {
      status: 'zero_drift',
      sourceSha256: verification.inventory.sourceSha256,
      remainingLogicalActionCount: 0,
      requiredViewCount: finalViews.length,
      exactViewFilterCount: finalViews.length,
    },
  });
}

function wrapSchemaActionFailure(error, action, appliedLogicalActionCount) {
  const wrapped = wrapActionFailure(error, action, appliedLogicalActionCount);
  if (wrapped?.code !== 'LARK_NATIVE_AI_SCHEMA_APPLY_REMOTE_ACTION_FAILED') return wrapped;
  return schemaApplyFailure(
    wrapped.message,
    wrapped.code,
    {
      ...(wrapped.details ?? {}),
      ...safeRemoteActionDiagnostics(error),
    },
    wrapped,
  );
}

function safeRemoteActionDiagnostics(error) {
  const details = error?.details && typeof error.details === 'object'
    ? error.details
    : {};
  const diagnostics = {};
  const status = Number(details.status);
  const larkCode = Number(details.larkCode);
  if (Number.isInteger(status) && status > 0) diagnostics.causeStatus = status;
  if (Number.isInteger(larkCode)) diagnostics.causeLarkCode = larkCode;

  const body = details.viewMutationBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return diagnostics;
  const property = body.property && typeof body.property === 'object' ? body.property : {};
  const filterInfo = property.filter_info ?? property.filterInfo;
  const conditions = Array.isArray(filterInfo?.conditions) ? filterInfo.conditions : [];
  diagnostics.viewMutation = freezeSchemaValue({
    hasViewName: typeof (body.view_name ?? body.viewName) === 'string'
      && String(body.view_name ?? body.viewName).trim() !== '',
    hasFilterInfo: Boolean(filterInfo && typeof filterInfo === 'object'),
    conjunction: filterInfo?.conjunction === 'or' ? 'or' : 'and',
    conditionCount: conditions.length,
    operators: [...new Set(conditions
      .map((condition) => condition?.operator)
      .filter((operator) => typeof operator === 'string' && operator.trim() !== ''))].sort(),
  });
  return diagnostics;
}

function requireClient(value, apply) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('client must be an object');
  }
  const methods = ['listTables', 'listFields', 'listViews', 'getView',
    ...(apply ? ['createField', 'updateField', 'createView', 'updateView'] : [])];
  for (const method of methods) if (typeof value[method] !== 'function') {
    throw new TypeError(`client.${method} is required`);
  }
  return value;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}
