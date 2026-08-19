const WRITE_METHODS = Object.freeze([
  'renameTable',
  'createField',
  'updateField',
  'batchCreateRecords',
  'batchUpdateRecords',
  'createView',
  'updateView',
  'updateViewHierarchy',
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
 * duplicate schema or records. Baseline/unrelated customer tables stay immutable.
 */
export async function prepareLarkBaseResumableTarget(input) {
  const targetClient = requireClient(input?.targetClient);
  const expectedTableNames = normalizeNames(input?.expectedTableNames, 'expectedTableNames');
  const protectedTables = normalizeProtectedTables(input?.protectedTables ?? []);
  const expectedNameSet = new Set(expectedTableNames);
  const protectedByName = new Map(protectedTables.map((table) => [table.name, table]));
  const protectedIds = new Set(protectedTables.map((table) => table.tableId));
  const currentTables = await targetClient.listTables();
  const currentByName = uniqueTableByName(currentTables);
  const currentById = new Map(currentTables.map((table) => [requireText(table?.tableId, 'current tableId'), table]));

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

          const created = await target.createTable(stripGeneratedSelectOptionIdsFromCreateTableRequest(request));
          const tableId = requireText(created?.tableId, `created tableId ${name}`);
          writableIds.add(tableId);
          return created;
        };
      }

      if (property === 'createField') {
        return async (request) => {
          const tableId = requireWritableTable(request?.tableId, 'createField', dynamicProtectedIds, writableIds);
          const field = requireObject(request?.field, 'createField.field');
          const fieldName = requireText(field?.fieldName, 'createField.fieldName');
          const existingFields = await target.listFields({ tableId });
          const existing = existingFields.find((item) => item?.fieldName === fieldName) ?? null;
          if (existing) {
            if (!fieldMatchesMutation(existing, field)) {
              throw codedError(
                'CUSTOMER_BASE_RESUME_FIELD_CONFLICT',
                `Existing migration-owned field differs from requested Source field: ${fieldName}`,
                { tableId, fieldName },
              );
            }
            return structuredClone(existing);
          }
          return target.createField({
            ...request,
            field: stripGeneratedSelectOptionIdsFromField(field),
          });
        };
      }

      if (property === 'batchCreateRecords') {
        return async (request) => {
          const tableId = requireWritableTable(request?.tableId, 'batchCreateRecords', dynamicProtectedIds, writableIds);
          const requestedRecords = requireArray(request?.records, 'batchCreateRecords.records');
          if (requestedRecords.length === 0) return { created: 0 };
          const fields = await target.listFields({ tableId });
          const primaries = fields.filter((field) => field?.isPrimary === true);
          if (primaries.length !== 1) {
            throw codedError('CUSTOMER_BASE_RESUME_PRIMARY_COUNT_INVALID', 'Migration-owned table must have exactly one primary field', { tableId, primaryCount: primaries.length });
          }
          const primaryName = requireText(primaries[0]?.fieldName, 'primary fieldName');
          const existingRecords = await target.listRecords({ tableId });
          const existingByPrimary = indexRecords(existingRecords, primaryName, `target ${tableId}`);
          const missing = [];
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
            for (const [fieldName, value] of Object.entries(payload)) {
              if (canonicalValue(existing?.fields?.[fieldName]) !== canonicalValue(value)) {
                throw codedError(
                  'CUSTOMER_BASE_RESUME_RECORD_CONFLICT',
                  `Existing migration-owned record differs from requested Source payload: ${primaryName}=${key}`,
                  { tableId, primaryName, primaryValue: key, fieldName },
                );
              }
            }
          }
          if (missing.length === 0) return { created: 0 };
          return target.batchCreateRecords({ ...request, records: missing });
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
          return target.createView(request);
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
          return target[property](request);
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
  if (requireText(existing?.fieldName, 'existing fieldName') !== requireText(requested?.fieldName, 'requested fieldName')) return false;
  if (Number(existing?.type) !== Number(requested?.type)) return false;
  if (requested?.description !== undefined && String(existing?.description ?? '') !== String(requested.description ?? '')) return false;
  return stableJson(canonicalProperty(existing?.property)) === stableJson(canonicalProperty(requested?.property));
}

function canonicalProperty(value) {
  if (Array.isArray(value)) return value.map(canonicalProperty);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => key !== 'id')
    .sort()
    .map((key) => [key, canonicalProperty(value[key])]));
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

function requireClient(client) {
  for (const method of ['listTables', 'listFields', 'listRecords', 'listViews', 'createTable', 'createField', 'batchCreateRecords']) {
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
