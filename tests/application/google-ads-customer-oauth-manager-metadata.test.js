import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAdsCustomerOAuthFlow } from '../../packages/application/src/connections/google-ads-customer-oauth-flow.js';

function dependency(methods) {
  return Object.fromEntries(methods.map((method) => [method, async () => undefined]));
}

test('Google Ads OAuth metadata carries normalized manager and advertiser bindings without tokens', () => {
  const shared = dependency([
    'previewInvitation', 'beginOAuth', 'consumeCallbackState',
    'completeOAuthAttempt', 'releaseOAuthAttempt',
  ]);
  const oauthClient = dependency([
    'buildAuthorizationUrl', 'exchangeAuthorizationCode', 'refreshAccessToken',
  ]);
  const adsClient = dependency(['validateTargetCustomer']);
  const credentials = dependency(['replace', 'read']);
  const store = dependency(['updateConnection', 'getConnection']);
  const flow = new GoogleAdsCustomerOAuthFlow({
    shared,
    oauthClient,
    adsClient,
    credentials,
    store,
    redirectUri: 'https://worker.example/oauth/google-ads/callback',
    environment: 'development',
    approvedManagerCustomerId: '946-357-0541',
    approvedTargetCustomerId: '566-233-2033',
  });

  const metadata = flow.providerMetadata({
    credentialReference: 'credential-reference-only',
    advertiserCustomerId: '566-233-2033',
    currencyCode: 'thb',
    timeZone: 'Asia/Bangkok',
  });
  assert.deepEqual(metadata, {
    credentialReference: 'credential-reference-only',
    managerCustomerId: '9463570541',
    approvedAdvertiserCustomerId: '5662332033',
    advertiserCustomerId: '5662332033',
    currencyCode: 'THB',
    timeZone: 'Asia/Bangkok',
  });
  assert.equal(JSON.stringify(metadata).includes('refresh'), false);
  assert.equal(Object.isFrozen(metadata), true);
});
