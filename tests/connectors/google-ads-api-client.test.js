import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAdsApiClient } from '../../packages/connectors/src/google-ads/google-ads-api.client.js';

test('Google Ads access validation uses v24, manager header and exact advertiser identity', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({
      results: [{
        customer: {
          id: '5662332033',
          descriptiveName: 'Customer',
          currencyCode: 'THB',
          timeZone: 'Asia/Bangkok',
        },
      }],
    });
  });
  const identity = await client.validateTargetCustomer('access-private');
  assert.deepEqual(identity, {
    customerId: '5662332033',
    descriptiveName: 'Customer',
    currencyCode: 'THB',
    timeZone: 'Asia/Bangkok',
  });
  assert.equal(calls[0].url, 'https://googleads.googleapis.com/v24/customers/5662332033/googleAds:search');
  assert.equal(calls[0].init.headers['login-customer-id'], '9463570541');
  assert.equal(calls[0].init.headers.authorization, 'Bearer access-private');
  assert.match(JSON.parse(calls[0].init.body).query, /FROM customer LIMIT 1/u);
});

test('Google Ads developer token approval failure has a distinct retained-credential status code', async () => {
  const client = createClient(async () => Response.json({
    error: {
      code: 403,
      details: [{
        errors: [{
          errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' },
        }],
      }],
    },
  }, { status: 403 }));
  await assert.rejects(
    () => client.validateTargetCustomer('access-private'),
    (error) => (
      error.code === 'GOOGLE_ADS_API_ACCESS_PENDING'
      && JSON.stringify(error).includes('access-private') === false
    ),
  );
});

test('Google Ads target identity mismatch fails closed', async () => {
  const client = createClient(async () => Response.json({
    results: [{ customer: { id: '1111111111' } }],
  }));
  await assert.rejects(
    () => client.validateTargetCustomer('access-private'),
    (error) => error.code === 'GOOGLE_ADS_CUSTOMER_IDENTITY_MISMATCH',
  );
});

function createClient(fetchImpl) {
  return new GoogleAdsApiClient({
    developerToken: 'developer-private',
    loginCustomerId: '946-357-0541',
    targetCustomerId: '566-233-2033',
    fetchImpl,
  });
}
