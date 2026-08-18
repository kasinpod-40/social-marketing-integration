/**
 * GET-only verifier for migration-created Advanced Permission roles.
 *
 * It verifies the public, readable role contract: role name plus exact Target Table
 * IDs and table_perm values. Unrelated customer roles are ignored. Base-level
 * all-enabled semantics are guaranteed by the documented v2 create omission rule
 * and are not reconstructed from export-internal numeric keys here.
 */
export async function verifyLarkBaseAdvancedPermissionParity(input) {
  const plan = requireObject(input?.plan, 'plan');
  const targetClient = requireClient(input?.targetClient);
  const expectedRoles = requireArray(plan?.roles, 'plan.roles');
  const targetRoles = await targetClient.listAdvancedPermissionRoles();
  const targetByName = uniqueRoleByName(targetRoles);
  const mismatches = [];

  for (const expected of expectedRoles) {
    const roleName = requireText(expected?.roleName, 'expected roleName');
    const target = targetByName.get(roleName);
    if (!target) {
      mismatches.push(problem('ADVANCED_PERMISSION_VERIFY_ROLE_MISSING', `Target role missing: ${roleName}`, { roleName }));
      continue;
    }

    const expectedTableRoles = canonicalTableRoles(
      requireArray(expected?.tableRoles, `${roleName}.tableRoles`).map((entry) => ({
        tableId: requireText(entry?.targetTableId, `${roleName}.targetTableId`),
        tablePerm: finiteNumber(entry?.tablePerm, `${roleName}.tablePerm`),
      })),
    );
    const actualTableRoles = canonicalTableRoles(requireArray(target?.tableRoles ?? [], `${roleName}.target tableRoles`));
    if (JSON.stringify(expectedTableRoles) !== JSON.stringify(actualTableRoles)) {
      mismatches.push(problem(
        'ADVANCED_PERMISSION_VERIFY_TABLE_ROLE_MISMATCH',
        `Target role table permissions differ: ${roleName}`,
        { roleName, expectedTableRoles, actualTableRoles },
      ));
    }
  }

  return deepFreeze({
    ok: mismatches.length === 0,
    contractVersion: 'customer_base_advanced_permission_verifier_v1',
    mode: 'read-only',
    expectedRoleCount: expectedRoles.length,
    targetRoleCount: targetRoles.length,
    baseRuleVerification: 'documented_v2_all_permissions_default_by_omission',
    mismatches,
    remoteMutationCount: 0,
  });
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

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: structuredClone(details) });
}

function requireClient(client) {
  if (!client || typeof client.listAdvancedPermissionRoles !== 'function') {
    throw new TypeError('targetClient must implement listAdvancedPermissionRoles()');
  }
  return client;
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
