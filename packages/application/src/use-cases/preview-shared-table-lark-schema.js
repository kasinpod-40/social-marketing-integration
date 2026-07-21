import { planLarkSchema } from './install-lark-report-schema.js';
import { assertSchemaDoesNotTargetProtectedTables, PROTECTED_LARK_TABLES, canonicalTableName } from '../../../config/src/lark-table-governance.js';
import { validateSharedTableLarkSchema } from '../../../config/src/shared-table-lark-schema.js';

/**
 * ตรวจ Shared-table migration แบบ Read-only เท่านั้น
 * ไม่เรียก Create/Update/Delete API และไม่คืนคำสั่ง Apply จนกว่าจะมี Authorization แยกต่างหาก
 */
export async function previewSharedTableLarkSchema(input) {
  const client = requirePreviewClient(input?.client);
  const env = input?.env ?? {};
  const schema = input?.schema;
  const views = Array.isArray(input?.views) ? input.views : [];
  const schemaVersion = input?.schemaVersion ?? 'shared-table-lark-schema-preview';
  const validateSchema = input?.validateSchema ?? validateSharedTableLarkSchema;
  validateSchema(schema);
  assertSchemaDoesNotTargetProtectedTables(schema);

  const liveTables = await client.listTables();
  const fieldsCache = new Map();
  const planningClient = {
    async listTables() { return liveTables; },
    async listFields({ tableId }) {
      if (!fieldsCache.has(tableId)) fieldsCache.set(tableId, await client.listFields({ tableId }));
      return fieldsCache.get(tableId);
    },
  };
  const schemaPlan = await planLarkSchema({
    client: planningClient,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });

  const tableById = new Map(liveTables.map((table) => [table.tableId, table]));
  const byCanonicalName = groupTablesByName(liveTables);
  const conflicts = [...schemaPlan.conflicts];
  const warnings = [...schemaPlan.warnings];
  const renameActions = [];
  const primaryFieldActions = [];
  const schemaActions = [...schemaPlan.actions];
  let manualActions = [...schemaPlan.manualActions];
  const reuseChecks = [];

  for (const tableContract of schema) {
    if (tableContract.sharedTable.physicalAction !== 'rename_reuse_in_place') continue;
    const resolved = schemaPlan.resolvedTables.find((table) => table.tableKey === tableContract.key);
    if (!resolved?.tableId) continue;
    const live = tableById.get(resolved.tableId);
    if (!live) continue;

    const currentCanonical = canonicalTableName(live.name);
    const targetCanonical = canonicalTableName(tableContract.logicalName);
    const alreadyTarget = currentCanonical === targetCanonical;
    const targetCandidates = byCanonicalName.get(targetCanonical) ?? [];
    if (!alreadyTarget && targetCandidates.some((candidate) => candidate.tableId !== live.tableId)) {
      conflicts.push(Object.freeze({
        code: 'SHARED_TABLE_TARGET_ALREADY_EXISTS',
        tableKey: tableContract.key,
        sourceTableId: live.tableId,
        sourceTableName: live.name,
        targetTableName: tableContract.logicalName,
        message: `พบ Target table ${tableContract.logicalName} แยกจากตารางที่จะ Reuse; หยุดเพื่อป้องกัน Table ซ้ำ`,
      }));
      continue;
    }

    let empty = null;
    if (!alreadyTarget) {
      const page = await client.listRecordsPage({
        tableId: live.tableId,
        pageSize: 1,
        includeRecordMetadata: false,
      });
      empty = page.records.length === 0 && page.hasMore !== true;
      if (!empty) {
        conflicts.push(Object.freeze({
          code: 'SHARED_TABLE_REUSE_SOURCE_NOT_EMPTY',
          tableKey: tableContract.key,
          tableId: live.tableId,
          tableName: live.name,
          targetTableName: tableContract.logicalName,
          message: `ตาราง ${live.name} มี Record แล้ว จึงห้าม Rename/Reuse อัตโนมัติ`,
        }));
      } else {
        renameActions.push(Object.freeze({
          kind: 'rename_table',
          tableKey: tableContract.key,
          tableId: live.tableId,
          fromName: live.name,
          toName: tableContract.logicalName,
          preserveTableId: true,
          authorized: false,
        }));
      }
    }

    const liveFields = fieldsCache.get(live.tableId) ?? [];
    const primaryResolution = resolveReusablePrimaryField({
      tableContract,
      table: live,
      liveFields,
      schemaActions,
      manualActions,
      conflicts,
      primaryFieldActions,
    });
    manualActions = primaryResolution.manualActions;

    const liveViews = await client.listViews({ tableId: live.tableId });
    reuseChecks.push(Object.freeze({
      tableKey: tableContract.key,
      tableId: live.tableId,
      currentName: live.name,
      targetName: tableContract.logicalName,
      alreadyTarget,
      empty,
      fieldCount: liveFields.length,
      primaryField: primaryResolution.primaryField,
      primaryFieldResolution: primaryResolution.status,
      viewCount: liveViews.length,
    }));
  }

  const protectedChecks = PROTECTED_LARK_TABLES.map((protectedTable) => {
    const matches = byCanonicalName.get(canonicalTableName(protectedTable.logicalName)) ?? [];
    return Object.freeze({
      ...protectedTable,
      found: matches.length === 1,
      ambiguous: matches.length > 1,
      tableId: matches.length === 1 ? matches[0].tableId : null,
      plannedActions: 0,
    });
  });
  for (const check of protectedChecks) {
    if (check.ambiguous) {
      conflicts.push(Object.freeze({
        code: 'PROTECTED_TABLE_AMBIGUOUS',
        tableName: check.logicalName,
        message: `พบ Protected table ${check.logicalName} มากกว่าหนึ่งตาราง`,
      }));
    } else if (!check.found) {
      warnings.push(Object.freeze({
        code: 'PROTECTED_TABLE_NOT_FOUND',
        tableName: check.logicalName,
        message: `ไม่พบ Protected table ${check.logicalName} ใน Base ที่ Preview`,
      }));
    }
  }

  const viewActions = planViewNames({ views, schema, schemaPlan, client });
  const resolvedViewActions = await viewActions;
  const actions = Object.freeze([
    ...renameActions,
    ...primaryFieldActions,
    ...schemaActions,
    ...resolvedViewActions,
  ]);
  const uniqueConflicts = dedupeObjects(conflicts);
  const summary = Object.freeze({
    liveTables: liveTables.length,
    tablesInScope: schema.length,
    reuseTables: reuseChecks.length,
    renameTables: renameActions.length,
    createTables: schemaActions.filter((action) => action.kind === 'create_table').length,
    createFields: schemaActions.filter((action) => action.kind === 'create_field').length,
    updateFields: schemaActions.filter((action) => action.kind === 'update_field').length,
    updatePrimaryFields: primaryFieldActions.length,
    createViews: resolvedViewActions.filter((action) => action.kind === 'create_view').length,
    protectedTables: protectedChecks.length,
    protectedActions: 0,
    deleteActions: 0,
    recordWrites: 0,
    conflicts: uniqueConflicts.length,
    warnings: warnings.length,
    manualActions: manualActions.length,
    blockingManualActions: manualActions.length,
  });

  return deepFreeze({
    mode: 'read_only_preview',
    schemaVersion,
    readyForApplyAuthorization: uniqueConflicts.length === 0 && manualActions.length === 0,
    requiresManualSchemaResolution: manualActions.length > 0,
    applyImplemented: false,
    summary,
    reuseChecks,
    protectedChecks,
    resolvedTables: schemaPlan.resolvedTables,
    actions,
    conflicts: uniqueConflicts,
    warnings,
    manualActions,
    environmentUpdates: schemaPlan.environmentUpdates,
    safety: Object.freeze({
      liveMutationPerformed: false,
      sourceApiCalled: false,
      businessRecordRead: 'empty-check only; maximum one record per reuse candidate',
      businessRecordWrite: false,
      applyRequiresSeparateAuthorization: true,
    }),
  });
}

function resolveReusablePrimaryField(input) {
  const desired = input.tableContract.fields.find((field) => field.primary === true);
  if (!desired) return { status: 'not_required', primaryField: null, manualActions: input.manualActions };
  const desiredName = desired.fieldName.toLocaleLowerCase('en-US');
  const liveByDesiredName = input.liveFields.find((field) => field.fieldName?.trim().toLocaleLowerCase('en-US') === desiredName);
  if (liveByDesiredName?.isPrimary === true) {
    return { status: 'already_aligned', primaryField: summarizePrimary(liveByDesiredName), manualActions: input.manualActions };
  }
  const createIndex = input.schemaActions.findIndex((action) =>
    action.kind === 'create_field'
    && action.tableKey === input.tableContract.key
    && action.field?.primary === true
    && action.field?.fieldName === desired.fieldName);
  if (createIndex < 0) {
    return { status: 'manual_review', primaryField: null, manualActions: input.manualActions };
  }
  const primaries = input.liveFields.filter((field) => field.isPrimary === true);
  if (primaries.length !== 1) {
    if (primaries.length > 1) {
      input.conflicts.push(Object.freeze({
        code: 'SHARED_TABLE_MULTIPLE_PRIMARY_FIELDS',
        tableKey: input.tableContract.key,
        tableId: input.table.tableId,
        tableName: input.table.name,
        primaryFieldIds: primaries.map((field) => field.fieldId),
        message: `พบ Primary field มากกว่าหนึ่งรายการใน ${input.table.name}`,
      }));
    }
    return { status: primaries.length === 0 ? 'primary_metadata_missing' : 'invalid_multiple_primary', primaryField: null, manualActions: input.manualActions };
  }
  const current = primaries[0];
  if (Number(current.type) !== Number(desired.type)) {
    input.conflicts.push(Object.freeze({
      code: 'SHARED_TABLE_PRIMARY_FIELD_TYPE_MISMATCH',
      tableKey: input.tableContract.key,
      tableId: input.table.tableId,
      tableName: input.table.name,
      fieldId: current.fieldId,
      currentFieldName: current.fieldName,
      currentType: current.type,
      expectedType: desired.type,
      message: `Primary field ของ ${input.table.name} ไม่ใช่ Text จึงห้าม Reuse อัตโนมัติ`,
    }));
    return { status: 'type_conflict', primaryField: summarizePrimary(current), manualActions: input.manualActions };
  }
  input.schemaActions.splice(createIndex, 1);
  const manualActions = input.manualActions.filter((action) => !(
    action.code === 'PRIMARY_FIELD_REVIEW_REQUIRED'
    && action.tableKey === input.tableContract.key
    && action.fieldName === desired.fieldName
  ));
  input.primaryFieldActions.push(Object.freeze({
    kind: 'update_primary_field',
    tableKey: input.tableContract.key,
    tableId: input.table.tableId,
    tableName: input.table.name,
    fieldId: current.fieldId,
    fromName: current.fieldName,
    toName: desired.fieldName,
    field: desired,
    preservePrimary: true,
    authorized: false,
  }));
  return { status: 'rename_planned', primaryField: summarizePrimary(current), manualActions };
}

function summarizePrimary(field) {
  return Object.freeze({ fieldId: field.fieldId ?? null, fieldName: field.fieldName ?? null, type: field.type ?? null });
}

async function planViewNames({ views, schema, schemaPlan, client }) {
  const resolvedByLogicalName = new Map(schemaPlan.resolvedTables.map((table) => [table.logicalName, table]));
  const schemaByLogicalName = new Map(schema.map((table) => [table.logicalName, table]));
  const viewsByTableId = new Map();
  const actions = [];
  for (const view of views) {
    const resolved = resolvedByLogicalName.get(view.table);
    const tableContract = schemaByLogicalName.get(view.table);
    if (!resolved || !tableContract) continue;
    if (!resolved.tableId) {
      actions.push(Object.freeze({
        kind: 'create_view',
        tableKey: tableContract.key,
        tableId: null,
        tableName: view.table,
        viewName: view.viewName,
        filter: view.filter,
        deferredUntilTableExists: true,
        authorized: false,
      }));
      continue;
    }
    if (!viewsByTableId.has(resolved.tableId)) {
      viewsByTableId.set(resolved.tableId, await client.listViews({ tableId: resolved.tableId }));
    }
    const existingNames = new Set(viewsByTableId.get(resolved.tableId)
      .map((candidate) => candidate.viewName?.trim().toLocaleLowerCase('en-US'))
      .filter(Boolean));
    if (!existingNames.has(view.viewName.toLocaleLowerCase('en-US'))) {
      actions.push(Object.freeze({
        kind: 'create_view',
        tableKey: tableContract.key,
        tableId: resolved.tableId,
        tableName: view.table,
        viewName: view.viewName,
        filter: view.filter,
        deferredUntilFieldsExist: true,
        authorized: false,
      }));
    }
  }
  return actions;
}

function groupTablesByName(tables) {
  const result = new Map();
  for (const table of tables) {
    const name = canonicalTableName(table?.name);
    if (!name) continue;
    const group = result.get(name) ?? [];
    group.push(table);
    result.set(name, group);
  }
  return result;
}

function dedupeObjects(items) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return Object.freeze(result);
}

function requirePreviewClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews', 'listRecordsPage']) {
    if (typeof client?.[method] !== 'function') throw new TypeError(`Shared-table preview requires client.${method}`);
  }
  return client;
}

function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
