const SUPPORTED_TABLE_PERMS = Object.freeze(new Set([0, 1, 2, 4]));

/**
 * Builds a deterministic, read-only Advanced Permission materialization plan from
 * the redacted local-export semantic inventory.
 *
 * Unassigned exported role definitions have no effective access-control impact and
 * are therefore retained as inactive evidence instead of being materialized. Active
 * roles remain fail-closed until member/dashboard assignment semantics are supported.
 *
 * Orphaned export table-role references are retained as forensic evidence but are
 * never materialized because the approved current Source snapshot has no Table to
 * remap them to.
 *
 * `base_rule` is intentionally omitted only when every exported base permission
 * point is enabled. Feishu v2 documents omission as granting all base permission
 * points, avoiding any guessed mapping from export-internal numeric keys.
 */
export function planLarkBaseAdvancedPermissionParity(input) {
  const semantics = requireObject(input?.permissionSemantics, 'permissionSemantics');
  const targetTables = requireArray(input?.targetTables, 'targetTables');
  const targetByName = uniqueTargetTableByName(targetTables);
  const roles = requireArray(semantics.roles, 'permissionSemantics.roles');
  const blockers = [];
  const orphanedFingerprints = new Set();
  const plans = [];
  const inactiveRoles = [];

  for (const role of roles) {
    const roleName = requireText(role?.roleName, 'roleName');
    const memberCount = nonNegativeInteger(role?.memberCount, `${roleName}.memberCount`);
    const dashboardRoleCount = nonNegativeInteger(role?.dashboardRoleCount, `${roleName}.dashboardRoleCount`);

    if (memberCount === 0 && dashboardRoleCount === 0) {
      inactiveRoles.push(Object.freeze({
        roleName,
        memberCount,
        dashboardRoleCount,
        classification: 'inactive_unassigned_source_role_no_effective_access',
      }));
      continue;
    }

    if (memberCount !== 0) blockers.push(problem('ADVANCED_PERMISSION_MEMBERS_UNSUPPORTED', `${roleName} has exported members`, { roleName, memberCount }));
    if (dashboardRoleCount !== 0) blockers.push(problem('ADVANCED_PERMISSION_DASHBOARD_RULES_UNSUPPORTED', `${roleName} has exported dashboard rules`, { roleName, dashboardRoleCount }));

    const baseRule = requireObject(role?.baseRule ?? {}, `${roleName}.baseRule`);
    const baseRuleValues = Object.values(baseRule).map((value) => finiteNumber(value, `${roleName}.baseRule value`));
    const allBasePermissionsEnabled = baseRuleValues.length > 0 && baseRuleValues.every((value) => value === 1);
    if (!allBasePermissionsEnabled) {
      blockers.push(problem(
        'ADVANCED_PERMISSION_BASE_RULE_NUMERIC_MAPPING_UNPROVEN',
        `${roleName} has an exported baseRule that cannot use the documented all-enabled omission rule`,
        { roleName, keys: Object.keys(baseRule).sort(numericStringCompare), values: [...new Set(baseRuleValues)].sort((a, b) => a - b) },
      ));
    }

    const tableRoles = [];
    for (const entry of requireArray(role?.tableRoles ?? [], `${roleName}.tableRoles`)) {
      const tableName = requireText(entry?.tableName, `${roleName}.tableRole.tableName`);
      const tablePerm = finiteNumber(entry?.perm, `${roleName}.${tableName}.perm`);
      if (!SUPPORTED_TABLE_PERMS.has(tablePerm)) {
        blockers.push(problem('ADVANCED_PERMISSION_TABLE_PERM_UNSUPPORTED', `${roleName}.${tableName} has unsupported table permission`, { roleName, tableName, tablePerm }));
        continue;
      }
      for (const key of ['fieldPerm', 'fieldPermV2', 'recRule']) {
        if ((entry?.[key] ?? 'none') !== 'none') {
          blockers.push(problem('ADVANCED_PERMISSION_FINE_GRAINED_RULE_UNSUPPORTED', `${roleName}.${tableName} has represented ${key}`, { roleName, tableName, key, state: entry[key] }));
        }
      }
      const targetTable = targetByName.get(tableName);
      if (!targetTable) {
        blockers.push(problem('ADVANCED_PERMISSION_TARGET_TABLE_MISSING', `${roleName} cannot remap target table ${tableName}`, { roleName, tableName }));
        continue;
      }
      tableRoles.push(Object.freeze({
        tableName,
        targetTableId: targetTable.tableId,
        tablePerm,
      }));
    }

    const orphanedTableRoles = requireArray(role?.unresolvedTableRoles ?? [], `${roleName}.unresolvedTableRoles`)
      .map((entry) => {
        const fingerprint = requireFingerprint(entry?.referenceFingerprint, `${roleName}.orphaned fingerprint`);
        orphanedFingerprints.add(fingerprint);
        return Object.freeze({
          referenceFingerprint: fingerprint,
          tablePerm: finiteNumber(entry?.perm, `${roleName}.orphaned perm`),
          schemaVersion: entry?.schemaVersion == null ? null : finiteNumber(entry.schemaVersion, `${roleName}.orphaned schemaVersion`),
          classification: 'orphaned_export_reference_not_materializable',
        });
      });

    plans.push(Object.freeze({
      roleName,
      baseRuleMode: allBasePermissionsEnabled ? 'omit_documented_all_permissions_default' : 'blocked_unmapped_numeric_rule',
      tableRoles: Object.freeze(tableRoles.sort((left, right) => left.tableName.localeCompare(right.tableName))),
      orphanedTableRoles: Object.freeze(orphanedTableRoles.sort((left, right) => left.referenceFingerprint.localeCompare(right.referenceFingerprint))),
      request: Object.freeze({
        role_name: roleName,
        table_roles: Object.freeze(tableRoles.map((entry) => Object.freeze({
          table_id: entry.targetTableId,
          table_perm: entry.tablePerm,
        }))),
      }),
    }));
  }

  return deepFreeze({
    ok: blockers.length === 0,
    readyToWrite: blockers.length === 0,
    contractVersion: 'customer_base_advanced_permission_plan_v1',
    mode: 'read-only',
    semanticsContractVersion: semantics.contractVersion ?? null,
    roles: plans,
    inactiveRoles,
    summary: {
      sourceRoleCount: roles.length,
      roleCount: plans.length,
      inactiveRoleCount: inactiveRoles.length,
      tableRoleCount: plans.reduce((sum, role) => sum + role.tableRoles.length, 0),
      orphanedTableRoleCount: plans.reduce((sum, role) => sum + role.orphanedTableRoles.length, 0),
      orphanedTableReferenceCount: orphanedFingerprints.size,
      blockers: blockers.length,
    },
    blockers,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function uniqueTargetTableByName(tables) {
  const result = new Map();
  for (const [index, table] of tables.entries()) {
    const item = requireObject(table, `targetTables[${index}]`);
    const name = requireText(item.name, `targetTables[${index}].name`);
    const tableId = requireText(item.tableId, `targetTables[${index}].tableId`);
    if (result.has(name)) throw new TypeError(`duplicate target table name: ${name}`);
    result.set(name, Object.freeze({ name, tableId }));
  }
  return result;
}

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: structuredClone(details) });
}

function requireFingerprint(value, name) {
  const text = requireText(value, name);
  if (!/^[a-f0-9]{16}$/u.test(text)) throw new TypeError(`${name} must be a 16-character hex fingerprint`);
  return text;
}

function nonNegativeInteger(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return number;
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}

function numericStringCompare(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
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
