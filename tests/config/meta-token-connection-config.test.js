import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_REQUIRED_PERMISSIONS,
  loadMetaTokenConnectionConfig,
} from '../../packages/config/src/meta-token-connection-config.js';

test('Meta token connection config permits a fully unconfigured fail-closed foundation', () => {
  const config = loadMetaTokenConnectionConfig({});

  assert.equal(config.apiVersion, null);
  assert.equal(config.credentials.facebookAccessToken, null);
  assert.equal(config.credentials.facebookPageAccessToken, null);
  assert.equal(config.credentials.instagramAccessToken, null);
  assert.equal(config.mappings.facebookPageId, null);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.credentials), true);
});

test('Meta token connection config requires a pinned API version when any token exists', () => {
  assert.throws(
    () => loadMetaTokenConnectionConfig({ META_ACCESS_TOKEN: 'facebook-private' }),
    (error) => error?.code === 'META_CONNECTION_CONFIG_INVALID'
      && error?.details?.fieldName === 'META_GRAPH_API_VERSION',
  );
  assert.throws(
    () => loadMetaTokenConnectionConfig({
      META_GRAPH_API_VERSION: 'latest',
      META_ACCESS_TOKEN: 'facebook-private',
    }),
    (error) => error?.code === 'META_CONNECTION_CONFIG_INVALID',
  );
});

test('Meta token connection config separates credentials and exact mappings', () => {
  const config = loadMetaTokenConnectionConfig({
    META_GRAPH_API_VERSION: 'V25.0',
    META_ACCESS_TOKEN: 'facebook-private',
    META_FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-page-private',
    META_INSTAGRAM_ACCESS_TOKEN: 'instagram-private',
    META_FACEBOOK_PAGE_ID: 'page-private',
    META_INSTAGRAM_ACCOUNT_ID: 'instagram-account-private',
    META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=act_12345,chemistry_k3=67890',
    META_MAX_PAGES: '7',
  });

  assert.equal(config.apiVersion, 'v25.0');
  assert.equal(config.credentials.facebookAccessToken, 'facebook-private');
  assert.equal(config.credentials.facebookPageAccessToken, 'facebook-page-private');
  assert.equal(config.credentials.instagramAccessToken, 'instagram-private');
  assert.equal(config.mappings.facebookPageId, 'page-private');
  assert.equal(config.mappings.instagramAccountId, 'instagram-account-private');
  assert.deepEqual(config.mappings.metaAdAccounts, [
    { key: 'chemistry_k2', accountId: '12345' },
    { key: 'chemistry_k3', accountId: '67890' },
  ]);
  assert.deepEqual(config.mappings.metaAdAccountIds, ['12345', '67890']);
  assert.equal(config.mappings.metaAdAccountId, null);
  assert.equal(config.transport.maxPages, 7);
  assert.deepEqual(META_REQUIRED_PERMISSIONS.meta_ads, ['ads_read', 'business_management']);
});


test('Meta token connection config rejects ambiguous or duplicate multi-account mappings', () => {
  assert.throws(
    () => loadMetaTokenConnectionConfig({
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=123,chemistry_k3=123',
    }),
    (error) => error?.code === 'META_CONNECTION_CONFIG_INVALID',
  );
  assert.throws(
    () => loadMetaTokenConnectionConfig({
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=123',
      META_AD_ACCOUNT_ID: '456',
    }),
    (error) => error?.code === 'META_CONNECTION_CONFIG_INVALID',
  );
});

test('Meta token connection config rejects credential and mapping placeholders', () => {
  assert.throws(
    () => loadMetaTokenConnectionConfig({
      META_GRAPH_API_VERSION: 'v25.0',
      META_ACCESS_TOKEN: 'replace-with-meta-access-token',
    }),
    (error) => error?.code === 'META_CREDENTIAL_PLACEHOLDER',
  );
  assert.throws(
    () => loadMetaTokenConnectionConfig({
      META_FACEBOOK_PAGE_ID: 'replace-with-facebook-page-id',
    }),
    (error) => error?.code === 'META_CONNECTION_CONFIG_PLACEHOLDER',
  );
});
