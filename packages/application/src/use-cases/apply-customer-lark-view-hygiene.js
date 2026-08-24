import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CUSTOMER_LARK_VIEW_HYGIENE_VERSION = 'customer-lark-empty-fields-v1';
export const CUSTOMER_LARK_VIEW_HYGIENE_FOLDER = 'Setup Phase | Social MKT Data Hub';
export const CUSTOMER_LARK_VIEW_FIELD_ORDER_VERSION = 'customer-lark-field-order-v1';

const ID_PATTERNS = Object.freeze({
  tableId: /^tbl[A-Za-z0-9]+$/u,
  fieldId: /^fld[A-Za-z0-9]+$/u,
  viewId: /^vew[A-Za-z0-9]+$/u,
  sha256: /^[a-f0-9]{64}$/u,
});
const MAX_CANDIDATE_FIELDS = 64;
const MAX_ORDERED_FIELDS = 128;
const MAX_VIEWS = 32;

const FIELD_ORDER_GROUP = Object.freeze({
  PRIMARY: 0,
  DISPLAY: 10,
  CONTEXT: 20,
  TIME: 30,
  STATUS: 40,
  METRIC: 50,
  LINK: 60,
  DETAIL: 70,
  IDENTIFIER: 80,
  TECHNICAL: 90,
});

const DISPLAY_PATTERNS = Object.freeze([
  /(^|_)name$/u,
  /title/u,
  /caption/u,
  /description/u,
  /(^|_)message$/u,
  /summary/u,
  /insight/u,
  /strengths|weaknesses|recommendations/u,
  /note/u,
  /^sku$/u,
  /order_number/u,
]);
const CONTEXT_PATTERNS = Object.freeze([
  /^platforms?$/u,
  /channel/u,
  /account/u,
  /customer/u,
  /campaign/u,
  /ad_group|asset_group/u,
  /creative/u,
  /content/u,
  /product/u,
  /course/u,
  /category/u,
  /funnel/u,
  /currency/u,
  /language/u,
  /timezone/u,
  /report_type|period_kind|comparison_mode|scope_type/u,
]);
const TIME_PATTERNS = Object.freeze([
  /metric_date/u,
  /period_start|period_end|compare_start|compare_end/u,
  /published_at/u,
  /source_created_at|source_modified_at|source_updated_at/u,
  /first_order_at|last_order_at/u,
  /created_at|updated_at|generated_at|fetched_at|sent_at|last_sync_at/u,
  /(^|_)date$/u,
  /(^|_)time$/u,
  /weekday|cooldown_until|window_days/u,
]);
const STATUS_PATTERNS = Object.freeze([
  /status/u,
  /state/u,
  /severity/u,
  /priority/u,
  /enabled|eligible/u,
  /preview_mode|comparison_mode/u,
]);
const METRIC_PATTERNS = Object.freeze([
  /spend/u,
  /sales|revenue|value/u,
  /cost|price|micros|refund|discount|tax|shipping/u,
  /impressions?|reach/u,
  /views?/u,
  /clicks?|interactions?|engagement/u,
  /orders?|customers?|products?|conversions?|leads?|messages?/u,
  /count|total/u,
  /rate|percentage|ratio/u,
  /duration|seconds|quantity|rank|coverage/u,
]);
const TECHNICAL_PATTERNS = Object.freeze([
  /_json$/u,
  /payload/u,
  /hash|checksum/u,
  /revision|(^|_)version($|_)/u,
  /sync_run_id|coverage_run_id/u,
  /dedupe/u,
  /slot_key/u,
  /capability/u,
  /config_/u,
]);
const IDENTIFIER_PATTERNS = Object.freeze([
  /^external_.*_id$/u,
  /^(campaign|ad_group|asset_group|creative|ad|video|inbox|team|agent|conversation)_id$/u,
  /^manager_account_id$/u,
  /^source_?id$/u,
]);

/**
 * ซ่อนเฉพาะ Candidate field ที่พิสูจน์กับ Live Base แล้วว่าไม่มีค่าจริงทั้งตาราง.
 * รักษา Hidden fields เดิม, ไม่ลบ Field/View, ไม่แก้ Filter และไม่เขียน Record.
 */
export async function applyCustomerLarkViewHygiene(input = {}) {
  const client = requireClient(input.client);
  const scope = normalizeScope(input.scope);
  const allowedScopeHashes = normalizeAllowedScopeHashes(input.allowedScopeHashes);
  const observedScopeHash = await sha256Hex(buildCustomerLarkViewHygieneScopeText(scope));
  if (observedScopeHash !== scope.scopeSha256 || !allowedScopeHashes.has(observedScopeHash)) {
    throw permanentError('Customer Lark View hygiene scope is not reviewed', {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_FORBIDDEN',
      details: { scopeSha256: scope.scopeSha256 },
    });
  }

  const fields = await client.listFields({ tableId: scope.tableId });
  const fieldById = new Map(fields.map((field) => [requireId(field?.fieldId, 'fieldId'), field]));
  const primary = fieldById.get(scope.primaryFieldId);
  if (!primary || primary.isPrimary !== true) {
    throw schemaDrift('primary_field', scope);
  }

  for (const candidate of scope.candidateFields) {
    const live = fieldById.get(candidate.fieldId);
    if (!live || live.fieldName !== candidate.fieldName || live.isPrimary === true) {
      throw schemaDrift(`candidate_field:${candidate.fieldId}`, scope);
    }
  }

  const confirmedEmptyFieldIds = [];
  const populatedFieldIds = [];
  for (const candidate of scope.candidateFields) {
    const records = await client.searchRecords({
      tableId: scope.tableId,
      fieldNames: [candidate.fieldName],
      filter: {
        conjunction: 'and',
        conditions: [{ fieldName: candidate.fieldName, operator: 'isNotEmpty' }],
      },
      pageSize: 1,
      maxPages: 1,
      maxItems: 1,
      stopWhen: () => true,
    });
    if (records.length === 0) confirmedEmptyFieldIds.push(candidate.fieldId);
    else populatedFieldIds.push(candidate.fieldId);
  }

  const listedViews = await client.listViews({ tableId: scope.tableId });
  const listedById = new Map(listedViews.map((view) => [requireId(view?.viewId, 'viewId'), view]));
  let updatedViews = 0;
  let unchangedViews = 0;

  for (const expected of scope.views) {
    const listed = listedById.get(expected.viewId);
    if (!listed || listed.viewName !== expected.viewName || listed.viewType !== expected.viewType) {
      throw schemaDrift(`view:${expected.viewId}`, scope);
    }
    const live = await client.getView({ tableId: scope.tableId, viewId: expected.viewId });
    if (live.viewName !== expected.viewName || live.viewType !== expected.viewType) {
      throw schemaDrift(`hydrated_view:${expected.viewId}`, scope);
    }
    const currentHidden = normalizeUniqueIds(live.property?.hiddenFields ?? [], 'fieldId');
    if (currentHidden.includes(scope.primaryFieldId)) {
      throw schemaDrift(`hidden_primary:${expected.viewId}`, scope);
    }
    const desiredHidden = [...new Set([...currentHidden, ...confirmedEmptyFieldIds])].sort();
    if (sameIds(currentHidden, desiredHidden)) {
      unchangedViews += 1;
      continue;
    }
    await client.updateView({
      tableId: scope.tableId,
      viewId: expected.viewId,
      hiddenFields: desiredHidden,
    });
    const readback = await client.getView({ tableId: scope.tableId, viewId: expected.viewId });
    const readbackHidden = normalizeUniqueIds(readback.property?.hiddenFields ?? [], 'fieldId');
    if (!sameIds(readbackHidden, desiredHidden)) {
      throw permanentError('Customer Lark View hidden-fields readback does not match', {
        code: 'CUSTOMER_LARK_VIEW_HYGIENE_READBACK_MISMATCH',
        details: { tableId: scope.tableId, viewId: expected.viewId },
      });
    }
    updatedViews += 1;
  }

  return Object.freeze({
    ok: true,
    tableId: scope.tableId,
    tableName: scope.tableName,
    candidateFields: scope.candidateFields.length,
    confirmedEmptyFields: confirmedEmptyFieldIds.length,
    populatedFieldsSkipped: populatedFieldIds.length,
    updatedViews,
    unchangedViews,
    recordWrites: 0,
    schemaWrites: 0,
  });
}

/**
 * เรียงเฉพาะ Field ที่มองเห็นอยู่ในแต่ละ Grid View ตามแผนที่ผ่าน review.
 * Hidden fields เดิมยัง Hidden, ไม่เปลี่ยน Field schema/Record/Filter/View name.
 */
export async function applyCustomerLarkViewFieldOrder(input = {}) {
  const client = requireFieldOrderClient(input.client);
  const scope = normalizeFieldOrderScope(input.scope);
  const allowedScopeHashes = normalizeAllowedScopeHashes(input.allowedScopeHashes);
  const observedScopeHash = await sha256Hex(buildCustomerLarkViewFieldOrderScopeText(scope));
  if (observedScopeHash !== scope.scopeSha256 || !allowedScopeHashes.has(observedScopeHash)) {
    throw permanentError('Customer Lark View field-order scope is not reviewed', {
      code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_FORBIDDEN',
      details: { scopeSha256: scope.scopeSha256 },
    });
  }

  const liveFields = await client.listFields({ tableId: scope.tableId });
  if (liveFields.length !== scope.orderedFields.length) {
    throw fieldOrderSchemaDrift('field_count', scope);
  }
  const expectedById = new Map(scope.orderedFields.map((field) => [field.fieldId, field]));
  const liveNames = new Set();
  for (const live of liveFields) {
    const fieldId = requireId(live?.fieldId, 'fieldId');
    const expected = expectedById.get(fieldId);
    if (!expected
      || live.fieldName !== expected.fieldName
      || live.type !== expected.fieldType
      || liveNames.has(live.fieldName)) {
      throw fieldOrderSchemaDrift(`field:${fieldId}`, scope);
    }
    liveNames.add(live.fieldName);
  }
  const livePrimary = liveFields.find((field) => field.fieldId === scope.primaryFieldId);
  if (!livePrimary || livePrimary.isPrimary !== true || scope.orderedFields[0].fieldId !== scope.primaryFieldId) {
    throw fieldOrderSchemaDrift('primary_field', scope);
  }

  const listedViews = await client.listViews({ tableId: scope.tableId });
  const listedById = new Map(listedViews.map((view) => [requireId(view?.viewId, 'viewId'), view]));
  const expectedViewIds = new Set(scope.views.map((view) => view.viewId));
  const liveGridViewIds = listedViews
    .filter((view) => view.viewType === 'grid')
    .map((view) => view.viewId);
  if (liveGridViewIds.length !== expectedViewIds.size
    || liveGridViewIds.some((viewId) => !expectedViewIds.has(viewId))) {
    throw fieldOrderSchemaDrift('grid_view_set', scope);
  }
  const orderedFieldNames = scope.orderedFields.map((field) => field.fieldName);
  let updatedViews = 0;
  let unchangedViews = 0;

  for (const expectedView of scope.views) {
    const listed = listedById.get(expectedView.viewId);
    if (!listed
      || listed.viewName !== expectedView.viewName
      || listed.viewType !== expectedView.viewType
      || expectedView.viewType !== 'grid') {
      throw fieldOrderSchemaDrift(`view:${expectedView.viewId}`, scope);
    }
    const current = normalizeUniqueFieldNames(
      await client.getViewVisibleFields({ tableId: scope.tableId, viewId: expectedView.viewId }),
      scope,
    );
    if (!current.includes(livePrimary.fieldName)
      || current.some((fieldName) => !liveNames.has(fieldName))) {
      throw fieldOrderSchemaDrift(`visible_fields:${expectedView.viewId}`, scope);
    }
    const currentSet = new Set(current);
    const desired = orderedFieldNames.filter((fieldName) => currentSet.has(fieldName));
    if (desired.length !== current.length || !sameTextSet(desired, current)) {
      throw fieldOrderSchemaDrift(`visible_field_set:${expectedView.viewId}`, scope);
    }
    if (sameTextOrder(current, desired)) {
      unchangedViews += 1;
      continue;
    }
    await client.setViewVisibleFields({
      tableId: scope.tableId,
      viewId: expectedView.viewId,
      visibleFields: desired,
    });
    const readback = normalizeUniqueFieldNames(
      await client.getViewVisibleFields({ tableId: scope.tableId, viewId: expectedView.viewId }),
      scope,
    );
    if (!sameTextOrder(readback, desired)) {
      throw permanentError('Customer Lark View field-order readback does not match', {
        code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_READBACK_MISMATCH',
        details: { tableId: scope.tableId, viewId: expectedView.viewId },
      });
    }
    updatedViews += 1;
  }

  return Object.freeze({
    ok: true,
    tableId: scope.tableId,
    tableName: scope.tableName,
    fieldCount: scope.orderedFields.length,
    updatedViews,
    unchangedViews,
    sourceSummary: Object.freeze({
      tableName: scope.tableName,
      fieldCount: scope.orderedFields.length,
      targetViews: scope.views.length,
      updatedViews,
      unchangedViews,
    }),
    recordWrites: 0,
    schemaWrites: 0,
  });
}

export function orderCustomerLarkFieldsForDisplay(input = {}) {
  const fields = normalizeBoundedArray(input.fields, 'fields', MAX_ORDERED_FIELDS, (field, index) => ({
    fieldId: requireId(field?.fieldId, 'fieldId'),
    fieldName: requireText(field?.fieldName, 'fieldName'),
    fieldType: requirePositiveInteger(field?.fieldType, 'fieldType'),
    originalIndex: index,
  }));
  const primaryFieldId = requireId(input.primaryFieldId, 'fieldId');
  assertUnique(fields.map((field) => field.fieldId), 'fields');
  assertUnique(fields.map((field) => field.fieldName), 'fieldNames');
  if (!fields.some((field) => field.fieldId === primaryFieldId)) {
    throw permanentError('Customer Lark View field order requires the primary field', {
      code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_INVALID',
    });
  }
  return Object.freeze(fields
    .sort((left, right) => compareFieldDisplayOrder(left, right, primaryFieldId))
    .map(({ originalIndex: _originalIndex, ...field }) => Object.freeze(field)));
}

export function buildCustomerLarkViewFieldOrderScopeText(input = {}) {
  const scope = normalizeFieldOrderScope({
    ...input,
    scopeSha256: input.scopeSha256 ?? '0'.repeat(64),
  }, { skipScopeHash: true });
  return JSON.stringify({
    version: scope.version,
    folderName: scope.folderName,
    tableId: scope.tableId,
    tableName: scope.tableName,
    primaryFieldId: scope.primaryFieldId,
    orderedFields: scope.orderedFields.map((field) => ({
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      fieldType: field.fieldType,
    })),
    views: scope.views.map((view) => ({
      viewId: view.viewId,
      viewName: view.viewName,
      viewType: view.viewType,
    })),
  });
}

export async function sha256CustomerLarkViewFieldOrderScope(input = {}) {
  return sha256Hex(buildCustomerLarkViewFieldOrderScopeText(input));
}

export function buildCustomerLarkViewHygieneScopeText(input = {}) {
  const scope = normalizeScope({ ...input, scopeSha256: input.scopeSha256 ?? '0'.repeat(64) }, {
    skipScopeHash: true,
  });
  return JSON.stringify({
    version: scope.version,
    folderName: scope.folderName,
    tableId: scope.tableId,
    tableName: scope.tableName,
    primaryFieldId: scope.primaryFieldId,
    candidateFields: scope.candidateFields.map((field) => ({
      fieldId: field.fieldId,
      fieldName: field.fieldName,
    })),
    views: scope.views.map((view) => ({
      viewId: view.viewId,
      viewName: view.viewName,
      viewType: view.viewType,
    })),
  });
}

export async function sha256CustomerLarkViewHygieneScope(input = {}) {
  return sha256Hex(buildCustomerLarkViewHygieneScopeText(input));
}

function normalizeScope(input, options = {}) {
  const source = requireObject(input, 'scope');
  const version = requireText(source.version, 'version');
  const folderName = requireText(source.folderName, 'folderName');
  const tableId = requireId(source.tableId, 'tableId');
  const tableName = requireText(source.tableName, 'tableName');
  const primaryFieldId = requireId(source.primaryFieldId, 'fieldId');
  if (version !== CUSTOMER_LARK_VIEW_HYGIENE_VERSION
    || folderName !== CUSTOMER_LARK_VIEW_HYGIENE_FOLDER
    || !(tableName.includes('MKT_') || tableName.includes('RAW_TikTok_'))) {
    throw permanentError('Customer Lark View hygiene identity is invalid', {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
    });
  }
  const candidateFields = normalizeBoundedArray(
    source.candidateFields,
    'candidateFields',
    MAX_CANDIDATE_FIELDS,
    (field) => Object.freeze({
      fieldId: requireId(field?.fieldId, 'fieldId'),
      fieldName: requireText(field?.fieldName, 'fieldName'),
    }),
  ).sort(byId('fieldId'));
  const views = normalizeBoundedArray(source.views, 'views', MAX_VIEWS, (view) => Object.freeze({
    viewId: requireId(view?.viewId, 'viewId'),
    viewName: requireText(view?.viewName, 'viewName'),
    viewType: requireText(view?.viewType, 'viewType'),
  })).sort(byId('viewId'));
  if (candidateFields.some((field) => field.fieldId === primaryFieldId)) {
    throw permanentError('Customer Lark View hygiene cannot hide the primary field', {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_PRIMARY_FIELD_FORBIDDEN',
    });
  }
  assertUnique(candidateFields.map((field) => field.fieldId), 'candidateFields');
  assertUnique(views.map((view) => view.viewId), 'views');
  const scopeSha256 = options.skipScopeHash
    ? '0'.repeat(64)
    : requirePattern(source.scopeSha256, ID_PATTERNS.sha256, 'scopeSha256');
  return Object.freeze({
    version,
    folderName,
    tableId,
    tableName,
    primaryFieldId,
    candidateFields: Object.freeze(candidateFields),
    views: Object.freeze(views),
    scopeSha256,
  });
}

function normalizeFieldOrderScope(input, options = {}) {
  const source = requireObject(input, 'scope');
  const version = requireText(source.version, 'version');
  const folderName = requireText(source.folderName, 'folderName');
  const tableId = requireId(source.tableId, 'tableId');
  const tableName = requireText(source.tableName, 'tableName');
  const primaryFieldId = requireId(source.primaryFieldId, 'fieldId');
  if (version !== CUSTOMER_LARK_VIEW_FIELD_ORDER_VERSION
    || folderName !== CUSTOMER_LARK_VIEW_HYGIENE_FOLDER
    || !(tableName.includes('MKT_') || tableName.includes('RAW_TikTok_'))) {
    throw permanentError('Customer Lark View field-order identity is invalid', {
      code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_INVALID',
    });
  }
  const orderedFields = normalizeBoundedArray(
    source.orderedFields,
    'orderedFields',
    MAX_ORDERED_FIELDS,
    (field) => Object.freeze({
      fieldId: requireId(field?.fieldId, 'fieldId'),
      fieldName: requireText(field?.fieldName, 'fieldName'),
      fieldType: requirePositiveInteger(field?.fieldType, 'fieldType'),
    }),
  );
  const views = normalizeBoundedArray(source.views, 'views', MAX_VIEWS, (view) => Object.freeze({
    viewId: requireId(view?.viewId, 'viewId'),
    viewName: requireText(view?.viewName, 'viewName'),
    viewType: requireText(view?.viewType, 'viewType'),
  })).sort(byId('viewId'));
  if (orderedFields[0]?.fieldId !== primaryFieldId) {
    throw permanentError('Customer Lark View field order must start with the primary field', {
      code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_PRIMARY_FIELD_REQUIRED',
    });
  }
  assertUnique(orderedFields.map((field) => field.fieldId), 'orderedFields');
  assertUnique(orderedFields.map((field) => field.fieldName), 'orderedFieldNames');
  assertUnique(views.map((view) => view.viewId), 'views');
  const scopeSha256 = options.skipScopeHash
    ? '0'.repeat(64)
    : requirePattern(source.scopeSha256, ID_PATTERNS.sha256, 'scopeSha256');
  return Object.freeze({
    version,
    folderName,
    tableId,
    tableName,
    primaryFieldId,
    orderedFields: Object.freeze(orderedFields),
    views: Object.freeze(views),
    scopeSha256,
  });
}

function normalizeAllowedScopeHashes(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw permanentError('Customer Lark View hygiene scope allowlist is empty', {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_FORBIDDEN',
    });
  }
  return new Set(normalized.map((item) => requirePattern(item, ID_PATTERNS.sha256, 'scopeSha256')));
}

function normalizeBoundedArray(value, fieldName, maximum, normalize) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw permanentError(`Customer Lark View hygiene requires bounded ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
      details: { fieldName, maximum },
    });
  }
  return value.map(normalize);
}

function normalizeUniqueFieldNames(value, scope) {
  if (!Array.isArray(value) || value.length === 0) {
    throw fieldOrderSchemaDrift('visible_fields', scope);
  }
  const names = value.map((item) => requireText(item, 'visibleFieldName'));
  if (new Set(names).size !== names.length) {
    throw fieldOrderSchemaDrift('duplicate_visible_fields', scope);
  }
  return names;
}

function normalizeUniqueIds(value, patternName) {
  if (!Array.isArray(value)) throw schemaDrift('hidden_fields', { tableId: null });
  return [...new Set(value.map((item) => requireId(item, patternName)))].sort();
}

function requireClient(client) {
  for (const method of ['listFields', 'searchRecords', 'listViews', 'getView', 'updateView']) {
    if (typeof client?.[method] !== 'function') throw new TypeError(`Customer Lark View hygiene requires client.${method}`);
  }
  return client;
}

function requireFieldOrderClient(client) {
  for (const method of ['listFields', 'listViews', 'getViewVisibleFields', 'setViewVisibleFields']) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Customer Lark View field order requires client.${method}`);
    }
  }
  return client;
}

function requireId(value, patternName) {
  return requirePattern(value, ID_PATTERNS[patternName], patternName);
}

function requirePattern(value, pattern, fieldName) {
  const text = requireText(value, fieldName);
  if (!pattern?.test(text)) {
    throw permanentError(`Customer Lark View hygiene requires valid ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
      details: { fieldName },
    });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Customer Lark View hygiene requires ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function requirePositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw permanentError(`Customer Lark View hygiene requires positive ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_INVALID',
      details: { fieldName },
    });
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError(`Customer Lark View hygiene requires ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
      details: { fieldName },
    });
  }
  return value;
}

function assertUnique(values, fieldName) {
  if (new Set(values).size !== values.length) {
    throw permanentError(`Customer Lark View hygiene requires unique ${fieldName}`, {
      code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_INVALID',
      details: { fieldName },
    });
  }
}

function sameIds(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameTextOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTextSet(left, right) {
  return sameTextOrder([...left].sort(), [...right].sort());
}

function compareFieldDisplayOrder(left, right, primaryFieldId) {
  const a = fieldDisplayOrderTuple(left, primaryFieldId);
  const b = fieldDisplayOrderTuple(right, primaryFieldId);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function fieldDisplayOrderTuple(field, primaryFieldId) {
  if (field.fieldId === primaryFieldId) return [FIELD_ORDER_GROUP.PRIMARY, 0, '', field.originalIndex];
  const name = field.fieldName.toLowerCase();
  const matched = (patterns) => patterns.findIndex((pattern) => pattern.test(name));
  const technical = matched(TECHNICAL_PATTERNS);
  if (technical >= 0) return [FIELD_ORDER_GROUP.TECHNICAL, technical, name, field.originalIndex];
  const display = matched(DISPLAY_PATTERNS);
  if (display >= 0) return [FIELD_ORDER_GROUP.DISPLAY, display, name, field.originalIndex];
  const time = matched(TIME_PATTERNS);
  if (time >= 0 || field.fieldType === 5) {
    return [FIELD_ORDER_GROUP.TIME, time >= 0 ? time : TIME_PATTERNS.length, name, field.originalIndex];
  }
  const status = matched(STATUS_PATTERNS);
  if (status >= 0 || field.fieldType === 7) {
    return [FIELD_ORDER_GROUP.STATUS, status >= 0 ? status : STATUS_PATTERNS.length, name, field.originalIndex];
  }
  if (field.fieldType === 15 || field.fieldType === 18 || /url|link/u.test(name)) {
    return [FIELD_ORDER_GROUP.LINK, 0, name, field.originalIndex];
  }
  const identifier = matched(IDENTIFIER_PATTERNS);
  if (identifier >= 0) {
    return [FIELD_ORDER_GROUP.IDENTIFIER, identifier, name, field.originalIndex];
  }
  const metric = matched(METRIC_PATTERNS);
  if (field.fieldType === 2) {
    return [FIELD_ORDER_GROUP.METRIC, metric >= 0 ? metric : METRIC_PATTERNS.length, name, field.originalIndex];
  }
  const context = matched(CONTEXT_PATTERNS);
  if (context >= 0) return [FIELD_ORDER_GROUP.CONTEXT, context, name, field.originalIndex];
  if (metric >= 0) return [FIELD_ORDER_GROUP.METRIC, metric, name, field.originalIndex];
  if (/(^|_)id$|(^|_)key$/u.test(name)) {
    return [FIELD_ORDER_GROUP.IDENTIFIER, 0, name, field.originalIndex];
  }
  return [FIELD_ORDER_GROUP.DETAIL, 0, name, field.originalIndex];
}

function byId(fieldName) {
  return (left, right) => left[fieldName].localeCompare(right[fieldName]);
}

function schemaDrift(stage, scope) {
  return permanentError('Customer Lark View hygiene stopped on live schema drift', {
    code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCHEMA_DRIFT',
    details: { stage, tableId: scope?.tableId ?? null },
  });
}

function fieldOrderSchemaDrift(stage, scope) {
  return permanentError('Customer Lark View field order stopped on live schema drift', {
    code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCHEMA_DRIFT',
    details: { stage, tableId: scope?.tableId ?? null },
  });
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
