const MANUAL_DYNAMIC_DATE_TOKENS = new Set(['TheLastMonth']);
const OWNERSHIP = 'ui-manual-unsupported-view-dynamic-date-token';
const CANONICAL_READ_METHODS = Object.freeze([
  'listTables',
  'listFields',
  'listRecords',
  'listViews',
  'getView',
]);

/**
 * Project only View filters that have a documented automatic write contract.
 * The underlying Source client remains immutable and authoritative. A View containing
 * an unsupported dynamic Date token is projected with its entire filter removed so
 * automatic Apply can never persist only a subset of the Source predicate.
 */
export function projectLarkBaseSourceForAutomaticViewFilterParity(sourceClient) {
  if (!sourceClient || typeof sourceClient !== 'object') {
    throw new TypeError('sourceClient must be an object');
  }
  if (typeof sourceClient.getView !== 'function') {
    return Object.freeze({
      client: sourceClient,
      getRequirements: () => Object.freeze([]),
    });
  }

  const tableNameById = new Map();
  const requirementsByKey = new Map();
  const client = bindClientSurface(sourceClient);

  client.listTables = async (...args) => {
    const tables = await sourceClient.listTables(...args);
    for (const table of tables ?? []) {
      if (text(table?.tableId) && text(table?.name)) tableNameById.set(text(table.tableId), text(table.name));
    }
    return tables;
  };

  client.getView = async (request) => {
    const view = structuredClone(await sourceClient.getView(request));
    const classification = classifyLarkBaseViewFilterParity(view?.property?.filterInfo);
    if (classification.ownership !== OWNERSHIP) return view;

    const tableId = text(request?.tableId);
    const viewId = text(request?.viewId ?? view?.viewId);
    const viewName = text(view?.viewName) ?? '(unnamed View)';
    const requirement = Object.freeze({
      ownership: OWNERSHIP,
      tableName: tableNameById.get(tableId) ?? null,
      viewName,
      conditionCount: classification.conditionCount,
      dynamicDateTokenCount: classification.dynamicDateTokenCount,
      dynamicDateTokens: Object.freeze([...classification.dynamicDateTokens]),
    });
    requirementsByKey.set(`${tableId ?? ''}\u0000${viewId ?? viewName}`, requirement);

    const propertyValue = view?.property && typeof view.property === 'object' && !Array.isArray(view.property)
      ? structuredClone(view.property)
      : {};
    propertyValue.filterInfo = null;
    view.property = propertyValue;
    return view;
  };

  return Object.freeze({
    client: Object.freeze(client),
    getRequirements: () => Object.freeze([...requirementsByKey.values()]),
  });
}

export function classifyLarkBaseViewFilterParity(filterInfo) {
  const conditions = Array.isArray(filterInfo?.conditions) ? filterInfo.conditions : [];
  const tokens = [];
  for (const condition of conditions) {
    if (Number(condition?.fieldType ?? condition?.field_type) !== 5) continue;
    for (const value of decodeValues(condition?.value)) {
      if (typeof value === 'string' && MANUAL_DYNAMIC_DATE_TOKENS.has(value.trim())) tokens.push(value.trim());
    }
  }
  const uniqueTokens = [...new Set(tokens)];
  return Object.freeze({
    ownership: uniqueTokens.length > 0 ? OWNERSHIP : 'automatic',
    conditionCount: conditions.length,
    dynamicDateTokenCount: tokens.length,
    dynamicDateTokens: Object.freeze(uniqueTokens),
  });
}

export const LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP = OWNERSHIP;

function bindClientSurface(sourceClient) {
  const client = {};
  for (const key of CANONICAL_READ_METHODS) {
    const method = sourceClient[key];
    if (typeof method !== 'function') continue;
    client[key] = (...args) => method.apply(sourceClient, args);
  }
  return client;
}

function decodeValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [value];
  const source = value.trim();
  if (!source) return [];
  try {
    const decoded = JSON.parse(source);
    return Array.isArray(decoded) ? decoded : [decoded];
  } catch {
    return [source];
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
