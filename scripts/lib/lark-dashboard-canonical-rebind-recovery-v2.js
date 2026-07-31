export const LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_VERSION =
  'lark_dashboard_canonical_rebind_recovery_v2';

export const LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION =
  'I_ENABLED_BASE_DASHBOARD_READ_UPDATE_BLOCK_UPDATE_AND_FIELD_DELETE';

export const REQUIRED_LARK_DASHBOARD_RECOVERY_SCOPES = Object.freeze([
  'base:dashboard:read',
  'base:dashboard:update',
  'base:block:update',
  'base:field:delete',
]);

/**
 * PATCH เป็น partial ที่ระดับ Block แต่ data_config เป็นค่าทั้งก้อน จึงต้องส่ง
 * canonical configuration ฉบับเต็ม ไม่ใช่เฉพาะ top-level keys ที่เปลี่ยน
 */
export function buildFullDashboardBlockUpdateBody(dataConfig) {
  return deepFreeze({
    data_config: clone(requireObject(dataConfig, 'dataConfig')),
  });
}

export function classifyDashboardBlockMutation(input = {}) {
  const before = requireObject(input.before, 'before');
  const target = requireObject(input.target, 'target');
  const after = requireObject(input.after, 'after');

  if (stableStringify(after) === stableStringify(target)) return 'target_converged';
  if (stableStringify(after) === stableStringify(before)) return 'rejected_unchanged';
  return 'state_drift';
}

export function assertDashboardRecoveryScopeConfirmation(value) {
  if (value !== LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION) {
    const error = new Error('Explicit confirmation of the complete Lark Dashboard recovery scope contract is required');
    error.name = 'LarkDashboardCanonicalRebindRecoveryError';
    error.code = 'LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION_REQUIRED';
    error.details = Object.freeze({
      envName: 'CONFIRM_LARK_DASHBOARD_RECOVERY_SCOPE_CONTRACT',
      requiredScopes: REQUIRED_LARK_DASHBOARD_RECOVERY_SCOPES,
      remoteMutationCount: 0,
    });
    throw error;
  }
  return true;
}

export function stableDashboardConfigString(value) {
  return stableStringify(requireObject(value, 'dataConfig'));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
