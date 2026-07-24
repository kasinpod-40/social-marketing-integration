import {
  CONNECTOR_ROUTE_SLUGS,
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

const CONTRACT_VERSION = 1;

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
    });
  }

  async beginOAuth(input = {}) {
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
    await this.store.consumeInvitation({
      id: invitation.invitationId,
      connectorKey,
      customerKey,
      nonceHash,
      now,
    });

    const existingConnection = typeof this.store.findConnectionByCustomerConnector === 'function'
      ? await this.store.findConnectionByCustomerConnector({ connectorKey, customerKey })
      : null;
    const connectionId = existingConnection?.connectionId ?? this.createId('connection');
    const attemptId = this.createId('oauth-attempt');
    if (!existingConnection) {
      await this.store.createConnection({
        connectionId,
        connectorKey,
        customerKey,
        createdAt: now,
      });
    }
    await this.store.attachInvitationConnection({
      invitationId: invitation.invitationId,
      connectionId,
    });

    const pkceVerifier = this.randomToken(64);
    const pkceCredentialReference = await this.credentials.replace({
      connectionId,
      connectorKey,
      credentialKind: 'pkce_verifier',
      plaintext: pkceVerifier,
    });
    const stateNonce = this.randomToken(32);
    const expiresAt = now + readOAuthStateTtlMs(input.stateTtlMs);
    const statePayload = Object.freeze({
      v: CONTRACT_VERSION,
      connectorKey,
      customerKey,
      attemptId,
      connectionId,
      redirectUri,
      issuedAt: now,
      expiresAt,
      nonce: stateNonce,
      invitationId: invitation.invitationId,
    });
    const [stateNonceHash, state, codeChallenge] = await Promise.all([
      hashSecureToken(stateNonce, this.cryptoImpl),
      signCompactPayload(statePayload, this.stateSigningKey, { cryptoImpl: this.cryptoImpl }),
      hashSecureToken(pkceVerifier, this.cryptoImpl),
    ]);
    await this.store.createOAuthState({
      attemptId,
      invitationId: invitation.invitationId,
      connectionId,
      connectorKey,
      customerKey,
      redirectUri,
      nonceHash: stateNonceHash,
      pkceCredentialReference,
      issuedAt: now,
      expiresAt,
    });
    return Object.freeze({
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      connectionId,
      attemptId,
      redirectUri,
      expiresAt,
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
}

function validateInvitationPayload(payload, expected) {
  if (
    payload.v !== CONTRACT_VERSION
    || payload.connectorKey !== expected.connectorKey
    || payload.customerKey !== expected.customerKey
    || payload.environment !== expected.environment
    || normalizeUrl(payload.redirectUri) !== expected.redirectUri
  ) {
    throw permanentError('Connection invitation binding does not match', {
      code: 'CONNECTION_INVITATION_MISMATCH',
    });
  }
  validateTemporalPayload(payload, expected.now, 'INVITATION');
  requireText(payload.invitationId, 'invitationId');
  requireText(payload.nonce, 'nonce');
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

function requireStore(value) {
  for (const method of [
    'createInvitation',
    'consumeInvitation',
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
