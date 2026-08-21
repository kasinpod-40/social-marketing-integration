const MAX_DEPTH = 10;
const MAX_JSON_STRING_BYTES = 4 * 1024 * 1024;

/**
 * Decorates the local .base source client with the export-only aliases stored in
 * Automation Extra.TableMap. Workflow Drafts refer to those aliases while the
 * TableMap/FieldMap values point to the canonical Base IDs exposed by
 * listTables/listFields.
 *
 * No remote capability is added. Unknown aliases are not invented: they remain
 * unresolved and are rejected later by the existing workflow validators.
 */
export async function createWorkflowExportReferenceAliasSourceClient(sourceClient) {
  requireSourceClient(sourceClient);
  const resources = requireObject(sourceClient.getExportResources(), 'export resources');
  const workflows = Array.isArray(resources.workflows) ? resources.workflows : [];
  const canonicalTables = await sourceClient.listTables();
  const tableById = new Map();
  const fieldById = new Map();

  for (const table of canonicalTables) {
    const tableId = requireText(table?.tableId, 'Source tableId');
    tableById.set(tableId, table);
    for (const field of await sourceClient.listFields({ tableId })) {
      const fieldId = requireText(field?.fieldId, `${tableId} fieldId`);
      fieldById.set(fieldId, { tableId, field });
    }
  }

  const tableAliasToCanonicalId = new Map();
  const fieldAliasesByCanonicalTableId = new Map();
  const diagnostics = {
    tableMapCount: 0,
    tableAliasCount: 0,
    fieldAliasCount: 0,
    unresolvedCanonicalTableIds: 0,
    unresolvedCanonicalFieldIds: 0,
  };

  for (const workflow of workflows) scanWorkflow(workflow);

  return Object.freeze({
    ...sourceClient,
    async listTables() {
      const base = await sourceClient.listTables();
      const aliases = [];
      for (const [alias, canonicalId] of tableAliasToCanonicalId) {
        const canonical = tableById.get(canonicalId);
        if (!canonical || alias === canonicalId) continue;
        aliases.push({ ...canonical, tableId: alias });
      }
      return [...base, ...aliases];
    },
    async listFields(input) {
      const requestedTableId = requireText(input?.tableId, 'tableId');
      const canonicalTableId = tableAliasToCanonicalId.get(requestedTableId) ?? requestedTableId;
      const base = await sourceClient.listFields({ ...input, tableId: canonicalTableId });
      const aliases = [];
      const fieldAliases = fieldAliasesByCanonicalTableId.get(canonicalTableId) ?? new Map();
      for (const [alias, canonicalFieldId] of fieldAliases) {
        const canonical = fieldById.get(canonicalFieldId)?.field;
        if (!canonical || alias === canonicalFieldId) continue;
        aliases.push({ ...canonical, fieldId: alias });
      }
      return [...base, ...aliases];
    },
    getWorkflowExportReferenceAliasDiagnostics() {
      return Object.freeze({ ...diagnostics });
    },
  });

  function scanWorkflow(rawWorkflow) {
    const seen = new WeakSet();
    visit(rawWorkflow, 0);

    function visit(value, depth) {
      if (depth > MAX_DEPTH || value === null || value === undefined) return;
      if (typeof value === 'string') {
        const parsed = tryParseJson(value);
        if (parsed !== null) visit(parsed, depth + 1);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      for (const [key, nested] of Object.entries(value)) {
        if (/^TableMap$/iu.test(key) && isPlainObject(nested)) consumeTableMap(nested);
        visit(nested, depth + 1);
      }
    }
  }

  function consumeTableMap(tableMap) {
    diagnostics.tableMapCount += 1;
    for (const [tableAlias, rawTableSpec] of Object.entries(tableMap)) {
      if (!isPlainObject(rawTableSpec)) continue;
      const canonicalTableId = knownId(
        rawTableSpec.TableID ?? rawTableSpec.tableId ?? rawTableSpec.table_id,
        tableById,
      );
      if (!canonicalTableId) {
        diagnostics.unresolvedCanonicalTableIds += 1;
        continue;
      }
      setTableAlias(tableAlias, canonicalTableId);

      const rawFieldMap = rawTableSpec.FieldMap ?? rawTableSpec.fieldMap ?? rawTableSpec.field_map;
      if (!isPlainObject(rawFieldMap)) continue;
      for (const [fieldAlias, rawCanonicalFieldId] of Object.entries(rawFieldMap)) {
        const canonicalFieldId = knownId(rawCanonicalFieldId, fieldById);
        if (!canonicalFieldId) {
          diagnostics.unresolvedCanonicalFieldIds += 1;
          continue;
        }
        const fieldInfo = fieldById.get(canonicalFieldId);
        if (fieldInfo.tableId !== canonicalTableId) {
          const error = new Error('Workflow export FieldMap points outside its TableMap table');
          error.code = 'CUSTOMER_BASE_WORKFLOW_EXPORT_FIELD_TABLE_MISMATCH';
          error.details = { canonicalTableId, canonicalFieldId };
          throw error;
        }
        setFieldAlias(canonicalTableId, fieldAlias, canonicalFieldId);
      }
    }
  }

  function setTableAlias(alias, canonicalId) {
    const key = optionalText(alias);
    if (!key || key === canonicalId) return;
    const existing = tableAliasToCanonicalId.get(key);
    if (existing && existing !== canonicalId) {
      const error = new Error('Workflow export table alias is ambiguous');
      error.code = 'CUSTOMER_BASE_WORKFLOW_EXPORT_TABLE_ALIAS_CONFLICT';
      error.details = { aliasFingerprint: shortFingerprint(key) };
      throw error;
    }
    if (!existing) {
      tableAliasToCanonicalId.set(key, canonicalId);
      diagnostics.tableAliasCount += 1;
    }
  }

  function setFieldAlias(canonicalTableId, alias, canonicalFieldId) {
    const key = optionalText(alias);
    if (!key || key === canonicalFieldId) return;
    let map = fieldAliasesByCanonicalTableId.get(canonicalTableId);
    if (!map) {
      map = new Map();
      fieldAliasesByCanonicalTableId.set(canonicalTableId, map);
    }
    const existing = map.get(key);
    if (existing && existing !== canonicalFieldId) {
      const error = new Error('Workflow export field alias is ambiguous');
      error.code = 'CUSTOMER_BASE_WORKFLOW_EXPORT_FIELD_ALIAS_CONFLICT';
      error.details = { aliasFingerprint: shortFingerprint(key) };
      throw error;
    }
    if (!existing) {
      map.set(key, canonicalFieldId);
      diagnostics.fieldAliasCount += 1;
    }
  }
}

function knownId(value, map, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (map.has(text)) return text;
    const parsed = tryParseJson(text);
    return parsed === null ? null : knownId(parsed, map, depth + 1);
  }
  if (!isPlainObject(value)) return null;
  for (const key of ['id', 'value', 'TableID', 'tableId', 'table_id', 'FieldID', 'fieldId', 'field_id']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const found = knownId(value[key], map, depth + 1);
    if (found) return found;
  }
  return null;
}

function tryParseJson(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_JSON_STRING_BYTES) return null;
  if (!['{', '[', '"'].includes(text[0])) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return tryParseJson(parsed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function requireSourceClient(client) {
  if (!client || typeof client.getExportResources !== 'function' || typeof client.listTables !== 'function' || typeof client.listFields !== 'function') {
    throw new TypeError('sourceClient must expose export resources, tables and fields');
  }
}
function requireObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function isPlainObject(value) {
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
function shortFingerprint(value) {
  let hash = 2166136261;
  for (const ch of String(value)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
