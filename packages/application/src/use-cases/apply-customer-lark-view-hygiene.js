import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CUSTOMER_LARK_VIEW_HYGIENE_VERSION = 'customer-lark-empty-fields-v1';
export const CUSTOMER_LARK_VIEW_HYGIENE_FOLDER = 'Setup Phase | Social MKT Data Hub';

const ID_PATTERNS = Object.freeze({
  tableId: /^tbl[A-Za-z0-9]+$/u,
  fieldId: /^fld[A-Za-z0-9]+$/u,
  viewId: /^vew[A-Za-z0-9]+$/u,
  sha256: /^[a-f0-9]{64}$/u,
});
const MAX_CANDIDATE_FIELDS = 64;
const MAX_VIEWS = 32;

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

function byId(fieldName) {
  return (left, right) => left[fieldName].localeCompare(right[fieldName]);
}

function schemaDrift(stage, scope) {
  return permanentError('Customer Lark View hygiene stopped on live schema drift', {
    code: 'CUSTOMER_LARK_VIEW_HYGIENE_SCHEMA_DRIFT',
    details: { stage, tableId: scope?.tableId ?? null },
  });
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
