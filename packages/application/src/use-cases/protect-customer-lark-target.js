const DEFAULT_PROTECTED_TARGET_TABLE_NAMES = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
]);

/**
 * Wraps the customer Target Lark client with a fail-closed write fence.
 *
 * Protected existing tables are business-owned resources that consolidation must
 * never overwrite, delete, recreate, or mutate. Reads are passed through so a
 * preview/verifier can compare them with the export. Any write addressed to a
 * protected table ID/name throws before an OpenAPI request is made.
 */
export async function protectCustomerLarkTarget(input) {
  const client = requireClient(input?.client);
  const protectedNames = normalizeNames(
    input?.protectedTableNames ?? DEFAULT_PROTECTED_TARGET_TABLE_NAMES,
  );
  const tables = await client.listTables();
  const protectedByName = new Map();
  const protectedIds = new Set();

  for (const name of protectedNames) {
    const matches = tables.filter((table) => table?.name === name);
    if (matches.length > 1) {
      throw codedError(
        'CUSTOMER_BASE_PROTECTED_TABLE_DUPLICATE',
        `Target Base contains duplicate protected table name: ${name}`,
        { name, count: matches.length },
      );
    }
    if (matches.length === 1) {
      const tableId = requireText(matches[0]?.tableId, `protected tableId ${name}`);
      protectedByName.set(name, tableId);
      protectedIds.add(tableId);
    }
  }

  const wrapped = Object.create(client);

  wrapped.createTable = async (request) => {
    const name = requireText(request?.name, 'createTable.name');
    if (protectedNames.includes(name)) {
      throw protectedWriteError('createTable', { name });
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
        throw protectedWriteError(method, {
          tableId,
          name: [...protectedByName.entries()].find(([, id]) => id === tableId)?.[0] ?? null,
        });
      }
      return client[method](request);
    };
  }

  return Object.freeze({
    client: wrapped,
    policy: Object.freeze({
      contractVersion: 'customer_lark_target_protection_v1',
      protectedTableNames: Object.freeze([...protectedNames]),
      protectedTablesPresent: Object.freeze(
        [...protectedByName.entries()].map(([name, tableId]) => Object.freeze({ name, tableId })),
      ),
      rule: 'read-only-on-protected-existing-tables',
    }),
  });
}

export function assertProtectedTargetTablePlan(input) {
  const preview = input?.preview;
  const protectedNames = normalizeNames(
    input?.protectedTableNames ?? DEFAULT_PROTECTED_TARGET_TABLE_NAMES,
  );
  const plans = Array.isArray(preview?.tables) ? preview.tables : [];
  const violations = [];

  for (const name of protectedNames) {
    const plan = plans.find((entry) => entry?.name === name) ?? null;
    if (!plan) {
      violations.push({ name, reason: 'protected table missing from consolidation plan' });
      continue;
    }
    if (plan.action !== 'reuse_exact') {
      violations.push({ name, reason: `protected table action must be reuse_exact, found ${String(plan.action)}` });
    }
  }

  if (violations.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED',
      'Protected customer table is not proven exact/reusable; consolidation must stop without mutating it',
      { violations },
    );
  }

  return Object.freeze({
    ok: true,
    contractVersion: 'customer_lark_target_protected_plan_v1',
    protectedTableNames: Object.freeze([...protectedNames]),
    actions: Object.freeze(protectedNames.map((name) => Object.freeze({ name, action: 'reuse_exact' }))),
  });
}

function protectedWriteError(operation, details) {
  return codedError(
    'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED',
    `Write blocked by protected customer table policy: ${operation}`,
    { operation, ...details },
  );
}

function normalizeNames(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('protectedTableNames must be a non-empty array');
  }
  return Object.freeze([...new Set(value.map((name) => requireText(name, 'protectedTableName')))]);
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
