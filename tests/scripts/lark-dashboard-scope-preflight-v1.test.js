import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_SCOPE_CONFIRMATION,
  REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
  assertLarkDashboardScopeConfirmation,
  buildLarkDashboardScopePreflightFailure,
  isLarkScopePermissionError,
  parseReportedMissingLarkScopes,
} from '../../scripts/lib/lark-dashboard-scope-preflight-v1.js';

test('declares the complete non-optional Dashboard canonical-rebind scope contract', () => {
  assert.deepEqual(REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES, [
    'base:dashboard:read',
    'base:dashboard:update',
    'base:field:delete',
  ]);
});

test('parses the first Lark-reported missing scope without treating it as the full contract', () => {
  const error = new Error(
    'Lark HTTP 400: Access denied. One of the following scopes is required: [base:dashboard:read]',
  );
  error.details = { larkCode: 99991672, status: 400 };

  assert.equal(isLarkScopePermissionError(error), true);
  assert.deepEqual(parseReportedMissingLarkScopes(error), ['base:dashboard:read']);

  const failure = buildLarkDashboardScopePreflightFailure(error);
  assert.deepEqual(failure.details.reportedMissingScopes, ['base:dashboard:read']);
  assert.deepEqual(
    failure.details.requiredScopes,
    REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
  );
  assert.equal(failure.details.remoteMutationCount, 0);
});

test('requires an explicit confirmation that all three permissions were enabled', () => {
  assert.equal(
    assertLarkDashboardScopeConfirmation(LARK_DASHBOARD_SCOPE_CONFIRMATION),
    true,
  );
  assert.throws(
    () => assertLarkDashboardScopeConfirmation('base:dashboard:read'),
    {
      code: 'LARK_DASHBOARD_CANONICAL_REBIND_SCOPE_CONFIRMATION_REQUIRED',
    },
  );
});
