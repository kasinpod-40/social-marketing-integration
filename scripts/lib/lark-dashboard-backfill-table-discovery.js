export function resolveExactLarkTableEnvironment(input = {}) {
  const sourceEnv = requireObject(input.env, 'env');
  const liveTables = requireArray(input.liveTables, 'liveTables');
  const contracts = requireArray(input.contracts, 'contracts');
  const env = { ...sourceEnv };
  const resolved = [];
  const preserved = [];
  const requiredIds = new Map();

  for (const contractInput of contracts) {
    const contract = requireObject(contractInput, 'contract');
    const tableKey = requireText(contract.tableKey, 'contract.tableKey');
    const envName = requireText(contract.envName, 'contract.envName');
    const names = uniqueNames(contract.names);
    const configured = optionalText(env[envName]);

    if (configured) {
      assertUniqueRequiredId(requiredIds, configured, tableKey);
      env[envName] = configured;
      preserved.push(Object.freeze({ tableKey, source: 'environment' }));
      continue;
    }

    const matches = liveTables.filter((tableInput) => {
      const table = requireObject(tableInput, 'liveTable');
      const name = optionalText(table.name);
      return name ? names.includes(name) : false;
    });
    if (matches.length === 0) {
      throw discoveryError(
        `Required Lark table was not found by exact name for ${tableKey}`,
        'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_MISSING',
        { tableKey, expectedNames: names },
      );
    }
    if (matches.length > 1) {
      throw discoveryError(
        `Required Lark table name is ambiguous for ${tableKey}`,
        'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_AMBIGUOUS',
        { tableKey, matchedNames: matches.map((table) => table.name) },
      );
    }

    const tableId = requireText(matches[0].tableId, 'liveTable.tableId');
    assertUniqueRequiredId(requiredIds, tableId, tableKey);
    env[envName] = tableId;
    resolved.push(Object.freeze({
      tableKey,
      source: 'exact_name_discovery',
      matchedName: requireText(matches[0].name, 'liveTable.name'),
    }));
  }

  return Object.freeze({
    env: Object.freeze(env),
    summary: Object.freeze({
      required: contracts.length,
      fromEnvironment: preserved.length,
      discovered: resolved.length,
      tables: Object.freeze([...preserved, ...resolved]),
    }),
  });
}

function assertUniqueRequiredId(ownerById, tableId, tableKey) {
  const owner = ownerById.get(tableId);
  if (owner && owner !== tableKey) {
    throw discoveryError(
      'One Lark table ID resolved to multiple required logical tables',
      'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_ID_CONFLICT',
      { tableKeys: [owner, tableKey] },
    );
  }
  ownerById.set(tableId, tableKey);
}

function uniqueNames(value) {
  const names = requireArray(value, 'contract.names')
    .map((name) => requireText(name, 'contract.name'));
  const unique = [...new Set(names)];
  if (unique.length === 0) throw new TypeError('contract.names must not be empty');
  return Object.freeze(unique);
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function discoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardBackfillTableDiscoveryError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
