/**
 * Snapshots non-table customer Base resources before migration and applies the same
 * immutable-preexisting principle already used for customer Tables.
 *
 * Current scope is Advanced Permission roles because that is the only non-table
 * resource with a documented create path being prepared. Existing roles are never
 * updated/deleted by this workstream; creating a duplicate role name is blocked.
 */
export async function protectCustomerLarkBaseResources(input) {
  const client = requireClient(input?.client);
  const existingRoles = await client.listAdvancedPermissionRoles();
  const byName = new Map();
  for (const role of existingRoles) {
    const roleName = requireText(role?.roleName, 'existing roleName');
    if (byName.has(roleName)) throw codedError('CUSTOMER_BASE_PREEXISTING_ROLE_DUPLICATE', `Target Base contains duplicate pre-existing role name: ${roleName}`, { roleName });
    byName.set(roleName, Object.freeze({
      roleName,
      roleId: requireText(role?.roleId, `existing roleId ${roleName}`),
    }));
  }

  const wrapped = Object.create(client);
  if (typeof client.createAdvancedPermissionRole === 'function') {
    wrapped.createAdvancedPermissionRole = async (request) => {
      const roleName = requireText(request?.roleName, 'createAdvancedPermissionRole.roleName');
      if (byName.has(roleName)) {
        throw codedError(
          'CUSTOMER_BASE_PROTECTED_ROLE_WRITE_BLOCKED',
          `Write blocked by immutable pre-existing customer role policy: ${roleName}`,
          { operation: 'createAdvancedPermissionRole', roleName, reason: 'role name existed before migration started' },
        );
      }
      return client.createAdvancedPermissionRole(request);
    };
  }

  return Object.freeze({
    client: wrapped,
    policy: Object.freeze({
      contractVersion: 'customer_lark_base_resource_protection_v1',
      rule: 'all-preexisting-target-base-resources-read-only',
      existingAdvancedPermissionRolesProtected: Object.freeze([...byName.values()].sort((left, right) => left.roleName.localeCompare(right.roleName))),
      supportedNewResourceWrites: Object.freeze(['createAdvancedPermissionRole']),
    }),
  });
}

function requireClient(client) {
  if (!client || typeof client.listAdvancedPermissionRoles !== 'function') {
    throw new TypeError('client must implement listAdvancedPermissionRoles()');
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
