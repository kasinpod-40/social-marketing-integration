import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGoogleAdsRuntimeConfig,
  loadGoogleOAuthRuntimeConfig,
  loadCustomerCredentialRuntimeConfig,
  loadCustomerConnectionRuntimeConfig,
} from '../../apps/sync-worker/src/customer-connection-runtime.js';

test('connection runtime locks Integration Workspace and reads exact redirect/key contracts', () => {
  const config = loadCustomerConnectionRuntimeConfig(validEnv());
  assert.equal(config.environment, 'development');
  assert.equal(config.customerProfile, 'integration_workspace');
  assert.equal(config.customerKey, 'chemistry_k');
  assert.equal(config.redirectUris.google_ads, 'https://worker.example/oauth/google-ads/callback');
  assert.equal(config.redirectUris.youtube, 'https://worker.example/oauth/youtube/callback');
  assert.equal(config.encryptionKeyVersion, 'v1');
  assert.equal(loadCustomerCredentialRuntimeConfig(validEnv()).customerKey, 'chemistry_k');
  assert.equal(loadGoogleAdsRuntimeConfig(validEnv()).managerCustomerId, '9463570541');
  assert.equal(loadGoogleAdsRuntimeConfig(validEnv()).advertiserCustomerId, '5662332033');
  assert.equal(loadGoogleOAuthRuntimeConfig(validEnv()).clientId, 'google-client-id');
});

test('connection runtime rejects historical profiles and placeholder secrets', () => {
  assert.throws(
    () => loadCustomerConnectionRuntimeConfig({
      ...validEnv(),
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    }),
    /reviewed environment\/profile tuple/u,
  );
  assert.throws(
    () => loadCustomerConnectionRuntimeConfig({
      ...validEnv(),
      MKT_CONNECTION_OPERATOR_TOKEN: 'replace-with-operator-token',
    }),
    /Worker Secrets/u,
  );
});

test('shared/YouTube runtime does not require a Google Ads Developer Token', () => {
  const env = validEnv();
  delete env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete env.MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID;
  delete env.MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID;
  assert.equal(loadCustomerConnectionRuntimeConfig(env).customerKey, 'chemistry_k');
  assert.equal(loadGoogleOAuthRuntimeConfig(env).clientId, 'google-client-id');
  assert.throws(() => loadGoogleAdsRuntimeConfig(env), /GOOGLE_ADS_DEVELOPER_TOKEN/u);
});

test('Queue credential runtime does not require HTTP invitation or redirect secrets', () => {
  const env = validEnv();
  for (const field of [
    'MKT_CONNECTION_PUBLIC_ORIGIN',
    'MKT_GOOGLE_ADS_REDIRECT_URI',
    'MKT_YOUTUBE_REDIRECT_URI',
    'MKT_CONNECTION_OPERATOR_TOKEN',
    'MKT_CONNECTION_INVITATION_SIGNING_KEY',
    'MKT_CONNECTION_STATE_SIGNING_KEY',
    'MKT_CONNECTION_SELECTION_SIGNING_KEY',
  ]) delete env[field];
  const config = loadCustomerCredentialRuntimeConfig(env);
  assert.equal(config.customerProfile, 'integration_workspace');
  assert.equal(config.encryptionKeyVersion, 'v1');
});

test('Queue credential runtime admits only exact Customer Production and loads bounded previous keys', () => {
  const config = loadCustomerCredentialRuntimeConfig({
    ...validEnv(),
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTION_ENCRYPTION_KEY_VERSION: 'v2',
    MKT_CONNECTION_ENCRYPTION_KEY_PREVIOUS_VERSIONS: 'v1',
    MKT_CONNECTION_ENCRYPTION_KEY_V2: 'customer-encryption-key',
  });
  assert.equal(config.environment, 'production');
  assert.equal(config.customerProfile, 'chemistry_k');
  assert.deepEqual(config.encryptionKeyVersions, ['v2', 'v1']);
  assert.deepEqual(config.encryptionKeys, {
    v2: 'customer-encryption-key',
    v1: 'encryption-key',
  });

  for (const [environment, profile] of [
    ['production', 'integration_workspace'],
    ['development', 'chemistry_k'],
    ['production', 'other'],
  ]) {
    assert.throws(
      () => loadCustomerCredentialRuntimeConfig({
        ...validEnv(),
        MKT_ENV: environment,
        MKT_CUSTOMER_PROFILE: profile,
      }),
      /(?:reviewed environment\/profile tuple|Invalid runtime pairing|Unknown MKT_CUSTOMER_PROFILE)/u,
    );
  }
});

function validEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_PUBLIC_ORIGIN: 'https://worker.example',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_GOOGLE_ADS_REDIRECT_URI: 'https://worker.example/oauth/google-ads/callback',
    MKT_YOUTUBE_REDIRECT_URI: 'https://worker.example/oauth/youtube/callback',
    MKT_CONNECTION_OPERATOR_TOKEN: 'operator-secret',
    MKT_CONNECTION_INVITATION_SIGNING_KEY: 'invitation-signing-key',
    MKT_CONNECTION_STATE_SIGNING_KEY: 'state-signing-key',
    MKT_CONNECTION_SELECTION_SIGNING_KEY: 'selection-signing-key',
    MKT_CONNECTION_ENCRYPTION_KEY_VERSION: 'v1',
    MKT_CONNECTION_ENCRYPTION_KEY_V1: 'encryption-key',
    GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
    MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID: '946-357-0541',
    MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID: '566-233-2033',
    MKT_GOOGLE_ADS_API_VERSION: 'v24',
  };
}
