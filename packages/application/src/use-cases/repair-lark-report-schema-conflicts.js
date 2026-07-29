import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../../config/src/lark-report-schema-v2.js';
import { planLarkSchema } from './install-lark-report-schema.js';

export const REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION = 'REPAIR_EMPTY_REPORT_SCHEMA_CONFLICTS';

/**
 * วางแผนแก้เฉพาะ Conflict ที่พิสูจน์ได้ว่าไม่แตะ Business value:
 * - Field type mismatch เมื่อ Field นั้นว่างทุก Record และไม่ใช่ Primary
 * - Duplicate field name เมื่อ Table ทั้งตารางไม่มี Record และ Field ซ้ำที่เกินมาทั้งหมดไม่ใช่ Primary
 *
 * Conflict อื่นหรือ Field ที่มีค่าแม้เป็น 0/false จะ Fail closed เสมอ.
 */
export async function planLarkReportSchemaConflictRepair(input = {}) {
  const client = requireClient(input.client);
  const schema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  validateSchema(schema);

  const preview = input.preview ?? await planLarkSchema({
    client,
    env: input.env ?? {},
    schema,
    schemaVersion,
    validateSchema,
  });
  const contracts = new Map(schema.map((table) => [table.key, table]));
  const fieldsByTable = new Map();
  const recordsByTable = new Map();
  const repairActions = [];
  const blockers = [];
  let repairConflictCount = 0;

  const getFields = async (tableId) => {
    if (!fieldsByTable.has(tableId)) fieldsByTable.set(tableId, await client.listFields({ tableId }));
    return fieldsByTable.get(tableId);
  };
  const getRecords = async (tableId) => {
    if (!recordsByTable.has(tableId)) {
      recordsByTable.set(tableId, await client.listRecords({
        tableId,
        includeRecordMetadata: false,
      }));
    }
    return recordsByTable.get(tableId);
  };

  for (const conflict of preview.conflicts ?? []) {
    const contract = contracts.get(conflict?.tableKey);
    const desired = contract?.fields?.find(
      (field) => normalizeName(field.fieldName) === normalizeName(conflict?.fieldName),
    );
    if (!contract || !desired || !conflict?.tableId) {
      blockers.push(blocker(conflict, 'REPORT_SCHEMA_CONFLICT_CONTRACT_UNRESOLVED'));
      continue;
    }

    if (conflict.code === 'FIELD_TYPE_MISMATCH') {
      const result = await planEmptyFieldTypeRepair({
        conflict,
        desired,
        fields: await getFields(conflict.tableId),
        records: await getRecords(conflict.tableId),
      });
      if (result.blocker) blockers.push(result.blocker);
      else {
        repairActions.push(result.action);
        repairConflictCount += 1;
      }
      continue;
    }

    if (conflict.code === 'DUPLICATE_FIELD_NAME') {
      const result = await planEmptyTableDuplicateRepair({
        conflict,
        desired,
        fields: await getFields(conflict.tableId),
        records: await getRecords(conflict.tableId),
        schema,
      });
      if (result.blocker) blockers.push(result.blocker);
      else {
        repairActions.push(...result.actions);
        repairConflictCount += 1;
      }
      continue;
    }

    blockers.push(blocker(conflict, 'REPORT_SCHEMA_CONFLICT_UNSUPPORTED'));
  }

  return deepFreeze({
    mode: 'preview',
    schemaVersion,
    conflictCount: preview.conflicts?.length ?? 0,
    repairConflictCount,
    repairActionCount: repairActions.length,
    blockerCount: blockers.length,
    repairable: blockers.length === 0,
    repairActions,
    blockers,
    environmentUpdates: preview.environmentUpdates ?? {},
  });
}

/** Apply ใช้ Fresh plan และตรวจ Live state ซ้ำก่อนทุก Field mutation. */
export async function applyLarkReportSchemaConflictRepair(input = {}) {
  const env = input.env ?? {};
  if (env.CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR !== REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION) {
    throw recoveryError(
      `Apply requires CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR=${REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION}`,
      'REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION_REQUIRED',
    );
  }

  const client = requireClient(input.client);
  const schema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  const plan = await planLarkReportSchemaConflictRepair({
    client,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });
  if (!plan.repairable || plan.repairConflictCount !== plan.conflictCount) {
    throw recoveryError(
      'Report schema conflicts are not safely repairable without Business-value mutation',
      'REPORT_SCHEMA_CONFLICT_REPAIR_BLOCKED',
      {
        conflictCount: plan.conflictCount,
        repairConflictCount: plan.repairConflictCount,
        blockerCount: plan.blockerCount,
        blockers: plan.blockers,
      },
    );
  }

  const appliedActions = [];
  for (const action of plan.repairActions) {
    if (action.kind === 'update_empty_field_type') {
      await applyEmptyFieldTypeRepair(client, action);
    } else if (action.kind === 'archive_empty_duplicate_field') {
      await applyEmptyDuplicateArchive(client, action);
    } else {
      throw recoveryError(
        `Unsupported Report schema recovery action: ${action.kind}`,
        'REPORT_SCHEMA_CONFLICT_REPAIR_ACTION_INVALID',
      );
    }
    appliedActions.push(action);
  }

  const verification = await planLarkSchema({
    client,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });
  if ((verification.conflicts?.length ?? 0) !== 0) {
    throw recoveryError(
      'Report schema conflict recovery verification still contains conflicts',
      'REPORT_SCHEMA_CONFLICT_REPAIR_VERIFICATION_FAILED',
      {
        remainingConflictCount: verification.conflicts?.length ?? 0,
        remainingConflictCodes: [...new Set((verification.conflicts ?? []).map((item) => item.code))].sort(),
      },
    );
  }

  return deepFreeze({
    mode: 'apply',
    ok: true,
    schemaVersion,
    conflictCount: plan.conflictCount,
    repairedConflictCount: plan.repairConflictCount,
    appliedRepairCount: appliedActions.length,
    remainingConflictCount: 0,
    appliedActions,
    environmentUpdates: verification.environmentUpdates ?? {},
  });
}

export function safeReportSchemaConflictRepairEvidence(value) {
  if (Array.isArray(value)) return value.map(safeReportSchemaConflictRepairEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password|consumer_key|consumer_secret|tableId|fieldId|recordId)/iu.test(key)) {
      continue;
    }
    if (key === 'repairActions' || key === 'appliedActions') {
      output.repairs = nested.map(safeRepairAction);
      continue;
    }
    output[key] = safeReportSchemaConflictRepairEvidence(nested);
  }
  return output;
}

function planEmptyFieldTypeRepair(input) {
  const matching = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.desired.fieldName),
  );
  if (matching.length !== 1) {
    return { blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_FIELD_IDENTITY_AMBIGUOUS') };
  }
  const live = matching[0];
  if (live.isPrimary === true || input.desired.primary === true) {
    return { blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_PRIMARY_FIELD_MUTATION_BLOCKED') };
  }
  const populatedRecordCount = countPopulatedRecords(input.records, input.desired.fieldName);
  if (populatedRecordCount !== 0) {
    return {
      blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_POPULATED_FIELD', {
        recordCount: input.records.length,
        populatedRecordCount,
      }),
    };
  }
  return {
    action: deepFreeze({
      kind: 'update_empty_field_type',
      tableKey: input.conflict.tableKey,
      tableId: input.conflict.tableId,
      fieldId: live.fieldId,
      fieldName: input.desired.fieldName,
      fromType: Number(live.type),
      toType: Number(input.desired.type),
      recordCount: input.records.length,
      populatedRecordCount: 0,
      field: clone(input.desired),
    }),
  };
}

function planEmptyTableDuplicateRepair(input) {
  if (input.records.length !== 0) {
    return {
      blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_DUPLICATE_POPULATED_TABLE', {
        recordCount: input.records.length,
      }),
    };
  }
  const matching = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.desired.fieldName),
  );
  if (matching.length < 2) {
    return { blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_DUPLICATE_IDENTITY_CHANGED') };
  }
  if (matching.some((field) => field.isPrimary === true) || input.desired.primary === true) {
    return { blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_PRIMARY_FIELD_MUTATION_BLOCKED') };
  }
  const desiredType = matching
    .filter((field) => Number(field.type) === Number(input.desired.type))
    .sort((left, right) => String(left.fieldId).localeCompare(String(right.fieldId)));
  if (desiredType.length === 0) {
    return { blocker: blocker(input.conflict, 'REPORT_SCHEMA_CONFLICT_DUPLICATE_CANONICAL_TYPE_MISSING') };
  }
  const canonical = desiredType[0];
  const usedNames = new Set([
    ...input.fields.map((field) => normalizeName(field.fieldName)),
    ...input.schema.flatMap((table) => table.fields.map((field) => normalizeName(field.fieldName))),
  ]);
  const actions = matching
    .filter((field) => field.fieldId !== canonical.fieldId)
    .map((field) => {
      const archiveName = buildArchiveName(field.fieldName, field.fieldId, usedNames);
      usedNames.add(normalizeName(archiveName));
      return deepFreeze({
        kind: 'archive_empty_duplicate_field',
        tableKey: input.conflict.tableKey,
        tableId: input.conflict.tableId,
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        archiveName,
        recordCount: 0,
        field: {
          fieldName: archiveName,
          type: Number(field.type),
          ...(field.uiType ? { uiType: field.uiType } : {}),
          ...(field.description ? { description: field.description } : {}),
          ...(field.property ? { property: clone(field.property) } : {}),
        },
      });
    });
  return { actions };
}

async function applyEmptyFieldTypeRepair(client, action) {
  const fields = await client.listFields({ tableId: action.tableId });
  const matching = fields.filter((field) => normalizeName(field.fieldName) === normalizeName(action.fieldName));
  const live = matching.find((field) => field.fieldId === action.fieldId);
  if (matching.length !== 1 || !live || live.isPrimary === true || Number(live.type) !== action.fromType) {
    throw recoveryError(
      'Report schema field changed after recovery planning',
      'REPORT_SCHEMA_CONFLICT_REPAIR_STATE_CHANGED',
      safeRepairAction(action),
    );
  }
  const records = await client.listRecords({ tableId: action.tableId, includeRecordMetadata: false });
  const populatedRecordCount = countPopulatedRecords(records, action.fieldName);
  if (populatedRecordCount !== 0) {
    throw recoveryError(
      'Report schema field received Business values after recovery planning',
      'REPORT_SCHEMA_CONFLICT_REPAIR_FIELD_BECAME_POPULATED',
      { ...safeRepairAction(action), recordCount: records.length, populatedRecordCount },
    );
  }
  await client.updateField({ tableId: action.tableId, fieldId: action.fieldId, field: action.field });
}

async function applyEmptyDuplicateArchive(client, action) {
  const records = await client.listRecords({ tableId: action.tableId, includeRecordMetadata: false });
  if (records.length !== 0) {
    throw recoveryError(
      'Report schema duplicate table received Records after recovery planning',
      'REPORT_SCHEMA_CONFLICT_REPAIR_TABLE_BECAME_POPULATED',
      { ...safeRepairAction(action), recordCount: records.length },
    );
  }
  const fields = await client.listFields({ tableId: action.tableId });
  const live = fields.find((field) => field.fieldId === action.fieldId);
  const archiveExists = fields.some((field) => normalizeName(field.fieldName) === normalizeName(action.archiveName));
  if (!live
    || normalizeName(live.fieldName) !== normalizeName(action.fieldName)
    || live.isPrimary === true
    || archiveExists) {
    throw recoveryError(
      'Report schema duplicate field changed after recovery planning',
      'REPORT_SCHEMA_CONFLICT_REPAIR_STATE_CHANGED',
      safeRepairAction(action),
    );
  }
  await client.updateField({ tableId: action.tableId, fieldId: action.fieldId, field: action.field });
}

function countPopulatedRecords(records, fieldName) {
  return records.filter((record) => {
    const entry = Object.entries(record?.fields ?? {}).find(
      ([name]) => normalizeName(name) === normalizeName(fieldName),
    );
    return entry ? hasBusinessValue(entry[1]) : false;
  }).length;
}

function hasBusinessValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length !== 0;
  return true;
}

function safeRepairAction(action) {
  return Object.freeze({
    kind: action.kind,
    tableKey: action.tableKey,
    fieldName: action.fieldName,
    ...(action.archiveName ? { archiveName: action.archiveName } : {}),
    ...(Number.isFinite(action.fromType) ? { fromType: action.fromType } : {}),
    ...(Number.isFinite(action.toType) ? { toType: action.toType } : {}),
    recordCount: action.recordCount ?? null,
    populatedRecordCount: action.populatedRecordCount ?? null,
  });
}

function blocker(conflict, code, details = {}) {
  return deepFreeze({
    code,
    conflictCode: conflict?.code ?? null,
    tableKey: conflict?.tableKey ?? null,
    fieldName: conflict?.fieldName ?? null,
    expectedType: conflict?.expectedType ?? null,
    actualType: conflict?.actualType ?? null,
    ...details,
  });
}

function buildArchiveName(fieldName, fieldId, usedNames) {
  const slug = String(fieldName ?? 'field').normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 40) || 'field';
  const suffix = String(fieldId ?? 'unknown').replace(/[^A-Za-z0-9]/gu, '').slice(-8) || 'unknown';
  const base = `__mkt_archived_duplicate_${slug}_${suffix}`.slice(0, 90);
  let candidate = base;
  let index = 2;
  while (usedNames.has(normalizeName(candidate))) {
    candidate = `${base.slice(0, 84)}_${index}`;
    index += 1;
  }
  return candidate;
}

function requireClient(client) {
  for (const name of ['listTables', 'listFields', 'listRecords', 'updateField']) {
    if (typeof client?.[name] !== 'function') {
      throw new TypeError(`Report schema conflict recovery requires client.${name}`);
    }
  }
  return client;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
