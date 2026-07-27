import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION,
  assertChatwootProviderPreflightConfirmation,
  buildChatwootProviderPreflightEvidence,
  classifyChatwootReportingPermissionError,
  loadChatwootProviderPreflightTarget,
  parseChatwootProviderPreflightArgs,
  summarizeChatwootProviderRequestEvents,
} from '../../scripts/lib/chatwoot-provider-preflight.js';

function validEnv(overrides = {}) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    CHATWOOT_BASE_URL: 'https://cmkchat.parkos-service.biz/',
    CHATWOOT_ACCOUNT_ID: '1',
    CHATWOOT_API_ACCESS_TOKEN: 'secret-token-value',
    CHATWOOT_DEPLOYMENT_TYPE: 'self_hosted',
    ...overrides,
  };
}

test('Chatwoot Provider preflight is plan-only by default and accepts only --execute', () => {
  assert.deepEqual(parseChatwootProviderPreflightArgs([]), { execute: false });
  assert.deepEqual(parseChatwootProviderPreflightArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseChatwootProviderPreflightArgs(['--phase=provider']),
    (error) => error.code === 'CHATWOOT_PROVIDER_PREFLIGHT_ARGUMENT_INVALID',
  );
});

test('Chatwoot Provider preflight locks exact Integration Workspace identity', () => {
  const target = loadChatwootProviderPreflightTarget(validEnv());
  assert.equal(target.baseUrl, 'https://cmkchat.parkos-service.biz');
  assert.equal(target.accountId, 1);
  assert.equal(target.deploymentType, 'self_hosted');
  assert.equal(target.accessToken, 'secret-token-value');

  for (const [field, value] of [
    ['MKT_ENV', 'production'],
    ['MKT_CUSTOMER_PROFILE', 'chemistry_k'],
    ['MKT_CONNECTION_CUSTOMER_KEY', 'other_customer'],
  ]) {
    assert.throws(
      () => loadChatwootProviderPreflightTarget(validEnv({ [field]: value })),
      (error) => error.code === 'CHATWOOT_PROVIDER_TARGET_INVALID',
    );
  }

  assert.throws(
    () => loadChatwootProviderPreflightTarget(validEnv({ CHATWOOT_BASE_URL: 'http://example.com' })),
    (error) => error.code === 'CHATWOOT_PROVIDER_BASE_URL_INVALID',
  );
  assert.throws(
    () => loadChatwootProviderPreflightTarget(validEnv({ CHATWOOT_ACCOUNT_ID: '0' })),
    (error) => error.code === 'CHATWOOT_PROVIDER_ACCOUNT_ID_INVALID',
  );
});

test('Chatwoot Provider preflight requires the exact execution confirmation', () => {
  assert.doesNotThrow(() => assertChatwootProviderPreflightConfirmation({
    CONFIRM_CHATWOOT_PROVIDER_GET_ONLY: CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION,
  }));
  assert.throws(
    () => assertChatwootProviderPreflightConfirmation({}),
    (error) => error.code === 'CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION_REQUIRED',
  );
});

test('Reporting Events 401 and 403 are classified as an administrator permission blocker', () => {
  for (const status of [401, 403]) {
    const blocker = classifyChatwootReportingPermissionError({
      details: { operation: 'list_reporting_events', status },
    });
    assert.deepEqual(blocker, {
      code: 'CHATWOOT_REPORTING_ADMIN_REQUIRED',
      status,
      operation: 'list_reporting_events',
      requiredRole: 'administrator',
      action: 'promote_integration_user_to_administrator_then_rerun',
    });
  }

  assert.equal(classifyChatwootReportingPermissionError({
    details: { operation: 'list_contacts', status: 401 },
  }), null);
  assert.equal(classifyChatwootReportingPermissionError({
    details: { operation: 'list_reporting_events', status: 429 },
  }), null);
});

test('Blocked evidence preserves passed endpoints without exposing Token, URL, Account ID or PII', () => {
  const target = loadChatwootProviderPreflightTarget(validEnv());
  const blocker = classifyChatwootReportingPermissionError({
    details: { operation: 'list_reporting_events', status: 401 },
  });
  const evidence = buildChatwootProviderPreflightEvidence({
    target,
    profile: { id: 55, role: 'agent', name: 'Integration User', email: 'secret@example.com' },
    account: { id: 1, name: 'Chemistry K', permissions: ['conversation_manage'] },
    visibleAccountCount: 1,
    endpointChecks: {
      profile: { status: 'passed' },
      inboxes: { status: 'passed', rowsObserved: 2 },
      reportingEvents: {
        status: 'blocked',
        code: blocker.code,
        httpStatus: blocker.status,
        requiredRole: blocker.requiredRole,
      },
    },
    requestSummary: {
      requestAttempts: 8,
      successfulRequests: 7,
      failedRequests: 1,
      retries: 0,
    },
    reportingPermissionBlocker: blocker,
    capturedAt: '2026-07-27T20:00:00.000Z',
  });

  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.decision, 'CHATWOOT_REPORTING_ADMIN_REQUIRED');
  assert.equal(evidence.endpointChecks.inboxes.status, 'passed');
  assert.equal(evidence.nextGate, 'chatwoot_integration_user_role_update');
  assert.equal(evidence.boundaries.providerMutationCount, 0);
  assert.equal(evidence.boundaries.d1MutationCount, 0);

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('secret-token-value'), false);
  assert.equal(serialized.includes('cmkchat.parkos-service.biz'), false);
  assert.equal(serialized.includes('Integration User'), false);
  assert.equal(serialized.includes('secret@example.com'), false);
  assert.equal(serialized.includes('Chemistry K'), false);
});

test('Request event summary counts attempts, successes, failures and retries', () => {
  assert.deepEqual(summarizeChatwootProviderRequestEvents([
    { stage: 'chatwoot_request_start' },
    { stage: 'chatwoot_request_retry' },
    { stage: 'chatwoot_request_start' },
    { stage: 'chatwoot_request_success' },
    { stage: 'chatwoot_request_failed' },
  ]), {
    requestAttempts: 2,
    successfulRequests: 1,
    failedRequests: 1,
    retries: 1,
  });
});
