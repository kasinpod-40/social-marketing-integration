import {
  CONNECTOR_ROUTE_SLUGS,
  readInvitationMaxAttempts,
  readInvitationTtlMs,
  readOAuthStateTtlMs,
  requireCustomerConnectionConnector,
} from './customer-connection-contract.js';
import {
  createSecureRandomToken,
  hashSecureToken,
  signCompactPayload,
  verifyCompactPayload,
} from '../../../shared/src/security/secure-token.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CONTRACT_VERSION = 2;

/** Shared invitation/state orchestration; Provider-specific code exchange/identity อยู่นอก Service นี้ */
export class CustomerConnectionOAuthService {
  constructor(input = {}) {
    this.store = requireStore(input.store);
    this.credentials = requireCredentialRepository(input.credentials);
    this.invitationSigningKey = requireText(input.invitationSigningKey, 'invitationSigningKey');
    this.stateSigningKey = requireText(input.stateSigningKey, 'stateSigningKey');
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.createId = typeof input.createId === 'function'
      ? input.createId
      : (prefix) => `${prefix}:${crypto.randomUUID()}`;
    this.randomToken = typeof input.randomToken === 'function'
      ? input.randomToken
      : createSecureRandomToken;
    this.cryptoImpl = input.cryptoImpl ?? globalThis.crypto;
  }

  async createInvitation(input = {}) {
    const connectorKey = requireCustomerConnectionConnector(input.connectorKey);
    const customerKey = requireText(input.customerKey, 'customerKey');
    const environment = requireText(input.environment, 'environment');
    const publicOrigin = requireHttpsOrigin(input.publicOrigin);
    const redirectUri = requireHttpsUrl(input.redirectUri, 'redirectUri');
    const issuedAt = requireTimestamp(this.now(), 'now');
    const expiresAt = issuedAt + readInvitationTtlMs(input.ttlMs);
    const maxAttempts = readInvitationMaxAttempts(input.maxAttempts);
    const invitationId = this.createId('invitation');
    const nonce = this.randomToken(32);
    const payload = Object.freeze({
      v: CONTRACT_VERSION,
      invitationId,
      connectorKey,
      customerKey,
      environment,
      redirectUri,
      issuedAt,
      expiresAt,
      maxAttempts,
      nonce,
    });
    const [nonceHash, token] = await Promise.all([
      hashSecureToken(nonce, this.cryptoImpl),
      signCompactPayload(payload, this.invitationSigningKey, { cryptoImpl: this.cryptoImpl }),
    ]);
    await this.store.createInvitation({
      invitationId,
      connectorKey,
      customerKey,
      environment,
      nonceHash,
      redirectUri,
      issuedAt,
      expiresAt,
      maxAttempts,
    });
    const slug = CONNECTOR_ROUTE_SLUGS[connectorKey];
    const connectUrl = new URL(`/connect/${slug}`, publicOrigin);
    connectUrl.searchParams.set('invitation', token);
    return Object.freeze({
      connector: connectorKey,
      customerKey,
      connectUrl: connectUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
      environment,
      maxAttempts,
    });
  }

  async previewInvitation(input = {}) {
    const value = await this.readInvitation(input);
    const activeAttemptExpiresAt = (
      value.row.activeAttemptId
      && value.row.activeAttemptExpiresAt !== null
      && value.row.activeAttemptExpiresAt >= value.now
    ) ? value.row.activeAttemptExpiresAt : null;
    return Object.freeze({
      connector: value.connectorKey,
      expiresAt: new Date(value.row.expiresAt).toISOString(),
      attemptsRemaining: Math.max(0, value.row.maxAttempts - value.row.attemptCount),
      canStart: activeAttemptExpiresAt === null,
      retryAvailableAt: activeAttemptExpiresAt === null
        ? null
        : new Date(activeAttemptExpiresAt).toISOString(),
    });
  }

  async beginOAuth(input = {}) {
    const attemptId = this.createId('oauth-attempt');
    const value = await this.readInvitation(input);
    const expiresAt = Math.min(
      value.now + readOAuthStateTtlMs(input.stateTtlMs),
      value.invitation.expiresAt,
    );
    if (expiresAt <= value.now) {
      throw permanentError('Connection invitation has expired', {
        code: 'CONNECTION_INVITATION_EXPIRED',
      });
    }
    await this.store.reserveInvitationAttempt({
      id: value.invitation.invitationId,
      attemptId,
      connectorKey: value.connectorKey,
      customerKey: value.customerKey,
      nonceHash: value.nonceHash,
      maxAttempts: value.invitation.maxAttempts,
      attemptExpiresAt: expiresAt,
      now: value.now,
    });

    let connectionId = null;
    let pkceCredentialReference = null;
    try {
      const existingConnection = typeof this.store.findConnectionByCustomerConnector === 'function'
        ? await this.store.findConnectionByCustomerConnector({
          connectorKey: value.connectorKey,
          customerKey: value.customerKey,
        })
        : null;
      connectionId = existingConnection?.connectionId ?? this.createId('connection');
      if (!existingConnection) {
        await this.store.createConnection({
          connectionId,
          connectorKey: value.connectorKey,
          customerKey: value.customerKey,
          createdAt: value.now,
        });
      }
      await this.store.attachInvitationConnection({
        invitationId: value.invitation.invitationId,
        connectionId,
        attemptId,
      });

      const pkceVerifier = this.randomToken(64);
      pkceCredentialReference = await this.credentials.replace({
        connectionId,
        connectorKey: value.connectorKey,
        credentialKind: 'pkce_verifier',
        plaintext: pkceVerifier,
      });
      const stateNonce = this.randomToken(32);
      const statePayload = Object.freeze({
        v: CONTRACT_VERSION,
        connectorKey: value.connectorKey,
        customerKey: value.customerKey,
        attemptId,
        connectionId,
        redirectUri: value.redirectUri,
        issuedAt: value.now,
        expiresAt,
        nonce: stateNonce,
        invitationId: value.invitation.invitationId,
      });
      const [stateNonceHash, state, codeChallenge] = await Promise.all([
        hashSecureToken(stateNonce, this.cryptoImpl),
        signCompactPayload(statePayload, this.stateSigningKey, { cryptoImpl: this.cryptoImpl }),
        hashSecureToken(pkceVerifier, this.cryptoImpl),
      ]);
      await this.store.createOAuthState({
        attemptId,
        invitationId: value.invitation.invitationId,
        connectionId,
        connectorKey: value.connectorKey,
        customerKey: value.customerKey,
        redirectUri: value.redirectUri,
        nonceHash: stateNonceHash,
        pkceCredentialReference,
        issuedAt: value.now,
        expiresAt,
      });
      return Object.freeze({
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        connectionId,
        attemptId,
        invitationId: value.invitation.invitationId,
        connectorKey: value.connectorKey,
        customerKey: value.customerKey,
        redirectUri: value.redirectUri,
        expiresAt,
      });
    } catch (error) {
      await this.rollbackBeginFailure({
        invitationId: value.invitation.invitationId,
        attemptId,
        connectionId,
        connectorKey: value.connectorKey,
        customerKey: value.customerKey,
        pkceCredentialReference,
        now: value.now,
      });
      throw error;
    }
  }

  async completeOAuthAttempt(input = {}) {
    const value = normalizeAttemptLifecycle(input, this.now());
    return this.store.completeInvitation({
      id: value.invitationId,
      attemptId: value.attemptId,
      connectionId: value.connectionId,
      connectorKey: value.connectorKey,
      customerKey: value.customerKey,
      now: value.now,
    });
  }

  async releaseOAuthAttempt(input = {}) {
    const value = normalizeAttemptLifecycle(input, this.now());
    return this.store.releaseInvitationAttempt({
      id: value.invitationId,
      attemptId: value.attemptId,
      connectionId: value.connectionId,
      connectorKey: value.connectorKey,
      customerKey: value.customerKey,
      now: value.now,
    });
  }

  async consumeCallbackState(input = {}) {
    const connectorKey = requireCustomerConnectionConnector(input.connectorKey);
    const redirectUri = requireHttpsUrl(input.redirectUri, 'redirectUri');
    const now = requireTimestamp(this.now(), 'now');
    const payload = await verifyCompactPayload(
      requireText(input.state, 'state'),
      this.stateSigningKey,
      { cryptoImpl: this.cryptoImpl },
    );
    const customerKey = requireText(payload.customerKey, 'customerKey');
    validateStatePayload(payload, {
      connectorKey,
      customerKey: input.customerKey
        ? requireText(input.customerKey, 'customerKey')
        : customerKey,
      redirectUri,
      now,
    });
    const nonceHash = await hashSecureToken(payload.nonce, this.cryptoImpl);
    const attempt = await this.store.consumeOAuthState({
      id: payload.attemptId,
      connectorKey,
      customerKey,
      redirectUri,
      nonceHash,
      now,
    });
    if (
      attempt.connectionId !== payload.connectionId
      || attempt.invitationId !== payload.invitationId
    ) {
      throw permanentError('OAuth state attempt binding does not match', {
        code: 'CONNECTION_OAUTH_STATE_MISMATCH',
      });
    }
    const pkceVerifier = await this.credentials.read({
      credentialReference: requireText(
        attempt.pkceCredentialReference,
        'pkceCredentialReference',
      ),
      connectionId: payload.connectionId,
      connectorKey,
      credentialKind: 'pkce_verifier',
    });
    await this.credentials.revoke({
      credentialReference: attempt.pkceCredentialReference,
      connectionId: payload.connectionId,
      connectorKey,
      credentialKind: 'pkce_verifier',
    });
    return Object.freeze({
      connectorKey,
      customerKey,
      connectionId: payload.connectionId,
      attemptId: payload.attemptId,
      invitationId: payload.invitationId,
      redirectUri,
      pkceVerifier,
    });
  }

  async readInvitation(input = {}) {
    const connectorKey = requireCustomerConnectionConnector(input.connectorKey);
    const environment = requireText(input.environment, 'environment');
    const redirectUri = requireHttpsUrl(input.redirectUri, 'redirectUri');
    const now = requireTimestamp(this.now(), 'now');
    const invitation = await verifyCompactPayload(
      requireText(input.invitationToken, 'invitationToken'),
      this.invitationSigningKey,
      { cryptoImpl: this.cryptoImpl },
    );
    const customerKey = requireText(invitation.customerKey, 'customerKey');
    validateInvitationPayload(invitation, {
      connectorKey,
      customerKey: input.customerKey
        ? requireText(input.customerKey, 'customerKey')
        : customerKey,
      environment,
      redirectUri,
      now,
    });
    const nonceHash = await hashSecureToken(invitation.nonce, this.cryptoImpl);
    const row = await this.store.getInvitation(invitation.invitationId);
    validatePersistedInvitation(row, {
      invitation,
      connectorKey,
      customerKey,
      environment,
      redirectUri,
      nonceHash,
      now,
    });
    return Object.freeze({
      invitation,
      row,
      connectorKey,
      customerKey,
      environment,
      redirectUri,
      nonceHash,
      now,
    });
  }

  async rollbackBeginFailure(input) {
    const cleanup = [
      this.store.releaseInvitationAttempt({
        id: input.invitationId,
        attemptId: input.attemptId,
        connectionId: input.connectionId ?? 'connection-not-created',
        connectorKey: input.connectorKey,
        customerKey: input.customerKey,
        now: input.now,
      }),
    ];
    if (input.pkceCredentialReference && input.connectionId) {
      cleanup.push(this.credentials.revoke({
        credentialReference: input.pkceCredentialReference,
        connectionId: input.connectionId,
        connectorKey: input.connectorKey,
        credentialKind: 'pkce_verifier',
      }));
    }
    await Promise.all(cleanup);
  }
}

function validateInvitationPayload(payload, expected) {
  if (
    payload.v !== CONTRACT_VERSION
    || payload.connectorKey !== expected.connectorKey
    || payload.customerKey !== expected.customerKey
    || payload.environment !== expected.environment
    || normalizeUrl(payload.redirectUri) !== expected.redirectUri
    || readInvitationMaxAttempts(payload.maxAttempts) !== payload.maxAttempts
  ) {
    throw permanentError('Connection invitation binding does not match', {
      code: 'CONNECTION_INVITATION_MISMATCH',
    });
  }
  validateTemporalPayload(payload, expected.now, 'INVITATION');
  requireText(payload.invitationId, 'invitationId');
  requireText(payload.nonce, 'nonce');
}

function validatePersistedInvitation(row, expected) {
  if (!row) {
    throw permanentError('Connection invitation is invalid', {
      code: 'CONNECTION_INVITATION_INVALID',
    });
  }
  if (
    row.invitationId !== expected.invitation.invitationId
    || row.connectorKey !== expected.connectorKey
    || row.customerKey !== expected.customerKey
    || row.environment !== expected.environment
    || normalizeUrl(row.redirectUri) !== expected.redirectUri
    || row.nonceHash !== expected.nonceHash
    || row.issuedAt !== expected.invitation.issuedAt
    || row.expiresAt !== expected.invitation.expiresAt
    || row.maxAttempts !== expected.invitation.maxAttempts
  ) {
    throw permanentError('Connection invitation binding does not match', {
      code: 'CONNECTION_INVITATION_MISMATCH',
    });
  }
  if (row.consumedAt !== null) {
    throw permanentError('Connection invitation was already completed', {
      code: 'CONNECTION_INVITATION_REPLAYED',
    });
  }
  if (row.expiresAt < expected.now) {
    throw permanentError('Connection invitation has expired', {
      code: 'CONNECTION_INVITATION_EXPIRED',
    });
  }
  if (row.attemptCount >= row.maxAttempts) {
    throw permanentError('Connection invitation retry limit was reached', {
      code: 'CONNECTION_INVITATION_ATTEMPTS_EXHAUSTED',
    });
  }
}

function validateStatePayload(payload, expected) {
  if (
    payload.v !== CONTRACT_VERSION
    || payload.connectorKey !== expected.connectorKey
    || payload.customerKey !== expected.customerKey
    || normalizeUrl(payload.redirectUri) !== expected.redirectUri
  ) {
    throw permanentError('OAuth state binding does not match', {
      code: 'CONNECTION_OAUTH_STATE_MISMATCH',
    });
  }
  validateTemporalPayload(payload, expected.now, 'OAUTH_STATE');
  for (const fieldName of ['attemptId', 'connectionId', 'invitationId', 'nonce']) {
    requireText(payload[fieldName], fieldName);
  }
}

function validateTemporalPayload(payload, now, prefix) {
  const issuedAt = requireTimestamp(payload.issuedAt, 'issuedAt');
  const expiresAt = requireTimestamp(payload.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt || now > expiresAt) {
    throw permanentError(`${prefix} has expired`, {
      code: `CONNECTION_${prefix}_EXPIRED`,
    });
  }
  if (issuedAt > now + 60_000) {
    throw permanentError(`${prefix} issued-at is invalid`, {
      code: `CONNECTION_${prefix}_TEMPORAL_INVALID`,
    });
  }
}

function normalizeAttemptLifecycle(input, nowValue) {
  return Object.freeze({
    invitationId: requireText(input.invitationId, 'invitationId'),
    attemptId: requireText(input.attemptId, 'attemptId'),
    connectionId: requireText(input.connectionId, 'connectionId'),
    connectorKey: requireCustomerConnectionConnector(input.connectorKey),
    customerKey: requireText(input.customerKey, 'customerKey'),
    now: requireTimestamp(nowValue, 'now'),
  });
}

function requireStore(value) {
  for (const method of [
    'createInvitation',
    'getInvitation',
    'reserveInvitationAttempt',
    'releaseInvitationAttempt',
    'completeInvitation',
    'createConnection',
    'attachInvitationConnection',
    'createOAuthState',
    'consumeOAuthState',
  ]) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`CustomerConnectionOAuthService requires store.${method}`);
    }
  }
  return value;
}

function requireCredentialRepository(value) {
  if (
    typeof value?.replace !== 'function'
    || typeof value?.read !== 'function'
    || typeof value?.revoke !== 'function'
  ) {
    throw new TypeError('CustomerConnectionOAuthService requires encrypted credential repository');
  }
  return value;
}

function requireHttpsOrigin(value) {
  const url = new URL(requireText(value, 'publicOrigin'));
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.pathname !== '/') {
    throw new TypeError('publicOrigin must be an HTTPS origin');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function requireHttpsUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError(`${fieldName} must use HTTPS`);
  }
  url.hash = '';
  return url.toString();
}

function normalizeUrl(value) {
  try {
    return requireHttpsUrl(value, 'URL');
  } catch {
    return null;
  }
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
