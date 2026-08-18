const SAFE_ROLE_KEYS = Object.freeze(new Set([
  'name',
  'members',
  'baseRule',
  'tableRoleMap',
  'blockRoleMap',
]));

/**
 * Produces a local-only semantic inventory of exported Advanced Permission roles.
 *
 * Unlike the generic resource-shape audit, this intentionally exposes only the
 * non-secret values required to prove a deterministic OpenAPI mapping: role names,
 * table names, numeric permission enums/schema versions, null/presence state for
 * field/record rules, member counts, dashboard-rule count, and the export numeric
 * base-rule map. It never emits role/member/base/table IDs or member identities.
 */
export function inspectLarkBaseExportPermissionSemantics(input) {
  const roles = requireArray(input?.roles, 'roles');
  const sourceTables = requireArray(input?.sourceTables, 'sourceTables');
  const tableNameById = uniqueTableNameById(sourceTables);

  const result = roles.map((role, roleIndex) => inspectRole(role, roleIndex, tableNameById));
  const roleNames = new Set();
  for (const role of result) {
    if (roleNames.has(role.roleName)) throw new TypeError(`duplicate exported role name: ${role.roleName}`);
    roleNames.add(role.roleName);
  }

  return deepFreeze({
    ok: true,
    contractVersion: 'lark_base_export_permission_semantics_v1',
    mode: 'local-read-only-id-redacted',
    roles: result,
    summary: {
      roleCount: result.length,
      memberCount: result.reduce((sum, role) => sum + role.memberCount, 0),
      tableRoleCount: result.reduce((sum, role) => sum + role.tableRoles.length, 0),
      dashboardRoleCount: result.reduce((sum, role) => sum + role.dashboardRoleCount, 0),
      tablePermValues: uniqueSortedNumbers(result.flatMap((role) => role.tableRoles.map((entry) => entry.perm))),
      schemaVersionValues: uniqueSortedNumbers(result.flatMap((role) => role.tableRoles.map((entry) => entry.schemaVersion).filter(Number.isFinite))),
      baseRuleKeys: [...new Set(result.flatMap((role) => Object.keys(role.baseRule)))].sort(numericStringCompare),
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function inspectRole(value, index, tableNameById) {
  const role = requireObject(value, `roles[${index}]`);
  for (const key of Object.keys(role)) {
    if (SAFE_ROLE_KEYS.has(key) || ['baseId', 'roleId', 'createdTime', 'updatedTime'].includes(key)) continue;
    throw new TypeError(`unsupported exported role property: ${key}`);
  }

  const roleName = requireText(role.name, `roles[${index}].name`);
  const members = requireArray(role.members ?? [], `roles[${index}].members`);
  const tableRoleMap = requireObject(role.tableRoleMap ?? {}, `roles[${index}].tableRoleMap`);
  const blockRoleMap = requireObject(role.blockRoleMap ?? {}, `roles[${index}].blockRoleMap`);
  const baseRule = normalizeNumericMap(role.baseRule ?? {}, `roles[${index}].baseRule`);

  const tableRoles = Object.entries(tableRoleMap).map(([mapTableId, rawRule]) => {
    const rule = requireObject(rawRule, `roles[${index}].tableRoleMap.${mapTableId}`);
    const tableId = optionalText(rule.tableId) ?? mapTableId;
    if (tableId !== mapTableId) throw new TypeError(`tableRoleMap key/tableId mismatch for role ${roleName}`);
    const tableName = tableNameById.get(tableId);
    if (!tableName) throw new TypeError(`role ${roleName} references unknown source table`);
    const perm = requireFiniteNumber(rule.perm, `role ${roleName} table ${tableName} perm`);
    const schemaVersion = optionalFiniteNumber(rule.schemaVersion);

    return {
      tableName,
      perm,
      schemaVersion,
      fieldPerm: presenceKind(rule.fieldPerm),
      fieldPermV2: presenceKind(rule.fieldPermV2),
      recRule: presenceKind(rule.recRule),
    };
  }).sort((left, right) => left.tableName.localeCompare(right.tableName));

  return {
    roleName,
    memberCount: members.length,
    dashboardRoleCount: Object.keys(blockRoleMap).length,
    baseRule,
    tableRoles,
  };
}

function uniqueTableNameById(tables) {
  const result = new Map();
  const names = new Set();
  for (const [index, table] of tables.entries()) {
    const item = requireObject(table, `sourceTables[${index}]`);
    const tableId = requireText(item.tableId, `sourceTables[${index}].tableId`);
    const name = requireText(item.name, `sourceTables[${index}].name`);
    if (result.has(tableId)) throw new TypeError(`duplicate source tableId: ${tableId}`);
    if (names.has(name)) throw new TypeError(`duplicate source table name: ${name}`);
    result.set(tableId, name);
    names.add(name);
  }
  return result;
}

function normalizeNumericMap(value, name) {
  const source = requireObject(value, name);
  return Object.fromEntries(Object.entries(source)
    .map(([key, raw]) => [key, requireFiniteNumber(raw, `${name}.${key}`)])
    .sort(([left], [right]) => numericStringCompare(left, right)));
}

function presenceKind(value) {
  if (value === null || value === undefined) return 'none';
  if (Array.isArray(value)) return value.length === 0 ? 'empty_array' : 'array';
  if (typeof value === 'object') return Object.keys(value).length === 0 ? 'empty_object' : 'object';
  return typeof value;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function numericStringCompare(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  return requireFiniteNumber(value, 'number');
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
