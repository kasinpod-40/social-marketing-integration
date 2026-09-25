import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_AUTHORIZE_URL = 'https://business-api.tiktok.com/portal/auth';
const DEFAULT_TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
const DEFAULT_TIMEOUT_MS = 30_000;

export class TikTokAdsOAuthClient {
  constructor(input = {}) {
    this.appId = requireDigits(input.appId, 'appId');
    this.appSecret = requireText(input.appSecret, 'appSecret');
    this.authorizeUrl = requireHttpsUrl(input.authorizeUrl ?? DEFAULT_AUTHORIZE_URL, 'authorizeUrl');
    this.tokenUrl = requireHttpsUrl(input.tokenUrl ?? DEFAULT_TOKEN_URL, 'tokenUrl');
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('TikTokAdsOAuthClient requires fetch');
    this.timeoutMs = positiveInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  buildAuthorizationUrl(input = {}) {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('state', requireText(input.state, 'state'));
    url.searchParams.set('redirect_uri', requireHttpsUrl(input.redirectUri, 'redirectUri'));
    return url.toString();
  }

  async exchangeAuthorizationCode(input = {}) {
    const payload = await this.#requestToken({
      app_id: this.appId,
      auth_code: requireText(input.code, 'code'),
      secret: this.appSecret,
    });
    const data = payload.data ?? {};
    const accessToken = requireText(data.access_token, 'access_token');
    const refreshToken = requireText(data.refresh_token, 'refresh_token');
    const now = this.now();
    return Object.freeze({
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresAt: expiryFromSeconds(data, ['expires_in', 'access_token_expires_in'], now),
      refreshExpiresAt: expiryFromSeconds(
        data,
        ['refresh_expires_in', 'refresh_token_expires_in'],
        now,
      ),
    });
  }

  async #requestToken(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw transientError('TikTok Ads OAuth request failed', {
        code: 'TIKTOK_ADS_OAUTH_NETWORK_ERROR',
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError('TikTok Ads OAuth returned invalid JSON', {
        code: 'TIKTOK_ADS_OAUTH_INVALID_RESPONSE',
        cause,
        details: { httpStatus: response.status },
      });
    }
    if (response.ok && Number(payload?.code) === 0) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    throw (retryable ? transientError : permanentError)(
      'TikTok Ads OAuth request was rejected',
      {
        code: retryable ? 'TIKTOK_ADS_OAUTH_TRANSIENT_ERROR' : 'TIKTOK_ADS_OAUTH_REJECTED',
        details: {
          httpStatus: response.status,
          providerCode: String(payload?.code ?? 'unknown'),
        },
      },
    );
  }
}

function expiryFromSeconds(data, names, now) {
  for (const name of names) {
    const value = data?.[name];
    if (value === undefined || value === null || value === '') continue;
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      throw permanentError('TikTok Ads OAuth token lifetime is invalid', {
        code: 'TIKTOK_ADS_OAUTH_INVALID_RESPONSE',
        details: { fieldName: name },
      });
    }
    return now + seconds * 1_000;
  }
  return null;
}
function requireHttpsUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError(`${fieldName} must use HTTPS`);
  }
  return url.toString();
}
function requireDigits(value, fieldName) {
  const text = requireText(String(value ?? ''), fieldName);
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must contain digits only`);
  return text;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
