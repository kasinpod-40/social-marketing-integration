import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Shared server-side Google OAuth transport สำหรับ Connector-specific consent แยกกัน */
export class GoogleOAuthClient {
  constructor(config = {}) {
    this.clientId = requireText(config.clientId, 'clientId');
    this.clientSecret = requireText(config.clientSecret, 'clientSecret');
    this.authorizationUrl = requireHttpsUrl(
      config.authorizationUrl ?? DEFAULT_AUTHORIZATION_URL,
      'authorizationUrl',
    );
    this.tokenUrl = requireHttpsUrl(config.tokenUrl ?? DEFAULT_TOKEN_URL, 'tokenUrl');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('GoogleOAuthClient requires fetch');
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, 'timeoutMs');
    this.clock = typeof config.clock === 'function' ? config.clock : () => Date.now();
  }

  buildAuthorizationUrl(input = {}) {
    const url = new URL(this.authorizationUrl);
    const scopes = normalizeScopes(input.scopes);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', requireHttpsUrl(input.redirectUri, 'redirectUri'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', requireText(input.state, 'state'));
    if (input.promptConsent === true) url.searchParams.set('prompt', 'consent');
    if (input.codeChallenge) {
      url.searchParams.set('code_challenge', requireText(input.codeChallenge, 'codeChallenge'));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeAuthorizationCode(input = {}) {
    const payload = await this.requestToken(new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: requireText(input.code, 'code'),
      grant_type: 'authorization_code',
      redirect_uri: requireHttpsUrl(input.redirectUri, 'redirectUri'),
      ...(input.codeVerifier ? { code_verifier: requireText(input.codeVerifier, 'codeVerifier') } : {}),
    }), 'GOOGLE_OAUTH_CODE_EXCHANGE');
    return normalizeTokenResponse(payload, this.clock());
  }

  async refreshAccessToken(input = {}) {
    const payload = await this.requestToken(new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: requireText(input.refreshToken, 'refreshToken'),
      grant_type: 'refresh_token',
    }), 'GOOGLE_OAUTH_TOKEN_REFRESH');
    return normalizeTokenResponse(payload, this.clock(), { requireRefreshToken: false });
  }

  async requestToken(body, errorPrefix) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      throw transientError('Google OAuth request failed', {
        code: `${errorPrefix}_NETWORK_ERROR`,
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError('Google OAuth returned invalid JSON', {
        code: `${errorPrefix}_INVALID_RESPONSE`,
        cause,
        details: { status: response.status },
      });
    }
    if (response.ok && !payload?.error) return payload;

    const retryable = response.status === 429 || response.status >= 500;
    const factory = retryable ? transientError : permanentError;
    throw factory('Google OAuth request was rejected', {
      code: retryable ? `${errorPrefix}_TRANSIENT_ERROR` : `${errorPrefix}_REJECTED`,
      details: {
        status: response.status,
        oauthErrorCode: optionalText(payload?.error),
      },
    });
  }
}

function normalizeTokenResponse(payload, now, options = {}) {
  const accessToken = requireText(payload?.access_token, 'access_token');
  const refreshToken = optionalText(payload?.refresh_token);
  if (options.requireRefreshToken !== false && !refreshToken) {
    throw permanentError('Google OAuth did not return a Refresh Token', {
      code: 'GOOGLE_OAUTH_REFRESH_TOKEN_MISSING',
    });
  }
  const expiresInSeconds = positiveInteger(payload?.expires_in ?? 3_600, 'expires_in');
  return Object.freeze({
    accessToken,
    refreshToken,
    tokenType: optionalText(payload?.token_type) ?? 'Bearer',
    expiresAt: requireTimestamp(now) + expiresInSeconds * 1000,
    grantedScopes: Object.freeze(parseScopeString(payload?.scope)),
  });
}

function normalizeScopes(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Google OAuth scopes are required');
  return [...new Set(value.map((scope) => requireText(scope, 'scope')))].sort();
}

function parseScopeString(value) {
  const text = optionalText(value);
  if (!text) return [];
  return [...new Set(text.split(/\s+/u).filter(Boolean))].sort();
}

function requireHttpsUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError(`${fieldName} must use HTTPS`);
  }
  return url.toString();
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Google OAuth requires ${fieldName}`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : String(value).trim();
  return text || null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('OAuth clock must return epoch milliseconds');
  return number;
}
