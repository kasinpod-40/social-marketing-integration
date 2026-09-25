import {
  CUSTOMER_CONNECTION_ACCESS_STATUSES,
  CUSTOMER_CONNECTION_CONNECTORS,
  CUSTOMER_CONNECTION_STATUSES,
} from './customer-connection-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CONNECTOR = CUSTOMER_CONNECTION_CONNECTORS.TIKTOK_ADS;

export class TikTokAdsCustomerOAuthFlow {
  constructor(input = {}) {
    this.shared = requireMethod(input.shared, 'previewInvitation', 'shared');
    requireMethod(input.shared, 'beginOAuth', 'shared');
    requireMethod(input.shared, 'consumeCallbackState', 'shared');
    requireMethod(input.shared, 'completeOAuthAttempt', 'shared');
    requireMethod(input.shared, 'releaseOAuthAttempt', 'shared');
    this.oauthClient = requireMethod(input.oauthClient, 'buildAuthorizationUrl', 'oauthClient');
    requireMethod(input.oauthClient, 'exchangeAuthorizationCode', 'oauthClient');
    this.adsClient = requireMethod(input.adsClient, 'listAuthorizedAdvertisers', 'adsClient');
    requireMethod(input.adsClient, 'getAdvertiser', 'adsClient');
    this.credentials = requireMethod(input.credentials, 'replace', 'credentials');
    this.store = requireMethod(input.store, 'updateConnection', 'store');
    requireMethod(input.store, 'getConnection', 'store');
    this.redirectUri = requireText(input.redirectUri, 'redirectUri');
    this.environment = requireText(input.environment, 'environment');
    this.approvedAdvertiserId = optionalDigits(input.approvedAdvertiserId);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async preview(invitationToken) {
    return this.shared.previewInvitation({
      connectorKey: CONNECTOR,
      environment: this.environment,
      redirectUri: this.redirectUri,
      invitationToken: requireText(invitationToken, 'invitationToken'),
    });
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
      state: attempt.state,
    });
  }

  async complete(input = {}) {
    const callback = await this.shared.consumeCallbackState({
      connectorKey: CONNECTOR,
      redirectUri: this.redirectUri,
      state: requireText(input.state, 'state'),
    });
    if (input.oauthError) {
      await this.#recordFailure(callback, 'TIKTOK_ADS_OAUTH_PROVIDER_REJECTED');
      throw connectionError(
        'TikTok Ads authorization was rejected',
        'TIKTOK_ADS_OAUTH_PROVIDER_REJECTED',
      );
    }

    try {
      const token = await this.oauthClient.exchangeAuthorizationCode({
        code: requireText(input.code, 'code'),
      });
      const authorized = await this.adsClient.listAuthorizedAdvertisers({
        accessToken: token.accessToken,
      });
      const advertiserId = selectAdvertiserId(authorized, this.approvedAdvertiserId);
      const identity = await this.adsClient.getAdvertiser({
        accessToken: token.accessToken,
        advertiserId,
      });
      const existing = await this.store.getConnection(callback.connectionId);
      const credentialReference = await this.credentials.replace({
        connectionId: callback.connectionId,
        connectorKey: CONNECTOR,
        credentialKind: 'refresh_token',
        plaintext: token.refreshToken,
        previousReference: existing?.credentialReference ?? null,
      });
      const validatedAt = this.now();
      await this.store.updateConnection({
        connectionId: callback.connectionId,
        connectorKey: CONNECTOR,
        externalAccountId: identity.advertiserId,
        externalAccountName: identity.advertiserName,
        grantedScopes: [],
        tokenType: token.tokenType,
        tokenExpiresAt: token.expiresAt,
        lastValidatedAt: validatedAt,
        connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
        accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
        lastErrorCode: null,
        providerMetadata: {
          credentialReference,
          advertiserId: identity.advertiserId,
          currency: identity.currency,
          timezone: identity.timezone,
          refreshTokenExpiresAt: token.refreshExpiresAt,
          authorizedAdvertiserCount: authorized.length,
        },
        updatedAt: validatedAt,
      });
      await this.shared.completeOAuthAttempt(callback);
      return safeResult({
        connectionId: callback.connectionId,
        identity,
        validatedAt,
      });
    } catch (error) {
      await this.#recordFailure(callback, error?.code ?? 'TIKTOK_ADS_OAUTH_CALLBACK_FAILED');
      throw error;
    }
  }

  async #recordFailure(callback, errorCode) {
    if (typeof this.store.recordCallbackError === 'function') {
      await this.store.recordCallbackError({
        attemptId: callback.attemptId,
        errorCode,
        now: this.now(),
      });
    }
    const identityMismatch = [
      'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
      'TIKTOK_ADS_NO_ADVERTISER_ACCESS',
    ].includes(errorCode);
    const selectionRequired = errorCode === 'TIKTOK_ADS_ADVERTISER_SELECTION_REQUIRED';
    await this.store.updateConnection({
      connectionId: callback.connectionId,
      connectorKey: CONNECTOR,
      connectionStatus: selectionRequired
        ? CUSTOMER_CONNECTION_STATUSES.IDENTITY_SELECTION_REQUIRED
        : identityMismatch
          ? CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH
          : CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      accessStatus: selectionRequired
        ? CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_SELECTION_REQUIRED
        : identityMismatch
          ? CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH
          : CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
      grantedScopes: [],
      lastErrorCode: errorCode,
      updatedAt: this.now(),
    });
    await this.shared.releaseOAuthAttempt(callback);
  }
}

function selectAdvertiserId(candidates, approvedAdvertiserId) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw permanentError('TikTok Ads authorization returned no advertiser access', {
      code: 'TIKTOK_ADS_NO_ADVERTISER_ACCESS',
    });
  }
  if (approvedAdvertiserId) {
    const matched = candidates.find((item) => item.advertiserId === approvedAdvertiserId);
    if (!matched) {
      throw permanentError('TikTok Ads advertiser identity mismatch', {
        code: 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
      });
    }
    return approvedAdvertiserId;
  }
  if (candidates.length === 1) return requireDigits(candidates[0].advertiserId, 'advertiserId');
  throw permanentError('TikTok Ads advertiser selection is required', {
    code: 'TIKTOK_ADS_ADVERTISER_SELECTION_REQUIRED',
    details: { candidateCount: candidates.length },
  });
}

function safeResult(input) {
  return Object.freeze({
    connector: CONNECTOR,
    connectionId: input.connectionId,
    externalIdentity: Object.freeze({
      accountId: maskIdentity(input.identity.advertiserId),
      accountName: input.identity.advertiserName ?? null,
    }),
    connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
    accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
    grantedScopes: Object.freeze([]),
    validatedAt: new Date(input.validatedAt).toISOString(),
    nextAction: 'none',
    queued: false,
    larkWrite: false,
  });
}
function requireMethod(value, method, fieldName) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  return value;
}
function requireDigits(value, fieldName) {
  const text = requireText(String(value ?? ''), fieldName);
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must contain digits only`);
  return text;
}
function optionalDigits(value) {
  if (value === undefined || value === null || value === '') return null;
  return requireDigits(value, 'approvedAdvertiserId');
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function connectionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function maskIdentity(value) {
  const text = requireDigits(value, 'advertiserId');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
}
