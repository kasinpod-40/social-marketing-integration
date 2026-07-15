import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** แลก Refresh token เป็น Access token แบบ Server-side โดยไม่บันทึก Token ลง Source/Log */
export class YouTubeOAuthTokenProvider {
  constructor(config = {}) {
    this.clientId = requireText(config.clientId, 'clientId');
    this.clientSecret = requireText(config.clientSecret, 'clientSecret');
    this.refreshToken = requireText(config.refreshToken, 'refreshToken');
    this.tokenUrl = new URL(config.tokenUrl ?? DEFAULT_TOKEN_URL).toString();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('YouTubeOAuthTokenProvider requires fetch');
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, 'timeoutMs');
    this.clock = typeof config.clock === 'function' ? config.clock : () => Date.now();
    this.cached = null;
  }

  /** คืน Token ที่ยังไม่ใกล้หมดอายุ และ Refresh ใหม่แบบ Lazy เมื่อจำเป็น */
  async getAccessToken() {
    const now = this.clock();
    if (this.cached && this.cached.expiresAt - now > 60_000) return this.cached.accessToken;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      throw transientError('YouTube OAuth token refresh failed', {
        code: 'YOUTUBE_OAUTH_NETWORK_ERROR',
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError('YouTube OAuth token endpoint returned invalid JSON', {
        code: 'YOUTUBE_OAUTH_INVALID_RESPONSE',
        cause,
        details: { status: response.status },
      });
    }
    if (!response.ok || payload?.error) {
      const retryable = response.status === 429 || response.status >= 500;
      const factory = retryable ? transientError : permanentError;
      throw factory('YouTube OAuth token refresh was rejected', {
        code: retryable ? 'YOUTUBE_OAUTH_TRANSIENT_ERROR' : 'YOUTUBE_OAUTH_INVALID_GRANT',
        details: {
          status: response.status,
          oauthError: optionalText(payload?.error),
          oauthErrorDescription: optionalText(payload?.error_description),
        },
      });
    }

    const accessToken = requireText(payload?.access_token, 'access_token');
    const expiresInSeconds = positiveInteger(payload?.expires_in ?? 3600, 'expires_in');
    this.cached = Object.freeze({
      accessToken,
      expiresAt: now + expiresInSeconds * 1000,
    });
    return accessToken;
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube OAuth requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() || null : String(value);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}
