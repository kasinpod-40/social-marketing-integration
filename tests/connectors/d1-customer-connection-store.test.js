import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import { D1CustomerConnectionStore } from '../../packages/connectors/src/d1-customer-connection-store.js';
import { EncryptedCustomerCredentialRepository } from '../../packages/connectors/src/encrypted-customer-credential-repository.js';
import { encodeBase64Url } from '../../packages/shared/src/security/secure-token.js';

const INITIAL_URL = new URL('../../migrations/0001_initial.sql', import.meta.url);
const MIGRATION_URL = new URL('../../migrations/0011_customer_connection_oauth.sql', import.meta.url);
const ENCRYPTION_KEY = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));

test('D1 invitation consume is exact, expiring and one-time', async () => {
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
    });

    await assert.rejects(
      () => fixture.store.consumeInvitation({
        id: 'invitation-1',
        connectorKey: 'google_ads',
        customerKey: 'customer',
        nonceHash: 'nonce-hash',
        now: 1_500,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_MISMATCH',
    );
    const consumed = await fixture.store.consumeInvitation({
      id: 'invitation-1',
      connectorKey: 'youtube',
      customerKey: 'customer',
      nonceHash: 'nonce-hash',
      now: 1_500,
    });
    assert.equal(consumed.consumedAt, 1_500);
    await assert.rejects(
      () => fixture.store.consumeInvitation({
        id: 'invitation-1',
        connectorKey: 'youtube',
        customerKey: 'customer',
        nonceHash: 'nonce-hash',
        now: 1_600,
      }),
      (error) => error.code === 'CONNECTION_INVITATION_REPLAYED',
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
  });
  await store.consumeInvitation({
    id: 'invitation-1',
    connectorKey: 'youtube',
    customerKey: 'customer',
    nonceHash: 'invitation-hash',
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
  const [initial, migration] = await Promise.all([
    readFile(INITIAL_URL, 'utf8'),
    readFile(MIGRATION_URL, 'utf8'),
  ]);
  const d1 = createSqliteD1();
  d1.exec(initial);
  d1.exec(migration);
  return {
    d1,
    store: new D1CustomerConnectionStore({ db: d1 }),
    close: () => d1.close(),
  };
}
