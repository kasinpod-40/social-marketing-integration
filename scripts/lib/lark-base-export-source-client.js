import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const REQUIRED_PAYLOAD_KEYS = Object.freeze([
  'gzipSnapshot',
  'gzipExtraInfo',
  'gzipBaseRole',
  'gzipAccessConfig',
  'gzipDashboard',
  'gzipAutomation',
]);
const SUPPORTED_FIELD_TYPES = new Set([1, 2, 3, 4, 5, 7, 15, 18, 20]);
const MAX_EXPANDED_STRING_BYTES = 256 * 1024 * 1024;

/**
 * Exposes the canonical local `.base` export through the read methods consumed by
 * `consolidate-lark-base.js`. This is a local source adapter, not another Lark
 * transport: it performs zero remote requests and exposes no mutation methods.
 */
export async function createLarkBaseExportSourceClient(filePath) {
  const model = await loadCanonicalExportModel(filePath);

  return Object.freeze({
    sourceKind: 'local-lark-base-export',
    appToken: 'LOCAL_EXPORT_SOURCE',
    async listTables() {
      return model.tableOrder.map((tableId) => structuredClone(model.tables.get(tableId).table));
    },
    async listFields(input) {
      const table = requireTable(model, input?.tableId);
      return table.fieldOrder.map((fieldId) => structuredClone(table.fields.get(fieldId)));
    },
    async listRecords(input) {
      const table = requireTable(model, input?.tableId);
      return table.recordOrder.map((recordId) => structuredClone(table.records.get(recordId)));
    },
    async listViews(input) {
      const table = requireTable(model, input?.tableId);
      return table.viewOrder.map((viewId) => structuredClone(table.views.get(viewId)));
    },
    async getView(input) {
      const table = requireTable(model, input?.tableId);
      const viewId = requireText(input?.viewId, 'viewId');
      const view = table.views.get(viewId);
      if (!view) throw codedError('LARK_BASE_EXPORT_VIEW_MISSING', `Export view not found: ${viewId}`, { tableId: table.table.tableId, viewId });
      return structuredClone(view);
    },
    getExportResources() {
      return structuredClone(model.resources);
    },
    getExportDiagnostics() {
      return structuredClone(model.diagnostics);
    },
  });
}

export async function inspectLarkBaseExportSourceModel(filePath) {
  const model = await loadCanonicalExportModel(filePath);
  return deepFreeze({
    ok: true,
    contractVersion: 'lark_base_export_source_model_v1',
    mode: 'local-read-only',
    tables: model.tableOrder.length,
    fields: sumTables(model, (table) => table.fields.size),
    records: sumTables(model, (table) => table.records.size),
    views: sumTables(model, (table) => table.views.size),
    diagnostics: model.diagnostics,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

async function loadCanonicalExportModel(filePath) {
  const path = requireText(filePath, 'filePath');
  const envelope = parseJson(await readFile(path), 'root .base JSON');
  const payloads = decodeEnvelope(envelope);
  const snapshots = requireArray(payloads.gzipSnapshot, 'gzipSnapshot');

  const tableNames = new Map();
  const tables = new Map();
  const tableOrder = [];
  const duplicateSnapshotTableIds = new Set();
  const unsupportedFieldTypes = new Set();
  const rawViewFeatureCounts = {
    filtered: 0,
    sorted: 0,
    grouped: 0,
    hiddenFields: 0,
    hierarchy: 0,
    cardSetting: 0,
  };
  const countedViewFeatureIds = new Set();

  for (const [snapshotIndex, entry] of snapshots.entries()) {
    const schema = requireObject(entry?.schema, `gzipSnapshot[${snapshotIndex}].schema`);
    for (const [tableId, tableMeta] of Object.entries(requireObject(schema?.tableMap, `gzipSnapshot[${snapshotIndex}].schema.tableMap`))) {
      mergeStableValue(tableNames, tableId, optionalText(tableMeta?.name), 'table name');
    }

    const data = requireObject(schema?.data, `gzipSnapshot[${snapshotIndex}].schema.data`);
    const tableData = requireObject(data?.table, `gzipSnapshot[${snapshotIndex}].schema.data.table`);
    const tableId = requireText(tableData?.meta?.id, `gzipSnapshot[${snapshotIndex}].schema.data.table.meta.id`);
    const tableName = requireText(tableNames.get(tableId), `tableMap name for ${tableId}`);

    let table = tables.get(tableId);
    if (!table) {
      table = {
        table: Object.freeze({ tableId, name: tableName, revision: finiteNumberOrNull(tableData?.meta?.rev) }),
        primaryFieldId: optionalText(tableData?.primaryKey),
        fields: new Map(),
        fieldOrder: [],
        records: new Map(),
        recordOrder: [],
        views: new Map(),
        viewOrder: [],
      };
      tables.set(tableId, table);
      tableOrder.push(tableId);
    } else {
      duplicateSnapshotTableIds.add(tableId);
      if (table.table.name !== tableName) {
        throw codedError('LARK_BASE_EXPORT_TABLE_NAME_CONFLICT', `Duplicate snapshot changed table name for ${tableId}`);
      }
      const primary = optionalText(tableData?.primaryKey);
      if (primary && table.primaryFieldId && primary !== table.primaryFieldId) {
        throw codedError('LARK_BASE_EXPORT_PRIMARY_FIELD_CONFLICT', `Duplicate snapshot changed primary field for ${tableId}`);
      }
      if (!table.primaryFieldId && primary) table.primaryFieldId = primary;
    }

    const fieldMap = requireObject(tableData?.fieldMap ?? {}, `fieldMap ${tableId}`);
    for (const [fieldId, rawField] of Object.entries(fieldMap)) {
      const type = Number(rawField?.type);
      if (!SUPPORTED_FIELD_TYPES.has(type)) unsupportedFieldTypes.add(type);
      const normalized = normalizeField({ fieldId, rawField, primaryFieldId: table.primaryFieldId });
      mergeEntity(table.fields, table.fieldOrder, fieldId, normalized, `field ${tableId}.${fieldId}`);
    }

    const viewMap = requireObject(tableData?.viewMap ?? {}, `viewMap ${tableId}`);
    const preferredViewOrder = Array.isArray(tableData?.views) ? tableData.views : Object.keys(viewMap);
    for (const [viewId, rawView] of Object.entries(viewMap)) {
      const normalized = normalizeView({ viewId, rawView });
      mergeEntity(table.views, table.viewOrder, viewId, normalized, `view ${tableId}.${viewId}`, false);
    }
    table.viewOrder = stableOrderedIds(preferredViewOrder, table.views.keys());

    for (const [viewId, rawView] of Object.entries(viewMap)) {
      const featureIdentity = `${tableId}:${viewId}`;
      if (countedViewFeatureIds.has(featureIdentity)) continue;
      countedViewFeatureIds.add(featureIdentity);
      const property = rawView?.property ?? {};
      if (property?.filterInfo) rawViewFeatureCounts.filtered += 1;
      if (Array.isArray(property?.sortInfo) && property.sortInfo.length > 0) rawViewFeatureCounts.sorted += 1;
      if (Array.isArray(property?.group) && property.group.length > 0) rawViewFeatureCounts.grouped += 1;
      if (Object.values(property?.colInfos ?? {}).some((item) => item?.hidden === true)) rawViewFeatureCounts.hiddenFields += 1;
      if (property?.hierarchyConfig) rawViewFeatureCounts.hierarchy += 1;
      if (property?.cardViewSetting) rawViewFeatureCounts.cardSetting += 1;
    }

    const recordMap = data?.recordMap == null ? {} : requireObject(data.recordMap, `recordMap ${tableId}`);
    for (const [recordId, rawRecord] of Object.entries(recordMap)) {
      const normalized = normalizeRecord({ recordId, rawRecord, table });
      mergeEntity(table.records, table.recordOrder, recordId, normalized, `record ${tableId}.${recordId}`);
    }
  }

  if (unsupportedFieldTypes.size > 0) {
    throw codedError(
      'LARK_BASE_EXPORT_FIELD_TYPE_UNSUPPORTED',
      'Export contains field types not covered by the local source adapter',
      { fieldTypes: [...unsupportedFieldTypes].sort((a, b) => a - b) },
    );
  }

  for (const table of tables.values()) {
    if (!table.primaryFieldId || !table.fields.has(table.primaryFieldId)) {
      throw codedError('LARK_BASE_EXPORT_PRIMARY_FIELD_MISSING', `Export table has no valid primary field: ${table.table.name}`);
    }
  }

  const resources = Object.freeze({
    extraInfo: structuredClone(payloads.gzipExtraInfo),
    accessConfig: structuredClone(payloads.gzipAccessConfig),
    dashboards: structuredClone(payloads.gzipDashboard),
    workflows: structuredClone(payloads.gzipAutomation),
    roles: structuredClone(payloads.gzipBaseRole),
  });

  return {
    path,
    tables,
    tableOrder,
    resources,
    diagnostics: deepFreeze({
      duplicateSnapshotTableIds: Object.freeze([...duplicateSnapshotTableIds].sort()),
      rawViewFeatureCounts: Object.freeze(rawViewFeatureCounts),
      fieldTypes: Object.freeze(collectFieldTypeCounts(tables)),
      sourceRecordValueMode: 'normalized-to-openapi-write-values',
    }),
  };
}

function normalizeField(input) {
  const raw = requireObject(input.rawField, `field ${input.fieldId}`);
  const type = Number(raw.type);
  const property = normalizeFieldProperty(type, raw.property);
  return deepFreeze({
    fieldId: input.fieldId,
    fieldName: requireText(raw?.name, `field name ${input.fieldId}`),
    type,
    uiType: optionalText(raw?.fieldUIType),
    description: normalizeDescription(raw?.description),
    isPrimary: raw?.isPrimary === true || input.primaryFieldId === input.fieldId,
    property,
    exportProperty: raw?.property ? structuredClone(raw.property) : null,
    exportAllowedEditModes: raw?.allowedEditModes ? structuredClone(raw.allowedEditModes) : null,
    exportExInfo: raw?.exInfo ? structuredClone(raw.exInfo) : null,
  });
}

function normalizeFieldProperty(type, rawProperty) {
  if (!rawProperty || typeof rawProperty !== 'object' || Array.isArray(rawProperty)) return null;
  const raw = structuredClone(rawProperty);
  const result = {};

  if (Array.isArray(raw.options)) result.options = raw.options.map((option) => ({
    name: requireText(option?.name, 'select option.name'),
    ...(Number.isInteger(Number(option?.color)) ? { color: Number(option.color) } : {}),
    ...(optionalText(option?.id) ? { id: optionalText(option.id) } : {}),
  }));
  if (raw.formatter !== undefined) result.formatter = normalizeFormatter(raw.formatter);
  if (raw.dateFormat !== undefined) result.date_formatter = raw.dateFormat;
  if (raw.autoFill !== undefined) result.auto_fill = raw.autoFill === true;
  if (raw.multiple !== undefined) result.multiple = raw.multiple === true;
  if (raw.tableId !== undefined) result.table_id = raw.tableId;
  if (raw.tableName !== undefined) result.table_name = raw.tableName;
  if (raw.backFieldName !== undefined) result.back_field_name = raw.backFieldName;
  if (raw.formula !== undefined) result.formula_expression = raw.formula;
  if (raw.formulaExpression !== undefined) result.formula_expression = raw.formulaExpression;
  if (raw.currencyCode !== undefined) result.currency_code = raw.currencyCode;
  if (raw.type !== undefined) result.type = structuredClone(raw.type);

  // Propertyless OpenAPI field types must not receive UI-internal properties.
  if (new Set([1, 7, 13, 15, 17, 19]).has(type)) return null;
  return Object.keys(result).length > 0 ? deepFreeze(result) : null;
}

function normalizeRecord(input) {
  const fields = {};
  const rawRecord = input.rawRecord == null ? {} : requireObject(input.rawRecord, `record ${input.recordId}`);
  for (const [fieldId, rawCell] of Object.entries(rawRecord)) {
    const field = input.table.fields.get(fieldId);
    if (!field) continue;
    fields[field.fieldName] = normalizeCellValue(rawCell, field);
  }
  return deepFreeze({
    recordId: input.recordId,
    fields,
    createdTime: null,
    lastModifiedTime: null,
    lastModifiedBy: null,
  });
}

function normalizeCellValue(rawCell, field) {
  if (rawCell === null || rawCell === undefined) return null;
  const cell = requireObject(rawCell, `cell ${field.fieldName}`);
  const value = cell.value;
  switch (Number(field.type)) {
    case 1:
      return normalizeTextSegments(value);
    case 2:
    case 5:
    case 7:
      return value ?? null;
    case 3:
      return selectOptionName(field, value);
    case 4:
      return Array.isArray(value) ? value.map((optionId) => selectOptionName(field, optionId)) : [];
    case 15:
      return normalizeUrlValue(value);
    case 18:
      return normalizeRelationValue(value);
    case 20:
      return value ?? null;
    default:
      throw codedError('LARK_BASE_EXPORT_CELL_TYPE_UNSUPPORTED', `Unsupported exported cell type ${field.type}`);
  }
}

function normalizeTextSegments(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw codedError('LARK_BASE_EXPORT_TEXT_CELL_INVALID', 'Export Text cell must be an array of text segments');
  return value.map((segment) => {
    if (segment?.type !== 'text' || typeof segment?.text !== 'string') {
      throw codedError('LARK_BASE_EXPORT_RICH_TEXT_UNSUPPORTED', 'Export contains non-text rich-text segments that require explicit migration support');
    }
    return segment.text;
  }).join('');
}

function selectOptionName(field, optionId) {
  if (optionId === null || optionId === undefined || optionId === '') return null;
  const options = Array.isArray(field.exportProperty?.options) ? field.exportProperty.options : [];
  const match = options.find((option) => option?.id === optionId);
  if (!match) {
    throw codedError('LARK_BASE_EXPORT_SELECT_OPTION_UNMAPPED', `Select option ID is not defined for ${field.fieldName}`, {
      fieldId: field.fieldId,
      optionId,
    });
  }
  return requireText(match.name, `select option name ${optionId}`);
}

function normalizeUrlValue(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length !== 1) throw codedError('LARK_BASE_EXPORT_URL_MULTI_VALUE_UNSUPPORTED', 'URL field contains multiple values');
  const item = requireObject(value[0], 'URL cell item');
  return {
    link: requireText(item.link, 'URL cell link'),
    text: optionalText(item.text) ?? requireText(item.link, 'URL cell link'),
  };
}

function normalizeRelationValue(value) {
  if (value === null || value === undefined) return null;
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return requireText(item.recordId ?? item.record_id ?? item.id, 'relation record id');
    throw codedError('LARK_BASE_EXPORT_RELATION_CELL_INVALID', 'Relation cell contains an unsupported value');
  });
}

function normalizeView(input) {
  const raw = requireObject(input.rawView, `view ${input.viewId}`);
  if (Number(raw?.type) !== 1) {
    throw codedError('LARK_BASE_EXPORT_VIEW_TYPE_UNSUPPORTED', `Export view type ${raw?.type} is not mapped`, { viewId: input.viewId });
  }
  const property = raw?.property && typeof raw.property === 'object' ? raw.property : {};
  const colInfos = property?.colInfos && typeof property.colInfos === 'object' ? property.colInfos : {};
  const hiddenFields = Object.entries(colInfos)
    .filter(([, info]) => info?.hidden === true)
    .map(([fieldId]) => fieldId)
    .sort();
  const filterInfo = normalizeFilterInfo(property?.filterInfo);
  return deepFreeze({
    viewId: input.viewId,
    viewName: requireText(raw?.name, `view name ${input.viewId}`),
    viewType: 'grid',
    publicLevel: raw?.publicLevel ?? null,
    property: {
      hiddenFields,
      filterInfo,
      fieldOrder: Array.isArray(property?.fields) ? [...property.fields] : [],
      sortInfo: Array.isArray(property?.sortInfo) ? structuredClone(property.sortInfo) : [],
      group: Array.isArray(property?.group) ? structuredClone(property.group) : [],
      colInfos: structuredClone(colInfos),
      rowHeightLevel: property?.rowHeightLevel ?? null,
      frozenColCount: property?.frozenColCount ?? null,
      cardViewSetting: structuredClone(property?.cardViewSetting ?? null),
      hierarchyConfig: structuredClone(property?.hierarchyConfig ?? null),
      colorInfo: structuredClone(property?.colorInfo ?? null),
    },
    exportBizType: raw?.bizType ?? null,
    exportIsPrivate: raw?.isPrivate === true,
  });
}

function normalizeFilterInfo(value) {
  if (!value) return null;
  const source = requireObject(value, 'view.filterInfo');
  return deepFreeze({
    conjunction: source?.conjunction === 'or' ? 'or' : 'and',
    conditions: (Array.isArray(source?.conditions) ? source.conditions : []).map((condition) => ({
      fieldId: requireText(condition?.fieldId, 'view filter fieldId'),
      fieldType: Number(condition?.fieldType),
      operator: requireText(condition?.operator, 'view filter operator'),
      value: condition?.value === undefined ? null : structuredClone(condition.value),
    })),
  });
}

function normalizeDescription(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (!Array.isArray(value.content)) return '';
  return value.content.map((item) => typeof item?.text === 'string' ? item.text : '').join('').trim();
}

function normalizeFormatter(value) {
  if (typeof value !== 'string') return value;
  const aliases = { '#,##0': '1,000', '#,##0.00': '1,000.00', '#,##0.0000': '0.0000' };
  return aliases[value.trim()] ?? value.trim();
}

function decodeEnvelope(envelope) {
  const source = requireObject(envelope, 'root .base JSON');
  const missing = REQUIRED_PAYLOAD_KEYS.filter((key) => typeof source[key] !== 'string' || source[key].trim() === '');
  if (missing.length > 0) throw codedError('LARK_BASE_EXPORT_PAYLOAD_MISSING', `Required .base payloads are missing: ${missing.join(', ')}`, { missing });
  return Object.fromEntries(REQUIRED_PAYLOAD_KEYS.map((key) => [key, decodeGzip(source[key], key)]));
}

function decodeGzip(value, label) {
  try {
    const inflated = gunzipSync(Buffer.from(value.trim(), 'base64'), { maxOutputLength: MAX_EXPANDED_STRING_BYTES });
    return parseJson(inflated, label);
  } catch (error) {
    if (error?.code?.startsWith?.('LARK_BASE_EXPORT_')) throw error;
    throw codedError('LARK_BASE_EXPORT_GZIP_PAYLOAD_INVALID', `${label} is not valid gzip/base64 JSON`, { cause: error?.message ?? String(error) });
  }
}

function parseJson(bytes, label) {
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/u, '').trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw codedError('LARK_BASE_EXPORT_INVALID_JSON', `${label} is not valid JSON`, { cause: error?.message ?? String(error) });
  }
}

function mergeEntity(map, order, id, value, label, appendOrder = true) {
  const existing = map.get(id);
  if (!existing) {
    map.set(id, value);
    if (appendOrder) order.push(id);
    return;
  }
  if (stableJson(existing) !== stableJson(value)) {
    const differencePaths = collectDifferencePaths(existing, value);
    throw codedError(
      'LARK_BASE_EXPORT_DUPLICATE_ENTITY_CONFLICT',
      `Duplicate export entity differs: ${label}`,
      { differenceCount: differencePaths.length, differencePaths: differencePaths.slice(0, 24) },
    );
  }
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
    for (let index = 0; index < length; index += 1) {
      collectDifferencePaths(left[index], right[index], `${path}[${index}]`, result);
    }
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
      if (!(key in left) || !(key in right)) {
        result.push(`${path}.${key}`);
        continue;
      }
      collectDifferencePaths(left[key], right[key], `${path}.${key}`, result);
    }
    return result;
  }
  result.push(path);
  return result;
}

function mergeStableValue(map, id, value, label) {
  if (!map.has(id)) {
    map.set(id, value);
    return;
  }
  if (map.get(id) !== value) throw codedError('LARK_BASE_EXPORT_DUPLICATE_ENTITY_CONFLICT', `Duplicate ${label} differs: ${id}`);
}

function stableOrderedIds(preferred, availableIterator) {
  const available = new Set(availableIterator);
  const result = [];
  for (const id of preferred) if (available.delete(id)) result.push(id);
  for (const id of available) result.push(id);
  return result;
}

function collectFieldTypeCounts(tables) {
  const counts = {};
  for (const table of tables.values()) {
    for (const field of table.fields.values()) counts[field.type] = (counts[field.type] ?? 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right))));
}

function sumTables(model, getter) {
  let total = 0;
  for (const table of model.tables.values()) total += getter(table);
  return total;
}

function requireTable(model, tableIdValue) {
  const tableId = requireText(tableIdValue, 'tableId');
  const table = model.tables.get(tableId);
  if (!table) throw codedError('LARK_BASE_EXPORT_TABLE_MISSING', `Export table not found: ${tableId}`);
  return table;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} is required`, { name });
  return value.trim();
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} must be an array`, { name });
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} must be an object`, { name });
  return value;
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
