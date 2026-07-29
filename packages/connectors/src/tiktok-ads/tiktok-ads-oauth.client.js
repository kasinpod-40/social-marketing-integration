import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_AUTHORIZE_URL = 'https://business-api.tiktok.com/portal/auth';
const DEFAULT_TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';

/** TikTok for Business OAuth transport. Token material is returned to the application only. */
export class TikTokAdsOAuthClient {
  constructor(input = {}) {
    this.appId = requireText(input.appId, 'appId');
    this.appSecret = requireText(input.appSecret, 'appSecret');
    this.authorizeUrl = input.authorizeUrl ?? DEFAULT_AUTHORIZE_URL;
    this.tokenUrl = input.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  buildAuthorizationUrl(input = {}) {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('state', requireText(input.state, 'state'));
    url.searchParams.set('redirect_uri', requireText(input.redirectUri, 'redirectUri'));
    return url.toString();
  }

  async exchangeAuthorizationCode(input = {}) {
    const response = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        secret: this.appSecret,
        auth_code: requireText(input.code, 'code'),
      }),
    });
    const payload = await readJson(response);
    if (!response.ok || payload.code !== 0) {
      throw classifyProviderError(payload, response.status, 'TIKTOK_ADS_TOKEN_EXCHANGE_FAILED');
    }
    const data = payload.data ?? {};
    const accessToken = requireText(data.access_token, 'access_token');
    const advertiserIds = Array.isArray(data.advertiser_ids)
      ? [...new Set(data.advertiser_ids.map((value) => String(value).trim()).filter(Boolean))]
      : [];
    if (advertiserIds.length === 0) {
      throw permanentError('TikTok Ads authorization returned no advertiser', {
        code: 'TIKTOK_ADS_NO_ADVERTISER_ACCESS',
      });
    }
    return Object.freeze({ accessToken, advertiserIds: Object.freeze(advertiserIds) });
  }
}

async function readJson(response) {
  try { return await response.json(); } catch {
    throw transientError('TikTok Ads returned invalid JSON', { code: 'TIKTOK_ADS_RESPONSE_INVALID' });
  }
}

function classifyProviderError(payload, status, fallbackCode) {
  const code = String(payload?.code ?? fallbackCode);
  const options = { code: fallbackCode, details: { providerCode: code, httpStatus: status } };
  return status >= 500 || status === 429
    ? transientError('TikTok Ads provider request failed', options)
    : permanentError('TikTok Ads provider request was rejected', options);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
