export const LARK_DASHBOARD_SCOPE_PREFLIGHT_VERSION =
  'lark_dashboard_scope_preflight_v1';

export const LARK_DASHBOARD_SCOPE_CONFIRMATION =
  'I_ENABLED_BASE_DASHBOARD_READ_UPDATE_AND_FIELD_DELETE';

export const REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES = Object.freeze([
  'base:dashboard:read',
  'base:dashboard:update',
  'base:field:delete',
]);

const LARK_SCOPE_ERROR_CODE = 99991672;

/**
 * Lark มักคืนเฉพาะ Scope แรกที่ Endpoint ปัจจุบันต้องใช้ จึงห้ามตีความว่าเป็น
 * รายการสิทธิ์ทั้งหมดของ workflow นี้ Contract ด้านบนเป็น Source of Truth ของ Operator
 */
export function parseReportedMissingLarkScopes(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const bracket = message.match(/scopes?\s+is\s+required:\s*\[([^\]]+)\]/i);
  if (!bracket) return Object.freeze([]);
  return Object.freeze(
    bracket[1]
      .split(',')
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
  );
}

export function isLarkScopePermissionError(error) {
  return Number(error?.details?.larkCode) === LARK_SCOPE_ERROR_CODE
    || /scopes?\s+is\s+required/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

export function buildLarkDashboardScopePreflightFailure(error) {
  const reportedMissingScopes = parseReportedMissingLarkScopes(error);
  return Object.freeze({
    ok: false,
    contractVersion: LARK_DASHBOARD_SCOPE_PREFLIGHT_VERSION,
    code: 'LARK_DASHBOARD_CANONICAL_REBIND_SCOPE_PREFLIGHT_FAILED',
    message: 'Lark app permissions do not satisfy the complete Dashboard canonical-rebind contract',
    details: Object.freeze({
      requiredScopes: REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
      reportedMissingScopes,
      readScopeVerified: false,
      updateScopeDeclared: true,
      fieldDeleteScopeDeclared: true,
      remoteMutationCount: 0,
      nextAction: 'Enable all required scopes, publish the app version, then run the read-only scope preflight again',
    }),
    production: 'BLOCKED',
  });
}

export function assertLarkDashboardScopeConfirmation(value) {
  if (value !== LARK_DASHBOARD_SCOPE_CONFIRMATION) {
    const error = new Error('Explicit confirmation of the complete Lark Dashboard scope contract is required');
    error.name = 'LarkDashboardScopePreflightError';
    error.code = 'LARK_DASHBOARD_CANONICAL_REBIND_SCOPE_CONFIRMATION_REQUIRED';
    error.details = Object.freeze({
      envName: 'CONFIRM_LARK_DASHBOARD_SCOPE_CONTRACT',
      requiredScopes: REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
      remoteMutationCount: 0,
    });
    throw error;
  }
  return true;
}
