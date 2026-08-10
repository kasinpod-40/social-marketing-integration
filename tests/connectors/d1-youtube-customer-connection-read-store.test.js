import test from 'node:test';
import assert from 'node:assert/strict';
import { D1YouTubeCustomerConnectionReadStore } from '../../packages/connectors/src/youtube/d1-youtube-customer-connection-read-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

function createConnectionDb(input = {}) {
  const d1 = createSqliteD1();
  d1.exec(`
    CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      customer_key TEXT NOT NULL,
      connector_key TEXT NOT NULL,
      external_account_id TEXT,
      connection_status TEXT NOT NULL,
      access_status TEXT NOT NULL,
      granted_scopes_json TEXT,
      last_validated_at INTEGER,
      last_error_code TEXT,
      credential_reference TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE encrypted_credentials (
      connection_id TEXT NOT NULL,
      credential_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      credential_reference TEXT NOT NULL,
      key_version TEXT NOT NULL
    );
  `);
  d1.prepare(`
    INSERT INTO connections (
      id, customer_key, connector_key, external_account_id, connection_status,
      access_status, granted_scopes_json, last_validated_at, last_error_code,
      credential_reference, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    'connection-1',
    'chemistry_k',
    'youtube',
    'UC_CUSTOMER_CHANNEL',
    'connected',
    'validated',
    JSON.stringify([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ]),
    1785031200000,
    null,
    'credential-1',
    1785034568523,
  ).run();
  if (input.withActiveCredential !== false) {
    d1.prepare(`
      INSERT INTO encrypted_credentials (
        connection_id, credential_kind, status, credential_reference, key_version
      ) VALUES (?, ?, ?, ?, ?)
    `).bind('connection-1', 'refresh_token', 'active', 'credential-1', 'v1').run();
  }
  return d1;
}

test('D1 YouTube read store returns validated connection and matching active credential reference', async () => {
  const d1 = createConnectionDb();
  try {
    const store = new D1YouTubeCustomerConnectionReadStore({ db: d1 });
    const result = await store.findOwnerAuthorizedConnection({ customerKey: 'chemistry_k' });
    assert.equal(result.connectorKey, 'youtube');
    assert.equal(result.externalAccountId, 'UC_CUSTOMER_CHANNEL');
    assert.equal(result.credentialReference, 'credential-1');
    assert.equal(result.activeCredentialReference, 'credential-1');
    assert.equal(result.credentialKeyVersion, 'v1');
  } finally {
    d1.close();
  }
});

test('D1 YouTube read store exposes missing active reference for fail-closed authorization', async () => {
  const d1 = createConnectionDb({ withActiveCredential: false });
  try {
    const store = new D1YouTubeCustomerConnectionReadStore({ db: d1 });
    const result = await store.findOwnerAuthorizedConnection({ customerKey: 'chemistry_k' });
    assert.equal(result.credentialReference, 'credential-1');
    assert.equal(result.activeCredentialReference, null);
  } finally {
    d1.close();
  }
});
