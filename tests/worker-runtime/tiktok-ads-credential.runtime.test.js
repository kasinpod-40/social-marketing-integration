import { expect, it } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { D1CustomerConnectionStore } from '../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../packages/connectors/src/encrypted-customer-credential-repository.js';
import { encodeBase64Url } from '../../packages/shared/src/security/secure-token.js';

it('TikTok Ads long-term grant uses migrated shared D1 and Web Crypto in Workers runtime', async () => {
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const store = new D1CustomerConnectionStore({ db: env.MKT_STATE_DB });
  await store.createConnection({ connectionId: 'tiktok-runtime', connectorKey: 'tiktok_ads', customerKey: 'chemistry_k', createdAt: 1000 });
  const repository = new EncryptedCustomerCredentialRepository({
    store, keyVersion: 'v2', keys: { v2: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))) },
  });
  const binding = { connectionId: 'tiktok-runtime', connectorKey: 'tiktok_ads', credentialKind: 'access_token' };
  const first = await repository.replace({ ...binding, plaintext: 'private-test-access' });
  const next = await repository.replace({ ...binding, previousReference: first, plaintext: 'replacement-test-access' });
  expect(await repository.read({ ...binding, credentialReference: next })).toBe('replacement-test-access');
  await expect(repository.read({ ...binding, credentialReference: first })).rejects.toMatchObject({ code: 'CONNECTION_CREDENTIAL_UNAVAILABLE' });
  const rows = await env.MKT_STATE_DB.prepare("SELECT ciphertext,status FROM encrypted_credentials WHERE connection_id=? AND credential_kind='access_token'").bind(binding.connectionId).all();
  expect(rows.results.filter(row => row.status === 'active')).toHaveLength(1);
  expect(JSON.stringify(rows.results)).not.toContain('test-access');
  expect((await store.getConnection(binding.connectionId)).credentialReference).toBe(next);
});
