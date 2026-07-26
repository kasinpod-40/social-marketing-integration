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
    advertiserCustomerId: null,
    connectionStatus: 'connected',
    accessStatus: 'google_ads_api_access_pending',
    grantedScopes: ['https://www.googleapis.com/auth/adwords'],
    credentialReference: 'credential-1',
    activeCredentialReference: 'credential-1',
    credentialKeyVersion: 'v1',
    providerMetadata: {
      managerCustomerId: '9463570541',
      approvedAdvertiserCustomerId: '5662332033',
    },
    lastValidatedAt: null,
    ...overrides,
  };
}

function store(value) {
  return { async findScriptAuthorizedConnection() { return value; } };
}

test('API-pending encrypted consent authorizes Manager Script LIVE without plaintext token', async () => {
  const result = await assertGoogleAdsLiveAuthorization({
    ...EXPECTED,
    connectionStore: store(connection()),
  });
  assert.equal(result.connectionId, 'connection-1');
  assert.equal(result.accessStatus, 'google_ads_api_access_pending');
  assert.equal(result.apiAccessValidated, false);
  assert.equal(result.authorizationSource, 'manager_script_signed_delivery');
  assert.equal(result.advertiserCustomerId, '5662332033');
  assert.equal(JSON.stringify(result).includes('refresh'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('API-validated encrypted connection remains compatible with Manager Script LIVE', async () => {
  const result = await assertGoogleAdsLiveAuthorization({
    ...EXPECTED,
    connectionStore: store(connection({
      advertiserCustomerId: '5662332033',
      accessStatus: 'validated',
      providerMetadata: {
        managerCustomerId: '9463570541',
        approvedAdvertiserCustomerId: '5662332033',
        advertiserCustomerId: '5662332033',
        currencyCode: 'THB',
        timeZone: 'Asia/Bangkok',
      },
      lastValidatedAt: 1785031200000,
    })),
  });
  assert.equal(result.apiAccessValidated, true);
  assert.equal(result.lastValidatedAt, 1785031200000);
});

test('missing connection, unsupported state, scope and active credential fail closed', async () => {
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({ ...EXPECTED, connectionStore: store(null) }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_REQUIRED',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({ accessStatus: 'not_validated' })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_IDENTITY_MISMATCH',
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
});

test('approved advertiser, manager and optional API metadata mismatches are rejected', async () => {
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({
        providerMetadata: {
          managerCustomerId: '9463570541',
          approvedAdvertiserCustomerId: '1111111111',
        },
      })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_IDENTITY_MISMATCH',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({
        providerMetadata: {
          managerCustomerId: '1111111111',
          approvedAdvertiserCustomerId: '5662332033',
        },
      })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_MANAGER_MISMATCH',
  );
  await assert.rejects(
    () => assertGoogleAdsLiveAuthorization({
      ...EXPECTED,
      connectionStore: store(connection({
        providerMetadata: {
          managerCustomerId: '9463570541',
          approvedAdvertiserCustomerId: '5662332033',
          currencyCode: 'USD',
          timeZone: 'Asia/Bangkok',
        },
      })),
    }),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_CONNECTION_METADATA_MISMATCH',
  );
});
