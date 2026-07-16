import { RuntimeError, permanentError } from '../../../shared/src/errors/runtime-error.js';
import { larkFieldTypeAllowsProperty, normalizeLarkFieldProperty } from '../../../shared/src/lark/lark-field-contract.js';
import {
  LARK_REPORT_SCHEMA,
  LARK_REPORT_SCHEMA_VERSION,
  validateReportSchemaDefinition,
} from '../../../config/src/lark-report-schema.js';

const PLACEHOLDER_TABLE_ID_PATTERNS = Object.freeze([
  /^replace[-_]/iu,
  /^your[-_]/iu,
  /^todo$/iu,
  /^changeme$/iu,
]);

/**
 * สร้างแผนติดตั้ง Report Schema แบบ Read-only
 *
 * หลักการ:
 * - Resolve Table จาก Environment ID ก่อน แล้วจึงใช้ชื่อ/alias เป็น Fallback
 * - สร้างเฉพาะ Table/Field ที่ขาด
 * - เติม Select options ที่ขาดโดยรักษา Option เดิมและ ID เดิม
 * - ไม่ลบ Table, Field หรือ Option ที่มีอยู่
 * - Type mismatch จะ Fail closed เพื่อป้องกันข้อมูลเดิมเสียหาย
 * - Primary field ของ Table เดิมเป็น Manual action เพราะ Lark Field API ไม่ควรถูกใช้เปลี่ยนแบบทำลายข้อมูล
 */
export async function planLarkSchema(input) {
  const client = requireClient(input?.client);
  const env = input?.env ?? {};
  const schema = input?.schema ?? LARK_REPORT_SCHEMA;
  const schemaVersion = input?.schemaVersion ?? LARK_REPORT_SCHEMA_VERSION;
  const validateSchema = input?.validateSchema ?? validateReportSchemaDefinition;
  validateSchema(schema);

  const liveTables = await client.listTables();
  const tableIndex = buildTableIndex(liveTables);
  const actions = [];
  const conflicts = [];
  const warnings = [];
  const manualActions = [];
  const resolvedTables = [];

  for (const tableContract of schema) {
    const resolution = resolveLiveTable({ tableContract, env, tableIndex });
    warnings.push(...resolution.warnings);

    if (resolution.conflict) {
      conflicts.push(resolution.conflict);
      continue;
    }

    if (!resolution.table) {
      actions.push(Object.freeze({
        kind: 'create_table',
        tableKey: tableContract.key,
        logicalName: tableContract.logicalName,
        name: tableContract.createName,
        defaultViewName: tableContract.defaultViewName,
        fields: tableContract.fields,
        envName: tableContract.envName,
      }));
      resolvedTables.push(Object.freeze({
        tableKey: tableContract.key,
        logicalName: tableContract.logicalName,
        tableId: null,
        name: tableContract.createName,
        source: 'create',
        envName: tableContract.envName,
      }));
      continue;
    }

    const liveFields = await client.listFields({ tableId: resolution.table.tableId });
    const fieldPlan = planExistingTableFields({
      tableContract,
      table: resolution.table,
      liveFields,
    });
    actions.push(...fieldPlan.actions);
    conflicts.push(...fieldPlan.conflicts);
    warnings.push(...fieldPlan.warnings);
    manualActions.push(...fieldPlan.manualActions);
    resolvedTables.push(Object.freeze({
      tableKey: tableContract.key,
      logicalName: tableContract.logicalName,
      tableId: resolution.table.tableId,
      name: resolution.table.name,
      source: resolution.source,
      envName: tableContract.envName,
    }));
  }

  const summary = summarizePlan({ actions, conflicts, warnings, manualActions, resolvedTables });
  return deepFreeze({
    mode: 'preview',
    schemaVersion,
    readyToApply: conflicts.length === 0,
    summary,
    resolvedTables,
    actions,
    conflicts,
    warnings,
    manualActions,
    environmentUpdates: buildEnvironmentUpdates(resolvedTables),
  });
}

/**
 * Apply แผนติดตั้งจริงหลังผู้เรียกยืนยัน CONFIRM_WRITE=YES แล้วเท่านั้น
 * ฟังก์ชันนี้ไม่อ่าน process.env เอง เพื่อให้ Tests และ Script guard แยกความรับผิดชอบชัดเจน
 */
export async function applyLarkSchema(input) {
  const client = requireClient(input?.client);
  const env = input?.env ?? {};
  const schema = input?.schema ?? LARK_REPORT_SCHEMA;
  const schemaVersion = input?.schemaVersion ?? LARK_REPORT_SCHEMA_VERSION;
  const validateSchema = input?.validateSchema ?? validateReportSchemaDefinition;
  const onProgress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const preview = await planLarkSchema({ client, env, schema, schemaVersion, validateSchema });

  if (!preview.readyToApply) {
    throw permanentError('Lark report schema contains conflicts and cannot be applied safely', {
      code: 'LARK_REPORT_SCHEMA_CONFLICT',
      details: {
        conflictCount: preview.conflicts.length,
        conflicts: preview.conflicts,
      },
    });
  }

  const appliedActions = [];
  const createdTableIds = new Map();

  for (const action of preview.actions) {
    onProgress(Object.freeze({ stage: 'schema_action_start', action }));
    let result;

    try {
      if (action.kind === 'create_table') {
        result = await client.createTable({
          name: action.name,
          defaultViewName: action.defaultViewName,
          fields: action.fields,
        });
        const tableId = requireText(result?.tableId, 'created tableId');
        createdTableIds.set(action.tableKey, tableId);
        appliedActions.push(Object.freeze({ ...action, tableId, status: 'created' }));
      } else if (action.kind === 'create_field') {
        result = await client.createField({
          tableId: action.tableId,
          field: action.field,
        });
        appliedActions.push(Object.freeze({
          ...action,
          fieldId: result?.fieldId ?? null,
          status: 'created',
        }));
      } else if (action.kind === 'update_field') {
        result = await client.updateField({
          tableId: action.tableId,
          fieldId: action.fieldId,
          field: action.field,
        });
        appliedActions.push(Object.freeze({ ...action, status: 'updated' }));
      } else {
        throw permanentError(`Unsupported report schema action: ${action.kind}`, {
          code: 'LARK_REPORT_SCHEMA_INVALID_ACTION',
          details: { action },
        });
      }
    } catch (error) {
      throw wrapSchemaActionError(error, action, appliedActions);
    }

    onProgress(Object.freeze({ stage: 'schema_action_complete', action, result }));
  }

  const postApplyEnv = { ...env };
  for (const table of schema) {
    const tableId = createdTableIds.get(table.key);
    if (tableId) postApplyEnv[table.envName] = tableId;
  }

  const verification = await planLarkSchema({
    client,
    env: postApplyEnv,
    schema,
    schemaVersion,
    validateSchema,
  });

  const remainingWriteActions = verification.actions.length;
  if (verification.conflicts.length > 0 || remainingWriteActions > 0) {
    throw permanentError('Lark report schema apply finished but verification is not clean', {
      code: 'LARK_REPORT_SCHEMA_VERIFICATION_FAILED',
      details: {
        remainingWriteActions,
        conflicts: verification.conflicts,
      },
    });
  }

  return deepFreeze({
    mode: 'apply',
    schemaVersion,
    ok: true,
    summary: {
      plannedActions: preview.actions.length,
      appliedActions: appliedActions.length,
      createdTables: appliedActions.filter((action) => action.kind === 'create_table').length,
      createdFields: appliedActions.filter((action) => action.kind === 'create_field').length,
      updatedFields: appliedActions.filter((action) => action.kind === 'update_field').length,
      manualActions: verification.manualActions.length,
    },
    appliedActions,
    verification,
    environmentUpdates: verification.environmentUpdates,
  });
}

/** ตรวจว่า Table ID เป็น Placeholder ซึ่งห้ามใช้ Resolve resource จริง */
export function isPlaceholderTableId(value) {
  if (typeof value !== 'string' || value.trim() === '') return true;
  const normalized = value.trim();
  return PLACEHOLDER_TABLE_ID_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Compatibility wrapper สำหรับ Report schema เดิม */
export function planLarkReportSchema(input = {}) {
  return planLarkSchema({
    ...input,
    schema: input.schema ?? LARK_REPORT_SCHEMA,
    schemaVersion: input.schemaVersion ?? LARK_REPORT_SCHEMA_VERSION,
    validateSchema: input.validateSchema ?? validateReportSchemaDefinition,
  });
}

/** Compatibility wrapper สำหรับ Report schema เดิม */
export function applyLarkReportSchema(input = {}) {
  return applyLarkSchema({
    ...input,
    schema: input.schema ?? LARK_REPORT_SCHEMA,
    schemaVersion: input.schemaVersion ?? LARK_REPORT_SCHEMA_VERSION,
    validateSchema: input.validateSchema ?? validateReportSchemaDefinition,
  });
}

function planExistingTableFields(input) {
  const actions = [];
  const conflicts = [];
  const warnings = [];
  const manualActions = [];
  const fieldsByName = new Map();

  for (const field of input.liveFields) {
    const name = normalizeName(field?.fieldName);
    if (!name) continue;
    if (fieldsByName.has(name)) {
      conflicts.push(Object.freeze({
        code: 'DUPLICATE_FIELD_NAME',
        tableKey: input.tableContract.key,
        tableId: input.table.tableId,
        fieldName: field.fieldName,
        message: `พบ Field ชื่อซ้ำใน Lark table ${input.table.name}: ${field.fieldName}`,
      }));
      continue;
    }
    fieldsByName.set(name, field);
  }

  for (const desired of input.tableContract.fields) {
    const live = fieldsByName.get(normalizeName(desired.fieldName));
    if (!live) {
      actions.push(Object.freeze({
        kind: 'create_field',
        tableKey: input.tableContract.key,
        logicalName: input.tableContract.logicalName,
        tableId: input.table.tableId,
        tableName: input.table.name,
        field: desired,
      }));
      if (desired.primary) {
        manualActions.push(buildPrimaryManualAction(input, desired, null));
      }
      continue;
    }

    if (Number(live.type) !== Number(desired.type)) {
      conflicts.push(Object.freeze({
        code: 'FIELD_TYPE_MISMATCH',
        tableKey: input.tableContract.key,
        tableId: input.table.tableId,
        fieldName: desired.fieldName,
        expectedType: desired.type,
        actualType: live.type,
        message: `Field type ไม่ตรง ${input.table.name}.${desired.fieldName}: expected ${desired.type}, actual ${live.type}`,
      }));
      continue;
    }

    if (desired.primary && live.isPrimary !== true) {
      manualActions.push(buildPrimaryManualAction(input, desired, live));
    }

    const desiredMutation = buildFieldMutation(live, desired);
    if (desiredMutation) {
      actions.push(Object.freeze({
        kind: 'update_field',
        tableKey: input.tableContract.key,
        logicalName: input.tableContract.logicalName,
        tableId: input.table.tableId,
        tableName: input.table.name,
        fieldId: live.fieldId,
        field: desiredMutation,
        reason: explainFieldUpdate(live, desired),
      }));
    }
  }

  return { actions, conflicts, warnings, manualActions };
}

function resolveLiveTable(input) {
  const warnings = [];
  const configuredId = normalizeOptionalText(input.env?.[input.tableContract.envName]);
  let missingConfiguredId = null;
  if (configuredId && !isPlaceholderTableId(configuredId)) {
    const byId = input.tableIndex.byId.get(configuredId);
    if (byId) return { table: byId, source: 'environment_id', warnings };
    missingConfiguredId = configuredId;
  }

  const candidates = new Map();
  for (const alias of input.tableContract.aliases) {
    for (const table of input.tableIndex.byName.get(canonicalTableName(alias)) ?? []) {
      candidates.set(table.tableId, table);
    }
  }
  if (candidates.size > 1) {
    return {
      table: null,
      warnings,
      conflict: Object.freeze({
        code: 'AMBIGUOUS_TABLE_NAME',
        tableKey: input.tableContract.key,
        candidates: [...candidates.values()],
        message: `พบหลาย Table ที่ตรงกับ ${input.tableContract.logicalName}; ต้องแก้ชื่อหรือกำหนด Table ID ให้ชัดเจน`,
      }),
    };
  }
  const table = [...candidates.values()][0] ?? null;
  if (table && missingConfiguredId) {
    warnings.push(Object.freeze({
      code: 'CONFIGURED_TABLE_ID_REPLACED_BY_NAME_MATCH',
      tableKey: input.tableContract.key,
      envName: input.tableContract.envName,
      configuredId: missingConfiguredId,
      resolvedTableId: table.tableId,
      message: `Table ID จาก ${input.tableContract.envName} ไม่พบ แต่ Resolve ได้จากชื่อ Table; ให้อัปเดต Local config หลัง Apply`,
    }));
  }
  if (!table && missingConfiguredId) {
    return {
      table: null,
      warnings,
      conflict: Object.freeze({
        code: 'CONFIGURED_TABLE_ID_NOT_FOUND',
        tableKey: input.tableContract.key,
        envName: input.tableContract.envName,
        configuredId: missingConfiguredId,
        message: `ไม่พบ Table ID จาก ${input.tableContract.envName} และไม่พบชื่อ Table ที่ตรงกัน; หยุดเพื่อป้องกันสร้าง Table ซ้ำ`,
      }),
    };
  }
  return { table, source: table ? 'table_name' : 'missing', warnings };
}

function buildTableIndex(tables) {
  const byId = new Map();
  const byName = new Map();
  for (const table of tables) {
    if (table?.tableId) byId.set(table.tableId, table);
    const name = canonicalTableName(table?.name);
    if (!name) continue;
    const group = byName.get(name) ?? [];
    group.push(table);
    byName.set(name, group);
  }
  return { byId, byName };
}


function wrapSchemaActionError(error, action, appliedActions) {
  const details = {
    ...(error?.details && typeof error.details === 'object' ? error.details : {}),
    schemaAction: {
      kind: action?.kind ?? null,
      tableKey: action?.tableKey ?? null,
      tableId: action?.tableId ?? null,
      tableName: action?.tableName ?? action?.name ?? null,
      fieldId: action?.fieldId ?? null,
      fieldName: action?.field?.fieldName ?? null,
      fieldType: action?.field?.type ?? null,
    },
    appliedActionCount: appliedActions.length,
  };

  if (error instanceof RuntimeError || (typeof error?.code === 'string' && typeof error?.retryable === 'boolean')) {
    return new RuntimeError(error.message, {
      code: error.code,
      retryable: error.retryable,
      cause: error,
      details,
    });
  }
  return permanentError('Unexpected Lark report schema action failure', {
    code: 'LARK_REPORT_SCHEMA_ACTION_FAILED',
    cause: error,
    details,
  });
}

function buildFieldMutation(live, desired) {
  const descriptionChanged = desired.manageDescription === true
    && normalizeDescription(live.description) !== normalizeDescription(desired.description);
  const desiredProperty = desired.property;
  const liveProperty = isPlainObject(live.property) ? live.property : {};
  let nextProperty = null;
  let propertyChanged = false;

  // ไม่พยายาม Align UI-internal metadata ของ Field ที่ OpenAPI ระบุว่า property ต้องเป็น null
  // เช่น Checkbox list/UI อาจมี styleId แต่ Update Field API ปฏิเสธ Property ดังกล่าว
  if (larkFieldTypeAllowsProperty(desired.type) && desiredProperty && Object.keys(desiredProperty).length > 0) {
    if (desired.type === 3 || desired.type === 4) {
      const existingOptions = Array.isArray(liveProperty.options) ? liveProperty.options : [];
      const existingNames = new Set(existingOptions.map((option) => normalizeName(option?.name)).filter(Boolean));
      const missingOptions = (desiredProperty.options ?? [])
        .filter((option) => !existingNames.has(normalizeName(option?.name)))
        .map((option) => ({ name: option.name, color: option.color }));
      propertyChanged = missingOptions.length > 0;
      nextProperty = propertyChanged
        ? { options: [...existingOptions, ...missingOptions] }
        : liveProperty;
    } else {
      const normalizedLiveProperty = normalizeLarkFieldProperty(desired.type, liveProperty) ?? {};
      const relevantKeys = Object.keys(desiredProperty);
      propertyChanged = relevantKeys.some((key) => !sameScalar(normalizedLiveProperty[key], desiredProperty[key]));
      nextProperty = propertyChanged
        ? { ...liveProperty, ...desiredProperty }
        : liveProperty;
    }
  } else if (larkFieldTypeAllowsProperty(desired.type) && Object.keys(liveProperty).length > 0) {
    // Update Field เป็น Full update จึงต้องคง Property เดิมเมื่อเปลี่ยนเฉพาะ Description
    nextProperty = liveProperty;
  }

  if (!descriptionChanged && !propertyChanged) return null;
  return Object.freeze({
    ...desired,
    ...(nextProperty && Object.keys(nextProperty).length > 0 ? { property: nextProperty } : {}),
  });
}

function explainFieldUpdate(live, desired) {
  const reasons = [];
  if (desired.type === 3 || desired.type === 4) {
    const existingNames = new Set((live.property?.options ?? []).map((option) => normalizeName(option?.name)));
    const missing = (desired.property?.options ?? [])
      .map((option) => option.name)
      .filter((name) => !existingNames.has(normalizeName(name)));
    if (missing.length > 0) reasons.push(`add_select_options:${missing.join(',')}`);
  } else if (desired.property && Object.keys(desired.property).length > 0) {
    const normalizedLiveProperty = normalizeLarkFieldProperty(desired.type, live.property) ?? {};
    if (Object.keys(desired.property).some((key) => !sameScalar(normalizedLiveProperty[key], desired.property[key]))) {
      reasons.push('align_field_property');
    }
  }
  if (desired.manageDescription === true
    && normalizeDescription(live.description) !== normalizeDescription(desired.description)) {
    reasons.push('align_description');
  }
  return reasons.join('+') || 'align_field_metadata';
}

function buildPrimaryManualAction(input, desired, live) {
  return Object.freeze({
    code: 'PRIMARY_FIELD_REVIEW_REQUIRED',
    tableKey: input.tableContract.key,
    tableId: input.table.tableId,
    tableName: input.table.name,
    fieldName: desired.fieldName,
    fieldId: live?.fieldId ?? null,
    message: `ตรวจ Primary field ของ ${input.table.name} ให้เป็น ${desired.fieldName} ใน Lark UI หลัง Apply`,
  });
}

function summarizePlan(input) {
  const counts = (kind) => input.actions.filter((action) => action.kind === kind).length;
  return Object.freeze({
    tablesInScope: input.resolvedTables.length,
    createTables: counts('create_table'),
    createFields: counts('create_field'),
    updateFields: counts('update_field'),
    conflicts: input.conflicts.length,
    warnings: input.warnings.length,
    manualActions: input.manualActions.length,
  });
}

function buildEnvironmentUpdates(resolvedTables) {
  const result = {};
  for (const table of resolvedTables) {
    if (table.tableId) result[table.envName] = table.tableId;
  }
  return Object.freeze(result);
}

function canonicalTableName(value) {
  const text = normalizeOptionalText(value);
  if (!text) return '';
  return text
    .replace(/^[^\p{L}\p{N}_]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function normalizeName(value) {
  return normalizeOptionalText(value)?.toLocaleLowerCase('en-US') ?? '';
}

function normalizeDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sameScalar(left, right) {
  return left === right || String(left) === String(right);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireClient(value) {
  const methods = ['listTables', 'listFields', 'createTable', 'createField', 'updateField'];
  for (const method of methods) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`Schema installer requires client.${method}`);
  }
  return value;
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
