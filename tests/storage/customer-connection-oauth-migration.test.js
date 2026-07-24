import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const INITIAL_URL = new URL('../../migrations/0001_initial.sql', import.meta.url);
const MIGRATION_URL = new URL('../../migrations/0011_customer_connection_oauth.sql', import.meta.url);
const RETRY_MIGRATION_URL = new URL(
  '../../migrations/0012_retry_safe_customer_connection.sql',
  import.meta.url,
);

test('migration 0011 extends the existing connection authority and preserves legacy rows', async () => {
  const [initial, migration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  try {
    d1.exec(initial);
    d1.database.prepare(`
      INSERT INTO connections(id, platform, account_id, account_name, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy-1', 'youtube', 'legacy-account', 'Legacy', 'connected');
    d1.exec(migration);

    const row = d1.database.prepare(`
      SELECT id, platform, account_id, account_name, status, customer_key, credential_reference
      FROM connections WHERE id = ?
    `).get('legacy-1');
    assert.deepEqual(row, {
      id: 'legacy-1',
      platform: 'youtube',
      account_id: 'legacy-account',
      account_name: 'Legacy',
      status: 'connected',
      customer_key: null,
      credential_reference: null,
    });

    const columns = d1.database.prepare('PRAGMA table_info(connections)').all().map((item) => item.name);
    for (const name of [
      'customer_key',
      'connector_key',
      'provider',
      'external_account_id',
      'external_account_name',
      'credential_reference',
      'granted_scopes_json',
      'connection_status',
      'access_status',
      'last_error_code',
      'provider_metadata_json',
    ]) assert.ok(columns.includes(name), name);
  } finally {
    d1.close();
  }
});

test('migration 0011 creates one-time invitation, OAuth state and encrypted credential tables', async () => {
  const [initial, migration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  try {
    d1.exec(initial);
    d1.exec(migration);

    const tables = d1.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((item) => item.name);
    for (const name of [
      'connections',
      'connection_invitations',
      'oauth_state_attempts',
      'encrypted_credentials',
      'connection_identity_selections',
    ]) assert.ok(tables.includes(name), name);

    assert.throws(() => d1.database.prepare(`
      INSERT INTO connection_invitations (
        invitation_id, connector_key, customer_key, environment, nonce_hash,
        redirect_uri, issued_at, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'expired-before-issued',
      'youtube',
      'customer',
      'development',
      'nonce',
      'https://example.test/oauth/youtube/callback',
      100,
      99,
      100,
    ), /CHECK constraint failed/u);
  } finally {
    d1.close();
  }
});

test('migration 0011 rejects plaintext-like credential kinds and unsupported algorithms', async () => {
  const [initial, migration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  try {
    d1.exec(initial);
    d1.exec(migration);
    d1.database.prepare(`
      INSERT INTO connections (
        id, platform, account_id, status, customer_key, connector_key, provider,
        connection_status, access_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'connection-1',
      'youtube',
      'pending:connection-1',
      'authorization_pending',
      'customer',
      'youtube',
      'google',
      'authorization_pending',
      'not_validated',
    );

    assert.throws(() => d1.database.prepare(`
      INSERT INTO encrypted_credentials (
        credential_reference, connection_id, credential_kind, ciphertext, iv,
        algorithm, key_version, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'credential-1',
      'connection-1',
      'plaintext_token',
      'ciphertext',
      'iv',
      'AES-256-GCM',
      'v1',
      'active',
      1,
      1,
    ), /CHECK constraint failed/u);

    assert.throws(() => d1.database.prepare(`
      INSERT INTO encrypted_credentials (
        credential_reference, connection_id, credential_kind, ciphertext, iv,
        algorithm, key_version, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'credential-2',
      'connection-1',
      'refresh_token',
      'ciphertext',
      'iv',
      'AES-CBC',
      'v1',
      'active',
      1,
      1,
    ), /CHECK constraint failed/u);
  } finally {
    d1.close();
  }
});

test('migration 0012 adds bounded retry state without reopening legacy invitations', async () => {
  const [initial, migration, retryMigration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
    readFile(RETRY_MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  try {
    d1.exec(initial);
    d1.exec(migration);
    d1.database.prepare(`
      INSERT INTO connection_invitations (
        invitation_id, connector_key, customer_key, environment, nonce_hash,
        redirect_uri, issued_at, expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-consumed',
      'youtube',
      'customer',
      'development',
      'legacy-nonce',
      'https://example.test/oauth/youtube/callback',
      100,
      1_000,
      500,
      100,
    );

    d1.exec(retryMigration);

    const row = d1.database.prepare(`
      SELECT attempt_count, max_attempts, active_attempt_id, active_attempt_expires_at, consumed_at
      FROM connection_invitations WHERE invitation_id = ?
    `).get('legacy-consumed');
    assert.deepEqual(row, {
      attempt_count: 0,
      max_attempts: 1,
      active_attempt_id: null,
      active_attempt_expires_at: null,
      consumed_at: 500,
    });
    const columns = d1.database.prepare(
      'PRAGMA table_info(connection_invitations)',
    ).all().map((item) => item.name);
    for (const name of [
      'attempt_count',
      'max_attempts',
      'active_attempt_id',
      'active_attempt_expires_at',
    ]) assert.ok(columns.includes(name), name);
  } finally {
    d1.close();
  }
});
