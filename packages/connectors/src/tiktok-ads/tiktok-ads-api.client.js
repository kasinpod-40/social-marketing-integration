import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 30_000;
const REPORT_PAGE_SIZE = 100;
const REPORT_MAX_PAGES = 5;

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

  /** ตรวจสิทธิ์ Campaign ด้วยหน้าแรกขนาดหนึ่งรายการ โดยไม่ส่ง payload ออกนอก Worker */
  async probeCampaigns(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const url = new URL(`${this.baseUrl}/campaign/get/`);
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '1');
    const payload = await this.#get(url, accessToken, 'TIKTOK_ADS_CAMPAIGN_PROBE');
    if (!Array.isArray(payload.data?.list)) {
      throw transientError('TikTok Ads campaign response is malformed', {
        code: 'TIKTOK_ADS_CAMPAIGN_PROBE_INVALID_RESPONSE',
      });
    }
    return Object.freeze({
      campaignReturned: payload.data.list.length > 0,
      pageSize: 1,
    });
  }

  /** ตรวจรูปแบบรายงาน Campaign รายวันเพียงแถวเดียว ไม่ส่งข้อมูลธุรกิจกลับจาก Worker */
  async probeCampaignDailyReport(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const date = requireIsoDate(input.date);
    const url = this.#campaignDailyReportUrl(advertiserId, date, 1, 1);
    const payload = await this.#get(url, accessToken, 'TIKTOK_ADS_REPORT_PROBE');
    if (!Array.isArray(payload.data?.list)) {
      throw transientError('TikTok Ads report response is malformed', {
        code: 'TIKTOK_ADS_REPORT_PROBE_INVALID_RESPONSE',
      });
    }
    const metrics = payload.data.list[0]?.metrics;
    return Object.freeze({
      reportReturned: payload.data.list.length > 0,
      pageSize: 1,
      paginationAvailable: payload.data.page_info != null,
      metricsPresent: Object.freeze({
        spend: Object.hasOwn(metrics ?? {}, 'spend'),
        impressions: Object.hasOwn(metrics ?? {}, 'impressions'),
        clicks: Object.hasOwn(metrics ?? {}, 'clicks'),
      }),
    });
  }

  /** อ่านทุกหน้าของวันเดียวแบบมีเพดาน ก่อนเปิด D1 write boundary */
  async listCampaignDailyReport(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const date = requireIsoDate(input.date);
    const rows = [];
    let expectedTotal = null;
    let expectedPages = null;
    for (let page = 1; page <= REPORT_MAX_PAGES; page += 1) {
      const payload = await this.#get(
        this.#campaignDailyReportUrl(advertiserId, date, page, REPORT_PAGE_SIZE),
        accessToken,
        'TIKTOK_ADS_DAILY_REPORT',
      );
      const list = payload.data?.list;
      const pageInfo = payload.data?.page_info;
      if (!Array.isArray(list) || !pageInfo || typeof pageInfo !== 'object') {
        throw transientError('TikTok Ads daily report response is malformed', {
          code: 'TIKTOK_ADS_DAILY_REPORT_INVALID_RESPONSE',
        });
      }
      const total = nonNegativeInteger(pageInfo.total_number, 'total_number');
      const pages = positiveInteger(pageInfo.total_page ?? Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE)), 'total_page');
      const reportedPage = positiveInteger(pageInfo.page ?? page, 'page');
      if (reportedPage !== page || pages > REPORT_MAX_PAGES
        || (expectedTotal !== null && (total !== expectedTotal || pages !== expectedPages))) {
        throw permanentError('TikTok Ads daily report pagination is inconsistent or too large', {
          code: 'TIKTOK_ADS_DAILY_REPORT_PAGINATION_UNSAFE',
        });
      }
      expectedTotal = total;
      expectedPages = pages;
      rows.push(...list);
      if (rows.length > REPORT_MAX_PAGES * REPORT_PAGE_SIZE) {
        throw permanentError('TikTok Ads daily report exceeds the bounded row limit', {
          code: 'TIKTOK_ADS_DAILY_REPORT_TOO_LARGE',
        });
      }
      if (page === pages) {
        if (rows.length !== total) {
          throw transientError('TikTok Ads daily report count does not match its pages', {
            code: 'TIKTOK_ADS_DAILY_REPORT_INCOMPLETE',
          });
        }
        return Object.freeze({ rows: Object.freeze(rows), totalCount: total, pageCount: pages });
      }
    }
    throw permanentError('TikTok Ads daily report exceeded its page limit', {
      code: 'TIKTOK_ADS_DAILY_REPORT_TOO_LARGE',
    });
  }

  #campaignDailyReportUrl(advertiserId, date, page, pageSize) {
    const url = new URL(`${this.baseUrl}/report/integrated/get/`);
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('report_type', 'BASIC');
    url.searchParams.set('data_level', 'AUCTION_CAMPAIGN');
    url.searchParams.set('dimensions', JSON.stringify(['campaign_id', 'stat_time_day']));
    url.searchParams.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks']));
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    return url;
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
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be nonnegative`);
  return number;
}
function requireIsoDate(value) {
  const date = requireText(value, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new TypeError('date must be a real YYYY-MM-DD date');
  }
  return date;
}
