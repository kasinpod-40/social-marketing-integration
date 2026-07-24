import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Legacy/DEV adapter: อ่าน Refresh Token จาก Environment โดยไม่ Persist ใหม่ */
export class EnvironmentRefreshTokenCredentialAdapter {
  constructor(input = {}) {
    this.refreshToken = requireText(input.refreshToken, 'refreshToken');
  }

  async getRefreshToken() {
    return this.refreshToken;
  }
}

/** Customer adapter: อ่านเฉพาะ credential_reference ผ่าน encrypted repository */
export class EncryptedCustomerRefreshTokenCredentialAdapter {
  constructor(input = {}) {
    if (typeof input.repository?.read !== 'function') {
      throw new TypeError('EncryptedCustomerRefreshTokenCredentialAdapter requires repository.read');
    }
    this.repository = input.repository;
    this.connectionId = requireText(input.connectionId, 'connectionId');
    this.connectorKey = requireText(input.connectorKey, 'connectorKey');
    this.credentialReference = requireText(input.credentialReference, 'credentialReference');
  }

  async getRefreshToken() {
    return this.repository.read({
      credentialReference: this.credentialReference,
      connectionId: this.connectionId,
      connectorKey: this.connectorKey,
      credentialKind: 'refresh_token',
    });
  }
}

/** Bounded one-token cache ต่อ Provider instance; Access Token ไม่ Persist และไม่ Log */
export class GoogleRefreshTokenAccessProvider {
  constructor(input = {}) {
    if (typeof input.oauthClient?.refreshAccessToken !== 'function') {
      throw new TypeError('GoogleRefreshTokenAccessProvider requires oauthClient.refreshAccessToken');
    }
    if (typeof input.credentialAdapter?.getRefreshToken !== 'function') {
      throw new TypeError('GoogleRefreshTokenAccessProvider requires credentialAdapter.getRefreshToken');
    }
    this.oauthClient = input.oauthClient;
    this.credentialAdapter = input.credentialAdapter;
    this.clock = typeof input.clock === 'function' ? input.clock : () => Date.now();
    this.cached = null;
    this.inFlight = null;
  }

  async getAccessToken() {
    const now = requireTimestamp(this.clock());
    if (this.cached && this.cached.expiresAt - now > 60_000) return this.cached.accessToken;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh(now);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  clear() {
    this.cached = null;
  }

  async refresh(now) {
    const refreshToken = await this.credentialAdapter.getRefreshToken();
    const result = await this.oauthClient.refreshAccessToken({ refreshToken });
    if (!result?.accessToken || !Number.isSafeInteger(result?.expiresAt) || result.expiresAt <= now) {
      throw permanentError('Google OAuth refresh returned an invalid token lifecycle', {
        code: 'GOOGLE_OAUTH_REFRESH_RESULT_INVALID',
      });
    }
    this.cached = Object.freeze({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
    });
    return this.cached.accessToken;
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('clock must return epoch milliseconds');
  return number;
}
