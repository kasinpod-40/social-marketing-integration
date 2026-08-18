const CONTRACT_VERSION = 'customer_base_full_parity_identity_preflight_v1';

/**
 * GET-only identity/table-set gate before the expensive full-parity audit.
 * The Source must be the exact 33-table authority before any deep parity read is meaningful.
 */
export async function preflightCustomerBaseFullParity(input) {
  const sourceClient = requireClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeNames(input?.expectedTableNames);
  const expectedSourceLabel = requireText(input?.expectedSourceLabel, 'expectedSourceLabel');
  const expectedTargetLabel = requireText(input?.expectedTargetLabel, 'expectedTargetLabel');

  const [source, target] = await Promise.all([
    inspectBase(sourceClient, expectedTableNames),
    inspectBase(targetClient, expectedTableNames),
  ]);

  const blockers = [];
  if (source.metadata.name !== expectedSourceLabel) {
    blockers.push(problem(
      'CUSTOMER_BASE_SOURCE_IDENTITY_NAME_MISMATCH',
      'Configured Source Base name does not match the required source authority',
      { expected: expectedSourceLabel, actual: source.metadata.name },
    ));
  }
  if (target.metadata.name !== expectedTargetLabel) {
    blockers.push(problem(
      'CUSTOMER_BASE_TARGET_IDENTITY_NAME_MISMATCH',
      'Configured Target Base name does not match the customer destination',
      { expected: expectedTargetLabel, actual: target.metadata.name },
    ));
  }
  if (source.tableCount !== expectedTableNames.length || source.missingExpectedTables.length > 0 || source.unexpectedTables.length > 0) {
    blockers.push(problem(
      'CUSTOMER_BASE_SOURCE_AUTHORITY_TABLE_SET_MISMATCH',
      'Configured Source Base is not the exact expected 33-table migration authority',
      {
        expectedTableCount: expectedTableNames.length,
        actualTableCount: source.tableCount,
        missingExpectedTables: source.missingExpectedTables,
        unexpectedTables: source.unexpectedTables,
      },
    ));
  }

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: CONTRACT_VERSION,
    mode: 'read-only',
    remoteMutationCount: 0,
    source,
    target,
    blockers,
  });
}

async function inspectBase(client, expectedTableNames) {
  const [metadataResponse, tables] = await Promise.all([
    client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}`,
      { method: 'GET' },
    ),
    client.listTables(),
  ]);
  const app = metadataResponse?.data?.app ?? metadataResponse?.data ?? {};
  const metadata = {
    name: requireText(app?.name, 'base.name'),
    revision: finiteNumberOrNull(app?.revision),
    isAdvanced: typeof app?.is_advanced === 'boolean' ? app.is_advanced : null,
    timeZone: optionalText(app?.time_zone),
    formulaType: finiteNumberOrNull(app?.formula_type),
    advanceVersion: optionalText(app?.advance_version),
  };

  const names = tables.map((table) => optionalText(table?.name)).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const missingExpectedTables = expectedTableNames.filter((name) => !uniqueNames.includes(name));
  const unexpectedTables = uniqueNames.filter((name) => !expectedTableNames.includes(name));

  return {
    metadata,
    tableCount: tables.length,
    uniqueTableNameCount: uniqueNames.length,
    missingExpectedTables,
    unexpectedTables,
  };
}

function normalizeNames(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expectedTableNames must be a non-empty array');
  const names = value.map((item) => requireText(item, 'expectedTableName'));
  if (new Set(names).size !== names.length) throw new TypeError('expectedTableNames must be unique');
  return names;
}

function problem(code, message, details) {
  return { code, message, details };
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function requireClient(value, name) {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} is required`);
  if (typeof value.requestBitableJson !== 'function') throw new TypeError(`${name}.requestBitableJson is required`);
  if (typeof value.listTables !== 'function') throw new TypeError(`${name}.listTables is required`);
  if (typeof value.appToken !== 'string' || value.appToken.trim() === '') throw new TypeError(`${name}.appToken is required`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
