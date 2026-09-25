import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TikTokAdsCustomerOAuthFlow,
} from '../../packages/application/src/connections/tiktok-ads-customer-oauth-flow.js';

test('TikTok Ads begin reuses shared invitation/state authority', async () => {
  const fixture = createFixture();
  const url = await fixture.flow.begin('signed-invitation');
  assert.equal(url, 'https://business-api.tiktok.test/portal/auth');
  assert.deepEqual(fixture.calls.begin[0], {
    connectorKey: 'tiktok_ads',
    environment: 'development',
    redirectUri: 'https://worker.example/oauth/tiktok-ads/callback',
    invitationToken: 'signed-invitation',
  });
});

test('TikTok Ads callback stores only encrypted Refresh Token and validates one advertiser read-only', async () => {
  const fixture = createFixture();
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'connected');
  assert.equal(result.accessStatus, 'validated');
  assert.equal(result.externalIdentity.accountId, '***************6789');
  assert.equal(result.queued, false);
  assert.equal(result.larkWrite, false);
  assert.equal(fixture.calls.encrypt[0].credentialKind, 'refresh_token');
  assert.equal(fixture.calls.encrypt[0].plaintext, 'refresh-private');
  assert.equal(fixture.calls.update[0].externalAccountId, '1234567890123456789');
  assert.equal(fixture.calls.order.join(','), 'exchange,list,info,encrypt,update,complete');
  assert.equal(JSON.stringify(result).includes('refresh-private'), false);
});

test('TikTok Ads multiple advertisers fail closed until exact advertiser is configured', async () => {
  const fixture = createFixture({
    advertisers: [
      { advertiserId: '1111111111111111111', advertiserName: 'A' },
      { advertiserId: '2222222222222222222', advertiserName: 'B' },
    ],
  });
  await assert.rejects(
    () => fixture.flow.complete({ state: 'signed-state', code: 'auth-code' }),
    (error) => error.code === 'TIKTOK_ADS_ADVERTISER_SELECTION_REQUIRED',
  );
  assert.equal(fixture.calls.encrypt.length, 0);
  assert.equal(fixture.calls.update.at(-1).connectionStatus, 'identity_selection_required');
  assert.equal(fixture.calls.release.length, 1);
});

test('TikTok Ads configured advertiser must be inside the authorized account set', async () => {
  const fixture = createFixture({
    approvedAdvertiserId: '3333333333333333333',
  });
  await assert.rejects(
    () => fixture.flow.complete({ state: 'signed-state', code: 'auth-code' }),
    (error) => error.code === 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
  );
  assert.equal(fixture.calls.encrypt.length, 0);
  assert.equal(fixture.calls.update.at(-1).connectionStatus, 'identity_mismatch');
});

function createFixture(options = {}) {
  const calls = { begin: [], encrypt: [], update: [], complete: [], release: [], order: [] };
  const shared = {
    async previewInvitation() { return { attemptsRemaining: 3, canStart: true }; },
    async beginOAuth(input) {
      calls.begin.push(input);
      return { state: 'signed-state', codeChallenge: 'internal-pkce' };
    },
    async consumeCallbackState() {
      return {
        connectionId: 'connection-private',
        invitationId: 'invitation-private',
        connectorKey: 'tiktok_ads',
        customerKey: 'chemistry_k',
        attemptId: 'attempt-private',
        pkceVerifier: 'internal-private',
      };
    },
    async completeOAuthAttempt(input) {
      calls.order.push('complete');
      calls.complete.push(input);
    },
    async releaseOAuthAttempt(input) {
      calls.release.push(input);
    },
  };
  const oauthClient = {
    buildAuthorizationUrl() { return 'https://business-api.tiktok.test/portal/auth'; },
    async exchangeAuthorizationCode() {
      calls.order.push('exchange');
      return {
        accessToken: 'access-private',
        refreshToken: 'refresh-private',
        tokenType: 'Bearer',
        expiresAt: 86_401_000,
        refreshExpiresAt: 31_536_001_000,
      };
    },
  };
  const advertisers = options.advertisers ?? [{
    advertiserId: '1234567890123456789',
    advertiserName: 'Chemistry K',
  }];
  const adsClient = {
    async listAuthorizedAdvertisers() {
      calls.order.push('list');
      return advertisers;
    },
    async getAdvertiser({ advertiserId }) {
      calls.order.push('info');
      return {
        advertiserId,
        advertiserName: 'Chemistry K',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
      };
    },
  };
  const credentials = {
    async replace(input) {
      calls.order.push('encrypt');
      calls.encrypt.push(input);
      return 'credential-private';
    },
  };
  const store = {
    async getConnection() { return null; },
    async updateConnection(input) {
      calls.order.push('update');
      calls.update.push(input);
    },
    async recordCallbackError() {},
  };
  return {
    calls,
    flow: new TikTokAdsCustomerOAuthFlow({
      shared,
      oauthClient,
      adsClient,
      credentials,
      store,
      redirectUri: 'https://worker.example/oauth/tiktok-ads/callback',
      environment: 'development',
      approvedAdvertiserId: options.approvedAdvertiserId ?? null,
      now: () => 1_000,
    }),
  };
}
