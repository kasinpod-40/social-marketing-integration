import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YouTubeCustomerOAuthFlow,
} from '../../packages/application/src/connections/youtube-customer-oauth-flow.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const SELECTION_KEY = 'selection-signing-key-with-at-least-thirty-two-bytes';

test('YouTube callback connects the only owned channel and persists null when subscribers are hidden', async () => {
  const fixture = createFixture({ channels: [channel('channel_A', { hidden: true })] });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'connected');
  assert.equal(fixture.calls.order.join(','), 'exchange,encrypt,decrypt,refresh,list,update,complete');
  assert.equal(fixture.calls.update[0].externalAccountId, 'channel_A');
  assert.equal(fixture.calls.update[0].providerMetadata.uploadsPlaylistId, 'UU_channel_A');
  assert.equal(fixture.calls.update[0].providerMetadata.subscriberCountHidden, true);
  assert.equal(fixture.calls.update[0].providerMetadata.subscriberCount, null);
});

test('YouTube callback with zero channels retains credential and records identity mismatch', async () => {
  const fixture = createFixture({ channels: [] });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'identity_mismatch');
  assert.equal(fixture.calls.encrypt.length, 1);
  assert.equal(fixture.calls.update[0].accessStatus, 'identity_mismatch');
  assert.equal(fixture.calls.update[0].lastErrorCode, 'YOUTUBE_CHANNEL_NOT_FOUND');
  assert.equal(fixture.calls.release.length, 1);
});

test('YouTube callback with multiple channels requires signed one-time explicit selection', async () => {
  const fixture = createFixture({
    channels: [channel('channel_A'), channel('channel_B')],
  });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'identity_selection_required');
  assert.equal(result.selectionRequired, true);
  assert.deepEqual(result.candidates, [
    { channelId: 'channel_A', title: 'Channel channel_A' },
    { channelId: 'channel_B', title: 'Channel channel_B' },
  ]);
  assert.equal(fixture.calls.selections.length, 1);
  assert.equal(fixture.calls.update[0].accessStatus, 'identity_selection_required');
  assert.equal(fixture.calls.complete.length, 1);

  fixture.selectedCandidate = fixture.calls.selections[0].candidates[1];
  const selected = await fixture.flow.select({
    selectionToken: result.selectionToken,
    channelId: 'channel_B',
  });
  assert.equal(selected.connectionStatus, 'connected');
  assert.equal(fixture.calls.consume[0].selectedExternalId, 'channel_B');
  assert.equal(fixture.calls.update.at(-1).externalAccountId, 'channel_B');
});

test('YouTube callback never auto-selects the first of multiple channels', async () => {
  const fixture = createFixture({
    channels: [channel('channel_A'), channel('channel_B')],
  });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'identity_selection_required');
  assert.equal(fixture.calls.update.some((item) => item.externalAccountId === 'channel_A'), false);
});

test('YouTube refresh failure retains encrypted credential and does not discover channels', async () => {
  const fixture = createFixture({
    channels: [channel('channel_A')],
    refreshError: Object.assign(new Error('refresh rejected'), {
      code: 'GOOGLE_OAUTH_TOKEN_REFRESH_REJECTED',
    }),
  });
  const result = await fixture.flow.complete({ state: 'signed-state', code: 'auth-code' });
  assert.equal(result.connectionStatus, 'token_refresh_failed');
  assert.equal(result.nextAction, 'reconnect');
  assert.equal(fixture.calls.encrypt.length, 1);
  assert.equal(fixture.calls.order.includes('list'), false);
  assert.equal(fixture.calls.release.length, 1);
});

function createFixture(options = {}) {
  const calls = {
    order: [],
    encrypt: [],
    update: [],
    selections: [],
    consume: [],
    complete: [],
    release: [],
  };
  let sequence = 0;
  const fixture = {
    calls,
    selectedCandidate: null,
  };
  const shared = {
    async previewInvitation() {
      return { attemptsRemaining: 3, canStart: true };
    },
    async beginOAuth() { return { state: 'signed-state', codeChallenge: 'challenge' }; },
    async consumeCallbackState() {
      return {
        connectionId: 'connection-private',
        customerKey: 'customer-private',
        connectorKey: 'youtube',
        invitationId: 'invitation-private',
        attemptId: 'attempt-private',
        pkceVerifier: 'pkce-private',
      };
    },
    async completeOAuthAttempt(input) {
      calls.order.push('complete');
      calls.complete.push(input);
    },
    async releaseOAuthAttempt(input) {
      calls.order.push('release');
      calls.release.push(input);
    },
  };
  const oauthClient = {
    buildAuthorizationUrl() { return 'https://accounts.google.test/consent'; },
    async exchangeAuthorizationCode() {
      calls.order.push('exchange');
      return {
        accessToken: 'access-private',
        refreshToken: 'refresh-private',
        tokenType: 'Bearer',
        expiresAt: 3_600_000,
        grantedScopes: SCOPES,
      };
    },
    async refreshAccessToken() {
      calls.order.push('refresh');
      if (options.refreshError) throw options.refreshError;
      return { accessToken: 'access-refreshed-private', expiresAt: 3_600_000 };
    },
  };
  const credentials = {
    async replace(input) {
      calls.order.push('encrypt');
      calls.encrypt.push(input);
      return 'credential-private';
    },
    async read() {
      calls.order.push('decrypt');
      return 'refresh-private';
    },
  };
  const store = {
    async createIdentitySelection(input) { calls.selections.push(input); },
    async consumeIdentitySelection(input) {
      calls.consume.push(input);
      return fixture.selectedCandidate;
    },
    async updateConnection(input) {
      calls.order.push('update');
      calls.update.push(input);
    },
    async recordCallbackError() {},
    async getConnection() {
      return {
        credentialReference: options.existingCredentialReference ?? null,
        grantedScopes: SCOPES,
        tokenType: 'Bearer',
        tokenExpiresAt: 3_600_000,
        lastRefreshAt: 1_000,
      };
    },
  };
  fixture.flow = new YouTubeCustomerOAuthFlow({
    shared,
    oauthClient,
    youtubeClientFactory: () => ({
      async listMyChannels() {
        calls.order.push('list');
        return options.channels ?? [];
      },
    }),
    credentials,
    store,
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    environment: 'development',
    selectionSigningKey: SELECTION_KEY,
    now: () => 1_000,
    createId: () => `selection-${++sequence}`,
    randomToken: () => 'selection-nonce-with-enough-random-looking-bytes',
  });
  return fixture;
}

function channel(id, options = {}) {
  return {
    id,
    snippet: { title: `Channel ${id}` },
    contentDetails: { relatedPlaylists: { uploads: `UU_${id}` } },
    statistics: {
      hiddenSubscriberCount: options.hidden === true,
      subscriberCount: '123',
      videoCount: '10',
      viewCount: '1000',
    },
    status: { privacyStatus: 'public' },
  };
}
