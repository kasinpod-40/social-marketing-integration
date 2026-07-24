import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightMetaCustomerConnections } from '../../packages/application/src/use-cases/preflight-meta-customer-connections.js';
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
      grantedPermissions: ['pages_show_list', 'pages_read_engagement'],
      linkedInstagramCount: 1,
    }),
    instagram: successAdapter({
      grantedPermissions: ['instagram_business_basic'],
      accountType: 'BUSINESS',
    }),
    metaAds: successAdapter({
      grantedPermissions: ['ads_read', 'business_management'],
      activeCandidateCount: 1,
    }),
    mappings: {
      facebookPageId: 'page-private',
      instagramAccountId: 'ig-private',
      metaAdAccountId: 'ad-private',
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
});

test('Meta preflight distinguishes missing mapping, scope and identity mismatch', async () => {
  const result = await preflightMetaCustomerConnections({
    facebook: successAdapter({
      mappingConfigured: false,
      identityMatched: false,
      grantedPermissions: ['pages_show_list', 'pages_read_engagement'],
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
