import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 30_000;

export class TikTokAdsApiClient {
  constructor(input = {}) {
    this.appId = requireDigits(input.appId, 'appId');
    this.appSecret = requireText(input.appSecret, 'appSecret');
    this.baseUrl = requireHttpsUrl(input.baseUrl ?? DEFAULT_BASE_URL, 'baseUrl').replace(/\/$/u, '');
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('TikTokAdsApiClient requires fetch');
    this.timeoutMs = positiveInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  }

  async listAuthorizedAdvertisers(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const url = new URL(`${this.baseUrl}/oauth2/advertiser/get/`);
    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('secret', this.appSecret);
    const payload = await this.#get(url, accessToken, 'TIKTOK_ADS_ADVERTISER_LIST');
    const list = Array.isArray(payload.data?.list) ? payload.data.list : [];
    const byId = new Map();
    for (const item of list) {
      const advertiserId = optionalDigits(item?.advertiser_id ?? item?.id ?? item);
      if (!advertiserId) continue;
      byId.set(advertiserId, Object.freeze({
        advertiserId,
        advertiserName: optionalText(item?.advertiser_name ?? item?.name),
      }));
    }
    return Object.freeze([...byId.values()].sort((left, right) => (
      left.advertiserId.localeCompare(right.advertiserId)
    )));
  }

  async getAdvertiser(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const url = new URL(`${this.baseUrl}/advertiser/info/`);
    url.searchParams.set('advertiser_ids', JSON.stringify([advertiserId]));
    const payload = await this.#get(url, accessToken, 'TIKTOK_ADS_ADVERTISER_INFO');
    const list = Array.isArray(payload.data?.list) ? payload.data.list : [];
    const row = list.find((item) => String(item?.advertiser_id ?? item?.id ?? '') === advertiserId);
    if (!row) {
      throw permanentError('TikTok Ads advertiser identity was not returned', {
        code: 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH',
      });
    }
    return Object.freeze({
      advertiserId,
      advertiserName: optionalText(row.advertiser_name ?? row.name),
      currency: optionalText(row.currency),
      timezone: optionalText(row.timezone ?? row.time_zone),
    });
  }

  async #get(url, accessToken, prefix) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'Access-Token': accessToken },
        signal: controller.signal,
      });
    } catch (cause) {
      throw transientError('TikTok Ads provider request failed', {
        code: `${prefix}_NETWORK_ERROR`,
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError('TikTok Ads provider returned invalid JSON', {
        code: `${prefix}_INVALID_RESPONSE`,
        cause,
        details: { httpStatus: response.status },
      });
    }
    if (response.ok && Number(payload?.code) === 0) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    throw (retryable ? transientError : permanentError)(
      'TikTok Ads provider request was rejected',
      {
        code: retryable ? `${prefix}_TRANSIENT_ERROR` : `${prefix}_REJECTED`,
        details: {
          httpStatus: response.status,
          providerCode: String(payload?.code ?? 'unknown'),
        },
      },
    );
  }
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
function optionalDigits(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  return /^\d+$/u.test(text) ? text : null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
