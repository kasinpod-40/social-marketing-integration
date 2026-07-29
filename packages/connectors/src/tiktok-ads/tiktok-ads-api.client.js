import { permanentError, retryableError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

/** Read-only TikTok Ads identity client. */
export class TikTokAdsApiClient {
  constructor(input = {}) {
    this.baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  async validateAdvertiser(input = {}) {
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const allowed = new Set((input.authorizedAdvertiserIds ?? []).map(String));
    if (!allowed.has(advertiserId)) {
      throw permanentError('TikTok Ads advertiser identity mismatch', {
        code: 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
      });
    }
    const url = new URL(`${this.baseUrl}/advertiser/info/`);
    url.searchParams.set('advertiser_ids', JSON.stringify([advertiserId]));
    const response = await this.fetch(url, {
      headers: { 'access-token': requireText(input.accessToken, 'accessToken') },
    });
    const payload = await readJson(response);
    if (!response.ok || payload.code !== 0) {
      const options = {
        code: 'TIKTOK_ADS_ADVERTISER_VALIDATION_FAILED',
        details: { providerCode: String(payload?.code ?? 'unknown'), httpStatus: response.status },
      };
      throw response.status >= 500 || response.status === 429
        ? retryableError('TikTok Ads advertiser validation failed', options)
        : permanentError('TikTok Ads advertiser validation was rejected', options);
    }
    const advertiser = payload.data?.list?.find((item) => String(item.advertiser_id) === advertiserId);
    if (!advertiser) {
      throw permanentError('TikTok Ads advertiser was not returned', {
        code: 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
      });
    }
    return Object.freeze({
      advertiserId,
      advertiserName: optionalText(advertiser.name),
      currency: optionalText(advertiser.currency),
      timezone: optionalText(advertiser.timezone),
    });
  }
}

async function readJson(response) {
  try { return await response.json(); } catch {
    throw retryableError('TikTok Ads returned invalid JSON', { code: 'TIKTOK_ADS_RESPONSE_INVALID' });
  }
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
function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}
