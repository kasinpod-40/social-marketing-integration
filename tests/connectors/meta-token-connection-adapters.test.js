import test from 'node:test';
import assert from 'node:assert/strict';
import { FacebookPageConnectionAdapter } from '../../packages/connectors/src/meta/facebook-page-connection.adapter.js';
import { InstagramBusinessConnectionAdapter } from '../../packages/connectors/src/meta/instagram-business-connection.adapter.js';
import { MetaAdsConnectionAdapter } from '../../packages/connectors/src/meta/meta-ads-connection.adapter.js';

test('Facebook Page adapter validates exact identity and granted permissions without names', async () => {
  const calls = [];
  const adapter = new FacebookPageConnectionAdapter({
    client: {
      async listEdge(path, query) {
        calls.push({ path, query });
        if (path === 'me/permissions') {
          return [
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'pages_read_engagement', status: 'granted' },
          ];
        }
        return [
          { id: 'page_A', instagram_business_account: { id: 'ig_A' } },
          { id: 'page_B' },
        ];
      },
    },
  });

  const result = await adapter.preflight({ expectedPageId: 'page_B' });
  assert.equal(result.candidateCount, 2);
  assert.equal(result.linkedInstagramCount, 1);
  assert.equal(result.mappingConfigured, true);
  assert.equal(result.identityMatched, true);
  assert.deepEqual(result.grantedPermissions, ['pages_read_engagement', 'pages_show_list']);
  assert.deepEqual(calls.map((call) => call.path), ['me/permissions', 'me/accounts']);
  assert.equal(JSON.stringify(result).includes('page_A'), false);
  assert.equal(JSON.stringify(result).includes('ig_A'), false);
});

test('Instagram adapter uses /me identity and never returns the external ID', async () => {
  const calls = [];
  const adapter = new InstagramBusinessConnectionAdapter({
    client: {
      async get(path, query) {
        calls.push({ path, query });
        return { user_id: 'ig-private', account_type: 'MEDIA_CREATOR' };
      },
    },
  });

  const result = await adapter.preflight({ expectedAccountId: 'ig-private' });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.identityMatched, true);
  assert.equal(result.accountType, 'MEDIA_CREATOR');
  assert.deepEqual(result.grantedPermissions, ['instagram_business_basic']);
  assert.equal(calls[0].path, 'me');
  assert.equal(JSON.stringify(result).includes('ig-private'), false);
});

test('Meta Ads adapter normalizes act_ identity and returns counts only', async () => {
  const adapter = new MetaAdsConnectionAdapter({
    client: {
      async listEdge(path) {
        if (path === 'me/permissions') {
          return [
            { permission: 'ads_read', status: 'granted' },
            { permission: 'business_management', status: 'granted' },
          ];
        }
        return [
          { id: 'act_123', account_id: '123', account_status: 1, currency: 'THB' },
          { id: 'act_456', account_status: 2, currency: 'USD' },
        ];
      },
    },
  });

  const result = await adapter.preflight({ expectedAdAccountIds: ['act_123', '456'] });
  assert.equal(result.candidateCount, 2);
  assert.equal(result.activeCandidateCount, 1);
  assert.equal(result.expectedAccountCount, 2);
  assert.equal(result.matchedAccountCount, 2);
  assert.equal(result.missingAccountCount, 0);
  assert.equal(result.identityMatched, true);
  assert.equal(JSON.stringify(result).includes('123'), false);
  assert.equal(JSON.stringify(result).includes('THB'), false);
});
