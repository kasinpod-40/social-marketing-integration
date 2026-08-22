const MANUAL_VIEW_FEATURES = Object.freeze([
  'fieldOrder',
  'sortInfo',
  'group',
  'colInfos',
  'rowHeightLevel',
  'frozenColCount',
]);

/**
 * Builds an ID-redacted manual UI parity manifest for View properties that are
 * represented in the approved export but do not have a proven OpenAPI write contract.
 *
 * This is local/read-only. Table/View/Field IDs are never emitted. Every exported
 * Field reference must resolve to a Field name in the same Source Table or the
 * manifest fails closed.
 */
export async function buildLarkBaseViewManualParityManifest(input) {
  const sourceClient = requireClient(input?.sourceClient);
  const tables = await sourceClient.listTables();
  const result = [];
  const featureCounts = Object.fromEntries(MANUAL_VIEW_FEATURES.map((feature) => [feature, 0]));

  for (const table of tables) {
    const tableId = requireText(table?.tableId, 'source tableId');
    const tableName = requireText(table?.name, `source table name ${tableId}`);
    const fields = await sourceClient.listFields({ tableId });
    const fieldNameById = uniqueFieldNameById(fields, tableName);
    const views = await sourceClient.listViews({ tableId });
    const tableViews = [];

    for (const view of views) {
      const viewName = requireText(view?.viewName, `view name ${tableName}`);
      const property = plainObject(view?.property) ? view.property : {};
      const manual = {};

      if (Array.isArray(property.fieldOrder) && property.fieldOrder.length > 0) {
        manual.fieldOrder = property.fieldOrder.map((fieldId) => resolveFieldName(fieldId, fieldNameById, tableName, viewName, 'fieldOrder'));
        featureCounts.fieldOrder += 1;
      }

      if (Array.isArray(property.sortInfo) && property.sortInfo.length > 0) {
        manual.sortInfo = sanitizeFieldReferencedValue(property.sortInfo, fieldNameById, tableName, viewName, 'sortInfo');
        featureCounts.sortInfo += 1;
      }

      if (Array.isArray(property.group) && property.group.length > 0) {
        manual.group = sanitizeFieldReferencedValue(property.group, fieldNameById, tableName, viewName, 'group');
        featureCounts.group += 1;
      }

      if (plainObject(property.colInfos) && Object.keys(property.colInfos).length > 0) {
        manual.colInfos = Object.fromEntries(Object.entries(property.colInfos)
          .map(([fieldId, info]) => [
            resolveFieldName(fieldId, fieldNameById, tableName, viewName, 'colInfos key'),
            sanitizeFieldReferencedValue(info, fieldNameById, tableName, viewName, 'colInfos'),
          ])
          .sort(([left], [right]) => left.localeCompare(right)));
        featureCounts.colInfos += 1;
      }

      if (property.rowHeightLevel !== null && property.rowHeightLevel !== undefined) {
        manual.rowHeightLevel = safePrimitive(property.rowHeightLevel, `${tableName}.${viewName}.rowHeightLevel`);
        featureCounts.rowHeightLevel += 1;
      }

      if (property.frozenColCount !== null && property.frozenColCount !== undefined) {
        manual.frozenColCount = safePrimitive(property.frozenColCount, `${tableName}.${viewName}.frozenColCount`);
        featureCounts.frozenColCount += 1;
      }

      if (Object.keys(manual).length > 0) {
        tableViews.push(Object.freeze({
          viewName,
          viewType: optionalText(view?.viewType) ?? 'grid',
          manual: deepFreeze(manual),
        }));
      }
    }

    if (tableViews.length > 0) {
      result.push(Object.freeze({
        tableName,
        views: Object.freeze(tableViews.sort((left, right) => left.viewName.localeCompare(right.viewName))),
      }));
    }
  }

  result.sort((left, right) => left.tableName.localeCompare(right.tableName));
  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_manifest_v1',
    mode: 'local-read-only-id-redacted',
    scope: 'clone-source-only',
    tables: result,
    summary: {
      tableCount: result.length,
      viewCount: result.reduce((sum, table) => sum + table.views.length, 0),
      featureCounts,
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

/**
 * Reduces a full manual manifest to the dimensions that are actually owned by
 * the post-Apply UI procedure. Hidden state is deliberately excluded because it
 * belongs to the automatic hidden-fields mutation + canonical verifier.
 *
 * Column width remains available to callers by default, but can be explicitly
 * excluded from a customer acceptance scope without weakening field-order parity.
 */
export function buildLarkBaseViewManualParityExecutionPlan(manifest, options = {}) {
  const source = requireManifest(manifest, 'manifest');
  const includeColumnWidths = options?.includeColumnWidths !== false;
  const counts = {
    fieldOrderViews: 0,
    sortViews: 0,
    groupViews: 0,
    columnWidthViews: 0,
    columnWidthAssignments: 0,
    rowHeightViews: 0,
    frozenColumnViews: 0,
  };
  let hiddenFieldViews = 0;
  let hiddenFieldAssignments = 0;
  const rowHeights = new Set();
  const frozenCounts = new Set();

  for (const table of source.tables) {
    for (const view of requireArray(table?.views, `${table?.tableName ?? 'table'} views`)) {
      const manual = plainObject(view?.manual) ? view.manual : {};
      if (Array.isArray(manual.fieldOrder) && manual.fieldOrder.length > 0) counts.fieldOrderViews += 1;
      if (Array.isArray(manual.sortInfo) && manual.sortInfo.length > 0) counts.sortViews += 1;
      if (Array.isArray(manual.group) && manual.group.length > 0) counts.groupViews += 1;
      const widths = explicitColumnWidths(manual.colInfos);
      if (Object.keys(widths).length > 0) {
        counts.columnWidthViews += 1;
        counts.columnWidthAssignments += Object.keys(widths).length;
      }
      const hidden = explicitHiddenFields(manual.colInfos);
      if (hidden.length > 0) {
        hiddenFieldViews += 1;
        hiddenFieldAssignments += hidden.length;
      }
      if (manual.rowHeightLevel !== null && manual.rowHeightLevel !== undefined) {
        counts.rowHeightViews += 1;
        rowHeights.add(manual.rowHeightLevel);
      }
      if (manual.frozenColCount !== null && manual.frozenColCount !== undefined) {
        counts.frozenColumnViews += 1;
        frozenCounts.add(manual.frozenColCount);
      }
    }
  }

  const manualOwned = includeColumnWidths
    ? counts
    : {
        fieldOrderViews: counts.fieldOrderViews,
        sortViews: counts.sortViews,
        groupViews: counts.groupViews,
        rowHeightViews: counts.rowHeightViews,
        frozenColumnViews: counts.frozenColumnViews,
      };

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_execution_plan_v1',
    mode: 'local-read-only-id-redacted',
    manualOwned,
    scopeExcluded: includeColumnWidths
      ? null
      : {
          columnWidthViews: counts.columnWidthViews,
          columnWidthAssignments: counts.columnWidthAssignments,
          reason: 'column width is excluded from this acceptance scope',
        },
    automaticExcluded: {
      hiddenFieldViews,
      hiddenFieldAssignments,
      reason: 'hidden fields are owned by the automatic View hidden-fields mutation and canonical verifier',
    },
    commonValues: {
      rowHeightLevel: singletonOrNull(rowHeights),
      frozenColCount: singletonOrNull(frozenCounts),
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

/**
 * Local manifest-to-manifest verification for the UI-only dimensions. It ignores
 * unrelated Target tables and does not compare hidden/default colInfo metadata.
 * Explicit non-null widths are compared by default and can be excluded by passing
 * includeColumnWidths: false. Field order remains blocking regardless.
 */
export function verifyLarkBaseViewManualParityManifests(input) {
  const source = requireManifest(input?.sourceManifest, 'sourceManifest');
  const target = requireManifest(input?.targetManifest, 'targetManifest');
  const includeColumnWidths = input?.includeColumnWidths !== false;
  const targetTables = uniqueNamedIndex(target.tables, 'target table', (item) => item?.tableName);
  const mismatches = [];
  let comparedViews = 0;

  for (const sourceTable of source.tables) {
    const tableName = requireText(sourceTable?.tableName, 'source tableName');
    const targetTable = targetTables.get(tableName);
    if (!targetTable) {
      mismatches.push(problem('VIEW_MANUAL_PARITY_TABLE_MISSING', `Target manifest is missing clone Table: ${tableName}`, { tableName }));
      continue;
    }
    const targetViews = uniqueNamedIndex(targetTable.views, `target View in ${tableName}`, (item) => item?.viewName);
    for (const sourceView of requireArray(sourceTable?.views, `${tableName} source views`)) {
      const viewName = requireText(sourceView?.viewName, `${tableName} source viewName`);
      const targetView = targetViews.get(viewName);
      if (!targetView) {
        mismatches.push(problem('VIEW_MANUAL_PARITY_VIEW_MISSING', `Target manifest is missing clone View: ${tableName}.${viewName}`, { tableName, viewName }));
        continue;
      }
      comparedViews += 1;
      const sourceState = manualOwnedState(sourceView?.manual, { includeColumnWidths });
      const targetState = manualOwnedState(targetView?.manual, { includeColumnWidths });
      for (const dimension of Object.keys(sourceState)) {
        if (stableJson(sourceState[dimension]) === stableJson(targetState[dimension])) continue;
        mismatches.push(problem(
          `VIEW_MANUAL_PARITY_${camelToUpperSnake(dimension)}_MISMATCH`,
          `Manual View parity mismatch: ${tableName}.${viewName}.${dimension}`,
          { tableName, viewName, dimension, expected: sourceState[dimension], actual: targetState[dimension] },
        ));
      }
    }
  }

  return deepFreeze({
    ok: mismatches.length === 0,
    contractVersion: 'customer_base_view_manual_parity_verifier_v1',
    mode: 'local-read-only-id-redacted',
    acceptanceScope: {
      fieldOrder: 'blocking',
      columnWidth: includeColumnWidths ? 'blocking' : 'excluded',
    },
    summary: {
      expectedTables: source.tables.length,
      expectedViews: source.tables.reduce((sum, table) => sum + requireArray(table?.views, 'source views').length, 0),
      comparedViews,
      mismatches: mismatches.length,
      fieldOrderMismatches: mismatches.filter((item) => item.code === 'VIEW_MANUAL_PARITY_FIELD_ORDER_MISMATCH').length,
    },
    executionPlan: buildLarkBaseViewManualParityExecutionPlan(source, { includeColumnWidths }),
    mismatches: Object.freeze(mismatches),
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function manualOwnedState(value, options = {}) {
  const manual = plainObject(value) ? value : {};
  const includeColumnWidths = options?.includeColumnWidths !== false;
  const state = {
    fieldOrder: Array.isArray(manual.fieldOrder) ? structuredClone(manual.fieldOrder) : [],
    sortInfo: Array.isArray(manual.sortInfo) ? structuredClone(manual.sortInfo) : [],
    group: Array.isArray(manual.group) ? structuredClone(manual.group) : [],
    rowHeightLevel: manual.rowHeightLevel ?? null,
    frozenColCount: manual.frozenColCount ?? null,
  };
  if (includeColumnWidths) state.columnWidths = explicitColumnWidths(manual.colInfos);
  return deepFreeze(state);
}

function explicitColumnWidths(value) {
  if (!plainObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, info]) => plainObject(info) && info.width !== null && info.width !== undefined)
    .map(([fieldName, info]) => [requireText(fieldName, 'column width field name'), safePrimitive(info.width, `column width ${fieldName}`)])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function explicitHiddenFields(value) {
  if (!plainObject(value)) return [];
  return Object.entries(value)
    .filter(([, info]) => plainObject(info) && info.hidden === true)
    .map(([fieldName]) => requireText(fieldName, 'hidden field name'))
    .sort();
}

function singletonOrNull(values) {
  return values.size === 1 ? [...values][0] : null;
}

function uniqueNamedIndex(items, label, getName) {
  const result = new Map();
  for (const item of requireArray(items, `${label}s`)) {
    const name = requireText(getName(item), `${label} name`);
    if (result.has(name)) throw new TypeError(`duplicate ${label} name: ${name}`);
    result.set(name, item);
  }
  return result;
}

function requireManifest(value, name) {
  if (!plainObject(value)) throw new TypeError(`${name} must be an object`);
  if (value.contractVersion !== 'customer_base_view_manual_parity_manifest_v1') {
    throw new TypeError(`${name} must use customer_base_view_manual_parity_manifest_v1`);
  }
  requireArray(value.tables, `${name}.tables`);
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function camelToUpperSnake(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase();
}

function problem(code, message, details = {}) {
  return deepFreeze({ code, message, details: structuredClone(details) });
}

function sanitizeFieldReferencedValue(value, fieldNameById, tableName, viewName, path) {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeFieldReferencedValue(item, fieldNameById, tableName, viewName, `${path}[${index}]`));
  }
  if (plainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
      const safeKey = fieldNameById.has(key) ? fieldNameById.get(key) : rejectRawFieldIdKey(key, tableName, viewName, path);
      return [safeKey, sanitizeFieldReferencedValue(nested, fieldNameById, tableName, viewName, `${path}.${safeKey}`)];
    }));
  }
  if (typeof value === 'string') {
    if (fieldNameById.has(value)) return fieldNameById.get(value);
    if (looksLikeFieldId(value)) {
      throw codedError('CUSTOMER_BASE_VIEW_MANIFEST_FIELD_UNMAPPED', `View layout references an unknown Field ID: ${tableName}.${viewName}`, { tableName, viewName, path });
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  throw codedError('CUSTOMER_BASE_VIEW_MANIFEST_VALUE_UNSUPPORTED', `Unsupported View layout value: ${tableName}.${viewName}`, { tableName, viewName, path, type: typeof value });
}

function rejectRawFieldIdKey(key, tableName, viewName, path) {
  if (looksLikeFieldId(key)) {
    throw codedError('CUSTOMER_BASE_VIEW_MANIFEST_FIELD_UNMAPPED', `View layout contains an unknown Field-ID key: ${tableName}.${viewName}`, { tableName, viewName, path });
  }
  return key;
}

function resolveFieldName(value, fieldNameById, tableName, viewName, path) {
  const fieldId = requireText(value, `${tableName}.${viewName}.${path}`);
  const fieldName = fieldNameById.get(fieldId);
  if (!fieldName) {
    throw codedError('CUSTOMER_BASE_VIEW_MANIFEST_FIELD_UNMAPPED', `View layout references a Field outside the current Source Table: ${tableName}.${viewName}`, { tableName, viewName, path });
  }
  return fieldName;
}

function uniqueFieldNameById(fields, tableName) {
  const result = new Map();
  const names = new Set();
  for (const field of requireArray(fields, `${tableName} fields`)) {
    const fieldId = requireText(field?.fieldId, `${tableName} fieldId`);
    const fieldName = requireText(field?.fieldName, `${tableName} fieldName`);
    if (result.has(fieldId)) throw new TypeError(`duplicate Source fieldId in ${tableName}`);
    if (names.has(fieldName)) throw new TypeError(`duplicate Source field name in ${tableName}: ${fieldName}`);
    result.set(fieldId, fieldName);
    names.add(fieldName);
  }
  return result;
}

function safePrimitive(value, name) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim() !== '' && !looksLikeFieldId(value)) return value;
  throw new TypeError(`${name} must be a safe primitive`);
}

function looksLikeFieldId(value) {
  return /^fld[A-Za-z0-9_-]+$/u.test(String(value));
}

function requireClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
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

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
