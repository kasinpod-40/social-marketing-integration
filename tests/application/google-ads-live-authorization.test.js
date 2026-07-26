import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGoogleAdsLiveAuthorization } from '../../packages/application/src/google-ads/google-ads-live-authorization.js';

const EXPECTED = Object.freeze({
  customerKey: 'chemistry_k',
  managerCustomerId: '9463570541',
  customerId: '5662332033',
  currencyCode: 'THB',
  sourceTimezone: 'Asia/Bangkok',
});

function connection(overrides = {}) {
  return {
    connectionId: 'connection-1',
    customerKey: 'chemistry_k',
    connectorKey: 'google_ads',
    advertiserCustomerId: '5662332033',
    connectionStatus: 'connected',
    accessStatus: 'validated',
    grantedScopes: ['https://www.googleapis.com/auth/adwords'],
    credentialReference: 'credential-1',
    activeCredentialReference: 'credential-1',
    credentialKeyVersion: 'v1',
    providerMetadata: {
      managerCustomerId: '9463570541',
      currencyCode: 'THB',
      timeZone: 'Asia/Bangkok',
    },
    lastValidatedAt: 1785031200000,
    ...overrides,
  };
}

function store(value) {
  return { async findValidatedConnection() { return value; } };
}

test('validated encrypted Google Ads connection passes without exposing plaintext token', async () => {
  const result = await assertGoogleAdsLiveAuthorization({
    ...EXPECTED,
    connectionStore: store(connection()),
  });
  assert.equal(result.connectionId, 'connection-1');
  assert.equal(result.credentialReference, 'credential-1');
  assert.equal(JSON.stringify(result).includes('refresh'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('missing connection, scope, credential and account metadata fail closed', async () => {
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({ ...EXPECTED, connectionStore: store(null) }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_REQUIRED',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({ grantedScopes: [] })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_SCOPE_INSUFFICIENT',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({ activeCredentialReference: 'credential-2' })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CREDENTIAL_UNAVAILABLE',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({ providerMetadata: { currencyCode: 'USD', timeZone: 'Asia/Bangkok' } })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_METADATA_MISMATCH',
  );
});

test('persisted manager mismatch is rejected while legacy missing manager remains compatible', async () => {
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({
        providerMetadata: {
          managerCustomerId: '1111111111',
          currencyCode: 'THB',
          timeZone: 'Asia/Bangkok',
        },
      })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_MANAGER_MISMATCH',
  );

  const result = await assertGoogleAdsLiveAuthorization({
    ...EXPECTED,
    connectionStore: store(connection({
      providerMetadata: { currencyCode: 'THB', timeZone: 'Asia/Bangkok' },
    })),
  });
  assert.equal(result.managerCustomerId, '9463570541');
});
