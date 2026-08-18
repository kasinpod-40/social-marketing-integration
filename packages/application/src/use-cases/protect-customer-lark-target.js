const DEFAULT_REQUIRED_PROTECTED_NAMES = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
]);

/**
 * Wraps the customer Target Lark client with a fail-closed write fence.
 *
 * Every table that exists before migration starts is immutable for this workstream.
 * Reads are allowed for preview/verification. Writes are allowed only to tables
 * created after the fence snapshot was taken.
 */
export async function protectCustomerLarkTarget(input) {
  const client = requireClient(input?.client);
  const requiredProtectedNames = normalizeNames(
    input?.requiredProtectedTableNames ?? DEFAULT_REQUIRED_PROTECTED_NAMES,
  );
  const protectedExternalNames = normalizeOptionalNames(input?.protectedExternalTableNames);
  const requiredNameSet = new Set(requiredProtectedNames);
  for (const name of protectedExternalNames) {
    if (!requiredNameSet.has(name)) {
      throw new TypeError(`protectedExternalTableNames must be a subset of requiredProtectedTableNames: ${name}`);
    }
  }

  const tables = await client.listTables();
  const existingByName = uniqueTableMap(tables);
  const protectedIds = new Set();

  for (const table of tables) {
    protectedIds.add(requireText(table?.tableId, `existing tableId ${table?.name ?? '<unnamed>'}`));
  }

  for (const name of requiredProtectedNames) {
    if (!existingByName.has(name)) {
      throw codedError(
        'CUSTOMER_BASE_REQUIRED_PROTECTED_TABLE_MISSING',
        `Required protected Target table is missing: ${name}`,
        { name },
      );
    }
  }

  const wrapped = Object.create(client);

  wrapped.createTable = async (request) => {
    const name = requireText(request?.name, 'createTable.name');
    if (existingByName.has(name)) {
      throw protectedWriteError('createTable', {
        name,
        reason: 'table name existed before migration started',
      });
    }
    return client.createTable(request);
  };

  for (const method of [
    'renameTable',
    'createField',
    'updateField',
    'batchCreateRecords',
    'batchUpdateRecords',
    'createView',
    'updateView',
  ]) {
    if (typeof client[method] !== 'function') continue;
    wrapped[method] = async (request) => {
      const tableId = requireText(request?.tableId, `${method}.tableId`);
      if (protectedIds.has(tableId)) {
        const table = tables.find((item) => item?.tableId === tableId) ?? null;
        throw protectedWriteError(method, {
          tableId,
          name: table?.name ?? null,
          reason: 'table existed before migration started',
        });
      }
      return client[method](request);
    };
  }

  const existingTables = tables
    .map((table) => Object.freeze({
      name: requireText(table?.name, `existing table name ${table?.tableId ?? '<unknown>'}`),
      tableId: requireText(table?.tableId, `existing tableId ${table?.name ?? '<unnamed>'}`),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return Object.freeze({
    client: wrapped,
    policy: Object.freeze({
      contractVersion: 'customer_lark_target_protection_v3',
      existingTablesProtected: Object.freeze(existingTables),
      requiredProtectedTableNames: Object.freeze([...requiredProtectedNames]),
      protectedExternalTableNames: Object.freeze([...protectedExternalNames]),
      rule: 'all-preexisting-target-tables-read-only',
    }),
  });
}

/**
 * Ensures that any pre-existing Target table which also appears in the Source
 * migration plan is read-only exact reuse. Tables explicitly declared as protected
 * external sources are kept live/authoritative in Target and must be absent from the
 * clone plan; they are reported as protected_external_reuse instead. Unrelated
 * customer tables do not need a Source plan entry; the client fence still keeps them immutable.
 */
export function assertProtectedTargetTablePlan(input) {
  const preview = input?.preview;
  const plans = Array.isArray(preview?.tables) ? preview.tables : [];
  const existingTables = Array.isArray(input?.existingTablesProtected)
    ? input.existingTablesProtected
    : [];
  const requiredProtectedNames = normalizeNames(
    input?.requiredProtectedTableNames ?? DEFAULT_REQUIRED_PROTECTED_NAMES,
  );
  const protectedExternalNames = normalizeOptionalNames(input?.protectedExternalTableNames);
  const existingNames = new Set(existingTables.map((table) => requireText(table?.name, 'existing protected table name')));
  const requiredNameSet = new Set(requiredProtectedNames);
  const protectedExternalNameSet = new Set(protectedExternalNames);
  const violations = [];

  for (const name of protectedExternalNames) {
    if (!requiredNameSet.has(name)) {
      violations.push({ name, reason: 'protected external table must also be a required protected table' });
    }
  }

  for (const requiredName of requiredProtectedNames) {
    if (!existingNames.has(requiredName)) {
      violations.push({ name: requiredName, reason: 'required protected table was not present in the pre-migration snapshot' });
      continue;
    }
    const plan = plans.find((entry) => entry?.name === requiredName) ?? null;
    if (protectedExternalNameSet.has(requiredName)) {
      if (plan) {
        violations.push({
          name: requiredName,
          reason: `protected external table must be excluded from clone plan, found ${String(plan.action)}`,
        });
      }
      continue;
    }
    if (!plan) {
      violations.push({
        name: requiredName,
        reason: 'required protected Source overlap has no reuse_exact plan entry; preview conflict or omission must block',
      });
      continue;
    }
    if (plan.action !== 'reuse_exact') {
      violations.push({ name: requiredName, reason: `required protected table action must be reuse_exact, found ${String(plan.action)}` });
    }
  }

  for (const table of existingTables) {
    const name = requireText(table?.name, 'existing protected table name');
    if (requiredNameSet.has(name)) continue;
    const plan = plans.find((entry) => entry?.name === name) ?? null;
    if (!plan) continue;
    if (plan.action !== 'reuse_exact') {
      violations.push({ name, reason: `pre-existing table action must be reuse_exact, found ${String(plan.action)}` });
    }
  }

  if (violations.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED',
      'Pre-existing customer table is not proven safe for the selected reuse policy; consolidation must stop without mutating existing resources',
      { violations },
    );
  }

  const sourceOverlaps = [
    ...protectedExternalNames.map((name) => Object.freeze({ name, action: 'protected_external_reuse' })),
    ...plans
      .filter((plan) => existingNames.has(plan?.name) && !protectedExternalNameSet.has(plan?.name))
      .map((plan) => Object.freeze({ name: plan.name, action: plan.action })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  return Object.freeze({
    ok: true,
    contractVersion: 'customer_lark_target_protected_plan_v3',
    rule: 'all-preexisting-target-tables-read-only',
    existingTablesProtected: Object.freeze(existingTables.map((table) => Object.freeze(structuredClone(table)))),
    protectedExternalTableNames: Object.freeze([...protectedExternalNames]),
    sourceOverlaps: Object.freeze(sourceOverlaps),
  });
}

function uniqueTableMap(tables) {
  const result = new Map();
  for (const table of tables) {
    const name = requireText(table?.name, 'existing table name');
    if (result.has(name)) {
      throw codedError(
        'CUSTOMER_BASE_PREEXISTING_TABLE_DUPLICATE',
        `Target Base contains duplicate pre-existing table name: ${name}`,
        { name },
      );
    }
    result.set(name, table);
  }
  return result;
}

function protectedWriteError(operation, details) {
  return codedError(
    'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED',
    `Write blocked by immutable pre-existing customer table policy: ${operation}`,
    { operation, ...details },
  );
}

function normalizeNames(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('requiredProtectedTableNames must be a non-empty array');
  }
  return Object.freeze([...new Set(value.map((name) => requireText(name, 'requiredProtectedTableName')))]);
}

function normalizeOptionalNames(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('protectedExternalTableNames must be an array');
  return Object.freeze([...new Set(value.map((name) => requireText(name, 'protectedExternalTableName')))]);
}

function requireClient(client) {
  if (!client || typeof client.listTables !== 'function') {
    throw new TypeError('client must be a Lark Bitable-compatible client');
  }
  return client;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
