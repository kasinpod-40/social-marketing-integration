import {
  CUSTOMER_CONNECTION_ACCESS_STATUSES,
  CUSTOMER_CONNECTION_CONNECTORS,
  CUSTOMER_CONNECTION_STATUSES,
  GOOGLE_OAUTH_SCOPES,
  readOAuthStateTtlMs,
  requireExactGrantedScopes,
} from './customer-connection-contract.js';
import {
  createSecureRandomToken,
  hashSecureToken,
  signCompactPayload,
  verifyCompactPayload,
} from '../../../shared/src/security/secure-token.js';

const CONNECTOR = CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE;
const SELECTION_VERSION = 1;

/** YouTube customer consent พร้อม explicit 0/1/N channel decision */
export class YouTubeCustomerOAuthFlow {
  constructor(input = {}) {
    this.shared = requireMethod(input.shared, 'beginOAuth', 'shared');
    requireMethod(input.shared, 'consumeCallbackState', 'shared');
    this.oauthClient = requireMethod(input.oauthClient, 'buildAuthorizationUrl', 'oauthClient');
    requireMethod(input.oauthClient, 'exchangeAuthorizationCode', 'oauthClient');
    requireMethod(input.oauthClient, 'refreshAccessToken', 'oauthClient');
    this.youtubeClientFactory = requireFunction(input.youtubeClientFactory, 'youtubeClientFactory');
    this.credentials = requireMethod(input.credentials, 'replace', 'credentials');
    requireMethod(input.credentials, 'read', 'credentials');
    this.store = requireMethod(input.store, 'updateConnection', 'store');
    requireMethod(input.store, 'createIdentitySelection', 'store');
    requireMethod(input.store, 'consumeIdentitySelection', 'store');
    requireMethod(input.store, 'getConnection', 'store');
    this.redirectUri = requireText(input.redirectUri, 'redirectUri');
    this.environment = requireText(input.environment, 'environment');
    this.selectionSigningKey = requireText(input.selectionSigningKey, 'selectionSigningKey');
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.createId = typeof input.createId === 'function'
      ? input.createId
      : (prefix) => `${prefix}:${globalThis.crypto.randomUUID()}`;
    this.randomToken = typeof input.randomToken === 'function'
      ? input.randomToken
      : createSecureRandomToken;
    this.cryptoImpl = input.cryptoImpl ?? globalThis.crypto;
  }

  async begin(invitationToken) {
    const attempt = await this.shared.beginOAuth({
      connectorKey: CONNECTOR,
      environment: this.environment,
      redirectUri: this.redirectUri,
      invitationToken: requireText(invitationToken, 'invitationToken'),
    });
    return this.oauthClient.buildAuthorizationUrl({
      redirectUri: this.redirectUri,
      scopes: GOOGLE_OAUTH_SCOPES[CONNECTOR],
      state: attempt.state,
      codeChallenge: attempt.codeChallenge,
      promptConsent: true,
    });
  }

  async complete(input = {}) {
    const callback = await this.shared.consumeCallbackState({
      connectorKey: CONNECTOR,
      redirectUri: this.redirectUri,
      state: requireText(input.state, 'state'),
    });
    if (input.oauthError) {
      await this.recordFailure(callback, 'GOOGLE_OAUTH_PROVIDER_REJECTED');
      throw flowError('Google OAuth authorization was rejected', 'GOOGLE_OAUTH_PROVIDER_REJECTED');
    }
    try {
      const token = await this.oauthClient.exchangeAuthorizationCode({
        code: requireText(input.code, 'code'),
        redirectUri: this.redirectUri,
        codeVerifier: callback.pkceVerifier,
      });
      const grantedScopes = requireExactGrantedScopes(CONNECTOR, token.grantedScopes);
      const existingConnection = await this.store.getConnection(callback.connectionId);
      const credentialReference = await this.credentials.replace({
        connectionId: callback.connectionId,
        connectorKey: CONNECTOR,
        credentialKind: 'refresh_token',
        plaintext: token.refreshToken,
        previousReference: existingConnection?.credentialReference ?? null,
      });
      let refreshed;
      try {
        const persistedRefreshToken = await this.credentials.read({
          credentialReference,
          connectionId: callback.connectionId,
          connectorKey: CONNECTOR,
          credentialKind: 'refresh_token',
        });
        refreshed = await this.oauthClient.refreshAccessToken({
          refreshToken: persistedRefreshToken,
        });
      } catch (error) {
        await this.updateConnection(callback, {
          grantedScopes,
          tokenType: token.tokenType,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.TOKEN_REFRESH_FAILED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
          lastErrorCode: error?.code ?? 'GOOGLE_OAUTH_TOKEN_REFRESH_FAILED',
          providerMetadata: { credentialReference },
        });
        return safeResult({
          connectionId: callback.connectionId,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.TOKEN_REFRESH_FAILED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
          grantedScopes,
          nextAction: 'reconnect',
        });
      }
      const channels = await this.youtubeClientFactory(refreshed.accessToken).listMyChannels();
      const candidates = Object.freeze(channels.map(normalizeChannelCandidate));
      const lifecycle = {
        grantedScopes,
        tokenType: token.tokenType,
        tokenExpiresAt: refreshed.expiresAt,
        lastRefreshAt: this.now(),
        credentialReference,
      };
      if (candidates.length === 0) {
        await this.updateConnection(callback, {
          ...lifecycle,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH,
          lastErrorCode: 'YOUTUBE_CHANNEL_NOT_FOUND',
          providerMetadata: { credentialReference, candidateCount: 0 },
        });
        return safeResult({
          connectionId: callback.connectionId,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH,
          grantedScopes,
          nextAction: 'use_google_account_with_youtube_channel_access',
        });
      }
      if (candidates.length === 1) {
        await this.finalizeSelection(callback, candidates[0], lifecycle);
        return safeResult({
          connectionId: callback.connectionId,
          candidate: candidates[0],
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
          grantedScopes,
          validatedAt: this.now(),
          nextAction: 'none',
        });
      }
      return this.createSelection(callback, candidates, lifecycle);
    } catch (error) {
      await this.recordFailure(callback, error?.code ?? 'YOUTUBE_OAUTH_CALLBACK_FAILED');
      throw error;
    }
  }

  async select(input = {}) {
    const now = requireTimestamp(this.now());
    const payload = await verifyCompactPayload(
      requireText(input.selectionToken, 'selectionToken'),
      this.selectionSigningKey,
      { cryptoImpl: this.cryptoImpl },
    );
    validateSelectionPayload(payload, now);
    const candidate = await this.store.consumeIdentitySelection({
      selectionId: payload.selectionId,
      connectionId: payload.connectionId,
      connectorKey: CONNECTOR,
      customerKey: payload.customerKey,
      nonceHash: await hashSecureToken(payload.nonce, this.cryptoImpl),
      selectedExternalId: requireText(input.channelId, 'channelId'),
      now,
    });
    const connection = await this.store.getConnection(payload.connectionId);
    if (!connection) {
      throw flowError('YouTube connection is unavailable', 'CONNECTION_METADATA_NOT_FOUND');
    }
    await this.finalizeSelection({
      connectionId: payload.connectionId,
      customerKey: payload.customerKey,
    }, candidate, {
      credentialReference: connection.credentialReference,
      grantedScopes: connection.grantedScopes,
      tokenType: connection.tokenType,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastRefreshAt: connection.lastRefreshAt,
    });
    return safeResult({
      connectionId: payload.connectionId,
      candidate,
      connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
      accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
      grantedScopes: connection.grantedScopes,
      validatedAt: now,
      nextAction: 'none',
    });
  }

  async createSelection(callback, candidates, lifecycle) {
    const issuedAt = requireTimestamp(this.now());
    const expiresAt = issuedAt + readOAuthStateTtlMs();
    const selectionId = this.createId('identity-selection');
    const nonce = this.randomToken(32);
    await this.store.createIdentitySelection({
      selectionId,
      connectionId: callback.connectionId,
      connectorKey: CONNECTOR,
      customerKey: callback.customerKey,
      nonceHash: await hashSecureToken(nonce, this.cryptoImpl),
      candidates,
      issuedAt,
      expiresAt,
    });
    const selectionToken = await signCompactPayload({
      v: SELECTION_VERSION,
      purpose: 'youtube_channel_selection',
      selectionId,
      connectionId: callback.connectionId,
      customerKey: callback.customerKey,
      issuedAt,
      expiresAt,
      nonce,
    }, this.selectionSigningKey, { cryptoImpl: this.cryptoImpl });
    await this.updateConnection(callback, {
      ...lifecycle,
      connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_SELECTION_REQUIRED,
      accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_SELECTION_REQUIRED,
      providerMetadata: {
        credentialReference: lifecycle.credentialReference,
        candidateCount: candidates.length,
      },
    });
    return Object.freeze({
      ...safeResult({
        connectionId: callback.connectionId,
        connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_SELECTION_REQUIRED,
        accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_SELECTION_REQUIRED,
        grantedScopes: lifecycle.grantedScopes,
        nextAction: 'select_youtube_channel',
      }),
      selectionRequired: true,
      selectionToken,
      expiresAt: new Date(expiresAt).toISOString(),
      candidates: Object.freeze(candidates.map((candidate) => Object.freeze({
        channelId: candidate.externalAccountId,
        title: candidate.externalAccountName,
      }))),
    });
  }

  async finalizeSelection(callback, candidate, lifecycle) {
    await this.updateConnection(callback, {
      ...lifecycle,
      externalAccountId: candidate.externalAccountId,
      externalAccountName: candidate.externalAccountName,
      connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
      accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
      lastValidatedAt: this.now(),
      lastErrorCode: null,
      providerMetadata: {
        ...(candidate.providerMetadata ?? {}),
        ...(lifecycle.credentialReference
          ? { credentialReference: lifecycle.credentialReference }
          : {}),
      },
    });
  }

  async updateConnection(callback, values) {
    await this.store.updateConnection({
      connectionId: callback.connectionId,
      connectorKey: CONNECTOR,
      grantedScopes: values.grantedScopes ?? undefined,
      ...values,
      updatedAt: this.now(),
    });
  }

  async recordFailure(callback, errorCode) {
    if (typeof this.store.recordCallbackError === 'function') {
      await this.store.recordCallbackError({
        attemptId: callback.attemptId,
        errorCode,
        now: this.now(),
      });
    }
    const scopeInsufficient = errorCode === 'CONNECTION_SCOPE_INSUFFICIENT';
    await this.updateConnection(callback, {
      connectionStatus: scopeInsufficient
        ? CUSTOMER_CONNECTION_STATUSES.SCOPE_INSUFFICIENT
        : CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      accessStatus: scopeInsufficient
        ? CUSTOMER_CONNECTION_ACCESS_STATUSES.SCOPE_INSUFFICIENT
        : CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
      grantedScopes: [],
      lastErrorCode: errorCode,
    });
  }
}

function normalizeChannelCandidate(channel) {
  const externalAccountId = requireText(channel?.id, 'channel.id');
  const hiddenSubscriberCount = channel?.statistics?.hiddenSubscriberCount === true;
  return Object.freeze({
    externalAccountId,
    externalAccountName: optionalText(channel?.snippet?.title) ?? 'YouTube channel',
    providerMetadata: Object.freeze({
      uploadsPlaylistId: optionalText(channel?.contentDetails?.relatedPlaylists?.uploads),
      subscriberCountHidden: hiddenSubscriberCount,
      subscriberCount: hiddenSubscriberCount
        ? null
        : optionalText(channel?.statistics?.subscriberCount),
      videoCount: optionalText(channel?.statistics?.videoCount),
      viewCount: optionalText(channel?.statistics?.viewCount),
      privacyStatus: optionalText(channel?.status?.privacyStatus),
    }),
  });
}

function validateSelectionPayload(payload, now) {
  if (
    payload?.v !== SELECTION_VERSION
    || payload?.purpose !== 'youtube_channel_selection'
    || !Number.isSafeInteger(payload?.issuedAt)
    || !Number.isSafeInteger(payload?.expiresAt)
    || payload.expiresAt <= payload.issuedAt
    || payload.expiresAt < now
  ) throw flowError('YouTube identity selection token is invalid', 'CONNECTION_IDENTITY_SELECTION_INVALID');
  for (const name of ['selectionId', 'connectionId', 'customerKey', 'nonce']) {
    requireText(payload[name], name);
  }
}

function safeResult(input) {
  return Object.freeze({
    connector: CONNECTOR,
    connectionId: input.connectionId,
    externalIdentity: Object.freeze({
      channelId: maskIdentity(input.candidate?.externalAccountId),
      channelTitle: optionalText(input.candidate?.externalAccountName),
    }),
    connectionStatus: input.connectionStatus,
    accessStatus: input.accessStatus,
    grantedScopes: Object.freeze([...(input.grantedScopes ?? [])]),
    validatedAt: input.validatedAt ? new Date(input.validatedAt).toISOString() : null,
    nextAction: input.nextAction,
    queued: false,
    larkWrite: false,
  });
}

function requireMethod(value, method, fieldName) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} is required`);
  return value;
}

function flowError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('now must be a timestamp');
  return number;
}

function maskIdentity(value) {
  const text = optionalText(value);
  if (!text) return null;
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
}
