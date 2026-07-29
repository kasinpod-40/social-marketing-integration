import {
  CUSTOMER_CONNECTION_ACCESS_STATUSES,
  CUSTOMER_CONNECTION_CONNECTORS,
  CUSTOMER_CONNECTION_STATUSES,
} from './customer-connection-contract.js';

const CONNECTOR = CUSTOMER_CONNECTION_CONNECTORS.TIKTOK_ADS;

/** TikTok Ads consent + encrypted access-token persistence + exact advertiser validation. */
export class TikTokAdsCustomerOAuthFlow {
  constructor(input = {}) {
    this.shared = requireMethod(input.shared, 'previewInvitation', 'shared');
    requireMethod(input.shared, 'beginOAuth', 'shared');
    requireMethod(input.shared, 'consumeCallbackState', 'shared');
    requireMethod(input.shared, 'completeOAuthAttempt', 'shared');
    requireMethod(input.shared, 'releaseOAuthAttempt', 'shared');
    this.oauthClient = requireMethod(input.oauthClient, 'buildAuthorizationUrl', 'oauthClient');
    requireMethod(input.oauthClient, 'exchangeAuthorizationCode', 'oauthClient');
    this.adsClient = requireMethod(input.adsClient, 'validateAdvertiser', 'adsClient');
    this.credentials = requireMethod(input.credentials, 'replace', 'credentials');
    this.store = requireMethod(input.store, 'updateConnection', 'store');
    requireMethod(input.store, 'getConnection', 'store');
    this.redirectUri = requireText(input.redirectUri, 'redirectUri');
    this.environment = requireText(input.environment, 'environment');
    this.approvedAdvertiserId = requireDigits(input.approvedAdvertiserId, 'approvedAdvertiserId');
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
      pkceEnabled: false,
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
      await this.fail(callback, 'TIKTOK_ADS_OAUTH_PROVIDER_REJECTED');
      throw connectionError('TikTok Ads authorization was rejected', 'TIKTOK_ADS_OAUTH_PROVIDER_REJECTED');
    }

    try {
      const token = await this.oauthClient.exchangeAuthorizationCode({
        code: requireText(input.code, 'code'),
        redirectUri: this.redirectUri,
      });
      const identity = await this.adsClient.validateAdvertiser({
        accessToken: token.accessToken,
        advertiserId: this.approvedAdvertiserId,
        authorizedAdvertiserIds: token.advertiserIds,
      });
      const existing = await this.store.getConnection(callback.connectionId);
      const credentialReference = await this.credentials.replace({
        connectionId: callback.connectionId,
        connectorKey: CONNECTOR,
        credentialKind: 'provider_access_token',
        plaintext: token.accessToken,
        previousReference: existing?.credentialReference ?? null,
      });
      const validatedAt = this.now();
      await this.store.updateConnection({
        connectionId: callback.connectionId,
        connectorKey: CONNECTOR,
        externalAccountId: identity.advertiserId,
        externalAccountName: identity.advertiserName,
        credentialReference,
        grantedScopes: [],
        tokenType: 'bearer',
        lastValidatedAt: validatedAt,
        connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
        accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
        lastErrorCode: null,
        providerMetadata: {
          credentialReference,
          advertiserId: identity.advertiserId,
          currency: identity.currency,
          timezone: identity.timezone,
        },
        updatedAt: validatedAt,
      });
      await this.shared.completeOAuthAttempt(callback);
      return safeResult({
        connectionId: callback.connectionId,
        advertiserId: identity.advertiserId,
        advertiserName: identity.advertiserName,
        validatedAt,
      });
    } catch (error) {
      await this.fail(callback, error?.code ?? 'TIKTOK_ADS_OAUTH_CALLBACK_FAILED');
      throw error;
    }
  }

  async fail(callback, errorCode) {
    if (typeof this.store.recordCallbackError === 'function') {
      await this.store.recordCallbackError({
        attemptId: callback.attemptId,
        errorCode,
        now: this.now(),
      });
    }
    await this.store.updateConnection({
      connectionId: callback.connectionId,
      connectorKey: CONNECTOR,
      connectionStatus: errorCode === 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH'
        ? CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH
        : CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      accessStatus: errorCode === 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH'
        ? CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH
        : CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
      grantedScopes: [],
      lastErrorCode: errorCode,
      updatedAt: this.now(),
    });
    await this.shared.releaseOAuthAttempt(callback);
  }
}

function safeResult(input) {
  return Object.freeze({
    connector: CONNECTOR,
    connectionId: input.connectionId,
    externalIdentity: Object.freeze({
      accountId: maskIdentity(input.advertiserId),
      accountName: input.advertiserName ?? null,
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
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireDigits(value, fieldName) {
  const text = requireText(String(value ?? ''), fieldName);
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must contain digits only`);
  return text;
}
function connectionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function maskIdentity(value) {
  const text = requireDigits(value, 'advertiserId');
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}
