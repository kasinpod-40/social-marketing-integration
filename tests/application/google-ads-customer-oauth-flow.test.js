import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GoogleAdsCustomerOAuthFlow,
} from '../../packages/application/src/connections/google-ads-customer-oauth-flow.js';

const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';

test('Google Ads begin derives customer binding from invitation and emits provider authorization URL', async () => {
  const fixture = createFixture();
  const url = await fixture.flow.begin('signed-invitation');
  assert.equal(url, 'https://accounts.google.test/consent');
  assert.deepEqual(fixture.calls.begin[0], {
    connectorKey: 'google_ads',
    environment: 'development',
    redirectUri: 'https://worker.example/oauth/google-ads/callback',
    invitationToken: 'signed-invitation',
  });
  assert.equal(fixture.calls.authorization[0].scopes[0], ADWORDS_SCOPE);
});

test('Google Ads callback encrypts Refresh Token before read-only validation and never queues/Lark writes', async () => {
  const fixture = createFixture();
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'connected');
  assert.equal(result.accessStatus, 'validated');
  assert.equal(result.externalIdentity.accountId, '******2033');
  assert.equal(result.queued, false);
  assert.equal(result.larkWrite, false);
  assert.equal(fixture.calls.order.join(','), 'exchange,encrypt,decrypt,refresh,validate,update');
  assert.equal(fixture.calls.encrypt[0].plaintext, 'refresh-private');
  assert.equal(fixture.calls.update[0].connectionStatus, 'connected');
  assert.equal(fixture.calls.update[0].accessStatus, 'validated');
  assert.equal(JSON.stringify(result).includes('refresh-private'), false);
});

test('Google Ads developer access pending retains encrypted credential and returns distinct status', async () => {
  const error = Object.assign(new Error('pending'), { code: 'GOOGLE_ADS_API_ACCESS_PENDING' });
  const fixture = createFixture({ validationError: error });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'connected');
  assert.equal(result.accessStatus, 'google_ads_api_access_pending');
  assert.equal(fixture.calls.encrypt.length, 1);
  assert.equal(fixture.calls.update[0].accessStatus, 'google_ads_api_access_pending');
  assert.equal(fixture.calls.update[0].lastErrorCode, 'GOOGLE_ADS_API_ACCESS_PENDING');
});

test('Google Ads callback rejects insufficient scopes before credential persistence', async () => {
  const fixture = createFixture({ grantedScopes: [] });
  await assert.rejects(
    () => fixture.flow.complete({ state: 'signed-state', code: 'auth-code' }),
    (error) => error.code === 'CONNECTION_SCOPE_INSUFFICIENT',
  );
  assert.equal(fixture.calls.encrypt.length, 0);
  assert.equal(fixture.calls.update.at(-1).lastErrorCode, 'CONNECTION_SCOPE_INSUFFICIENT');
});

test('Google Ads refresh failure retains encrypted credential and records lifecycle failure', async () => {
  const fixture = createFixture({
    refreshError: Object.assign(new Error('refresh rejected'), {
      code: 'GOOGLE_OAUTH_TOKEN_REFRESH_REJECTED',
    }),
  });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'token_refresh_failed');
  assert.equal(result.nextAction, 'reconnect');
  assert.equal(fixture.calls.encrypt.length, 1);
  assert.equal(fixture.calls.update[0].lastErrorCode, 'GOOGLE_OAUTH_TOKEN_REFRESH_REJECTED');
  assert.equal(fixture.calls.order.includes('validate'), false);
});

test('Google Ads account-not-visible keeps credential but fails exact identity binding', async () => {
  const fixture = createFixture({
    validationError: Object.assign(new Error('not visible'), {
      code: 'GOOGLE_ADS_CUSTOMER_IDENTITY_MISMATCH',
    }),
  });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'identity_mismatch');
  assert.equal(result.accessStatus, 'identity_mismatch');
  assert.equal(fixture.calls.encrypt.length, 1);
});

function createFixture(options = {}) {
  const calls = {
    begin: [],
    authorization: [],
    encrypt: [],
    update: [],
    order: [],
  };
  const shared = {
    async beginOAuth(input) {
      calls.begin.push(input);
      return { state: 'signed-state', codeChallenge: 'challenge' };
    },
    async consumeCallbackState() {
      return {
        connectionId: 'connection-private',
        attemptId: 'attempt-private',
        pkceVerifier: 'pkce-private',
      };
    },
  };
  const oauthClient = {
    buildAuthorizationUrl(input) {
      calls.authorization.push(input);
      return 'https://accounts.google.test/consent';
    },
    async exchangeAuthorizationCode() {
      calls.order.push('exchange');
      return {
        accessToken: 'access-private',
        refreshToken: 'refresh-private',
        tokenType: 'Bearer',
        expiresAt: 2_000,
        grantedScopes: options.grantedScopes ?? [ADWORDS_SCOPE],
      };
    },
    async refreshAccessToken() {
      calls.order.push('refresh');
      if (options.refreshError) throw options.refreshError;
      return { accessToken: 'access-refreshed-private', expiresAt: 3_600_000 };
    },
  };
  const credentials = {
    async replace(input) {
      calls.order.push('encrypt');
      calls.encrypt.push(input);
      return 'credential-private';
    },
    async read() {
      calls.order.push('decrypt');
      return 'refresh-private';
    },
  };
  const adsClient = {
    async validateTargetCustomer() {
      calls.order.push('validate');
      if (options.validationError) throw options.validationError;
      return {
        customerId: '5662332033',
        descriptiveName: 'Customer',
        currencyCode: 'THB',
        timeZone: 'Asia/Bangkok',
      };
    },
  };
  const store = {
    async getConnection() {
      return options.existingConnection ?? null;
    },
    async updateConnection(input) {
      calls.order.push('update');
      calls.update.push(input);
    },
    async recordCallbackError() {},
  };
  return {
    calls,
    flow: new GoogleAdsCustomerOAuthFlow({
      shared,
      oauthClient,
      adsClient,
      credentials,
      store,
      redirectUri: 'https://worker.example/oauth/google-ads/callback',
      environment: 'development',
      approvedTargetCustomerId: '5662332033',
      now: () => 1_000,
    }),
  };
}
