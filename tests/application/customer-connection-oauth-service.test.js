import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerConnectionOAuthService } from '../../packages/application/src/connections/customer-connection-oauth-service.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const INVITATION_KEY = 'invitation-signing-key-with-at-least-thirty-two-bytes';
const STATE_KEY = 'oauth-state-signing-key-with-at-least-thirty-two-bytes';

test('creates connector/customer/environment-specific invitation without exposing keys', async () => {
  const fixture = createFixture();
  const result = await fixture.service.createInvitation({
    connectorKey: 'google_ads',
    customerKey: 'customer',
    environment: 'development',
    publicOrigin: 'https://worker.example/',
    redirectUri: 'https://worker.example/oauth/google-ads/callback',
  });

  assert.equal(result.connector, 'google_ads');
  assert.equal(result.customerKey, 'customer');
  assert.equal(result.environment, 'development');
  assert.match(result.connectUrl, /^https:\/\/worker\.example\/connect\/google-ads\?invitation=/u);
  assert.equal(JSON.stringify(result).includes(INVITATION_KEY), false);
  assert.equal(JSON.stringify(result).includes(STATE_KEY), false);
  assert.equal(fixture.store.invitations.length, 1);
});

test('invitation and OAuth state are one-time and connector/customer bound', async () => {
  const fixture = createFixture();
  const invitation = await fixture.service.createInvitation({
    connectorKey: 'youtube',
    customerKey: 'customer',
    environment: 'development',
    publicOrigin: 'https://worker.example/',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
  });
  const invitationToken = new URL(invitation.connectUrl).searchParams.get('invitation');

  await assert.rejects(
    () => fixture.service.beginOAuth({
      connectorKey: 'google_ads',
      customerKey: 'customer',
      environment: 'development',
      redirectUri: 'https://worker.example/oauth/youtube/callback',
      invitationToken,
    }),
    (error) => error.code === 'CONNECTION_INVITATION_MISMATCH',
  );
  const attempt = await fixture.service.beginOAuth({
    connectorKey: 'youtube',
    customerKey: 'customer',
    environment: 'development',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    invitationToken,
  });
  assert.equal(attempt.codeChallengeMethod, 'S256');
  assert.notEqual(attempt.state, fixture.credentials.values.get('credential:5'));
  await assert.rejects(
    () => fixture.service.beginOAuth({
      connectorKey: 'youtube',
      customerKey: 'customer',
      environment: 'development',
      redirectUri: 'https://worker.example/oauth/youtube/callback',
      invitationToken,
    }),
    (error) => error.code === 'CONNECTION_INVITATION_REPLAYED',
  );

  const consumed = await fixture.service.consumeCallbackState({
    connectorKey: 'youtube',
    customerKey: 'customer',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    state: attempt.state,
  });
  assert.equal(consumed.connectionId, attempt.connectionId);
  assert.match(consumed.pkceVerifier, /^random-/u);
  await assert.rejects(
    () => fixture.service.consumeCallbackState({
      connectorKey: 'youtube',
      customerKey: 'customer',
      redirectUri: 'https://worker.example/oauth/youtube/callback',
      state: attempt.state,
    }),
    (error) => error.code === 'CONNECTION_OAUTH_STATE_REPLAYED',
  );
});

test('expired invitation fails before creating connection or OAuth state', async () => {
  let now = 1_000;
  const fixture = createFixture({ now: () => now });
  const invitation = await fixture.service.createInvitation({
    connectorKey: 'youtube',
    customerKey: 'customer',
    environment: 'development',
    publicOrigin: 'https://worker.example/',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    ttlMs: 5 * 60 * 1000,
  });
  now += 5 * 60 * 1000 + 1;
  await assert.rejects(
    () => fixture.service.beginOAuth({
      connectorKey: 'youtube',
      customerKey: 'customer',
      environment: 'development',
      redirectUri: 'https://worker.example/oauth/youtube/callback',
      invitationToken: new URL(invitation.connectUrl).searchParams.get('invitation'),
    }),
    (error) => error.code === 'CONNECTION_INVITATION_EXPIRED',
  );
  assert.equal(fixture.store.connections.length, 0);
  assert.equal(fixture.store.states.length, 0);
});

test('reconnect reuses the existing connector/customer Connection record', async () => {
  const fixture = createFixture();
  fixture.store.findConnectionByCustomerConnector = async () => ({
    connectionId: 'connection-existing',
  });
  const invitation = await fixture.service.createInvitation({
    connectorKey: 'youtube',
    customerKey: 'customer-a',
    environment: 'development',
    publicOrigin: 'https://worker.example',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
  });
  const result = await fixture.service.beginOAuth({
    connectorKey: 'youtube',
    environment: 'development',
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    invitationToken: new URL(invitation.connectUrl).searchParams.get('invitation'),
  });
  assert.equal(result.connectionId, 'connection-existing');
  assert.equal(fixture.store.connections.length, 0);
});

function createFixture(options = {}) {
  const store = createMemoryStore();
  const credentials = {
    values: new Map(),
    async replace(input) {
      const reference = `credential:${this.values.size + 1}`;
      this.values.set(reference, input.plaintext);
      return reference;
    },
    async read(input) {
      return this.values.get(input.credentialReference);
    },
    async revoke(input) {
      this.values.delete(input.credentialReference);
    },
  };
  let id = 0;
  let random = 0;
  const service = new CustomerConnectionOAuthService({
    store,
    credentials,
    invitationSigningKey: INVITATION_KEY,
    stateSigningKey: STATE_KEY,
    now: options.now ?? (() => 1_000),
    createId: (prefix) => `${prefix}:${++id}`,
    randomToken: () => `random-${++random}-with-sufficient-entropy-shape`,
  });
  return { service, store, credentials };
}

function createMemoryStore() {
  const invitations = [];
  const connections = [];
  const states = [];
  return {
    invitations,
    connections,
    states,
    async createInvitation(input) {
      invitations.push({ ...input, consumedAt: null, connectionId: null });
    },
    async consumeInvitation(input) {
      const row = invitations.find((item) => item.invitationId === input.id);
      if (row?.consumedAt !== null) throw permanentError('replay', { code: 'CONNECTION_INVITATION_REPLAYED' });
      if (!row || row.connectorKey !== input.connectorKey || row.customerKey !== input.customerKey) {
        throw permanentError('mismatch', { code: 'CONNECTION_INVITATION_MISMATCH' });
      }
      row.consumedAt = input.now;
      return row;
    },
    async createConnection(input) {
      connections.push({ ...input });
      return input;
    },
    async attachInvitationConnection(input) {
      const row = invitations.find((item) => item.invitationId === input.invitationId);
      row.connectionId = input.connectionId;
    },
    async createOAuthState(input) {
      states.push({ ...input, consumedAt: null });
    },
    async consumeOAuthState(input) {
      const row = states.find((item) => item.attemptId === input.id);
      if (row?.consumedAt !== null) throw permanentError('replay', { code: 'CONNECTION_OAUTH_STATE_REPLAYED' });
      if (!row || row.connectorKey !== input.connectorKey || row.customerKey !== input.customerKey) {
        throw permanentError('mismatch', { code: 'CONNECTION_OAUTH_STATE_MISMATCH' });
      }
      row.consumedAt = input.now;
      return row;
    },
  };
}
