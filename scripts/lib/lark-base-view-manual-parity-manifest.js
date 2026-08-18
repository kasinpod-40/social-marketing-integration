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
