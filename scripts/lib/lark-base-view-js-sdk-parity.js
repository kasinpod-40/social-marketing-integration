const CONTRACT_VERSION = 'customer_base_view_js_sdk_parity_plan_v1';
const MANIFEST_VERSION = 'customer_base_view_manual_parity_manifest_v1';
const DEFAULT_SOURCE_STRUCTURAL_COUNTS = Object.freeze({
  tables: 33,
  fields: 723,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
  advancedPermissionRoles: 4,
});
const DEFAULT_SOURCE_MIN_RECORDS = 35_528;

/**
 * Converts the retained names-only View manifest into a Base JS SDK execution plan.
 *
 * Server OpenAPI remains the authority for hidden/filter/hierarchy parity. This plan
 * owns only documented Base frontend-plugin mutations that were previously UI-only:
 * sort, group, explicit column width, and row height. Field order and frozen columns
 * remain audit/manual because the Base JS SDK exposes no documented reorder/freeze
 * setter. No generated Table/View/Field IDs are persisted in this plan.
 */
export function buildLarkBaseViewJsSdkParityPlan(manifest) {
  const source = requireManifest(manifest);
  const tables = [];
  const summary = {
    tableCount: 0,
    viewCount: 0,
    fieldOrderAuditViews: 0,
    hiddenVerificationViews: 0,
    hiddenVerificationAssignments: 0,
    sortViews: 0,
    groupViews: 0,
    columnWidthViews: 0,
    columnWidthAssignments: 0,
    rowHeightViews: 0,
    frozenColumnManualViews: 0,
  };

  for (const table of source.tables) {
    const tableName = requireText(table?.tableName, 'tableName');
    const views = [];

    for (const view of requireArray(table?.views, `${tableName}.views`)) {
      const viewName = requireText(view?.viewName, `${tableName}.viewName`);
      const manual = plainObject(view?.manual) ? view.manual : {};
      const fieldOrder = normalizeNameList(manual.fieldOrder, `${tableName}.${viewName}.fieldOrder`);
      const hiddenFieldNames = explicitHiddenFields(manual.colInfos);
      const sort = normalizeDirectionalRules(manual.sortInfo, `${tableName}.${viewName}.sortInfo`);
      const group = normalizeDirectionalRules(manual.group, `${tableName}.${viewName}.group`);
      const columnWidths = explicitColumnWidths(manual.colInfos, `${tableName}.${viewName}.colInfos`);
      const rowHeightLevel = normalizeRowHeight(manual.rowHeightLevel, `${tableName}.${viewName}.rowHeightLevel`);
      const frozenColCount = normalizeFrozenCount(manual.frozenColCount, `${tableName}.${viewName}.frozenColCount`);

      if (fieldOrder.length > 0) summary.fieldOrderAuditViews += 1;
      if (hiddenFieldNames.length > 0) {
        summary.hiddenVerificationViews += 1;
        summary.hiddenVerificationAssignments += hiddenFieldNames.length;
      }
      if (sort.length > 0) summary.sortViews += 1;
      if (group.length > 0) summary.groupViews += 1;
      if (Object.keys(columnWidths).length > 0) {
        summary.columnWidthViews += 1;
        summary.columnWidthAssignments += Object.keys(columnWidths).length;
      }
      if (rowHeightLevel !== null) summary.rowHeightViews += 1;
      if (frozenColCount !== null) summary.frozenColumnManualViews += 1;

      views.push(deepFreeze({
        viewName,
        viewType: optionalText(view?.viewType) ?? 'grid',
        verifyOnly: {
          fieldOrder,
          hiddenFieldNames,
        },
        mutate: {
          sort,
          group,
          columnWidths,
          rowHeightLevel,
        },
        remainingManual: {
          frozenColCount,
        },
      }));
      summary.viewCount += 1;
    }

    tables.push(deepFreeze({ tableName, views }));
  }

  summary.tableCount = tables.length;
  return deepFreeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    mode: 'base-js-sdk-ui-owned-only',
    ownership: {
      automaticServerOpenApiVerifyOnly: ['hiddenFields', 'filters', 'hierarchy'],
      baseJsSdkMutations: ['sort', 'group', 'columnWidth', 'rowHeight'],
      remainingManual: ['fieldOrder', 'frozenColumns'],
    },
    tables,
    summary,
  });
}

/**
 * Matches the controlled Apply refresh-admission boundary for the local Source file.
 * The View UI runner must not pin one historical SHA after automatic Apply has already
 * admitted a newer export. Structural resources stay exact while record count may grow.
 */
export function assessLarkBaseViewUiRefreshSourceAuthority(inspection, options = {}) {
  const structuralCounts = plainObject(options?.structuralCounts)
    ? options.structuralCounts
    : DEFAULT_SOURCE_STRUCTURAL_COUNTS;
  const minimumRecords = options?.minimumRecords ?? DEFAULT_SOURCE_MIN_RECORDS;
  const mismatches = [];

  for (const [dimension, expected] of Object.entries(structuralCounts)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }

  const records = Number(inspection?.counts?.records);
  if (!Number.isInteger(records) || records < minimumRecords) {
    mismatches.push({
      dimension: 'records',
      expectedMinimum: minimumRecords,
      actual: Number.isFinite(records) ? records : null,
    });
  }

  return deepFreeze({
    ok: mismatches.length === 0,
    authorityMode: mismatches.length === 0 ? 'refresh-compatible' : null,
    fileSha256: optionalText(inspection?.file?.sha256),
    records: Number.isInteger(records) ? records : null,
    mismatches,
  });
}

export const LARK_BASE_VIEW_JS_SDK_PARITY_PLAN_VERSION = CONTRACT_VERSION;

function normalizeDirectionalRules(value, name) {
  if (value === null || value === undefined) return [];
  const rules = requireArray(value, name);
  return rules.map((rule, index) => {
    if (!plainObject(rule)) throw new TypeError(`${name}[${index}] must be an object`);
    const fieldName = requireText(rule.fieldName ?? rule.fieldId ?? rule.field_id, `${name}[${index}].fieldName`);
    const desc = normalizeDirection(rule, `${name}[${index}]`);
    return deepFreeze({ fieldName, desc });
  });
}

function normalizeDirection(rule, name) {
  if (typeof rule.desc === 'boolean') return rule.desc;
  if (typeof rule.isDesc === 'boolean') return rule.isDesc;
  const order = optionalText(rule.order ?? rule.direction);
  if (order === 'desc' || order === 'DESC') return true;
  if (order === 'asc' || order === 'ASC') return false;
  throw new TypeError(`${name} must contain desc:boolean or order asc/desc`);
}

function explicitColumnWidths(value, name) {
  if (!plainObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, info]) => plainObject(info) && info.width !== null && info.width !== undefined)
    .map(([fieldName, info]) => {
      const safeName = requireText(fieldName, `${name} fieldName`);
      const width = Number(info.width);
      if (!Number.isFinite(width) || width <= 0) throw new TypeError(`${name}.${safeName}.width must be positive`);
      return [safeName, width];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

function explicitHiddenFields(value) {
  if (!plainObject(value)) return [];
  return Object.entries(value)
    .filter(([, info]) => plainObject(info) && info.hidden === true)
    .map(([fieldName]) => requireText(fieldName, 'hidden field name'))
    .sort();
}

function normalizeNameList(value, name) {
  if (value === null || value === undefined) return [];
  const names = requireArray(value, name).map((item, index) => requireText(item, `${name}[${index}]`));
  if (new Set(names).size !== names.length) throw new TypeError(`${name} must contain unique field names`);
  return names;
}

function normalizeRowHeight(value, name) {
  if (value === null || value === undefined) return null;
  const level = Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 4) throw new TypeError(`${name} must be an integer from 1 to 4`);
  return level;
}

function normalizeFrozenCount(value, name) {
  if (value === null || value === undefined) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return count;
}

function requireManifest(value) {
  if (!plainObject(value) || value.contractVersion !== MANIFEST_VERSION) {
    throw new TypeError(`manifest must use ${MANIFEST_VERSION}`);
  }
  requireArray(value.tables, 'manifest.tables');
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
