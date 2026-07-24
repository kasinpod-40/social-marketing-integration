import {
  CUSTOMER_CONNECTION_ACCESS_STATUSES,
  CUSTOMER_CONNECTION_CONNECTORS,
  CUSTOMER_CONNECTION_STATUSES,
  GOOGLE_OAUTH_SCOPES,
  requireExactGrantedScopes,
} from './customer-connection-contract.js';
import { sanitizeOperationalError } from '../../../shared/src/errors/runtime-error.js';

const CONNECTOR = CUSTOMER_CONNECTION_CONNECTORS.GOOGLE_ADS;

/** Google Ads customer consent + encrypted credential persistence + read-only identity validation */
export class GoogleAdsCustomerOAuthFlow {
  constructor(input = {}) {
    this.shared = requireMethod(input.shared, 'beginOAuth', 'shared');
    requireMethod(input.shared, 'consumeCallbackState', 'shared');
    this.oauthClient = requireMethod(input.oauthClient, 'buildAuthorizationUrl', 'oauthClient');
    requireMethod(input.oauthClient, 'exchangeAuthorizationCode', 'oauthClient');
    requireMethod(input.oauthClient, 'refreshAccessToken', 'oauthClient');
    this.adsClient = requireMethod(input.adsClient, 'validateTargetCustomer', 'adsClient');
    this.credentials = requireMethod(input.credentials, 'replace', 'credentials');
    requireMethod(input.credentials, 'read', 'credentials');
    this.store = requireMethod(input.store, 'updateConnection', 'store');
    requireMethod(input.store, 'getConnection', 'store');
    this.redirectUri = requireText(input.redirectUri, 'redirectUri');
    this.environment = requireText(input.environment, 'environment');
    this.approvedTargetCustomerId = optionalText(input.approvedTargetCustomerId);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
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
      throw connectionError('Google OAuth authorization was rejected', 'GOOGLE_OAUTH_PROVIDER_REJECTED');
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
        await this.store.updateConnection({
          connectionId: callback.connectionId,
          connectorKey: CONNECTOR,
          grantedScopes,
          tokenType: token.tokenType,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.TOKEN_REFRESH_FAILED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
          lastErrorCode: error?.code ?? 'GOOGLE_OAUTH_TOKEN_REFRESH_FAILED',
          providerMetadata: { credentialReference },
          updatedAt: this.now(),
        });
        return safeResult({
          connectionId: callback.connectionId,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.TOKEN_REFRESH_FAILED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
          grantedScopes,
          externalAccountId: this.approvedTargetCustomerId,
          nextAction: 'reconnect',
        });
      }

      try {
        const identity = await this.adsClient.validateTargetCustomer(refreshed.accessToken);
        const validatedAt = this.now();
        await this.store.updateConnection({
          connectionId: callback.connectionId,
          connectorKey: CONNECTOR,
          externalAccountId: identity.customerId,
          externalAccountName: identity.descriptiveName,
          grantedScopes,
          tokenType: token.tokenType,
          tokenExpiresAt: refreshed.expiresAt,
          lastRefreshAt: validatedAt,
          lastValidatedAt: validatedAt,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
          lastErrorCode: null,
          providerMetadata: {
            credentialReference,
            currencyCode: identity.currencyCode,
            timeZone: identity.timeZone,
          },
          updatedAt: this.now(),
        });
        return safeResult({
          connectionId: callback.connectionId,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.VALIDATED,
          grantedScopes,
          externalAccountId: identity.customerId,
          externalAccountName: identity.descriptiveName,
          validatedAt,
          nextAction: 'none',
        });
      } catch (error) {
        if (error?.code === 'GOOGLE_ADS_CUSTOMER_IDENTITY_MISMATCH'
          || error?.code === 'GOOGLE_ADS_API_ACCESS_REJECTED') {
          await this.store.updateConnection({
            connectionId: callback.connectionId,
            connectorKey: CONNECTOR,
            grantedScopes,
            tokenType: token.tokenType,
            tokenExpiresAt: refreshed.expiresAt,
            lastRefreshAt: this.now(),
            connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH,
            accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH,
            lastErrorCode: error.code,
            providerMetadata: { credentialReference },
            updatedAt: this.now(),
          });
          return safeResult({
            connectionId: callback.connectionId,
            connectionStatus: CUSTOMER_CONNECTION_STATUSES.IDENTITY_MISMATCH,
            accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.IDENTITY_MISMATCH,
            grantedScopes,
            externalAccountId: this.approvedTargetCustomerId,
            nextAction: 'grant_exact_google_ads_customer_access',
          });
        }
        if (error?.code !== 'GOOGLE_ADS_API_ACCESS_PENDING') throw error;
        await this.store.updateConnection({
          connectionId: callback.connectionId,
          connectorKey: CONNECTOR,
          grantedScopes,
          tokenType: token.tokenType,
          tokenExpiresAt: refreshed.expiresAt,
          lastRefreshAt: this.now(),
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.GOOGLE_ADS_API_ACCESS_PENDING,
          lastErrorCode: error.code,
          providerMetadata: { credentialReference },
          updatedAt: this.now(),
        });
        return safeResult({
          connectionId: callback.connectionId,
          connectionStatus: CUSTOMER_CONNECTION_STATUSES.CONNECTED,
          accessStatus: CUSTOMER_CONNECTION_ACCESS_STATUSES.GOOGLE_ADS_API_ACCESS_PENDING,
          grantedScopes,
          externalAccountId: this.approvedTargetCustomerId,
          nextAction: 'wait_for_google_ads_developer_token_access',
        });
      }
    } catch (error) {
      await this.recordFailure(callback, error?.code ?? 'GOOGLE_ADS_OAUTH_CALLBACK_FAILED');
      throw error;
    }
  }

  async recordFailure(callback, errorCode) {
    if (typeof this.store.recordCallbackError === 'function') {
      await this.store.recordCallbackError({
        attemptId: callback.attemptId,
        errorCode,
        now: this.now(),
      });
    }
    const operational = sanitizeOperationalError({ code: errorCode, message: 'OAuth callback failed' });
    const scopeInsufficient = errorCode === 'CONNECTION_SCOPE_INSUFFICIENT';
    await this.store.updateConnection({
      connectionId: callback.connectionId,
      connectorKey: CONNECTOR,
      connectionStatus: scopeInsufficient
        ? CUSTOMER_CONNECTION_STATUSES.SCOPE_INSUFFICIENT
        : CUSTOMER_CONNECTION_STATUSES.AUTHORIZATION_PENDING,
      accessStatus: scopeInsufficient
        ? CUSTOMER_CONNECTION_ACCESS_STATUSES.SCOPE_INSUFFICIENT
        : CUSTOMER_CONNECTION_ACCESS_STATUSES.NOT_VALIDATED,
      grantedScopes: [],
      lastErrorCode: operational.code,
      updatedAt: this.now(),
    });
  }
}

function safeResult(input) {
  return Object.freeze({
    connector: CONNECTOR,
    connectionId: input.connectionId,
    externalIdentity: Object.freeze({
      accountId: maskIdentity(input.externalAccountId),
      accountName: optionalText(input.externalAccountName),
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

function connectionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function maskIdentity(value) {
  const text = optionalText(value)?.replaceAll('-', '');
  if (!text) return null;
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
}
