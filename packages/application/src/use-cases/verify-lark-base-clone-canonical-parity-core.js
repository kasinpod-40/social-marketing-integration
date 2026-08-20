import { normalizeLarkFieldProperty } from '../../../shared/src/lark/lark-field-contract.js';

const RELATION_FIELD_TYPE = 18;
const FORMULA_FIELD_TYPE = 20;

/**
 * GET-only canonical verifier for the clone-scope portion of a customer Base migration.
 *
 * The verifier tolerates generated Target IDs only when Source table/field/record references
 * can be deterministically remapped by table name, field name and unique primary value.
 * It performs no mutations and intentionally ignores unrelated Target tables.
 * Formula definition remains an automatic hard gate; legacy Formula result presentation
 * is reported separately as manual/UI parity evidence because current Base v3 writes do
 * not expose those style/result fields.
 */
export async function verifyLarkBaseCloneCanonicalParity(input) {
  const sourceClient = requireReadClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireReadClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeOptionalNames(input?.expectedTableNames);

  const [sourceTables, targetTables] = await Promise.all([
    sourceClient.listTables(),
    targetClient.listTables(),
  ]);
  const mismatches = [];
  const manualFormulaPresentation = [];
  const sourceByName = uniqueTableIndex(sourceTables, 'source', mismatches);
  const targetByName = uniqueTableIndex(targetTables, 'target', mismatches);

  if (expectedTableNames) {
    for (const name of expectedTableNames) {
      if (!sourceByName.has(name)) {
        mismatches.push(problem('CANONICAL_VERIFY_SOURCE_TABLE_MISSING', `Source clone scope is missing table: ${name}`, { name }));
      }
    }
    for (const table of sourceTables) {
      if (!expectedTableNames.includes(table.name)) {
        mismatches.push(problem('CANONICAL_VERIFY_SOURCE_TABLE_UNEXPECTED', `Source clone scope contains unexpected table: ${table.name}`, { name: table.name }));
      }
    }
  }

  const sourceSnapshots = new Map();
  const targetSnapshots = new Map();
  const targetTableIdBySourceId = new Map();
  for (const sourceTable of sourceTables) {
    const targetTable = targetByName.get(sourceTable.name);
    if (!targetTable) {
      mismatches.push(problem('CANONICAL_VERIFY_TARGET_TABLE_MISSING', `Target table missing: ${sourceTable.name}`, { name: sourceTable.name }));
      continue;
    }
    targetTableIdBySourceId.set(requireText(sourceTable.tableId, 'source tableId'), requireText(targetTable.tableId, 'target tableId'));
    sourceSnapshots.set(sourceTable.tableId, await loadTableSnapshot(sourceClient, sourceTable));
    targetSnapshots.set(sourceTable.tableId, await loadTableSnapshot(targetClient, targetTable));
  }

  const hasFormulaFields = [...sourceSnapshots.values()]
    .some((snapshot) => snapshot.fields.some((field) => Number(field?.type) === FORMULA_FIELD_TYPE));
  const targetFormulaType = hasFormulaFields ? await readTargetFormulaType(targetClient) : null;

  const fieldIdMaps = new Map();
  const targetFieldBySourceFieldId = new Map();
  for (const sourceTable of sourceTables) {
    const source = sourceSnapshots.get(sourceTable.tableId);
    const target = targetSnapshots.get(sourceTable.tableId);
    if (!source || !target) continue;
    const targetByFieldName = uniqueFieldIndex(target.fields, sourceTable.name, mismatches);
    const fieldMap = new Map();
    for (const sourceField of source.fields) {
      const targetField = targetByFieldName.get(sourceField.fieldName);
      if (!targetField) continue;
      const sourceFieldId = requireText(sourceField.fieldId, `source fieldId ${sourceTable.name}.${sourceField.fieldName}`);
      const targetFieldId = requireText(targetField.fieldId, `target fieldId ${sourceTable.name}.${sourceField.fieldName}`);
      fieldMap.set(sourceFieldId, targetFieldId);
      targetFieldBySourceFieldId.set(`${sourceTable.tableId}:${sourceFieldId}`, targetField);
    }
    fieldIdMaps.set(sourceTable.tableId, fieldMap);
  }

  const recordIdMaps = new Map();
  const sourceRecordByPrimaryMaps = new Map();
  const targetRecordByPrimaryMaps = new Map();
  for (const sourceTable of sourceTables) {
    const source = sourceSnapshots.get(sourceTable.tableId);
    const target = targetSnapshots.get(sourceTable.tableId);
    if (!source || !target) continue;
    const primary = findSinglePrimary(source.fields, sourceTable.name, mismatches);
    if (!primary) continue;
    const sourceByPrimary = indexRecordsByPrimary(source.records, primary.fieldName, `source ${sourceTable.name}`, mismatches);
    const targetByPrimary = indexRecordsByPrimary(target.records, primary.fieldName, `target ${sourceTable.name}`, mismatches);
    sourceRecordByPrimaryMaps.set(sourceTable.tableId, sourceByPrimary);
    targetRecordByPrimaryMaps.set(sourceTable.tableId, targetByPrimary);
    const recordMap = new Map();
    for (const [key, sourceRecord] of sourceByPrimary.entries()) {
      const targetRecord = targetByPrimary.get(key);
      if (!targetRecord) continue;
      recordMap.set(requireText(sourceRecord.recordId, `source recordId ${sourceTable.name}:${key}`), requireText(targetRecord.recordId, `target recordId ${sourceTable.name}:${key}`));
    }
    recordIdMaps.set(sourceTable.tableId, recordMap);
  }

  for (const sourceTable of sourceTables) {
    const source = sourceSnapshots.get(sourceTable.tableId);
    const target = targetSnapshots.get(sourceTable.tableId);
    if (!source || !target) continue;
    verifyFields({
      sourceTable,
      source,
      target,
      fieldIdMaps,
      targetTableIdBySourceId,
      targetFormulaType,
      mismatches,
      manualFormulaPresentation,
    });
    verifyRecords({
      sourceTable,
      source,
      target,
      recordIdMaps,
      sourceRecordByPrimaryMaps,
      targetRecordByPrimaryMaps,
      mismatches,
    });
    verifyBasicViews({
      sourceTable,
      source,
      target,
      fieldIdMap: fieldIdMaps.get(sourceTable.tableId) ?? new Map(),
      mismatches,
    });
  }

  return deepFreeze({
    ok: mismatches.length === 0,
    contractVersion: 'customer_base_clone_canonical_verifier_v1',
    mode: 'read-only',
    summary: {
      sourceTables: sourceTables.length,
      targetTablesTotal: targetTables.length,
      mappedTables: targetTableIdBySourceId.size,
      mappedFields: sumMapSizes(fieldIdMaps),
      mappedRecords: sumMapSizes(recordIdMaps),
      mismatches: mismatches.length,
      manualFormulaPresentationMismatches: manualFormulaPresentation.length,
    },
    coverage: {
      fields: 'full-readable-config-with-relation-remap-formula-definition-hard-gate-and-formula-presentation-manual-evidence',
      records: 'all-readable-field-values-with-relation-record-id-remap',
      views: 'name-type-public-hidden-filter-with-field-id-remap-and-semantic-filter-canonicalization',
      unrelatedTargetTablesIgnored: true,
    },
    manualParity: {
      formulaPresentation: {
        ownership: 'ui-manual-current-openapi-read-only',
        required: manualFormulaPresentation.length > 0,
        targetFormulaType,
        mismatches: manualFormulaPresentation,
      },
    },
    mismatches,
    remoteMutationCount: 0,
  });
}

async function loadTableSnapshot(client, table) {
  const tableId = requireText(table?.tableId, 'tableId');
  const [fields, records, listedViews] = await Promise.all([
    client.listFields({ tableId }),
    client.listRecords({ tableId }),
    client.listViews({ tableId }),
  ]);
  const views = [];
  for (const listed of listedViews) {
    if (typeof client.getView !== 'function') {
      views.push(structuredClone(listed));
      continue;
    }
    const detailed = await client.getView({ tableId, viewId: requireText(listed?.viewId, 'viewId') });
    views.push(mergeListedAndDetailedView(listed, detailed));
  }
  return { table, fields, records, views };
}

async function readTargetFormulaType(client) {
  if (typeof client.getBaseFormulaType !== 'function') {
    throw new TypeError('targetClient must implement getBaseFormulaType() when Formula fields are present');
  }
  const raw = await client.getBaseFormulaType();
  if (raw === null || raw === undefined || raw === '') {
    throw new TypeError('Target Base formula_type must be an integer');
  }
  const formulaType = Number(raw);
  if (!Number.isInteger(formulaType)) throw new TypeError('Target Base formula_type must be an integer');
  return formulaType;
}

function verifyFields(input) {
  const {
    sourceTable,
    source,
    target,
    fieldIdMaps,
    targetTableIdBySourceId,
    targetFormulaType,
    mismatches,
    manualFormulaPresentation,
  } = input;
  if (source.fields.length !== target.fields.length) {
    mismatches.push(problem('CANONICAL_VERIFY_FIELD_COUNT_MISMATCH', `Field count mismatch: ${sourceTable.name}`, {
      sourceFields: source.fields.length,
      targetFields: target.fields.length,
    }));
  }
  const targetByName = uniqueFieldIndex(target.fields, sourceTable.name, mismatches);
  for (const sourceField of source.fields) {
    const targetField = targetByName.get(sourceField.fieldName);
    if (!targetField) {
      mismatches.push(problem('CANONICAL_VERIFY_FIELD_MISSING', `Target field missing: ${sourceTable.name}.${sourceField.fieldName}`));
      continue;
    }

    if (Number(sourceField?.type) === FORMULA_FIELD_TYPE) {
      const sourcePresentation = canonicalFormulaPresentation(sourceField?.property);
      const targetPresentation = canonicalFormulaPresentation(targetField?.property);
      if (stableJson(sourcePresentation) !== stableJson(targetPresentation)) {
        manualFormulaPresentation.push(deepFreeze({
          tableName: sourceTable.name,
          fieldName: requireText(sourceField?.fieldName, 'Formula fieldName'),
          targetFormulaType,
          differencePaths: collectDifferencePaths(sourcePresentation, targetPresentation).slice(0, 24),
          source: sourcePresentation,
          target: targetPresentation,
        }));
      }
    }

    const sourceComparable = canonicalField(sourceField, {
      side: 'source',
      targetTableIdBySourceId,
      fieldIdMaps,
      targetFormulaType,
    });
    const targetComparable = canonicalField(targetField, {
      side: 'target',
      targetFormulaType,
    });
    if (stableJson(sourceComparable) !== stableJson(targetComparable)) {
      mismatches.push(problem('CANONICAL_VERIFY_FIELD_CONFIG_MISMATCH', `Field configuration mismatch: ${sourceTable.name}.${sourceField.fieldName}`, {
        differencePaths: collectDifferencePaths(sourceComparable, targetComparable).slice(0, 32),
      }));
    }
  }
}

function canonicalField(field, context) {
  const type = Number(field?.type);
  return sortObject({
    fieldName: requireText(field?.fieldName, 'fieldName'),
    type,
    uiType: normalizeOptionalText(field?.uiType),
    description: normalizeDescription(field?.description),
    isPrimary: field?.isPrimary === true,
    property: canonicalFieldProperty(type, field?.property, context),
  });
}

function canonicalFieldProperty(type, property, context) {
  const normalized = normalizeLarkFieldProperty(type, property);
  const result = normalized ? structuredClone(normalized) : {};

  if (Number(type) === FORMULA_FIELD_TYPE) {
    const expression = normalizeOptionalText(result.formula_expression);
    if (!expression) return null;
    const mappedExpression = context?.side === 'source'
      ? remapFormulaExpression(expression, context.targetTableIdBySourceId, context.fieldIdMaps)
      : expression;
    return sortObject({ formula_expression: mappedExpression });
  }

  if (Number(type) === 5) {
    result.date_formatter = normalizeOptionalText(result.date_formatter) ?? 'yyyy/MM/dd';
    result.auto_fill = result.auto_fill === true;
  }
  if (Array.isArray(result.options)) {
    result.options = result.options.map((option) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
      const clone = structuredClone(option);
      delete clone.id;
      return clone;
    });
  }
  if (context?.side === 'source' && Number(type) === RELATION_FIELD_TYPE && result.table_id) {
    const mapped = context.targetTableIdBySourceId.get(result.table_id);
    result.table_id = mapped ?? `__unmapped_table__:${result.table_id}`;
  }
  delete result.table_name;
  return Object.keys(result).length > 0 ? sortObject(result) : null;
}

function canonicalFormulaPresentation(property) {
  const normalized = normalizeLarkFieldProperty(FORMULA_FIELD_TYPE, property);
  const result = normalized ? structuredClone(normalized) : {};
  delete result.formula_expression;
  delete result.table_name;
  return Object.keys(result).length > 0 ? sortObject(result) : null;
}

function remapFormulaExpression(expressionValue, tableMap, fieldIdMaps) {
  let expression = String(expressionValue);
  for (const [sourceTableId, targetTableId] of tableMap.entries()) {
    expression = replaceAllLiteral(expression, sourceTableId, targetTableId);
  }
  for (const fieldMap of fieldIdMaps.values()) {
    for (const [sourceFieldId, targetFieldId] of fieldMap.entries()) {
      expression = replaceAllLiteral(expression, sourceFieldId, targetFieldId);
    }
  }
  return expression;
}

function verifyRecords(input) {
  const {
    sourceTable,
    source,
    target,
    recordIdMaps,
    sourceRecordByPrimaryMaps,
    targetRecordByPrimaryMaps,
    mismatches,
  } = input;
  const sourceByPrimary = sourceRecordByPrimaryMaps.get(sourceTable.tableId) ?? new Map();
  const targetByPrimary = targetRecordByPrimaryMaps.get(sourceTable.tableId) ?? new Map();
  if (!sameKeySet(sourceByPrimary, targetByPrimary)) {
    mismatches.push(problem('CANONICAL_VERIFY_RECORD_PRIMARY_SET_MISMATCH', `Record primary-key set mismatch: ${sourceTable.name}`, {
      sourceRecords: source.records.length,
      targetRecords: target.records.length,
    }));
  }
  for (const [key, sourceRecord] of sourceByPrimary.entries()) {
    const targetRecord = targetByPrimary.get(key);
    if (!targetRecord) continue;
    for (const field of source.fields) {
      const sourceValue = canonicalRecordValue(sourceRecord?.fields?.[field.fieldName], field, {
        side: 'source',
        recordIdMaps,
      });
      const targetValue = canonicalRecordValue(targetRecord?.fields?.[field.fieldName], field, { side: 'target' });
      if (stableJson(sourceValue) !== stableJson(targetValue)) {
        mismatches.push(problem('CANONICAL_VERIFY_RECORD_VALUE_MISMATCH', `Record value mismatch: ${sourceTable.name}.${field.fieldName}`, {
          primaryValue: key,
          differencePaths: collectDifferencePaths(sourceValue, targetValue).slice(0, 16),
        }));
      }
    }
  }
}

function canonicalRecordValue(value, field, context) {
  if (value === undefined || value === null) return null;
  if (Number(field?.type) === RELATION_FIELD_TYPE) {
    const ids = extractRelationRecordIds(value);
    if (context?.side === 'source') {
      const sourceTargetTableId = requireText(field?.property?.table_id, `relation table_id ${field?.fieldName}`);
      const recordMap = context.recordIdMaps.get(sourceTargetTableId);
      return ids.map((id) => recordMap?.get(id) ?? `__unmapped_record__:${id}`).sort();
    }
    return ids.sort();
  }
  if (Number(field?.type) === 1) return canonicalTextValue(value);
  return sortObject(normalizeGenericValue(value));
}

function canonicalTextValue(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return normalizeGenericValue(value);
  if (value.every((item) => item && typeof item === 'object' && typeof item.text === 'string')) {
    return value.map((item) => item.text).join('');
  }
  return normalizeGenericValue(value);
}

function normalizeGenericValue(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(normalizeGenericValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeGenericValue(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function verifyBasicViews(input) {
  const { sourceTable, source, target, fieldIdMap, mismatches } = input;
  if (source.views.length !== target.views.length) {
    mismatches.push(problem('CANONICAL_VERIFY_VIEW_COUNT_MISMATCH', `View count mismatch: ${sourceTable.name}`, {
      sourceViews: source.views.length,
      targetViews: target.views.length,
    }));
  }
  const targetByName = uniqueViewIndex(target.views, sourceTable.name, mismatches);
  for (const sourceView of source.views) {
    const targetView = targetByName.get(sourceView.viewName);
    if (!targetView) {
      mismatches.push(problem('CANONICAL_VERIFY_VIEW_MISSING', `Target View missing: ${sourceTable.name}.${sourceView.viewName}`));
      continue;
    }
    const sourceComparable = canonicalBasicView(sourceView, fieldIdMap);
    const targetComparable = canonicalBasicView(targetView, null);
    if (stableJson(sourceComparable) !== stableJson(targetComparable)) {
      mismatches.push(problem('CANONICAL_VERIFY_VIEW_CONFIG_MISMATCH', `View configuration mismatch: ${sourceTable.name}.${sourceView.viewName}`, {
        differencePaths: collectDifferencePaths(sourceComparable, targetComparable).slice(0, 32),
      }));
    }
  }
}

function canonicalBasicView(view, fieldIdMap) {
  const mapFieldId = (fieldId) => fieldIdMap ? (fieldIdMap.get(fieldId) ?? `__unmapped_field__:${fieldId}`) : fieldId;
  const property = view?.property && typeof view.property === 'object' ? view.property : {};
  const hiddenFields = (Array.isArray(property.hiddenFields) ? property.hiddenFields : []).map(mapFieldId).sort();
  const filterInfo = property.filterInfo
    ? canonicalViewFilterInfo(property.filterInfo, mapFieldId)
    : null;
  return sortObject({
    viewType: normalizeOptionalText(view?.viewType),
    publicLevel: normalizePublicLevel(view?.publicLevel),
    hiddenFields,
    filterInfo,
  });
}

/**
 * Compare View filters by meaning instead of unstable Lark presentation details.
 * - 0/1 logical conditions do not depend on the conjunction label.
 * - values inside one condition are sets for the supported View filter contract.
 * - SingleSelect any-of may be represented as one multi-value condition in Source
 *   and as one OR condition per value in Target; group those representations.
 * - multiple unrelated conditions retain strict AND/OR semantics.
 */
function canonicalViewFilterInfo(filterInfo, mapFieldId) {
  const source = filterInfo && typeof filterInfo === 'object' && !Array.isArray(filterInfo)
    ? filterInfo
    : {};
  const conjunction = source.conjunction === 'or' ? 'or' : 'and';
  const rawConditions = (Array.isArray(source.conditions) ? source.conditions : []).map((condition) => ({
    fieldId: mapFieldId(condition?.fieldId),
    fieldType: Number(condition?.fieldType),
    operator: normalizeOptionalText(condition?.operator),
    value: canonicalViewFilterValue(condition?.value),
  }));

  const groupedSingleSelect = new Map();
  const conditions = [];
  for (const condition of rawConditions) {
    if (conjunction === 'or' && condition.fieldType === 3 && condition.operator === 'is') {
      const key = `${condition.fieldId}\u0000${condition.fieldType}\u0000${condition.operator}`;
      const existing = groupedSingleSelect.get(key) ?? { ...condition, value: [] };
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      existing.value.push(...values.filter((value) => value !== null && value !== undefined));
      groupedSingleSelect.set(key, existing);
      continue;
    }
    conditions.push(condition);
  }

  for (const condition of groupedSingleSelect.values()) {
    condition.value = canonicalViewFilterValue(condition.value);
    conditions.push(condition);
  }

  conditions.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return sortObject({
    conjunction: conditions.length <= 1 ? 'and' : conjunction,
    conditions,
  });
}

function canonicalViewFilterValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = normalizeGenericValue(value);
  if (!Array.isArray(normalized)) return sortObject(normalized);
  const uniqueByCanonical = new Map();
  for (const item of normalized) uniqueByCanonical.set(stableJson(sortObject(item)), sortObject(item));
  return [...uniqueByCanonical.values()]
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function mergeListedAndDetailedView(listedView, detailedView) {
  const listed = structuredClone(listedView ?? {});
  const detailed = structuredClone(detailedView ?? {});
  return {
    ...listed,
    ...detailed,
    viewId: detailed.viewId ?? listed.viewId ?? null,
    viewName: detailed.viewName ?? listed.viewName ?? null,
    viewType: detailed.viewType ?? listed.viewType ?? null,
    publicLevel: detailed.publicLevel ?? listed.publicLevel ?? null,
    property: {
      ...(listed.property && typeof listed.property === 'object' ? listed.property : {}),
      ...(detailed.property && typeof detailed.property === 'object' ? detailed.property : {}),
    },
  };
}

function findSinglePrimary(fields, tableName, mismatches) {
  const primaries = fields.filter((field) => field?.isPrimary === true);
  if (primaries.length !== 1) {
    mismatches.push(problem('CANONICAL_VERIFY_PRIMARY_INVALID', `Expected exactly one primary field: ${tableName}`, { count: primaries.length }));
    return null;
  }
  return primaries[0];
}

function indexRecordsByPrimary(records, fieldName, label, mismatches) {
  const result = new Map();
  for (const record of records) {
    const key = canonicalPrimaryValue(record?.fields?.[fieldName]);
    if (!key) {
      mismatches.push(problem('CANONICAL_VERIFY_PRIMARY_EMPTY', `${label} contains an empty primary value`, { fieldName }));
      continue;
    }
    if (result.has(key)) {
      mismatches.push(problem('CANONICAL_VERIFY_PRIMARY_DUPLICATE', `${label} contains duplicate primary value`, { fieldName, primaryValue: key }));
      continue;
    }
    result.set(key, record);
  }
  return result;
}

function canonicalPrimaryValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.text ?? item.name ?? '';
      return '';
    }).join('').trim();
  }
  if (value && typeof value === 'object') return String(value.text ?? value.name ?? '').trim();
  return '';
}

function extractRelationRecordIds(value) {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  for (const item of values) {
    if (typeof item === 'string' && item.trim()) result.push(item.trim());
    else if (item && typeof item === 'object') {
      const id = item.record_id ?? item.recordId ?? item.id;
      if (typeof id === 'string' && id.trim()) result.push(id.trim());
    }
  }
  return [...new Set(result)];
}

function uniqueTableIndex(tables, label, mismatches) {
  const result = new Map();
  for (const table of tables) {
    const name = normalizeOptionalText(table?.name);
    if (!name) {
      mismatches.push(problem('CANONICAL_VERIFY_TABLE_NAME_MISSING', `${label} Base contains a table without a name`));
      continue;
    }
    if (result.has(name)) {
      mismatches.push(problem('CANONICAL_VERIFY_TABLE_NAME_DUPLICATE', `${label} Base contains duplicate table name: ${name}`));
      continue;
    }
    result.set(name, table);
  }
  return result;
}

function uniqueFieldIndex(fields, tableName, mismatches) {
  const result = new Map();
  for (const field of fields) {
    const name = normalizeOptionalText(field?.fieldName);
    if (!name) {
      mismatches.push(problem('CANONICAL_VERIFY_FIELD_NAME_MISSING', `Target field without a name: ${tableName}`));
      continue;
    }
    if (result.has(name)) {
      mismatches.push(problem('CANONICAL_VERIFY_FIELD_NAME_DUPLICATE', `Duplicate Target field: ${tableName}.${name}`));
      continue;
    }
    result.set(name, field);
  }
  return result;
}

function uniqueViewIndex(views, tableName, mismatches) {
  const result = new Map();
  for (const view of views) {
    const name = normalizeOptionalText(view?.viewName);
    if (!name) {
      mismatches.push(problem('CANONICAL_VERIFY_VIEW_NAME_MISSING', `Target View without a name: ${tableName}`));
      continue;
    }
    if (result.has(name)) {
      mismatches.push(problem('CANONICAL_VERIFY_VIEW_NAME_DUPLICATE', `Duplicate Target View: ${tableName}.${name}`));
      continue;
    }
    result.set(name, view);
  }
  return result;
}

function sameKeySet(left, right) {
  if (left.size !== right.size) return false;
  for (const key of left.keys()) if (!right.has(key)) return false;
  return true;
}

function normalizePublicLevel(value) {
  if (value === 0 || value === '0') return 'Public';
  const normalized = normalizeOptionalText(value);
  if (normalized === null) return null;
  const lower = normalized.toLowerCase();
  if (lower === 'public') return 'Public';
  if (lower === 'locked') return 'Locked';
  if (lower === 'private') return 'Private';
  return normalized;
}

function normalizeDescription(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value?.text === 'string' ? value.text.trim() : '';
}

function normalizeOptionalNames(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expectedTableNames must be a non-empty array');
  const names = value.map((item) => requireText(item, 'expectedTableName'));
  if (new Set(names).size !== names.length) throw new TypeError('expectedTableNames must be unique');
  return names;
}

function requireReadClient(client, name) {
  for (const method of ['listTables', 'listFields', 'listRecords', 'listViews']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`${name} must implement ${method}()`);
  }
  return client;
}

function sumMapSizes(map) {
  let total = 0;
  for (const nested of map.values()) total += nested.size;
  return total;
}

function replaceAllLiteral(text, source, target) {
  return String(text).split(source).join(target);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function problem(code, message, details = {}) {
  return deepFreeze({ code, message, details: structuredClone(details) });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
