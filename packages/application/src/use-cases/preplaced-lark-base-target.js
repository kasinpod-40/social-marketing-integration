const DEFAULT_EXPECTED_TABLE_COUNT = 33;
const DEFAULT_TABLE_LIMIT = 100;

/**
 * Creates only missing destination-table shells in the target Base.
 *
 * This is intentionally separate from consolidation Apply. It is used when the customer has explicitly
 * accepted temporary root-level placement and will move the created tables into the required internal folder
 * before Apply. Existing tables are never renamed, deleted, or overwritten. A rerun is idempotent because the
 * current target table list is read before every provisioning pass.
 */
export async function provisionMissingLarkBaseTargetTables(input) {
  const targetClient = requireProvisionClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeExpectedNames(input?.expectedTableNames);
  const expectedTableCount = input?.expectedTableCount ?? expectedTableNames.length ?? DEFAULT_EXPECTED_TABLE_COUNT;
  const tableLimit = input?.tableLimit ?? DEFAULT_TABLE_LIMIT;

  const targetTables = await targetClient.listTables();
  const conflicts = [];
  const byName = uniqueTableIndex(targetTables, conflicts);

  if (expectedTableNames.length !== expectedTableCount) {
    conflicts.push(problem(
      'PROVISION_EXPECTED_TABLE_COUNT_MISMATCH',
      `Expected-name contract must contain exactly ${expectedTableCount} unique tables; found ${expectedTableNames.length}`,
      { expected: expectedTableCount, actual: expectedTableNames.length },
    ));
  }

  const missingTargetTables = expectedTableNames.filter((name) => !byName.has(name));
  if (targetTables.length + missingTargetTables.length > tableLimit) {
    conflicts.push(problem(
      'PROVISION_TARGET_TABLE_LIMIT_EXCEEDED',
      `Target Base would exceed the ${tableLimit}-table safety boundary`,
      {
        currentTargetTables: targetTables.length,
        missingTargetTables: missingTargetTables.length,
        resultingTables: targetTables.length + missingTargetTables.length,
      },
    ));
  }

  if (conflicts.length > 0) {
    return Object.freeze({
      ok: false,
      expectedTargetTables: expectedTableCount,
      targetTablesBefore: targetTables.length,
      alreadyPresentTargetTables: expectedTableNames.length - missingTargetTables.length,
      missingTargetTables: Object.freeze(missingTargetTables),
      createdTables: 0,
      createdTableNames: Object.freeze([]),
      conflicts: Object.freeze(conflicts),
    });
  }

  const createdTableNames = [];
  for (const name of missingTargetTables) {
    await targetClient.createTable({
      name,
      defaultViewName: 'Grid',
      fields: [{ fieldName: 'Text', type: 1 }],
    });
    createdTableNames.push(name);
  }

  return Object.freeze({
    ok: true,
    expectedTargetTables: expectedTableCount,
    targetTablesBefore: targetTables.length,
    alreadyPresentTargetTables: expectedTableNames.length - missingTargetTables.length,
    missingTargetTables: Object.freeze(missingTargetTables),
    createdTables: createdTableNames.length,
    createdTableNames: Object.freeze(createdTableNames),
    targetTablesAfter: targetTables.length + createdTableNames.length,
    conflicts: Object.freeze([]),
  });
}

/**
 * Adapts a real Lark target Base for customer consolidation without ever creating a remote table during Apply.
 *
 * Lark OpenAPI cannot place newly-created tables inside an internal Base navigation folder. The customer therefore
 * pre-places the destination tables in the required folder before Apply. Empty one-field tables are treated as safe
 * shells: the adapter hides them from the generic consolidation planner and intercepts createTable() as an in-place
 * claim that updates only the shell primary field and default view name. The underlying target client's createTable()
 * is never called from consolidation Apply.
 */
export async function preparePreplacedLarkBaseTarget(input) {
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeExpectedNames(input?.expectedTableNames);
  const expectedTableCount = input?.expectedTableCount ?? expectedTableNames.length ?? DEFAULT_EXPECTED_TABLE_COUNT;

  const targetTables = await targetClient.listTables();
  const conflicts = [];
  const byName = uniqueTableIndex(targetTables, conflicts);

  if (expectedTableNames.length !== expectedTableCount) {
    conflicts.push(problem(
      'PREPLACED_EXPECTED_TABLE_COUNT_MISMATCH',
      `Expected-name contract must contain exactly ${expectedTableCount} unique tables; found ${expectedTableNames.length}`,
      { expected: expectedTableCount, actual: expectedTableNames.length },
    ));
  }

  const missingTargetTables = [];
  const shellByName = new Map();
  const existingTargetTables = [];

  for (const name of expectedTableNames) {
    const table = byName.get(name);
    if (!table) {
      missingTargetTables.push(name);
      conflicts.push(problem(
        'PREPLACED_TARGET_TABLE_MISSING',
        `Target Base must already contain table before consolidation apply: ${name}`,
        { name },
      ));
      continue;
    }

    const fields = await targetClient.listFields({ tableId: table.tableId });
    const records = await targetClient.listRecords({ tableId: table.tableId });
    const views = await targetClient.listViews({ tableId: table.tableId });
    if (isSafeEmptyShell({ fields, records, views })) {
      shellByName.set(name, Object.freeze({
        table,
        primaryFieldId: fields[0].fieldId,
        defaultViewId: views[0].viewId,
        defaultViewName: views[0].viewName,
      }));
    } else {
      existingTargetTables.push(name);
    }
  }

  const claimedShellIds = new Set();
  const hiddenShellIds = new Set([...shellByName.values()].map((entry) => entry.table.tableId));

  const client = new Proxy(targetClient, {
    get(target, property, receiver) {
      if (property === 'listTables') {
        return async () => {
          const current = await target.listTables();
          return current.filter((table) => !hiddenShellIds.has(table.tableId) || claimedShellIds.has(table.tableId));
        };
      }

      if (property === 'createTable') {
        return async (request) => {
          const name = requireText(request?.name, 'table name');
          const shell = shellByName.get(name);
          if (!shell) {
            throw codedError(
              'PREPLACED_TARGET_SHELL_REQUIRED',
              `Refusing remote table creation during Apply; pre-place an empty target table first: ${name}`,
              { name },
            );
          }
          if (claimedShellIds.has(shell.table.tableId)) {
            throw codedError(
              'PREPLACED_TARGET_SHELL_ALREADY_CLAIMED',
              `Target shell was already claimed in this apply: ${name}`,
              { name, tableId: shell.table.tableId },
            );
          }

          const primaryFields = Array.isArray(request?.fields) ? request.fields : [];
          if (primaryFields.length !== 1) {
            throw codedError(
              'PREPLACED_TARGET_PRIMARY_CONTRACT_INVALID',
              `Shell claim requires exactly one primary field mutation: ${name}`,
              { fieldCount: primaryFields.length },
            );
          }

          await target.updateField({
            tableId: shell.table.tableId,
            fieldId: shell.primaryFieldId,
            field: primaryFields[0],
          });

          const defaultViewName = normalizeOptionalText(request?.defaultViewName);
          if (defaultViewName && defaultViewName !== shell.defaultViewName) {
            await target.updateView({
              tableId: shell.table.tableId,
              viewId: shell.defaultViewId,
              viewName: defaultViewName,
            });
          }

          claimedShellIds.add(shell.table.tableId);
          return Object.freeze({ ...shell.table });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return Object.freeze({
    ok: conflicts.length === 0,
    client,
    preflight: Object.freeze({
      ok: conflicts.length === 0,
      expectedTargetTables: expectedTableCount,
      actualTargetTables: targetTables.length,
      preplacedTargetTables: expectedTableNames.length - missingTargetTables.length,
      emptyShellTables: shellByName.size,
      existingTargetTables: existingTargetTables.length,
      missingTargetTables: Object.freeze(missingTargetTables),
      conflicts: Object.freeze(conflicts),
      remoteTableCreateAllowed: false,
    }),
  });
}

function isSafeEmptyShell(input) {
  if (input.records.length !== 0) return false;
  if (input.fields.length !== 1) return false;
  if (input.views.length !== 1) return false;
  const field = input.fields[0];
  return field?.isPrimary === true && typeof field.fieldId === 'string' && field.fieldId.trim() !== '';
}

function uniqueTableIndex(tables, conflicts) {
  const result = new Map();
  for (const table of tables) {
    const name = normalizeOptionalText(table?.name);
    if (!name) continue;
    if (result.has(name)) {
      conflicts.push(problem(
        'PREPLACED_TARGET_TABLE_DUPLICATE',
        `Target Base contains duplicate table name: ${name}`,
        { name },
      ));
      continue;
    }
    result.set(name, table);
  }
  return result;
}

function normalizeExpectedNames(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('expectedTableNames must be a non-empty array');
  }
  return [...new Set(value.map((name) => requireText(name, 'expectedTableName')))];
}

function requireProvisionClient(client, name) {
  const methods = ['listTables', 'createTable'];
  for (const method of methods) {
    if (!client || typeof client[method] !== 'function') {
      throw new TypeError(`${name} must implement ${method}()`);
    }
  }
  return client;
}

function requireClient(client, name) {
  const methods = ['listTables', 'listFields', 'listRecords', 'listViews', 'updateField', 'updateView'];
  for (const method of methods) {
    if (!client || typeof client[method] !== 'function') {
      throw new TypeError(`${name} must implement ${method}()`);
    }
  }
  return client;
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: Object.freeze(structuredClone(details)) });
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
