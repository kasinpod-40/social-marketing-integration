import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import { D1CustomerConnectionStore } from '../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../packages/connectors/src/encrypted-customer-credential-repository.js';
import { encodeBase64Url } from '../../packages/shared/src/security/secure-token.js';

const INITIAL_URL = new URL('../../migrations/0001_initial.sql', import.meta.url);
const MIGRATION_URL = new URL('../../migrations/0011_customer_connection_oauth.sql', import.meta.url);
const RETRY_MIGRATION_URL = new URL(
  '../../migrations/0012_retry_safe_customer_connection.sql',
  import.meta.url,
);
const ENCRYPTION_KEY = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));

test('D1 invitation reservation is exact, bounded and allows retry after active state expiry', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createInvitation({
      invitationId: 'invitation-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      environment: 'development',
      nonceHash: 'nonce-hash',
      redirectUri: 'https://example.test/oauth/youtube/callback',
      issuedAt: 1_000,
      expiresAt: 2_000,
      maxAttempts: 2,
    });

    await assert.rejects(
      () => fixture.store.reserveInvitationAttempt({
        id: 'invitation-1',
        attemptId: 'attempt-wrong',
        connectorKey: 'google_ads',
        customerKey: 'customer',
        nonceHash: 'nonce-hash',
        maxAttempts: 2,
        attemptExpiresAt: 1_700,
        now: 1_500,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_MISMATCH',
    );
    const reserved = await fixture.store.reserveInvitationAttempt({
      id: 'invitation-1',
      attemptId: 'attempt-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'nonce-hash',
      maxAttempts: 2,
      attemptExpiresAt: 1_700,
      now: 1_500,
    });
    assert.equal(reserved.attemptCount, 1);
    assert.equal(reserved.consumedAt, null);
    await assert.rejects(
      () => fixture.store.reserveInvitationAttempt({
        id: 'invitation-1',
        attemptId: 'attempt-2',
        connectorKey: 'youtube',
        customerKey: 'customer',
        nonceHash: 'nonce-hash',
        maxAttempts: 2,
        attemptExpiresAt: 1_800,
        now: 1_600,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_ATTEMPT_ACTIVE',
    );
    const retried = await fixture.store.reserveInvitationAttempt({
      id: 'invitation-1',
      attemptId: 'attempt-2',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'nonce-hash',
      maxAttempts: 2,
      attemptExpiresAt: 1_950,
      now: 1_701,
    });
    assert.equal(retried.attemptCount, 2);
    await assert.rejects(
      () => fixture.store.reserveInvitationAttempt({
        id: 'invitation-1',
        attemptId: 'attempt-3',
        connectorKey: 'youtube',
        customerKey: 'customer',
        nonceHash: 'nonce-hash',
        maxAttempts: 2,
        attemptExpiresAt: 1_990,
        now: 1_951,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_ATTEMPTS_EXHAUSTED',
    );
  } finally {
    fixture.close();
  }
});

test('D1 invitation permits one concurrent reservation and closes only after successful completion', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createInvitation({
      invitationId: 'invitation-concurrent',
      connectorKey: 'google_ads',
      customerKey: 'customer',
      environment: 'development',
      nonceHash: 'nonce-concurrent',
      redirectUri: 'https://example.test/oauth/google-ads/callback',
      issuedAt: 1_000,
      expiresAt: 10_000,
      maxAttempts: 3,
    });
    const reserve = (attemptId) => fixture.store.reserveInvitationAttempt({
      id: 'invitation-concurrent',
      attemptId,
      connectorKey: 'google_ads',
      customerKey: 'customer',
      nonceHash: 'nonce-concurrent',
      maxAttempts: 3,
      attemptExpiresAt: 2_000,
      now: 1_100,
    });
    const outcomes = await Promise.allSettled([reserve('attempt-a'), reserve('attempt-b')]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(
      outcomes.filter((item) => item.status === 'rejected')[0].reason.code,
      'CONNECTION_INVITATION_ATTEMPT_ACTIVE',
    );
    const activeAttemptId = outcomes.find((item) => item.status === 'fulfilled').value.activeAttemptId;

    await fixture.store.createConnection({
      connectionId: 'connection-concurrent',
      connectorKey: 'google_ads',
      customerKey: 'customer',
      createdAt: 1_100,
    });
    await fixture.store.attachInvitationConnection({
      invitationId: 'invitation-concurrent',
      connectionId: 'connection-concurrent',
      attemptId: activeAttemptId,
    });
    const completed = await fixture.store.completeInvitation({
      id: 'invitation-concurrent',
      attemptId: activeAttemptId,
      connectionId: 'connection-concurrent',
      connectorKey: 'google_ads',
      customerKey: 'customer',
      now: 1_200,
    });
    assert.equal(completed.consumedAt, 1_200);
    assert.equal(completed.activeAttemptId, null);
    await assert.rejects(
      () => reserve('attempt-after-success'),
      (error) => error.code === 'CONNECTION_INVITATION_REPLAYED',
    );
  } finally {
    fixture.close();
  }
});

test('D1 invitation release permits an immediate bounded retry after callback failure', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createInvitation({
      invitationId: 'invitation-release',
      connectorKey: 'youtube',
      customerKey: 'customer',
      environment: 'development',
      nonceHash: 'nonce-release',
      redirectUri: 'https://example.test/oauth/youtube/callback',
      issuedAt: 1_000,
      expiresAt: 10_000,
      maxAttempts: 3,
    });
    await fixture.store.reserveInvitationAttempt({
      id: 'invitation-release',
      attemptId: 'attempt-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'nonce-release',
      maxAttempts: 3,
      attemptExpiresAt: 2_000,
      now: 1_100,
    });
    await fixture.store.releaseInvitationAttempt({
      id: 'invitation-release',
      attemptId: 'attempt-1',
      connectionId: 'connection-not-created',
      connectorKey: 'youtube',
      customerKey: 'customer',
      now: 1_200,
    });
    const retry = await fixture.store.reserveInvitationAttempt({
      id: 'invitation-release',
      attemptId: 'attempt-2',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'nonce-release',
      maxAttempts: 3,
      attemptExpiresAt: 2_100,
      now: 1_201,
    });
    assert.equal(retry.attemptCount, 2);
    assert.equal(retry.activeAttemptId, 'attempt-2');

    await fixture.store.createConnection({
      connectionId: 'connection-release',
      connectorKey: 'youtube',
      customerKey: 'customer',
      createdAt: 1_202,
    });
    await fixture.store.attachInvitationConnection({
      invitationId: 'invitation-release',
      connectionId: 'connection-release',
      attemptId: 'attempt-2',
    });
    await assert.rejects(
      () => fixture.store.releaseInvitationAttempt({
        id: 'invitation-release',
        attemptId: 'attempt-2',
        connectionId: 'wrong-connection',
        connectorKey: 'youtube',
        customerKey: 'customer',
        now: 1_203,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_MISMATCH',
    );
  } finally {
    fixture.close();
  }
});

test('D1 OAuth state consume rejects connector/customer/redirect mismatch and replay', async () => {
  const fixture = await createFixture();
  try {
    await seedPendingAttempt(fixture.store);
    await assert.rejects(
      () => fixture.store.consumeOAuthState({
        id: 'attempt-1',
        connectorKey: 'youtube',
        customerKey: 'other-customer',
        redirectUri: 'https://example.test/oauth/youtube/callback',
        nonceHash: 'state-hash',
        now: 1_500,
      }),
      (error) => error.code === 'CONNECTION_OAUTH_STATE_MISMATCH',
    );
    const state = await fixture.store.consumeOAuthState({
      id: 'attempt-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      redirectUri: 'https://example.test/oauth/youtube/callback',
      nonceHash: 'state-hash',
      now: 1_500,
    });
    assert.equal(state.connectionId, 'connection-1');
    await assert.rejects(
      () => fixture.store.consumeOAuthState({
        id: 'attempt-1',
        connectorKey: 'youtube',
        customerKey: 'customer',
        redirectUri: 'https://example.test/oauth/youtube/callback',
        nonceHash: 'state-hash',
        now: 1_600,
      }),
      (error) => error.code === 'CONNECTION_OAUTH_STATE_REPLAYED',
    );
  } finally {
    fixture.close();
  }
});

test('encrypted credential repository replaces active Refresh Token atomically without legacy plaintext columns', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    let sequence = 0;
    const credentials = new EncryptedCustomerCredentialRepository({
      store: fixture.store,
      keyVersion: 'v1',
      keys: { v1: ENCRYPTION_KEY },
      now: () => 2_000 + sequence,
      createId: () => `credential-${++sequence}`,
    });
    const first = await credentials.replace({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
      plaintext: 'refresh-token-one',
    });
    assert.equal(await credentials.read({
      credentialReference: first,
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
    }), 'refresh-token-one');

    const second = await credentials.replace({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
      plaintext: 'refresh-token-two',
      previousReference: first,
    });
    assert.equal(await credentials.read({
      credentialReference: second,
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
    }), 'refresh-token-two');
    await assert.rejects(
      () => credentials.read({
        credentialReference: first,
        connectionId: 'connection-1',
        connectorKey: 'youtube',
        credentialKind: 'refresh_token',
      }),
      (error) => error.code === 'CONNECTION_CREDENTIAL_UNAVAILABLE',
    );

    const connection = fixture.d1.database.prepare(`
      SELECT credential_reference, encrypted_access_token, encrypted_refresh_token
      FROM connections WHERE id = ?
    `).get('connection-1');
    assert.deepEqual(connection, {
      credential_reference: second,
      encrypted_access_token: null,
      encrypted_refresh_token: null,
    });
    const active = fixture.d1.database.prepare(`
      SELECT count(*) AS total FROM encrypted_credentials
      WHERE connection_id = ? AND credential_kind = ? AND status = 'active'
    `).get('connection-1', 'refresh_token');
    assert.equal(active.total, 1);
  } finally {
    fixture.close();
  }
});

test('credential replacement conflict rolls back and keeps the prior active credential', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-1',
      connectorKey: 'google_ads',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    let sequence = 0;
    const credentials = new EncryptedCustomerCredentialRepository({
      store: fixture.store,
      keyVersion: 'v1',
      keys: { v1: ENCRYPTION_KEY },
      now: () => 2_000,
      createId: () => `credential-${++sequence}`,
    });
    const first = await credentials.replace({
      connectionId: 'connection-1',
      connectorKey: 'google_ads',
      credentialKind: 'refresh_token',
      plaintext: 'refresh-token-one',
    });
    await assert.rejects(
      () => credentials.replace({
        connectionId: 'connection-1',
        connectorKey: 'google_ads',
        credentialKind: 'refresh_token',
        plaintext: 'refresh-token-two',
        previousReference: 'wrong-reference',
      }),
      (error) => error.code === 'CONNECTION_CREDENTIAL_REPLACE_FAILED',
    );
    assert.equal(await credentials.read({
      credentialReference: first,
      connectionId: 'connection-1',
      connectorKey: 'google_ads',
      credentialKind: 'refresh_token',
    }), 'refresh-token-one');
    assert.equal(
      fixture.d1.database.prepare('SELECT count(*) AS total FROM encrypted_credentials').get().total,
      1,
    );
  } finally {
    fixture.close();
  }
});

test('credential repository rewraps the same plaintext under a new key without returning it', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-rewrap',
      connectorKey: 'youtube',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    const source = new EncryptedCustomerCredentialRepository({
      store: fixture.store,
      keyVersion: 'v1',
      keys: { v1: ENCRYPTION_KEY },
      now: () => 2_000,
      createId: () => 'credential-source',
    });
    await source.replace({
      connectionId: 'connection-rewrap',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
      plaintext: 'customer-refresh-token-never-returned',
    });
    const targetKey = 'ERERERERERERERERERERERERERERERERERERERERERE';
    const target = new EncryptedCustomerCredentialRepository({
      store: fixture.store,
      keyVersion: 'v2',
      keys: { v1: ENCRYPTION_KEY, v2: targetKey },
      now: () => 3_000,
      createId: () => 'credential-target',
    });
    const result = await target.rewrap({
      connectionId: 'connection-rewrap',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
      credentialReference: 'credential-source',
      sourceKeyVersion: 'v1',
    });
    assert.deepEqual(result, {
      previousReference: 'credential-source',
      credentialReference: 'credential-target',
      sourceKeyVersion: 'v1',
      keyVersion: 'v2',
    });
    assert.equal(JSON.stringify(result).includes('customer-refresh-token'), false);
    assert.equal(await target.read({
      credentialReference: 'credential-target',
      connectionId: 'connection-rewrap',
      connectorKey: 'youtube',
      credentialKind: 'refresh_token',
    }), 'customer-refresh-token-never-returned');
    await assert.rejects(
      () => target.rewrap({
        connectionId: 'connection-rewrap',
        connectorKey: 'youtube',
        credentialKind: 'refresh_token',
        credentialReference: 'credential-source',
        sourceKeyVersion: 'v1',
      }),
      (error) => error.code === 'CONNECTION_CREDENTIAL_UNAVAILABLE',
    );
  } finally {
    fixture.close();
  }
});

test('connection lookup supports reconnect without violating the legacy account uniqueness constraint', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-existing',
      connectorKey: 'google_ads',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    const found = await fixture.store.findConnectionByCustomerConnector({
      connectorKey: 'google_ads',
      customerKey: 'customer',
    });
    assert.equal(found.connectionId, 'connection-existing');
  } finally {
    fixture.close();
  }
});

test('PKCE credential is revoked after use and a later attempt can create a new active verifier', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    let sequence = 0;
    const credentials = new EncryptedCustomerCredentialRepository({
      store: fixture.store,
      keyVersion: 'v1',
      keys: { v1: ENCRYPTION_KEY },
      now: () => 2_000 + sequence,
      createId: () => `pkce-${++sequence}`,
    });
    const first = await credentials.replace({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'pkce_verifier',
      plaintext: 'pkce-first',
    });
    await credentials.revoke({
      credentialReference: first,
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'pkce_verifier',
    });
    const second = await credentials.replace({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'pkce_verifier',
      plaintext: 'pkce-second',
    });
    assert.notEqual(first, second);
    assert.equal(await credentials.read({
      credentialReference: second,
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      credentialKind: 'pkce_verifier',
    }), 'pkce-second');
  } finally {
    fixture.close();
  }
});

test('YouTube identity selection accepts only a stored candidate and is one-time', async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createConnection({
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      createdAt: 1_000,
    });
    await fixture.store.createIdentitySelection({
      selectionId: 'selection-1',
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'selection-hash',
      candidates: [
        { externalAccountId: 'channel_A', externalAccountName: 'A' },
        { externalAccountId: 'channel_B', externalAccountName: 'B' },
      ],
      issuedAt: 1_000,
      expiresAt: 2_000,
    });
    await assert.rejects(
      () => fixture.store.consumeIdentitySelection({
        selectionId: 'selection-1',
        connectionId: 'connection-1',
        connectorKey: 'youtube',
        customerKey: 'customer',
        nonceHash: 'selection-hash',
        selectedExternalId: 'channel_C',
        now: 1_500,
      }),
      (error) => error.code === 'CONNECTION_IDENTITY_SELECTION_CANDIDATE_INVALID',
    );
    const selected = await fixture.store.consumeIdentitySelection({
      selectionId: 'selection-1',
      connectionId: 'connection-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'selection-hash',
      selectedExternalId: 'channel_B',
      now: 1_500,
    });
    assert.equal(selected.externalAccountName, 'B');
    await assert.rejects(
      () => fixture.store.consumeIdentitySelection({
        selectionId: 'selection-1',
        connectionId: 'connection-1',
        connectorKey: 'youtube',
        customerKey: 'customer',
        nonceHash: 'selection-hash',
        selectedExternalId: 'channel_A',
        now: 1_600,
      }),
      (error) => error.code === 'CONNECTION_IDENTITY_SELECTION_REPLAYED',
    );
  } finally {
    fixture.close();
  }
});

async function seedPendingAttempt(store) {
  await store.createInvitation({
    invitationId: 'invitation-1',
    connectorKey: 'youtube',
    customerKey: 'customer',
    environment: 'development',
    nonceHash: 'invitation-hash',
    redirectUri: 'https://example.test/oauth/youtube/callback',
    issuedAt: 1_000,
    expiresAt: 2_000,
    maxAttempts: 3,
  });
  await store.reserveInvitationAttempt({
    id: 'invitation-1',
    attemptId: 'attempt-1',
    connectorKey: 'youtube',
    customerKey: 'customer',
    nonceHash: 'invitation-hash',
    maxAttempts: 3,
    attemptExpiresAt: 2_000,
    now: 1_100,
  });
  await store.createConnection({
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    customerKey: 'customer',
    createdAt: 1_100,
  });
  await store.attachInvitationConnection({
    invitationId: 'invitation-1',
    connectionId: 'connection-1',
    attemptId: 'attempt-1',
  });
  await store.createOAuthState({
    attemptId: 'attempt-1',
    invitationId: 'invitation-1',
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    customerKey: 'customer',
    redirectUri: 'https://example.test/oauth/youtube/callback',
    nonceHash: 'state-hash',
    issuedAt: 1_100,
    expiresAt: 2_000,
  });
}

async function createFixture() {
  const [initial, migration, retryMigration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
    readFile(RETRY_MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  d1.exec(initial);
  d1.exec(migration);
  d1.exec(retryMigration);
  return {
    d1,
    store: new D1CustomerConnectionStore({ db: d1 }),
    close: () => d1.close(),
  };
}
