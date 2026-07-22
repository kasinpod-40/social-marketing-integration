import { RuntimeError, permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  LARK_REPORT_VIEWS,
  LARK_REPORT_VIEW_VERSION,
  validateReportViewDefinition,
} from '../../../config/src/lark-report-views.js';

const TABLE_ID_PATTERN = /^tbl[A-Za-z0-9]+$/u;
const VALUELESS_FILTER_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);
const SELECT_FIELD_TYPES = new Set([3, 4]);

/** วางแผน Client Views แบบอ่านอย่างเดียวและไม่ลบ View เดิม */
export async function planLarkReportViews(input = {}) {
  const client = requireClient(input.client);
  const env = input.env ?? {};
  const contract = input.contract ?? LARK_REPORT_VIEWS;
  validateReportViewDefinition(contract);

  const actions = [];
  const conflicts = [];
  const warnings = [];
  const manualActions = [];
  const resolvedTables = [];

  for (const tableContract of contract) {
    const tableId = readTableId(env, tableContract);
    const [fields, views] = await Promise.all([
      client.listFields({ tableId }),
      client.listViews({ tableId }),
    ]);
    const fieldIndex = buildFieldIndex(fields, tableContract, conflicts);
    const viewIndex = buildViewIndex(views, tableContract, conflicts);

    resolvedTables.push(Object.freeze({
      tableKey: tableContract.tableKey,
      tableId,
      envName: tableContract.envName,
      fieldCount: fields.length,
      viewCount: views.length,
    }));

    for (const desired of tableContract.views) {
      const resolved = resolveViewProperty({ desired, fieldIndex, tableContract, conflicts, warnings });
      if (!resolved) continue;
      let live = viewIndex.get(normalizeName(desired.name));
      // List Views อาจคืนเฉพาะ identity แม้ Get View จะมี Filter property ครบ.
      // Hydrate View ที่จะเปรียบเทียบเพื่อไม่วางแผน PATCH ซ้ำหลังเขียนสำเร็จ.
      if (live && typeof client.getView === 'function') {
        live = await client.getView({
          tableId,
          viewId: requireText(live.viewId, 'viewId'),
        });
      }
      if (live && normalizeViewType(live.viewType) !== desired.type) {
        conflicts.push(Object.freeze({
          code: 'VIEW_TYPE_MISMATCH',
          tableKey: tableContract.tableKey,
          tableId,
          viewName: desired.name,
          expectedType: desired.type,
          actualType: live.viewType,
          message: `View type ไม่ตรง ${desired.name}: expected ${desired.type}, actual ${live.viewType}`,
        }));
        continue;
      }

      if (!live) {
        actions.push(Object.freeze({
          kind: 'create_view',
          tableKey: tableContract.tableKey,
          tableId,
          viewKey: desired.key,
          viewName: desired.name,
          viewType: desired.type,
          property: resolved,
        }));
      } else if (!sameViewProperty(live.property, resolved, desired)) {
        if (
          desired.allowAdditionalLiveFilterConditions === true
          && hasAdditionalLiveFilterConditions(live.property?.filterInfo, resolved.filterInfo)
        ) {
          conflicts.push(Object.freeze({
            code: 'VIEW_MANAGED_FILTER_DRIFT_WITH_UI_CONDITIONS',
            tableKey: tableContract.tableKey,
            tableId,
            viewName: desired.name,
            message: `Managed Filter ของ ${desired.name} drift ขณะที่มี UI-owned conditions; Installer จะไม่ PATCH เพื่อป้องกันการลบ relative-date contract`,
          }));
          continue;
        }
        actions.push(Object.freeze({
          kind: 'update_view',
          tableKey: tableContract.tableKey,
          tableId,
          viewKey: desired.key,
          viewId: requireText(live.viewId, 'viewId'),
          viewName: desired.name,
          viewType: desired.type,
          property: resolved,
        }));
      }

      if (desired.manualSort) {
        manualActions.push(Object.freeze({
          code: 'VIEW_SORT_REVIEW_REQUIRED',
          tableKey: tableContract.tableKey,
          tableId,
          viewName: desired.name,
          fieldName: desired.manualSort.fieldName,
          direction: desired.manualSort.direction,
          message: `ตั้ง Sort ของ ${desired.name} เป็น ${desired.manualSort.fieldName} ${desired.manualSort.direction} ใน Lark UI`,
        }));
      }

    }
  }

  if (input.includePermissionManualAction !== false) {
    manualActions.push(Object.freeze({
      code: 'CLIENT_ROLE_PERMISSION_REVIEW_REQUIRED',
      message: 'สิทธิ์ซ่อน RAW/Daily/Sync/System tables จาก Client role ต้องตั้งใน Lark Advanced Permission ตอนติดตั้ง Production',
    }));
  }

  return deepFreeze({
    mode: 'preview',
    viewVersion: LARK_REPORT_VIEW_VERSION,
    readyToApply: conflicts.length === 0,
    summary: {
      tablesInScope: contract.length,
      createViews: actions.filter((action) => action.kind === 'create_view').length,
      updateViews: actions.filter((action) => action.kind === 'update_view').length,
      conflicts: conflicts.length,
      warnings: warnings.length,
      manualActions: manualActions.length,
    },
    resolvedTables,
    actions,
    conflicts,
    warnings,
    manualActions,
  });
}

/**
 * Apply Client Views แบบปลอดภัย:
 * - สร้าง View ที่ขาดก่อน
 * - PATCH Filter และ Hidden fields แยก request ตาม Lark OpenAPI
 * - ไม่ส่ง view_name ซ้ำและไม่ผสม Filter/Hidden fields ในคำขอเดียวกัน
 *
 * หมายเหตุ: Sort ไม่มี mutation contract ใน View OpenAPI จึงยังเป็น Manual action.
 */
export async function applyLarkReportViews(input = {}) {
  const client = requireClient(input.client);
  const env = input.env ?? {};
  const contract = input.contract ?? LARK_REPORT_VIEWS;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const includePermissionManualAction = input.includePermissionManualAction !== false;
  const preview = await planLarkReportViews({ client, env, contract, includePermissionManualAction });
  if (!preview.readyToApply) {
    throw permanentError('Lark report client views contain conflicts and cannot be applied safely', {
      code: 'LARK_REPORT_VIEW_CONFLICT',
      details: { conflicts: preview.conflicts },
    });
  }

  const appliedActions = [];
  for (const action of preview.actions) {
    onProgress(Object.freeze({ stage: 'report_view_action_start', action }));
    let viewId = action.viewId ?? null;
    let mutationStage = 'filter';
    try {
      if (action.kind === 'create_view') {
        const created = await client.createView({
          tableId: action.tableId,
          viewName: action.viewName,
          viewType: action.viewType,
        });
        viewId = requireText(created?.viewId, 'created viewId');
        onProgress(Object.freeze({
          stage: 'report_view_created',
          action: Object.freeze({ ...action, viewId }),
        }));
      } else if (action.kind !== 'update_view') {
        throw permanentError(`Unsupported report view action: ${action.kind}`, {
          code: 'LARK_REPORT_VIEW_INVALID_ACTION',
          details: { action },
        });
      }

      // PATCH ขั้นต่ำเฉพาะ Filter: ไม่ส่งชื่อ View ซ้ำและไม่ผสม hidden_fields
      // เพื่อเลี่ยง generic 1254001 ของ Lark tenant และแยก contract ที่สำคัญออกจาก UI cosmetics.
      await client.updateView({
        tableId: action.tableId,
        viewId,
        filterInfo: action.property.filterInfo,
      });

      const mutationStages = ['filter'];
      if ((action.property.hiddenFields ?? []).length > 0) {
        mutationStage = 'hidden_fields';
        await client.updateView({
          tableId: action.tableId,
          viewId,
          hiddenFields: action.property.hiddenFields,
        });
        mutationStages.push('hidden_fields');
      }

      appliedActions.push(Object.freeze({
        ...action,
        viewId,
        status: action.kind === 'create_view' ? 'created_and_configured' : 'configured',
        mutationStages: Object.freeze(mutationStages),
      }));
    } catch (error) {
      throw wrapViewActionError(
        error,
        { ...action, viewId },
        appliedActions,
        mutationStage,
        action.kind === 'create_view' && Boolean(viewId),
      );
    }
    onProgress(Object.freeze({ stage: 'report_view_action_complete', action }));
  }

  const verification = await planLarkReportViews({ client, env, contract, includePermissionManualAction });
  if (verification.conflicts.length > 0 || verification.actions.length > 0) {
    throw permanentError('Lark report client view apply finished but verification is not clean', {
      code: 'LARK_REPORT_VIEW_VERIFICATION_FAILED',
      details: {
        remainingActions: verification.actions.length,
        conflicts: verification.conflicts,
      },
    });
  }

  return deepFreeze({
    mode: 'apply',
    viewVersion: LARK_REPORT_VIEW_VERSION,
    ok: true,
    summary: {
      plannedActions: preview.actions.length,
      appliedActions: appliedActions.length,
      createdViews: appliedActions.filter((action) => action.kind === 'create_view').length,
      updatedViews: appliedActions.filter((action) => action.kind === 'update_view').length,
      manualActions: verification.manualActions.length,
    },
    appliedActions,
    verification,
  });
}

function resolveViewProperty(input) {
  const hiddenFields = [];
  let valid = true;
  for (const fieldName of input.desired.hiddenFields ?? []) {
    const field = input.fieldIndex.get(normalizeName(fieldName));
    if (!field) {
      input.conflicts.push(missingFieldConflict(input, fieldName));
      valid = false;
      continue;
    }
    // Lark Base ไม่อนุญาตให้ซ่อน Primary/Index field ของตารางในทุก View
    // จึงต้องตัดออกก่อนสร้าง PATCH body มิฉะนั้น API จะตอบ 1254001 WrongRequestBody
    if (field.isPrimary === true) {
      input.warnings.push(Object.freeze({
        code: 'VIEW_PRIMARY_FIELD_CANNOT_BE_HIDDEN',
        tableKey: input.tableContract.tableKey,
        fieldName,
        viewName: input.desired.name,
        message: `Lark ไม่อนุญาตให้ซ่อน Primary field ${input.tableContract.tableKey}.${fieldName}; Installer จะคง Field นี้ไว้ใน View`,
      }));
      continue;
    }
    hiddenFields.push(requireText(field.fieldId, 'fieldId'));
  }

  const conditions = [];
  for (const condition of input.desired.filterInfo.conditions) {
    const field = input.fieldIndex.get(normalizeName(condition.fieldName));
    if (!field) {
      input.conflicts.push(missingFieldConflict(input, condition.fieldName));
      valid = false;
      continue;
    }
    const resolvedCondition = resolveFilterCondition({ ...input, condition, field });
    if (!resolvedCondition) {
      valid = false;
      continue;
    }
    conditions.push(resolvedCondition);
  }
  if (!valid) return null;

  return Object.freeze({
    hiddenFields: Object.freeze([...new Set(hiddenFields)].sort()),
    filterInfo: Object.freeze({
      conjunction: input.desired.filterInfo.conjunction,
      conditions: Object.freeze(conditions),
    }),
  });
}


/** แปลง Filter contract เป็นรูปแบบ canonical ของ View OpenAPI พร้อม Field type และ encoded value */
function resolveFilterCondition(input) {
  const fieldId = requireText(input.field.fieldId, 'fieldId');
  const fieldType = normalizePositiveInteger(input.field.type);
  if (!fieldType) {
    input.conflicts.push(Object.freeze({
      code: 'VIEW_FILTER_FIELD_TYPE_INVALID',
      tableKey: input.tableContract.tableKey,
      fieldName: input.condition.fieldName,
      viewName: input.desired.name,
      actualType: input.field.type ?? null,
      message: `สร้าง Filter ไม่ได้ เพราะ Field type ไม่ถูกต้อง ${input.tableContract.tableKey}.${input.condition.fieldName}`,
    }));
    return null;
  }

  const operator = input.condition.operator;
  if (VALUELESS_FILTER_OPERATORS.has(operator)) {
    return Object.freeze({ fieldId, fieldType, operator, value: null });
  }

  const rawValues = Array.isArray(input.condition.value)
    ? input.condition.value
    : [input.condition.value];
  if (rawValues.length === 0 || rawValues.some((value) => value === undefined || value === null)) {
    input.conflicts.push(Object.freeze({
      code: 'VIEW_FILTER_VALUE_MISSING',
      tableKey: input.tableContract.tableKey,
      fieldName: input.condition.fieldName,
      viewName: input.desired.name,
      message: `สร้าง Filter ไม่ได้ เพราะไม่มีค่า ${input.desired.name}.${input.condition.fieldName}`,
    }));
    return null;
  }

  let values;
  if (SELECT_FIELD_TYPES.has(fieldType)) {
    values = resolveSelectFilterValues(input, rawValues);
    if (!values) return null;
  } else if (fieldType === 7) {
    values = resolveCheckboxFilterValues(input, rawValues);
    if (!values) return null;
  } else {
    values = rawValues.map(normalizeFilterScalar);
  }

  return Object.freeze({
    fieldId,
    fieldType,
    operator,
    value: JSON.stringify(values),
  });
}

/** Select View filters ต้องส่ง Option ID จริง ไม่ใช่ชื่อที่แสดง */
function resolveSelectFilterValues(input, rawValues) {
  const options = Array.isArray(input.field.property?.options)
    ? input.field.property.options
    : [];
  const byId = new Map();
  const byName = new Map();
  for (const option of options) {
    const id = normalizeOptionalText(option?.id);
    const name = normalizeOptionalText(option?.name);
    if (id) byId.set(id, id);
    if (!name || !id) continue;
    const key = normalizeName(name);
    if (byName.has(key) && byName.get(key) !== id) {
      input.conflicts.push(Object.freeze({
        code: 'VIEW_FILTER_SELECT_OPTION_DUPLICATE',
        tableKey: input.tableContract.tableKey,
        fieldName: input.condition.fieldName,
        viewName: input.desired.name,
        optionName: name,
        message: `สร้าง Filter ไม่ได้ เพราะ Select option ชื่อซ้ำ ${input.condition.fieldName}.${name}`,
      }));
      return null;
    }
    byName.set(key, id);
  }

  const resolved = [];
  for (const raw of rawValues) {
    const value = requireFilterScalar(raw, 'select filter value');
    const optionId = byId.get(value) ?? byName.get(normalizeName(value));
    if (!optionId) {
      input.conflicts.push(Object.freeze({
        code: 'VIEW_FILTER_SELECT_OPTION_MISSING',
        tableKey: input.tableContract.tableKey,
        fieldName: input.condition.fieldName,
        viewName: input.desired.name,
        optionName: value,
        message: `สร้าง Filter ไม่ได้ เพราะไม่พบ Select option ${input.condition.fieldName}.${value}`,
      }));
      return null;
    }
    resolved.push(optionId);
  }
  return resolved;
}

function resolveCheckboxFilterValues(input, rawValues) {
  const resolved = [];
  for (const raw of rawValues) {
    if (raw === true || raw === false) {
      // Checkbox View filters are JSON booleans inside Lark's JSON-array string.
      // Sending the text "true" produces a syntactically valid body that Lark rejects.
      resolved.push(raw);
      continue;
    }
    const value = requireFilterScalar(raw, 'checkbox filter value').toLowerCase();
    if (value !== 'true' && value !== 'false') {
      input.conflicts.push(Object.freeze({
        code: 'VIEW_FILTER_CHECKBOX_VALUE_INVALID',
        tableKey: input.tableContract.tableKey,
        fieldName: input.condition.fieldName,
        viewName: input.desired.name,
        value,
        message: `สร้าง Filter ไม่ได้ เพราะ Checkbox ต้องเป็น true/false: ${input.condition.fieldName}`,
      }));
      return null;
    }
    resolved.push(value === 'true');
  }
  return resolved;
}

function normalizeFilterScalar(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new TypeError('Lark report view filter value must be a scalar');
}

function requireFilterScalar(value, fieldName) {
  const normalized = normalizeFilterScalar(value);
  if (normalized === '') throw new TypeError(`Lark report view installer requires ${fieldName}`);
  return normalized;
}

function missingFieldConflict(input, fieldName) {
  return Object.freeze({
    code: 'VIEW_FIELD_MISSING',
    tableKey: input.tableContract.tableKey,
    fieldName,
    viewName: input.desired.name,
    message: `สร้าง Client View ไม่ได้ เพราะไม่พบ Field ${input.tableContract.tableKey}.${fieldName}`,
  });
}

function buildFieldIndex(fields, tableContract, conflicts) {
  const index = new Map();
  for (const field of fields) {
    const key = normalizeName(field?.fieldName);
    if (!key) continue;
    if (index.has(key)) {
      conflicts.push(Object.freeze({
        code: 'DUPLICATE_FIELD_NAME',
        tableKey: tableContract.tableKey,
        fieldName: field.fieldName,
        message: `พบ Field ชื่อซ้ำใน ${tableContract.tableKey}: ${field.fieldName}`,
      }));
      continue;
    }
    index.set(key, field);
  }
  return index;
}

function buildViewIndex(views, tableContract, conflicts) {
  const index = new Map();
  for (const view of views) {
    const key = normalizeName(view?.viewName);
    if (!key) continue;
    if (index.has(key)) {
      conflicts.push(Object.freeze({
        code: 'DUPLICATE_VIEW_NAME',
        tableKey: tableContract.tableKey,
        viewName: view.viewName,
        message: `พบ View ชื่อซ้ำใน ${tableContract.tableKey}: ${view.viewName}`,
      }));
      continue;
    }
    index.set(key, view);
  }
  return index;
}

function sameViewProperty(live, desired, contract = {}) {
  const liveHidden = normalizeHiddenFields(live?.hiddenFields);
  const desiredHidden = normalizeHiddenFields(desired.hiddenFields);
  if (JSON.stringify(liveHidden) !== JSON.stringify(desiredHidden)) return false;
  const liveFilter = normalizeFilter(live?.filterInfo);
  const desiredFilter = normalizeFilter(desired.filterInfo);
  if (contract.allowAdditionalLiveFilterConditions !== true) {
    return JSON.stringify(liveFilter) === JSON.stringify(desiredFilter);
  }
  if (!liveFilter || !desiredFilter || liveFilter.conjunction !== desiredFilter.conjunction) return false;
  const liveConditions = liveFilter.conditions.map(conditionSignature);
  return desiredFilter.conditions.every((condition) => liveConditions.includes(conditionSignature(condition)));
}

function hasAdditionalLiveFilterConditions(live, desired) {
  const liveFilter = normalizeFilter(live);
  const desiredFilter = normalizeFilter(desired);
  if (!liveFilter || !desiredFilter) return false;
  const desiredConditions = desiredFilter.conditions.map(conditionSignature);
  return liveFilter.conditions.some((condition) => !desiredConditions.includes(conditionSignature(condition)));
}

function conditionSignature(condition) {
  return JSON.stringify(condition);
}

function normalizeHiddenFields(value) {
  const fields = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : [];
  return [...new Set(fields)].sort();
}

function normalizeFilter(filter) {
  if (!filter) return null;
  const conditions = (filter.conditions ?? []).map((condition) => ({
    fieldId: condition.fieldId ?? null,
    fieldType: normalizePositiveInteger(condition.fieldType),
    operator: condition.operator ?? null,
    value: canonicalizeFilterValue(condition.value),
  }));
  return {
    conjunction: filter.conjunction === 'or' ? 'or' : 'and',
    conditions,
  };
}

/** Canonicalize API value ซึ่งเป็น JSON-encoded string array เพื่อให้ Preview รันซ้ำแบบ Idempotent */
function canonicalizeFilterValue(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return JSON.stringify(value.map(normalizeFilterScalar));
  const text = String(value).trim();
  if (text === '') return JSON.stringify(['']);
  try {
    const parsed = JSON.parse(text);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return JSON.stringify(values.map(normalizeFilterScalar));
  } catch {
    return JSON.stringify([text]);
  }
}

function readTableId(env, tableContract) {
  const value = env?.[tableContract.envName];
  if (typeof value !== 'string' || !TABLE_ID_PATTERN.test(value.trim())) {
    throw permanentError(`Missing or invalid ${tableContract.envName}`, {
      code: 'LARK_REPORT_VIEW_TABLE_CONFIG_INVALID',
      details: { tableKey: tableContract.tableKey, envName: tableContract.envName },
    });
  }
  return value.trim();
}

function normalizeViewType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeName(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.normalize('NFKC').trim().toLowerCase()
    : null;
}

function wrapViewActionError(
  error,
  action,
  appliedActions,
  mutationStage = null,
  viewCreatedBeforeFailure = false,
) {
  const details = {
    ...(error?.details ?? {}),
    viewAction: {
      kind: action.kind,
      tableKey: action.tableKey,
      tableId: action.tableId,
      viewId: action.viewId ?? null,
      viewName: action.viewName,
    },
    appliedActionCount: appliedActions.length,
    viewMutationStage: mutationStage,
    viewCreatedBeforeFailure,
    createdViewId: viewCreatedBeforeFailure ? action.viewId : null,
  };
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error.cause,
      details,
    });
  }
  return permanentError(`Report view action failed: ${action.viewName}`, {
    code: 'LARK_REPORT_VIEW_ACTION_FAILED',
    cause: error,
    details,
  });
}

function requireClient(client) {
  for (const method of ['listFields', 'listViews', 'createView', 'updateView']) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Lark report view installer requires client.${method}`);
    }
  }
  return client;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Lark report view installer requires ${fieldName}`);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
