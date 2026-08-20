/**
 * Idempotently materializes only migration-owned Advanced Permission roles from a
 * previously validated plan. Role names that existed in the controlled-Apply
 * checkpoint are immutable and can never be adopted or overwritten.
 *
 * An empty plan is an explicit zero-request no-op: inactive unassigned Source role
 * definitions must not introduce Advanced Permission API dependencies on the Target.
 *
 * Missing active roles are created one at a time and immediately read back. If the
 * process stops after creating a subset, a rerun with the same protected-role
 * checkpoint reuses exact roles created by the migration and continues with the
 * remaining ones.
 */
export async function applyLarkBaseAdvancedPermissionParity(input) {
  const plan = requireObject(input?.plan, 'plan');
  if (plan.readyToWrite !== true || plan.ok !== true) {
    throw codedError('ADVANCED_PERMISSION_APPLY_PLAN_BLOCKED', 'Advanced Permission plan is not ready to write');
  }
  const protectedRoleNames = normalizeNames(input?.protectedRoleNames ?? []);
  const expectedRoles = requireArray(plan.roles, 'plan.roles');

  if (expectedRoles.length === 0) {
    return deepFreeze({
      ok: true,
      contractVersion: 'customer_base_advanced_permission_apply_v1',
      mode: 'inactive-source-roles-zero-request-noop',
      createdRoles: 0,
      reusedExactRoles: 0,
      protectedRoleNames,
      results: [],
      remoteRequestCount: 0,
      remoteMutationCount: 0,
    });
  }

  const targetClient = requireClient(input?.targetClient);
  const protectedSet = new Set(protectedRoleNames);
  const before = await targetClient.listAdvancedPermissionRoles();
  const beforeByName = uniqueRoleByName(before);
  const blockers = [];
  const actions = [];

  for (const expected of expectedRoles) {
    const roleName = requireText(expected?.roleName, 'expected roleName');
    const actual = beforeByName.get(roleName) ?? null;
    if (!actual) {
      actions.push(Object.freeze({ roleName, action: 'create' }));
      continue;
    }
    if (protectedSet.has(roleName)) {
      blockers.push(problem(
        'ADVANCED_PERMISSION_PROTECTED_ROLE_COLLISION',
        `Migration role name existed before controlled Apply and is immutable: ${roleName}`,
        { roleName },
      ));
      continue;
    }
    if (!sameRole(expected, actual)) {
      blockers.push(problem(
        'ADVANCED_PERMISSION_RESUME_ROLE_CONFLICT',
        `Existing migration-owned role does not match the expected plan: ${roleName}`,
        { roleName },
      ));
      continue;
    }
    actions.push(Object.freeze({ roleName, action: 'reuse_exact' }));
  }

  if (blockers.length > 0) {
    throw codedError(
      'ADVANCED_PERMISSION_APPLY_PREFLIGHT_BLOCKED',
      'Advanced Permission Apply stopped before mutation because Target role state is unsafe',
      { blockers },
    );
  }

  let createdRoles = 0;
  let reusedExactRoles = 0;
  const results = [];
  for (const action of actions) {
    const expected = expectedRoles.find((role) => role?.roleName === action.roleName);
    if (action.action === 'reuse_exact') {
      reusedExactRoles += 1;
      results.push(Object.freeze({ roleName: action.roleName, action: 'reuse_exact' }));
      continue;
    }

    await targetClient.createAdvancedPermissionRole({
      roleName: action.roleName,
      tableRoles: requireArray(expected?.tableRoles, `${action.roleName}.tableRoles`).map((entry) => ({
        tableId: requireText(entry?.targetTableId, `${action.roleName}.targetTableId`),
        tablePerm: finiteNumber(entry?.tablePerm, `${action.roleName}.tablePerm`),
      })),
    });
    createdRoles += 1;

    const readback = uniqueRoleByName(await targetClient.listAdvancedPermissionRoles()).get(action.roleName) ?? null;
    if (!readback || !sameRole(expected, readback)) {
      throw codedError(
        'ADVANCED_PERMISSION_APPLY_READBACK_MISMATCH',
        `Created Advanced Permission role failed immediate readback: ${action.roleName}`,
        { roleName: action.roleName },
      );
    }
    results.push(Object.freeze({ roleName: action.roleName, action: 'created_and_verified' }));
  }

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_advanced_permission_apply_v1',
    mode: 'apply-idempotent-resumable',
    createdRoles,
    reusedExactRoles,
    protectedRoleNames,
    results,
  });
}

function sameRole(expected, actual) {
  const expectedRoles = canonicalTableRoles(requireArray(expected?.tableRoles, 'expected.tableRoles').map((entry) => ({
    tableId: requireText(entry?.targetTableId, 'expected targetTableId'),
    tablePerm: finiteNumber(entry?.tablePerm, 'expected tablePerm'),
  })));
  const actualRoles = canonicalTableRoles(requireArray(actual?.tableRoles ?? [], 'actual.tableRoles'));
  return JSON.stringify(expectedRoles) === JSON.stringify(actualRoles);
}

function canonicalTableRoles(items) {
  return items.map((entry) => ({
    tableId: requireText(entry?.tableId, 'tableRole.tableId'),
    tablePerm: finiteNumber(entry?.tablePerm, 'tableRole.tablePerm'),
  })).sort((left, right) => left.tableId.localeCompare(right.tableId) || left.tablePerm - right.tablePerm);
}

function uniqueRoleByName(roles) {
  const result = new Map();
  for (const role of requireArray(roles, 'target roles')) {
    const roleName = requireText(role?.roleName, 'target roleName');
    if (result.has(roleName)) throw new TypeError(`duplicate target role name: ${roleName}`);
    result.set(roleName, role);
  }
  return result;
}

function normalizeNames(value) {
  const names = requireArray(value, 'protectedRoleNames').map((item) => requireText(item, 'protectedRoleName'));
  if (new Set(names).size !== names.length) throw new TypeError('protectedRoleNames must be unique');
  return Object.freeze(names);
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: structuredClone(details) });
}

function requireClient(client) {
  for (const method of ['listAdvancedPermissionRoles', 'createAdvancedPermissionRole']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`targetClient must implement ${method}()`);
  }
  return client;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
