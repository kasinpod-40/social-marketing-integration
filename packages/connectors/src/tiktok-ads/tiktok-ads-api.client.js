import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 30_000;
const REPORT_PAGE_SIZE = 100;
const REPORT_MAX_PAGES = 5;
const CAPABILITIES = Object.freeze({
  adgroup_metadata: { path: 'adgroup/get/', fields: ['adgroup_id', 'campaign_id', 'adgroup_name',
    'operation_status', 'optimization_goal', 'conversion_window'] },
  ad_metadata: { path: 'ad/get/', fields: ['ad_id', 'adgroup_id', 'campaign_id', 'ad_name',
    'operation_status', 'video_id', 'image_ids', 'tiktok_item_id', 'identity_id'] },
  campaign_all: { level: 'AUCTION_CAMPAIGN', dimension: 'campaign_id',
    metrics: ['spend', 'impressions', 'clicks'] },
  ad_base: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['spend', 'impressions', 'clicks'] },
  ad_delivery: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['reach', 'frequency'] },
  ad_video: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['video_play_actions', 'video_watched_2s', 'video_watched_6s'] },
  ad_conversion: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['conversion', 'cost_per_conversion'] },
  ad_purchase: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['total_complete_payment', 'total_purchase_value'] },
  ad_purchase_count: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['complete_payment'] },
  ad_purchase_value: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['total_complete_payment_value'] },
  smart_plus_metadata: { path: 'smart_plus/ad/get/', allStatuses: true,
    fields: ['ad_id', 'smart_plus_ad_id', 'campaign_id', 'adgroup_id', 'creative_list'] },
  ad_v2_base: { level: 'AUCTION_AD', dimension: 'ad_id_v2', metrics: ['spend', 'impressions', 'clicks'] },
  ad_total_purchase_value: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['total_purchase_value'] },
  ad_web_purchase_value: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['complete_payment_value'] },
  ad_purchase_average_value: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['value_per_complete_payment'] },
  ad_purchase_roas: { level: 'AUCTION_AD', dimension: 'ad_id', metrics: ['complete_payment_roas'] },
});
export const TIKTOK_ADS_DAILY_METRIC_FAMILIES = Object.freeze({
  base: Object.freeze(['spend', 'impressions', 'clicks']),
  delivery: Object.freeze(['reach', 'frequency']),
  video: Object.freeze(['video_play_actions', 'video_watched_2s', 'video_watched_6s']),
  optimization: Object.freeze(['conversion', 'cost_per_conversion']),
  web_purchase: Object.freeze(['complete_payment', 'complete_payment_roas', 'value_per_complete_payment']),
  app_purchase: Object.freeze(['purchase', 'total_purchase', 'total_purchase_value']),
});
export const TIKTOK_ADS_CAPABILITY_KINDS = Object.freeze(Object.keys(CAPABILITIES));

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

  /** Discovery อ่านหนึ่งหน้าเท่านั้น; ชื่อ metric เป็น capability hypothesis จน API/semantics ผ่าน */
  async probeCapability(input = {}) {
    if (!Object.hasOwn(CAPABILITIES, input.kind)) throw new TypeError('Unsupported TikTok Ads capability');
    const spec = CAPABILITIES[input.kind];
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const url = new URL(`${this.baseUrl}/${spec.path ?? 'report/integrated/get/'}`);
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '1');
    if (spec.allStatuses) url.searchParams.set('filtering', JSON.stringify({ primary_status: 'STATUS_ALL' }));
    if (!spec.path) {
      const date = requireIsoDate(input.date);
      url.searchParams.set('report_type', 'BASIC');
      url.searchParams.set('data_level', spec.level);
      url.searchParams.set('dimensions', JSON.stringify([spec.dimension, 'stat_time_day']));
      url.searchParams.set('metrics', JSON.stringify(spec.metrics));
      url.searchParams.set('start_date', date);
      url.searchParams.set('end_date', date);
      url.searchParams.set('filtering', JSON.stringify([{ field_name: spec.level === 'AUCTION_AD'
        ? 'ad_status' : 'campaign_status', filter_type: 'IN', filter_value: JSON.stringify(['STATUS_ALL']) }]));
    }
    const payload = await this.#get(url, requireText(input.accessToken, 'accessToken'), 'TIKTOK_ADS_CAPABILITY');
    const list = payload.data?.list;
    if (!Array.isArray(list) || list.length > 1) throw transientError('TikTok Ads capability response malformed',
      { code: 'TIKTOK_ADS_CAPABILITY_INVALID_RESPONSE' });
    const sample = list[0];
    if (spec.path && sample?.advertiser_id != null && String(sample.advertiser_id) !== advertiserId) {
      throw permanentError('TikTok Ads capability owner mismatch', { code: 'TIKTOK_ADS_CAPABILITY_OWNER_CONFLICT' });
    }
    const values = spec.path ? sample : sample?.metrics;
    const fields = spec.fields ?? spec.metrics;
    return Object.freeze({ kind: input.kind, sampleOnly: true, rowReturned: list.length > 0,
      totalCount: nonNegativeInteger(payload.data?.page_info?.total_number, 'total_number'),
      fieldsPresent: Object.freeze(Object.fromEntries(fields.map(field => [field, Object.hasOwn(values ?? {}, field)]))),
      dateMatched: spec.path ? null : sample?.dimensions?.stat_time_day === input.date
        || sample?.dimensions?.stat_time_day === `${input.date} 00:00:00`,
    });
  }

  /** อ่านทุกหน้าของวันเดียวแบบมีเพดาน ก่อนเปิด D1 write boundary */
  async listCampaignDailyReport(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const date = requireIsoDate(input.date);
    return this.#listCampaignRows({ accessToken, prefix: 'TIKTOK_ADS_DAILY_REPORT',
      urlForPage: page => this.#campaignDailyReportUrl(advertiserId, date, page, REPORT_PAGE_SIZE) });
  }

  /** รายวันทุกสถานะ: true Ad ใช้ ad_id_v2 เท่านั้น; ไม่รวม Creative grain กับ Ads */
  async listAllStatusDailyReport(input = {}) {
    const grains = { campaign: ['AUCTION_CAMPAIGN', 'campaign_id', 'campaign_status'],
      ad: ['AUCTION_AD', 'ad_id_v2', 'ad_status'] };
    if (!Object.hasOwn(grains, input.grain)) throw new TypeError('Unsupported TikTok Ads daily grain');
    const family = input.metricFamily ?? 'base';
    if (!Object.hasOwn(TIKTOK_ADS_DAILY_METRIC_FAMILIES, family) || (input.grain !== 'ad' && family !== 'base')) throw new TypeError('Unsupported TikTok daily metric family');
    const [level, dimension, statusField] = grains[input.grain];
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const date = requireIsoDate(input.date);
    return this.#listCampaignRows({ accessToken: requireText(input.accessToken, 'accessToken'),
      prefix: 'TIKTOK_ADS_ALL_STATUS_DAILY', maxPages: 100, concurrency: 4, urlForPage: page => {
        const url = new URL(`${this.baseUrl}/report/integrated/get/`);
        url.searchParams.set('advertiser_id', advertiserId);
        url.searchParams.set('report_type', 'BASIC');
        url.searchParams.set('data_level', level);
        url.searchParams.set('dimensions', JSON.stringify([dimension, 'stat_time_day']));
        url.searchParams.set('metrics', JSON.stringify(TIKTOK_ADS_DAILY_METRIC_FAMILIES[family]));
        url.searchParams.set('filtering', JSON.stringify([{ field_name: statusField,
          filter_type: 'IN', filter_value: JSON.stringify(['STATUS_ALL']) }]));
        url.searchParams.set('start_date', date);
        url.searchParams.set('end_date', date);
        url.searchParams.set('page', String(page));
        url.searchParams.set('page_size', String(REPORT_PAGE_SIZE));
        return url;
      } });
  }

  /** อ่าน Campaign metadata ครบทุกหน้าก่อน enrich; ไม่อนุมานว่าแถวที่ไม่คืนมาถูกลบ */
  async listCampaignMetadata(input = {}) {
    const accessToken = requireText(input.accessToken, 'accessToken');
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const source = await this.#listCampaignRows({ accessToken, prefix: 'TIKTOK_ADS_CAMPAIGN_METADATA',
      urlForPage: page => {
        const url = new URL(`${this.baseUrl}/campaign/get/`);
        url.searchParams.set('advertiser_id', advertiserId);
        url.searchParams.set('page', String(page));
        url.searchParams.set('page_size', String(REPORT_PAGE_SIZE));
        return url;
      } });
    const seen = new Set();
    const rows = source.rows.map(row => {
      const campaignId = requireDigits(row?.campaign_id, 'campaign_id');
      if (seen.has(campaignId) || (row.advertiser_id != null && String(row.advertiser_id) !== advertiserId)) {
        throw permanentError('TikTok Ads Campaign metadata identity is inconsistent', {
          code: 'TIKTOK_ADS_CAMPAIGN_METADATA_IDENTITY_CONFLICT',
        });
      }
      seen.add(campaignId);
      return Object.freeze({ campaignId, name: optionalText(row.campaign_name),
        status: optionalText(row.operation_status), objective: optionalText(row.objective_type) });
    });
    return Object.freeze({ ...source, rows: Object.freeze(rows) });
  }

  /** Full inventory ใช้ STATUS_ALL และ fields ที่จำเป็น; กำหนดเพดาน 10,000 แถว ไม่ถือว่า sample ครบ */
  async listEntityMetadata(input = {}) {
    const kinds = { campaign: ['campaign', 'campaign_name', 'campaign_id'],
      ad_group: ['adgroup', 'adgroup_name', 'adgroup_id'], ad: ['ad', 'ad_name', 'ad_id'],
      smart_ad: ['smart_plus/ad', 'ad_name', 'smart_plus_ad_id'] };
    if (!Object.hasOwn(kinds, input.kind)) throw new TypeError('Unsupported TikTok Ads inventory');
    const [resource, nameField, idField] = kinds[input.kind];
    const advertiserId = requireDigits(input.advertiserId, 'advertiserId');
    const fields = ['advertiser_id', idField, nameField, 'operation_status'];
    if (input.kind === 'campaign') fields.push('objective_type', 'campaign_automation_type');
    else fields.push('campaign_id');
    if (input.kind === 'ad') fields.push('adgroup_id', 'video_id', 'image_ids', 'ad_format');
    if (input.kind === 'smart_ad') fields.push('adgroup_id', 'creative_list');
    if (input.kind === 'ad_group') fields.push('optimization_goal', 'conversion_window', 'promotion_type');
    const result = await this.#listCampaignRows({ accessToken: requireText(input.accessToken, 'accessToken'),
      prefix: 'TIKTOK_ADS_INVENTORY', maxPages: 100, concurrency: 4, urlForPage: page => {
        const url = new URL(`${this.baseUrl}/${resource}/get/`);
        url.searchParams.set('advertiser_id', advertiserId);
        url.searchParams.set('fields', JSON.stringify(fields));
        url.searchParams.set('filtering', JSON.stringify({ primary_status: 'STATUS_ALL' }));
        url.searchParams.set('page', String(page));
        url.searchParams.set('page_size', String(REPORT_PAGE_SIZE));
        return url;
      } });
    const ids = new Set();
    const rows = result.rows.map(row => {
      const id = requireDigits(row?.[idField], idField);
      if (ids.has(id) || (row.advertiser_id != null && String(row.advertiser_id) !== advertiserId)) {
        throw permanentError('TikTok Ads inventory identity conflict', { code: 'TIKTOK_ADS_INVENTORY_IDENTITY_CONFLICT' });
      }
      ids.add(id);
      if (row.image_ids != null && (!Array.isArray(row.image_ids) || row.image_ids.length > 100
        || row.image_ids.some(value => typeof value !== 'string' || !value.trim()))) {
        throw permanentError('TikTok Ads image inventory is malformed', { code: 'TIKTOK_ADS_INVENTORY_ASSET_INVALID' });
      }
      if (row.creative_list != null && (!Array.isArray(row.creative_list) || row.creative_list.length > 100)) {
        throw permanentError('TikTok Ads creative inventory is malformed', { code: 'TIKTOK_ADS_INVENTORY_ASSET_INVALID' });
      }
      return Object.freeze({ id, kind: input.kind, name: optionalText(row[nameField]),
        status: optionalText(row.operation_status), objective: optionalText(row.objective_type),
        automationType: optionalText(row.campaign_automation_type),
        campaignId: input.kind === 'campaign' ? id : requireDigits(row.campaign_id, 'campaign_id'),
        adGroupId: ['ad', 'smart_ad'].includes(input.kind) ? requireDigits(row.adgroup_id, 'adgroup_id') : null,
        creativeItems: Array.isArray(row.creative_list) ? row.creative_list.length : null,
        creativeIds: Object.freeze(Array.isArray(row.creative_list)
          ? row.creative_list.map(creative => optionalDigits(creative?.smart_plus_creative_id)).filter(Boolean) : []),
        videoId: optionalText(row.video_id), imageIds: Object.freeze(row.image_ids ?? []),
        adFormat: optionalText(row.ad_format), optimizationGoal: optionalText(row.optimization_goal),
        conversionWindow: optionalText(row.conversion_window), promotionType: optionalText(row.promotion_type),
      });
    });
    return Object.freeze({ ...result, rows: Object.freeze(rows) });
  }

  async #listCampaignRows({ accessToken, prefix, urlForPage, maxPages = REPORT_MAX_PAGES, concurrency = 1 }) {
    const rows = [];
    let expectedTotal = null;
    let expectedPages = null;
    let page = 1;
    while (page <= (expectedPages ?? 1)) {
      // อ่านหน้าแรกเพื่อกำหนดขอบเขต แล้วอ่านไม่เกิน 4 requests พร้อมกันเฉพาะ inventory
      const end = Math.min(page + concurrency - 1, expectedPages ?? 1);
      const pagesToRead = Array.from({ length: end - page + 1 }, (_, index) => page + index);
      const settled = await Promise.allSettled(pagesToRead.map(async requestedPage => ({ requestedPage,
        payload: await this.#get(urlForPage(requestedPage), accessToken, prefix),
      })));
      const rejected = settled.find(result => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      const responses = settled.map(result => result.value);
      for (const { requestedPage, payload } of responses) {
        const list = payload.data?.list;
        const pageInfo = payload.data?.page_info;
        if (!Array.isArray(list) || list.length > REPORT_PAGE_SIZE || !pageInfo || typeof pageInfo !== 'object') {
          throw transientError('TikTok Ads paginated response is malformed', { code: `${prefix}_INVALID_RESPONSE` });
        }
        const total = nonNegativeInteger(pageInfo.total_number, 'total_number');
        const pages = positiveInteger(pageInfo.total_page ?? Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE)), 'total_page');
        const reportedPage = positiveInteger(pageInfo.page ?? requestedPage, 'page');
        if (reportedPage !== requestedPage || pages > maxPages
          || (expectedTotal !== null && (total !== expectedTotal || pages !== expectedPages))) {
          throw permanentError('TikTok Ads pagination is inconsistent or too large', {
            code: `${prefix}_PAGINATION_UNSAFE`,
            details: { requestedPage, reportedPage, totalPages: pages, totalRows: total,
              expectedPages, expectedTotal, maxPages },
          });
        }
        expectedTotal = total;
        expectedPages = pages;
        rows.push(...list);
        if (rows.length > maxPages * REPORT_PAGE_SIZE) {
          throw permanentError('TikTok Ads response exceeds the bounded row limit', { code: `${prefix}_TOO_LARGE` });
        }
      }
      page = end + 1;
    }
    if (rows.length !== expectedTotal) {
      throw transientError('TikTok Ads response count does not match its pages', { code: `${prefix}_INCOMPLETE` });
    }
    return Object.freeze({ rows: Object.freeze(rows), totalCount: expectedTotal, pageCount: expectedPages });
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
