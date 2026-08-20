import { normalizeLarkFieldProperty } from '../../../shared/src/lark/lark-field-contract.js';

const WRITE_METHODS = Object.freeze([
  'renameTable',
  'createField',
  'updateField',
  'createFormulaFieldV3',
  'updateFormulaFieldV3',
  'batchCreateRecords',
  'batchUpdateRecords',
  'createView',
  'updateView',
  'updateViewHierarchy',
]);
const FORMULA_FIELD_TYPE = 20;
const RECORD_RECONCILIATION_EXACT_RETRY = 'exact-retry';
const RECORD_RECONCILIATION_SOURCE_REFRESH = 'source-refresh';
const FORMULA_TYPE2_UI_PROPERTY_KEYS = Object.freeze([
  'currency_code',
  'formatter',
  'range_customize',
  'min',
  'max',
  'date_formatter',
  'rating',
]);

/**
 * Adapts a customer Target Base so the existing consolidation engine can safely
 * resume tables created by the same controlled migration session.
 *
 * The session checkpoint freezes every table that existed before Apply. Any clone-
 * scope table name absent from that baseline but present on a later attempt is a
 * recovery candidate. Recovery candidates are hidden from consolidation preflight,
 * then createTable() claims the existing table in place. Field/record creates become
 * exact-idempotent so a failure after a partial write can be retried without creating
 * duplicate schema or records. A separately admitted Source refresh may reconcile
 * requested fields on existing migration-owned records by stable primary key. Baseline/
 * unrelated customer tables stay immutable in every mode.
 */
export async function prepareLarkBaseResumableTarget(input) {
  const targetClient = requireClient(input?.targetClient);
  const expectedTableNames = normalizeNames(input?.expectedTableNames, 'expectedTableNames');
  const protectedTables = normalizeProtectedTables(input?.protectedTables ?? []);
  const recordReconciliationMode = normalizeRecordReconciliationMode(input?.recordReconciliationMode);
  const allowRecordRefresh = recordReconciliationMode === RECORD_RECONCILIATION_SOURCE_REFRESH;
  const expectedNameSet = new Set(expectedTableNames);
  const protectedByName = new Map(protectedTables.map((table) => [table.name, table]));
  const protectedIds = new Set(protectedTables.map((table) => table.tableId));
  const currentTables = await targetClient.listTables();
  const currentByName = uniqueTableByName(currentTables);
  const currentById = new Map(currentTables.map((table) => [requireText(table?.tableId, 'current tableId'), table]));
  const tableNameById = new Map(currentTables.map((table) => [
    requireText(table?.tableId, 'current tableId'),
    requireText(table?.name, 'current table name'),
  ]));

  for (const table of protectedTables) {
    const current = currentById.get(table.tableId);
    if (!current || requireText(current?.name, `protected table name ${table.tableId}`) !== table.name) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_PROTECTED_TABLE_DRIFT',
        `Protected customer table identity changed since checkpoint: ${table.name}`,
        { name: table.name, tableId: table.tableId, present: Boolean(current) },
      );
    }
    if (expectedNameSet.has(table.name)) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_EXPECTED_NAME_WAS_PREEXISTING',
        `Clone-scope table existed before controlled Apply and cannot be adopted: ${table.name}`,
        { name: table.name, tableId: table.tableId },
      );
    }
  }

  const resumeByName = new Map();
  for (const name of expectedTableNames) {
    const current = currentByName.get(name);
    if (!current) continue;
    const tableId = requireText(current?.tableId, `resume tableId ${name}`);
    if (protectedIds.has(tableId) || protectedByName.has(name)) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_PROTECTED_NAME_COLLISION',
        `Clone-scope table collides with protected customer state: ${name}`,
        { name, tableId },
      );
    }
    resumeByName.set(name, current);
  }

  const hiddenResumeIds = new Set([...resumeByName.values()].map((table) => requireText(table?.tableId, 'resume tableId')));
  const claimedResumeIds = new Set();
  const writableIds = new Set();
  const dynamicProtectedIds = new Set(
    currentTables
      .filter((table) => !expectedNameSet.has(requireText(table?.name, 'current table name')))
      .map((table) => requireText(table?.tableId, 'current tableId')),
  );
  for (const tableId of protectedIds) dynamicProtectedIds.add(tableId);

  let formulaTypePromise = null;
  const getTargetFormulaType = async () => {
    if (typeof targetClient.getBaseFormulaType !== 'function') {
      throw codedError(
        'CUSTOMER_BASE_RESUME_FORMULA_CAPABILITY_UNAVAILABLE',
        'Target client must expose documented Base formula_type metadata before Formula migration',
      );
    }
    if (!formulaTypePromise) {
      formulaTypePromise = Promise.resolve(targetClient.getBaseFormulaType())
        .then((value) => {
          const formulaType = Number(value);
          if (!Number.isInteger(formulaType)) {
            throw codedError(
              'CUSTOMER_BASE_RESUME_FORMULA_CAPABILITY_INVALID',
              'Target Base formula_type metadata must be an integer',
            );
          }
          return formulaType;
        });
    }
    return formulaTypePromise;
  };

  const client = new Proxy(targetClient, {
    get(target, property, receiver) {
      if (property === 'listTables') {
        return async () => {
          const tables = await target.listTables();
          return tables.filter((table) => {
            const tableId = requireText(table?.tableId, 'tableId');
            return !hiddenResumeIds.has(tableId) || claimedResumeIds.has(tableId);
          });
        };
      }

      if (property === 'createTable') {
        return async (request) => {
          const name = requireText(request?.name, 'createTable.name');
          if (!expectedNameSet.has(name)) {
            throw codedError('CUSTOMER_BASE_RESUME_CREATE_OUTSIDE_SCOPE', `Refusing table create outside clone scope: ${name}`, { name });
          }
          const resume = resumeByName.get(name);
          if (resume) {
            const tableId = requireText(resume?.tableId, `resume tableId ${name}`);
            if (claimedResumeIds.has(tableId)) {
              throw codedError('CUSTOMER_BASE_RESUME_TABLE_ALREADY_CLAIMED', `Resume table already claimed: ${name}`, { name, tableId });
            }
            const requestedFields = requireArray(request?.fields, 'createTable.fields');
            if (requestedFields.length !== 1) {
              throw codedError('CUSTOMER_BASE_RESUME_PRIMARY_CONTRACT_INVALID', `Resume claim requires exactly one primary field: ${name}`, { name, fieldCount: requestedFields.length });
            }
            const existingFields = await target.listFields({ tableId });
            const primaries = existingFields.filter((field) => field?.isPrimary === true);
            if (primaries.length !== 1 || !fieldMatchesMutation(primaries[0], requestedFields[0])) {
              throw codedError(
                'CUSTOMER_BASE_RESUME_PRIMARY_MISMATCH',
                `Partially-created table primary field does not match Source: ${name}`,
                { name, tableId, primaryCount: primaries.length },
              );
            }
            claimedResumeIds.add(tableId);
            writableIds.add(tableId);
            return structuredClone(resume);
          }

          const sanitizedRequest = stripGeneratedSelectOptionIdsFromCreateTableRequest(request);
          let created;
          try {
            created = await target.createTable(sanitizedRequest);
          } catch (error) {
            const primary = sanitizedRequest.fields[0] ?? null;
            throw remoteWriteError(
              'CUSTOMER_BASE_RESUME_CREATE_TABLE_REMOTE_REJECTED',
              `Lark rejected migration table create: ${name}`,
              error,
              {
                operation: 'createTable',
                tableName: name,
                ...(primary ? summarizeFieldMutation(primary) : {}),
              },
            );
          }
          const tableId = requireText(created?.tableId, `created tableId ${name}`);
          writableIds.add(tableId);
          tableNameById.set(tableId, name);
          return created;
        };
      }

      if (property === 'createField') {
        return async (request) => {
          const tableId = requireWritableTable(request?.tableId, 'createField', dynamicProtectedIds, writableIds);
          const tableName = tableNameById.get(tableId) ?? null;
          const field = requireObject(request?.field, 'createField.field');
          const fieldName = requireText(field?.fieldName, 'createField.fieldName');
          const isFormula = Number(field?.type) === FORMULA_FIELD_TYPE;
          const targetFormulaType = isFormula ? await getTargetFormulaType() : null;
          const comparableRequestedField = adaptFormulaFieldForTarget(field, targetFormulaType, {
            requirePropertyType: true,
            requireFormulaExpression: true,
          });
          const existingFields = await target.listFields({ tableId });
          const existing = existingFields.find((item) => item?.fieldName === fieldName) ?? null;
          if (existing) {
            const comparableExistingField = adaptFormulaFieldForTarget(existing, targetFormulaType);
            const comparison = compareFieldMutation(comparableExistingField, comparableRequestedField);
            if (comparison.ok) return structuredClone(existing);

            if (isFormula && isRecoverableFormulaShell(comparableExistingField, comparableRequestedField)) {
              return finalizeFormulaField({
                target,
                tableId,
                tableName,
                existingField: comparableExistingField,
                requestedField: comparableRequestedField,
                targetFormulaType,
              });
            }

            throw codedError(
              'CUSTOMER_BASE_RESUME_FIELD_CONFLICT',
              `Existing migration-owned field differs from requested Source field: ${fieldName}`,
              {
                tableId,
                tableName,
                fieldName,
                differencePaths: comparison.differencePaths,
                existingPropertyKeys: propertyKeys(comparison.existing.property),
                requestedPropertyKeys: propertyKeys(comparison.requested.property),
              },
            );
          }

          const sanitizedField = stripGeneratedSelectOptionIdsFromField(comparableRequestedField);
          if (isFormula) {
            return createFormulaFieldInStages({
              target,
              request,
              tableId,
              tableName,
              requestedField: sanitizedField,
              targetFormulaType,
            });
          }

          try {
            return await target.createField({
              ...request,
              field: sanitizedField,
            });
          } catch (error) {
            throw remoteWriteError(
              'CUSTOMER_BASE_RESUME_CREATE_FIELD_REMOTE_REJECTED',
              `Lark rejected migration field create: ${tableName ?? tableId}.${fieldName}`,
              error,
              {
                operation: 'createField',
                tableId,
                tableName,
                ...summarizeFieldMutation(sanitizedField),
              },
            );
          }
        };
      }

      if (property === 'batchCreateRecords') {
        return async (request) => {
          const tableId = requireWritableTable(request?.tableId, 'batchCreateRecords', dynamicProtectedIds, writableIds);
          const requestedRecords = requireArray(request?.records, 'batchCreateRecords.records');
          if (requestedRecords.length === 0) return { created: 0 };
          const fields = await target.listFields({ tableId });
          const fieldByName = indexFieldsByName(fields, tableId);
          const primaries = fields.filter((field) => field?.isPrimary === true);
          if (primaries.length !== 1) {
            throw codedError('CUSTOMER_BASE_RESUME_PRIMARY_COUNT_INVALID', 'Migration-owned table must have exactly one primary field', { tableId, primaryCount: primaries.length });
          }
          const primaryName = requireText(primaries[0]?.fieldName, 'primary fieldName');
          const existingRecords = await target.listRecords({ tableId });
          const existingByPrimary = indexRecords(existingRecords, primaryName, `target ${tableId}`);
          const missing = [];
          const refreshUpdates = [];
          const seenRequested = new Set();
          for (const requested of requestedRecords) {
            const payload = requireObject(requested, 'record payload');
            const key = canonicalValue(payload[primaryName]);
            if (seenRequested.has(key)) {
              throw codedError('CUSTOMER_BASE_RESUME_REQUEST_PRIMARY_DUPLICATE', `Duplicate requested primary value: ${key}`, { tableId, primaryName });
            }
            seenRequested.add(key);
            const existing = existingByPrimary.get(key);
            if (!existing) {
              missing.push(payload);
              continue;
            }

            const differingFields = {};
            for (const [fieldName, value] of Object.entries(payload)) {
              const field = fieldByName.get(fieldName);
              if (!field) {
                throw codedError(
                  'CUSTOMER_BASE_RESUME_RECORD_FIELD_MISSING',
                  `Requested record field is missing from migration-owned Target schema: ${fieldName}`,
                  { tableId, fieldName },
                );
              }
              if (recordFieldValuesEqual(existing?.fields?.[fieldName], value, field)) continue;
              if (!allowRecordRefresh) {
                throw codedError(
                  'CUSTOMER_BASE_RESUME_RECORD_CONFLICT',
                  `Existing migration-owned record differs from requested Source payload: ${primaryName}=${key}`,
                  { tableId, primaryName, primaryValue: key, fieldName },
                );
              }
              if (fieldName === primaryName) {
                throw codedError(
                  'CUSTOMER_BASE_RESUME_RECORD_PRIMARY_REFRESH_BLOCKED',
                  `Source refresh cannot rewrite the stable primary key: ${primaryName}=${key}`,
                  { tableId, primaryName, primaryValue: key },
                );
              }
              differingFields[fieldName] = structuredClone(value);
            }
            if (Object.keys(differingFields).length > 0) {
              refreshUpdates.push({
                recordId: requireText(existing?.recordId, `recordId ${primaryName}=${key}`),
                primaryValue: key,
                fields: differingFields,
              });
            }
          }

          if (refreshUpdates.length > 0) {
            if (typeof target.batchUpdateRecords !== 'function') {
              throw codedError(
                'CUSTOMER_BASE_RESUME_RECORD_REFRESH_CAPABILITY_UNAVAILABLE',
                'Target client must implement batchUpdateRecords() for admitted Source refresh reconciliation',
                {
                  tableId,
                  tableName: tableNameById.get(tableId) ?? null,
                  recordCount: refreshUpdates.length,
                },
              );
            }
            try {
              await target.batchUpdateRecords({
                tableId,
                records: refreshUpdates.map(({ recordId, fields: updateFields }) => ({ recordId, fields: updateFields })),
                ...(typeof request?.beforeChunk === 'function' ? { beforeChunk: request.beforeChunk } : {}),
              });
            } catch (error) {
              throw remoteWriteError(
                'CUSTOMER_BASE_RESUME_RECORD_REFRESH_REMOTE_REJECTED',
                `Lark rejected migration-owned record refresh: ${tableNameById.get(tableId) ?? tableId}`,
                error,
                {
                  operation: 'batchUpdateRecords',
                  tableId,
                  tableName: tableNameById.get(tableId) ?? null,
                  recordCount: refreshUpdates.length,
                  fieldNames: collectRecordUpdateFieldNames(refreshUpdates),
                },
              );
            }

            const readbackByPrimary = indexRecords(
              await target.listRecords({ tableId }),
              primaryName,
              `target refresh readback ${tableId}`,
            );
            for (const update of refreshUpdates) {
              const readback = readbackByPrimary.get(update.primaryValue);
              if (!readback) {
                throw codedError(
                  'CUSTOMER_BASE_RESUME_RECORD_REFRESH_READBACK_MISSING',
                  `Migration-owned record missing after Source refresh: ${primaryName}=${update.primaryValue}`,
                  { tableId, primaryName, primaryValue: update.primaryValue },
                );
              }
              for (const [fieldName, value] of Object.entries(update.fields)) {
                const field = fieldByName.get(fieldName);
                if (!field || !recordFieldValuesEqual(readback?.fields?.[fieldName], value, field)) {
                  throw codedError(
                    'CUSTOMER_BASE_RESUME_RECORD_REFRESH_READBACK_MISMATCH',
                    `Migration-owned record differs after Source refresh: ${primaryName}=${update.primaryValue}`,
                    { tableId, primaryName, primaryValue: update.primaryValue, fieldName },
                  );
                }
              }
            }
          }

          let created = 0;
          if (missing.length > 0) {
            try {
              const result = await target.batchCreateRecords({ ...request, records: missing });
              created = Number(result?.created ?? 0);
            } catch (error) {
              throw remoteWriteError(
                'CUSTOMER_BASE_RESUME_RECORD_CREATE_REMOTE_REJECTED',
                `Lark rejected migration record batch create: ${tableNameById.get(tableId) ?? tableId}`,
                error,
                {
                  operation: 'batchCreateRecords',
                  tableId,
                  tableName: tableNameById.get(tableId) ?? null,
                  recordCount: missing.length,
                  fieldNames: collectRecordFieldNames(missing),
                },
              );
            }
          }
          return { created };
        };
      }

      if (property === 'createView') {
        return async (request) => {
          const tableId = requireWritableTable(request?.tableId, 'createView', dynamicProtectedIds, writableIds);
          const viewName = requireText(request?.viewName, 'createView.viewName');
          const views = await target.listViews({ tableId });
          const existing = views.find((view) => view?.viewName === viewName) ?? null;
          if (existing) {
            const requestedType = optionalText(request?.viewType);
            const existingType = optionalText(existing?.viewType);
            if (requestedType && existingType && requestedType !== existingType) {
              throw codedError('CUSTOMER_BASE_RESUME_VIEW_CONFLICT', `Existing migration-owned View type differs: ${viewName}`, { tableId, viewName, requestedType, existingType });
            }
            return structuredClone(existing);
          }
          try {
            return await target.createView(request);
          } catch (error) {
            throw remoteWriteError(
              'CUSTOMER_BASE_RESUME_CREATE_VIEW_REMOTE_REJECTED',
              `Lark rejected migration View create: ${tableNameById.get(tableId) ?? tableId}.${viewName}`,
              error,
              {
                operation: 'createView',
                tableId,
                tableName: tableNameById.get(tableId) ?? null,
                viewName,
                viewType: optionalText(request?.viewType),
              },
            );
          }
        };
      }

      if (WRITE_METHODS.includes(property)) {
        return async (request) => {
          const tableId = requireText(request?.tableId, `${String(property)}.tableId`);
          if (dynamicProtectedIds.has(tableId)) {
            throw codedError(
              'CUSTOMER_BASE_RESUME_PROTECTED_TABLE_WRITE_BLOCKED',
              `Write blocked by controlled-Apply checkpoint: ${String(property)}`,
              { operation: String(property), tableId },
            );
          }
          if (!writableIds.has(tableId)) {
            throw codedError(
              'CUSTOMER_BASE_RESUME_UNOWNED_TABLE_WRITE_BLOCKED',
              `Write blocked because table is not owned by this migration session: ${String(property)}`,
              { operation: String(property), tableId },
            );
          }
          try {
            return await target[property](request);
          } catch (error) {
            throw remoteWriteError(
              'CUSTOMER_BASE_RESUME_REMOTE_WRITE_REJECTED',
              `Lark rejected migration write: ${String(property)} ${tableNameById.get(tableId) ?? tableId}`,
              error,
              {
                operation: String(property),
                tableId,
                tableName: tableNameById.get(tableId) ?? null,
              },
            );
          }
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return Object.freeze({
    ok: true,
    client,
    checkpoint: Object.freeze({
      contractVersion: 'customer_base_resumable_target_v1',
      protectedTables: Object.freeze(protectedTables.map((table) => Object.freeze(structuredClone(table)))),
      recoveryCandidateTables: Object.freeze([...resumeByName.keys()].sort()),
      rule: 'baseline-and-unrelated-tables-immutable-clone-scope-partials-exact-idempotent',
    }),
  });
}

async function createFormulaFieldInStages(input) {
  const {
    target,
    request,
    tableId,
    tableName,
    requestedField,
    targetFormulaType,
  } = input;
  const fieldName = requireText(requestedField?.fieldName, 'Formula fieldName');

  if (typeof target.createFormulaFieldV3 === 'function') {
    let created;
    try {
      created = await target.createFormulaFieldV3({
        ...request,
        tableId,
        field: requestedField,
      });
    } catch (error) {
      throw remoteWriteError(
        'CUSTOMER_BASE_RESUME_FORMULA_V3_CREATE_REMOTE_REJECTED',
        `Lark rejected Base v3 Formula create: ${tableName ?? tableId}.${fieldName}`,
        error,
        {
          operation: 'createFormulaFieldV3',
          tableId,
          tableName,
          ...summarizeFieldMutation(requestedField),
        },
      );
    }

    const comparableCreated = adaptFormulaFieldForTarget(created, targetFormulaType);
    const comparison = compareFieldMutation(comparableCreated, requestedField);
    if (!comparison.ok) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_FORMULA_V3_READBACK_MISMATCH',
        `Formula field differs after Base v3 create: ${tableName ?? tableId}.${fieldName}`,
        {
          tableId,
          tableName,
          fieldId: optionalText(created?.fieldId),
          fieldName,
          differencePaths: comparison.differencePaths,
          existingPropertyKeys: propertyKeys(comparison.existing.property),
          requestedPropertyKeys: propertyKeys(comparison.requested.property),
        },
      );
    }
    return structuredClone(created);
  }

  const shellField = stripFormulaExpressionFromField(requestedField);
  let created;
  try {
    created = await target.createField({
      ...request,
      field: shellField,
    });
  } catch (error) {
    throw remoteWriteError(
      'CUSTOMER_BASE_RESUME_FORMULA_SHELL_CREATE_REMOTE_REJECTED',
      `Lark rejected Formula type-only shell create: ${tableName ?? tableId}.${fieldName}`,
      error,
      {
        operation: 'createFormulaTypeOnlyShell',
        tableId,
        tableName,
        ...summarizeFieldMutation(shellField),
      },
    );
  }

  return finalizeFormulaField({
    target,
    tableId,
    tableName,
    existingField: created,
    requestedField,
    targetFormulaType,
  });
}

async function finalizeFormulaField(input) {
  const {
    target,
    tableId,
    tableName,
    existingField,
    requestedField,
    targetFormulaType,
  } = input;
  const fieldName = requireText(requestedField?.fieldName, 'Formula fieldName');
  const fieldId = requireText(existingField?.fieldId, `Formula fieldId ${fieldName}`);
  const useBaseV3 = typeof target.updateFormulaFieldV3 === 'function';

  try {
    if (useBaseV3) {
      await target.updateFormulaFieldV3({
        tableId,
        fieldId,
        field: requestedField,
      });
    } else {
      await target.updateField({
        tableId,
        fieldId,
        field: requestedField,
      });
    }
  } catch (error) {
    throw remoteWriteError(
      'CUSTOMER_BASE_RESUME_FORMULA_FINALIZE_REMOTE_REJECTED',
      `Lark rejected Formula finalize update: ${tableName ?? tableId}.${fieldName}`,
      error,
      {
        operation: useBaseV3 ? 'finalizeFormulaFieldV3' : 'finalizeFormulaField',
        tableId,
        tableName,
        fieldId,
        ...summarizeFieldMutation(requestedField),
      },
    );
  }

  const fields = await target.listFields({ tableId });
  const readback = fields.find((item) => item?.fieldId === fieldId)
    ?? fields.find((item) => item?.fieldName === fieldName)
    ?? null;
  if (!readback) {
    throw codedError(
      'CUSTOMER_BASE_RESUME_FORMULA_READBACK_MISSING',
      `Formula field missing after finalize update: ${tableName ?? tableId}.${fieldName}`,
      { tableId, tableName, fieldId, fieldName },
    );
  }

  const comparableReadback = adaptFormulaFieldForTarget(readback, targetFormulaType);
  const comparison = compareFieldMutation(comparableReadback, requestedField);
  if (!comparison.ok) {
    throw codedError(
      'CUSTOMER_BASE_RESUME_FORMULA_READBACK_MISMATCH',
      `Formula field differs after finalize update: ${tableName ?? tableId}.${fieldName}`,
      {
        tableId,
        tableName,
        fieldId,
        fieldName,
        differencePaths: comparison.differencePaths,
        existingPropertyKeys: propertyKeys(comparison.existing.property),
        requestedPropertyKeys: propertyKeys(comparison.requested.property),
      },
    );
  }
  return structuredClone(readback);
}

function isRecoverableFormulaShell(existing, requested) {
  if (Number(existing?.type) !== FORMULA_FIELD_TYPE || Number(requested?.type) !== FORMULA_FIELD_TYPE) return false;
  const requestedExpression = optionalText(requested?.property?.formula_expression);
  const existingExpression = optionalText(existing?.property?.formula_expression);
  if (!requestedExpression || existingExpression) return false;
  return compareFieldMutation(
    stripFormulaExpressionFromField(existing),
    stripFormulaExpressionFromField(requested),
  ).ok;
}

function stripFormulaExpressionFromField(field) {
  const result = structuredClone(requireObject(field, 'Formula field'));
  if (!result?.property || typeof result.property !== 'object' || Array.isArray(result.property)) return result;
  delete result.property.formula_expression;
  if (Object.keys(result.property).length === 0) result.property = null;
  return result;
}

function stripGeneratedSelectOptionIdsFromCreateTableRequest(request) {
  const fields = requireArray(request?.fields, 'createTable.fields');
  return {
    ...request,
    fields: fields.map(stripGeneratedSelectOptionIdsFromField),
  };
}

function stripGeneratedSelectOptionIdsFromField(field) {
  const sanitized = structuredClone(requireObject(field, 'field'));
  if (!Array.isArray(sanitized?.property?.options)) return sanitized;
  sanitized.property.options = sanitized.property.options.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
    const { id: _generatedId, ...rest } = option;
    return rest;
  });
  return sanitized;
}

function adaptFormulaFieldForTarget(field, formulaType, options = {}) {
  const normalized = structuredClone(requireObject(field, 'field'));
  if (Number(normalized?.type) !== FORMULA_FIELD_TYPE) return normalized;
  const rawProperty = normalized?.property && typeof normalized.property === 'object' && !Array.isArray(normalized.property)
    ? structuredClone(normalized.property)
    : normalized?.property;
  if (formulaType !== 2 && rawProperty && typeof rawProperty === 'object' && !Array.isArray(rawProperty)) {
    delete rawProperty.type;
  }
  const canonicalProperty = normalizeLarkFieldProperty(FORMULA_FIELD_TYPE, rawProperty);
  normalized.property = canonicalProperty ? structuredClone(canonicalProperty) : null;
  const property = normalized.property;

  if (options.requireFormulaExpression === true && !optionalText(property?.formula_expression)) {
    throw codedError(
      'CUSTOMER_BASE_RESUME_FORMULA_EXPRESSION_REQUIRED',
      `Formula Source field must contain formula_expression: ${requireText(normalized?.fieldName, 'fieldName')}`,
      { fieldName: requireText(normalized?.fieldName, 'fieldName'), formulaType },
    );
  }

  if (formulaType === 2) {
    if (options.requirePropertyType === true && (!property || property.type === undefined || property.type === null)) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_FORMULA_PROPERTY_TYPE_REQUIRED',
        `Target Base formula_type=2 requires Formula property.type: ${requireText(normalized?.fieldName, 'fieldName')}`,
        { fieldName: requireText(normalized?.fieldName, 'fieldName'), formulaType },
      );
    }
    if (property?.type && typeof property.type === 'object' && !Array.isArray(property.type)) {
      const uiProperty = property.type.ui_property
        && typeof property.type.ui_property === 'object'
        && !Array.isArray(property.type.ui_property)
        ? structuredClone(property.type.ui_property)
        : {};
      for (const key of FORMULA_TYPE2_UI_PROPERTY_KEYS) {
        if (property[key] !== undefined && uiProperty[key] === undefined) {
          uiProperty[key] = structuredClone(property[key]);
        }
        delete property[key];
      }
      property.type = {
        ...property.type,
        ...(Object.keys(uiProperty).length > 0 ? { ui_property: uiProperty } : {}),
      };
    }
  }
  return normalized;
}

function summarizeFieldMutation(field) {
  const value = requireObject(field, 'field');
  const property = value?.property && typeof value.property === 'object' && !Array.isArray(value.property)
    ? value.property
    : null;
  return {
    fieldName: requireText(value?.fieldName, 'fieldName'),
    fieldType: Number(value?.type),
    uiType: optionalText(value?.uiType),
    propertyKeys: property ? Object.keys(property).sort() : [],
    optionCount: Array.isArray(property?.options) ? property.options.length : 0,
  };
}

function collectRecordFieldNames(records) {
  const names = new Set();
  for (const record of records) {
    for (const fieldName of Object.keys(requireObject(record, 'record payload'))) names.add(fieldName);
  }
  return [...names].sort();
}

function collectRecordUpdateFieldNames(records) {
  const names = new Set();
  for (const record of records) {
    for (const fieldName of Object.keys(requireObject(record?.fields, 'record update fields'))) names.add(fieldName);
  }
  return [...names].sort();
}

function remoteWriteError(code, message, error, details = {}) {
  const causeDetails = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details
    : {};
  return codedError(code, message, {
    ...details,
    causeCode: optionalText(error?.code),
    status: finiteNumberOrNull(causeDetails.status),
    larkCode: finiteNumberOrNull(causeDetails.larkCode),
    retryAfter: finiteNumberOrNull(causeDetails.retryAfter),
  });
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireWritableTable(value, operation, protectedIds, writableIds) {
  const tableId = requireText(value, `${operation}.tableId`);
  if (protectedIds.has(tableId)) {
    throw codedError('CUSTOMER_BASE_RESUME_PROTECTED_TABLE_WRITE_BLOCKED', `Write blocked by controlled-Apply checkpoint: ${operation}`, { operation, tableId });
  }
  if (!writableIds.has(tableId)) {
    throw codedError('CUSTOMER_BASE_RESUME_UNOWNED_TABLE_WRITE_BLOCKED', `Write blocked because table is not owned by this migration session: ${operation}`, { operation, tableId });
  }
  return tableId;
}

function fieldMatchesMutation(existing, requested) {
  return compareFieldMutation(existing, requested).ok;
}

function compareFieldMutation(existing, requested) {
  const existingComparable = canonicalFieldMutation(existing, 'existing');
  const requestedComparable = canonicalFieldMutation(requested, 'requested');
  const differencePaths = collectDifferencePaths(existingComparable, requestedComparable);
  return {
    ok: differencePaths.length === 0,
    existing: existingComparable,
    requested: requestedComparable,
    differencePaths: differencePaths.slice(0, 24),
  };
}

function canonicalFieldMutation(field, label) {
  const value = requireObject(field, `${label} field`);
  const type = Number(value?.type);
  const property = canonicalProperty(normalizeLarkFieldProperty(type, value?.property));
  return {
    fieldName: requireText(value?.fieldName, `${label} fieldName`),
    type,
    description: normalizeDescription(value?.description),
    property,
  };
}

function normalizeDescription(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value?.text === 'string' ? value.text.trim() : '';
}

function propertyKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

function canonicalProperty(value) {
  if (Array.isArray(value)) return value.map(canonicalProperty);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => key !== 'id')
    .sort()
    .map((key) => [key, canonicalProperty(value[key])]));
}

function collectDifferencePaths(left, right, path = '$', result = []) {
  if (Object.is(left, right)) return result;
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!(leftArray && rightArray)) {
      result.push(path);
      return result;
    }
    if (left.length !== right.length) result.push(`${path}.length`);
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) collectDifferencePaths(left[index], right[index], `${path}[${index}]`, result);
    return result;
  }
  const leftObject = left !== null && typeof left === 'object';
  const rightObject = right !== null && typeof right === 'object';
  if (leftObject || rightObject) {
    if (!(leftObject && rightObject)) {
      result.push(path);
      return result;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) result.push(`${path}.${key}`);
      else collectDifferencePaths(left[key], right[key], `${path}.${key}`, result);
    }
    return result;
  }
  result.push(path);
  return result;
}

function indexFieldsByName(fields, tableId) {
  const result = new Map();
  for (const field of requireArray(fields, `target fields ${tableId}`)) {
    const fieldName = requireText(field?.fieldName, `target fieldName ${tableId}`);
    if (result.has(fieldName)) {
      throw codedError(
        'CUSTOMER_BASE_RESUME_TARGET_FIELD_DUPLICATE',
        `Target migration-owned table contains duplicate field name: ${fieldName}`,
        { tableId, fieldName },
      );
    }
    result.set(fieldName, field);
  }
  return result;
}

function recordFieldValuesEqual(left, right, field) {
  const type = Number(field?.type);
  if (type === 2) {
    return canonicalNumberRecordValue(left) === canonicalNumberRecordValue(right);
  }
  return canonicalValue(left) === canonicalValue(right);
}

function canonicalNumberRecordValue(value) {
  if (value === null || value === undefined || value === '') return 'number:null';
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${JSON.stringify(value)}`;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value.trim());
    if (Number.isFinite(number)) return `number:${JSON.stringify(number)}`;
  }
  return `json:${canonicalValue(value)}`;
}

function indexRecords(records, primaryName, label) {
  const result = new Map();
  for (const record of records) {
    const key = canonicalValue(record?.fields?.[primaryName]);
    if (result.has(key)) throw codedError('CUSTOMER_BASE_RESUME_TARGET_PRIMARY_DUPLICATE', `Duplicate primary value in ${label}: ${key}`, { primaryName, key });
    result.set(key, record);
  }
  return result;
}

function canonicalValue(value) {
  return stableJson(value ?? null);
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function uniqueTableByName(tables) {
  const result = new Map();
  for (const table of requireArray(tables, 'current tables')) {
    const name = requireText(table?.name, 'current table name');
    if (result.has(name)) throw codedError('CUSTOMER_BASE_RESUME_TARGET_TABLE_DUPLICATE', `Target Base contains duplicate table name: ${name}`, { name });
    result.set(name, table);
  }
  return result;
}

function normalizeProtectedTables(value) {
  const items = requireArray(value, 'protectedTables').map((table, index) => {
    const item = requireObject(table, `protectedTables[${index}]`);
    return Object.freeze({
      name: requireText(item?.name, `protectedTables[${index}].name`),
      tableId: requireText(item?.tableId, `protectedTables[${index}].tableId`),
    });
  });
  const names = new Set();
  const ids = new Set();
  for (const item of items) {
    if (names.has(item.name) || ids.has(item.tableId)) throw new TypeError('protectedTables must contain unique names and IDs');
    names.add(item.name);
    ids.add(item.tableId);
  }
  return Object.freeze(items);
}

function normalizeNames(value, name) {
  const items = requireArray(value, name).map((item) => requireText(item, name));
  if (items.length === 0 || new Set(items).size !== items.length) throw new TypeError(`${name} must be a non-empty unique array`);
  return Object.freeze(items);
}

function normalizeRecordReconciliationMode(value) {
  const mode = optionalText(value) ?? RECORD_RECONCILIATION_EXACT_RETRY;
  if (mode !== RECORD_RECONCILIATION_EXACT_RETRY && mode !== RECORD_RECONCILIATION_SOURCE_REFRESH) {
    throw new TypeError(`recordReconciliationMode must be ${RECORD_RECONCILIATION_EXACT_RETRY} or ${RECORD_RECONCILIATION_SOURCE_REFRESH}`);
  }
  return mode;
}

function requireClient(client) {
  for (const method of ['listTables', 'listFields', 'listRecords', 'listViews', 'createTable', 'createField', 'updateField', 'batchCreateRecords']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`targetClient must implement ${method}()`);
  }
  return client;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
