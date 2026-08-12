import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preflightMetaCustomerConnection,
  preflightMetaCustomerConnections,
} from '../../packages/application/src/use-cases/preflight-meta-customer-connections.js';
import { permanentError, transientError } from '../../packages/shared/src/errors/runtime-error.js';

function successAdapter(overrides = {}) {
  return {
    async preflight() {
      return {
        candidateCount: 1,
        mappingConfigured: true,
        identityMatched: true,
        grantedPermissions: [],
        ...overrides,
      };
    },
  };
}

test('Meta preflight reports three independent validated connections and zero writes', async () => {
  const result = await preflightMetaCustomerConnections({
    facebook: successAdapter({
      grantedPermissions: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        'read_insights',
      ],
      linkedInstagramCount: 1,
    }),
    instagram: successAdapter({
      grantedPermissions: ['instagram_business_basic'],
      accountType: 'BUSINESS',
    }),
    metaAds: successAdapter({
      grantedPermissions: ['ads_read', 'business_management'],
      activeCandidateCount: 2,
      expectedAccountCount: 2,
      matchedAccountCount: 2,
      missingAccountCount: 0,
    }),
    mappings: {
      facebookPageId: 'page-private',
      instagramAccountId: 'ig-private',
      metaAdAccountIds: ['ad-private-2', 'ad-private-3'],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.businessWrites, 0);
  assert.deepEqual(result.connectors.map((item) => item.status), [
    'identity_validated',
    'identity_validated',
    'identity_validated',
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /page-private|ig-private|ad-private/u);
  assert.equal(result.connectors[2].metadata.expectedAccountCount, 2);
  assert.equal(result.connectors[2].metadata.matchedAccountCount, 2);
});

test('Meta preflight distinguishes missing mapping, scope and identity mismatch', async () => {
  const result = await preflightMetaCustomerConnections({
    facebook: successAdapter({
      mappingConfigured: false,
      identityMatched: false,
      grantedPermissions: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        'read_insights',
      ],
    }),
    instagram: successAdapter({
      mappingConfigured: true,
      identityMatched: false,
      grantedPermissions: ['instagram_business_basic'],
    }),
    metaAds: successAdapter({
      grantedPermissions: ['ads_read'],
    }),
  });

  assert.deepEqual(result.connectors.map((item) => item.status), [
    'identity_mapping_required',
    'identity_mismatch',
    'scope_insufficient',
  ]);
  assert.deepEqual(result.connectors[2].permissions.missing, ['business_management']);
});

test('Meta preflight reports the exact missing Facebook engagement and Insights scopes', async () => {
  const result = await preflightMetaCustomerConnection({
    facebook: successAdapter({
      grantedPermissions: ['pages_show_list', 'pages_read_engagement'],
      linkedInstagramCount: 1,
    }),
    mappings: { facebookPageId: 'page-private' },
  }, 'facebook');

  assert.equal(result.status, 'scope_insufficient');
  assert.deepEqual(result.permissions.missing, ['pages_read_user_content', 'read_insights']);
});

test('Meta preflight classifies blocked, invalid and transient provider failures independently', async () => {
  const blocked = permanentError('Meta Graph request failed', {
    code: 'META_PERMANENT_API_ERROR',
    details: { graphCode: 200, providerReason: 'api_access_blocked' },
  });
  const invalid = permanentError('Meta Graph request failed', {
    code: 'META_PERMANENT_API_ERROR',
    details: { graphCode: 190 },
  });
  const unavailable = transientError('Meta Graph request failed', {
    code: 'META_TRANSIENT_API_ERROR',
    details: { graphCode: 4 },
  });
  const throwing = (error) => ({
    async preflight() { throw error; },
  });
  const result = await preflightMetaCustomerConnections({
    facebook: throwing(blocked),
    instagram: throwing(invalid),
    metaAds: throwing(unavailable),
    mappings: {},
  });

  assert.deepEqual(result.connectors.map((item) => item.status), [
    'provider_blocked',
    'token_invalid',
    'provider_unavailable',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /API access blocked/u);
});

test('Meta preflight reports an entirely empty runtime as fail-closed not_configured', async () => {
  const result = await preflightMetaCustomerConnections({});

  assert.equal(result.ok, false);
  assert.equal(result.businessWrites, 0);
  assert.equal(result.connectors.every((item) => item.status === 'not_configured'), true);
});

test('scoped Meta Ads preflight validates only the selected configured alias', async () => {
  const calls = [];
  const result = await preflightMetaCustomerConnection({
    metaAds: {
      async preflight(input) {
        calls.push(input);
        return {
          candidateCount: 2,
          activeCandidateCount: 2,
          expectedAccountCount: 1,
          matchedAccountCount: 1,
          missingAccountCount: 0,
          mappingConfigured: true,
          identityMatched: true,
          grantedPermissions: ['ads_read', 'business_management'],
        };
      },
    },
    mappings: {
      metaAdAccounts: [
        { key: 'chemistry_k2', accountId: '505898710119851' },
        { key: 'chemistry_k3', accountId: '851206695716861' },
      ],
    },
  }, 'meta_ads', { sourceAccountKey: 'chemistry_k3' });

  assert.equal(result.status, 'identity_validated');
  assert.equal(result.metadata.expectedAccountCount, 1);
  assert.deepEqual(calls, [{ expectedAdAccountIds: ['851206695716861'] }]);
  assert.doesNotMatch(JSON.stringify(result), /851206695716861/u);
});

test('unknown Meta Ads alias fails before a Provider request', async () => {
  let calls = 0;
  await assert.rejects(
    preflightMetaCustomerConnection({
      metaAds: {
        async preflight() {
          calls += 1;
          return {};
        },
      },
      mappings: {
        metaAdAccounts: [{ key: 'chemistry_k2', accountId: '505898710119851' }],
      },
    }, 'meta_ads', { sourceAccountKey: 'unknown' }),
    (error) => error.code === 'META_AD_ACCOUNT_MAPPING_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});
