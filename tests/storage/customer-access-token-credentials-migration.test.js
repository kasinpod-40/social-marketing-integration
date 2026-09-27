import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import { D1CustomerConnectionStore } from '../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../packages/connectors/src/encrypted-customer-credential-repository.js';

test('0024 preserves existing encrypted payloads, replacement links and PKCE foreign keys', async () => {
  const db = createSqliteD1();
  try {
    for (const file of ['0001_initial.sql', '0011_customer_connection_oauth.sql']) {
      db.exec(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
    }
    db.exec(`INSERT INTO connections(id,platform,account_id,status) VALUES ('c','youtube','a','connected');
      INSERT INTO encrypted_credentials VALUES ('new','c','refresh_token','cipher-new','iv-new','AES-256-GCM','v2','active',NULL,2,2,NULL);
      INSERT INTO encrypted_credentials VALUES ('old','c','refresh_token','cipher-old','iv-old','AES-256-GCM','v1','replaced','new',1,2,NULL);
      INSERT INTO encrypted_credentials VALUES ('pkce','c','pkce_verifier','cipher-pkce','iv-pkce','AES-256-GCM','v2','active',NULL,3,3,NULL);
      INSERT INTO connection_invitations(invitation_id,connector_key,customer_key,environment,nonce_hash,redirect_uri,issued_at,expires_at,created_at,connection_id)
        VALUES ('i','youtube','chemistry_k','production','n','https://example.test/callback',1,100,1,'c');
      INSERT INTO oauth_state_attempts(attempt_id,invitation_id,connection_id,connector_key,customer_key,redirect_uri,nonce_hash,pkce_credential_reference,issued_at,expires_at,created_at,updated_at)
        VALUES ('s','i','c','youtube','chemistry_k','https://example.test/callback','state','pkce',1,100,1,1);`);
    const before = db.database.prepare('SELECT * FROM encrypted_credentials ORDER BY credential_reference').all();
    const migration = await readFile(new URL('../../migrations/0024_customer_access_token_credentials.sql', import.meta.url), 'utf8');
    db.exec(`BEGIN; ${migration} COMMIT;`);
    assert.deepEqual(db.database.prepare('SELECT * FROM encrypted_credentials ORDER BY credential_reference').all(), before);
    assert.deepEqual(db.database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.database.prepare('SELECT pkce_credential_reference FROM oauth_state_attempts').get().pkce_credential_reference, 'pkce');
    assert.throws(() => db.exec("INSERT INTO encrypted_credentials SELECT 'duplicate',connection_id,credential_kind,ciphertext,iv,algorithm,key_version,status,replaced_by,created_at,updated_at,revoked_at FROM encrypted_credentials WHERE credential_reference='new'"), /UNIQUE/u);
    assert.throws(() => db.exec("INSERT INTO encrypted_credentials SELECT 'bad',connection_id,'plaintext_token',ciphertext,iv,algorithm,key_version,status,replaced_by,created_at,updated_at,revoked_at FROM encrypted_credentials WHERE credential_reference='new'"), /CHECK/u);

    const store = new D1CustomerConnectionStore({ db });
    const repository = new EncryptedCustomerCredentialRepository({
      store, keyVersion: 'v2', keys: { v2: Buffer.alloc(32, 7).toString('base64url') },
    });
    const input = { connectionId: 'c', connectorKey: 'tiktok_ads', credentialKind: 'access_token' };
    const first = await repository.replace({ ...input, plaintext: 'private-access-one' });
    const next = await repository.replace({ ...input, previousReference: first, plaintext: 'private-access-two' });
    assert.equal(await repository.read({ ...input, credentialReference: next }), 'private-access-two');
    await assert.rejects(() => repository.read({ ...input, credentialReference: first }), { code: 'CONNECTION_CREDENTIAL_UNAVAILABLE' });
    await assert.rejects(() => repository.read({ ...input, credentialKind: 'refresh_token', credentialReference: next }), { code: 'CONNECTION_CREDENTIAL_BINDING_MISMATCH' });
    await assert.rejects(() => repository.read({ ...input, connectorKey: 'youtube', credentialReference: next }));
    assert.equal(db.database.prepare("SELECT credential_reference FROM connections WHERE id='c'").get().credential_reference, next);
    assert.equal(db.database.prepare("SELECT COUNT(*) n FROM encrypted_credentials WHERE credential_kind='access_token' AND status='active'").get().n, 1);
    assert.equal(JSON.stringify(db.database.prepare("SELECT * FROM encrypted_credentials WHERE credential_kind='access_token'").all()).includes('private-access'), false);
  } finally { db.close(); }
});
