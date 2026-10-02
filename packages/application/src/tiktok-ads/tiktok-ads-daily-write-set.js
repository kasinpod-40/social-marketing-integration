import { currencyAmountToMicros } from '../../../domain/src/entities/ads.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  createAdsEntityKey,
  createAdsFactKey,
  validateStorageRow,
} from '../storage/marketing-history-contract.js';

const PLATFORM = 'tiktok_ads';
const MAX_DAILY_ROWS = 500;

/** สร้าง D1 rows ทั้งหมดก่อนเริ่มเขียน; ข้อมูลที่พิสูจน์ไม่ได้ต้องล้มทั้งวัน ไม่เติมศูนย์ */
export async function buildTikTokAdsDailyWriteSet(input = {}) {
  const customerKey = text(input.customerKey, 'customerKey');
  const accountKey = text(input.accountKey, 'accountKey');
  const advertiserId = digits(input.advertiserId, 'advertiserId');
  const currency = text(input.currency, 'currency').toUpperCase();
  const timezone = text(input.timezone, 'timezone');
  const date = requireDateOnly(input.date, { label: 'TikTok Ads date' });
  const syncRunId = text(input.syncRunId, 'syncRunId');
  const now = timestamp(input.now);
  const rows = input.rows;
  if (!Array.isArray(rows) || rows.length > MAX_DAILY_ROWS) {
    throw permanentError('TikTok Ads daily source rows exceed the reviewed bound', {
      code: 'TIKTOK_ADS_DAILY_ROW_BOUND',
    });
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw permanentError('TikTok Ads advertiser timezone is invalid', {
      code: 'TIKTOK_ADS_DAILY_TIMEZONE_INVALID',
    });
  }
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw permanentError('TikTok Ads advertiser currency is invalid', {
      code: 'TIKTOK_ADS_DAILY_CURRENCY_INVALID',
    });
  }

  const seen = new Set();
  const coverageRunId = `${PLATFORM}:${accountKey}:campaign_daily:${date}`;
  const entities = [];
  const dailyFacts = [];
  const sourceHashes = [];
  for (const source of rows) {
    const dimension = object(source?.dimensions, 'dimensions');
    const metrics = object(source?.metrics, 'metrics');
    const campaignId = digits(dimension.campaign_id, 'campaign_id');
    if (dimension.stat_time_day !== date) {
      throw permanentError('TikTok Ads report date does not match request', {
        code: 'TIKTOK_ADS_DAILY_DATE_MISMATCH',
      });
    }
    if (seen.has(campaignId)) {
      throw permanentError('TikTok Ads report repeated one campaign-day identity', {
        code: 'TIKTOK_ADS_DAILY_DUPLICATE_CAMPAIGN',
      });
    }
    seen.add(campaignId);
    const spendMicros = currencyAmountToMicros(text(metrics.spend, 'spend'), 'spend');
    const impressions = count(metrics.impressions, 'impressions');
    const clicks = count(metrics.clicks, 'clicks');
    const sourceHash = await createStableFingerprint({
      advertiserId, campaignId, date, spendMicros, impressions, clicks, currency,
    });
    sourceHashes.push(sourceHash);
    entities.push(validateStorageRow('ads_entity_state', {
      entity_key: createAdsEntityKey({
        platform: PLATFORM, account_key: accountKey, entity_type: 'campaign',
        external_entity_id: campaignId,
      }),
      customer_key: customerKey,
      platform: PLATFORM,
      account_key: accountKey,
      source_account_id: advertiserId,
      entity_type: 'campaign',
      external_entity_id: campaignId,
      parent_campaign_id: null,
      parent_ad_group_id: null,
      parent_ad_id: null,
      external_creative_id: null,
      entity_name: null,
      status: null,
      objective: null,
      currency,
      timezone,
      source_updated_at: null,
      first_seen_at: now,
      last_seen_at: now,
      source_availability_status: 'available',
      metadata_hash: await createStableFingerprint({ advertiserId, campaignId, currency, timezone }),
      last_coverage_run_id: coverageRunId,
      last_sync_run_id: syncRunId,
      created_at: now,
      updated_at: now,
    }));
    dailyFacts.push(validateStorageRow('ads_daily_facts', {
      ads_fact_key: createAdsFactKey({
        platform: PLATFORM, account_key: accountKey, report_level: 'campaign',
        external_entity_id: campaignId, metric_date: date,
        breakdown_key: 'none', segment_key: 'none',
      }),
      customer_key: customerKey,
      platform: PLATFORM,
      account_key: accountKey,
      source_account_id: advertiserId,
      report_level: 'campaign',
      entity_type: 'campaign',
      external_entity_id: campaignId,
      external_campaign_id: campaignId,
      external_ad_group_id: null,
      external_ad_id: null,
      external_creative_id: null,
      metric_date: date,
      account_timezone: timezone,
      breakdown_key: 'none',
      segment_key: 'none',
      ad_channel: PLATFORM,
      currency,
      spend_micros: spendMicros,
      impressions,
      reach: null,
      clicks,
      conversions: null,
      conversion_value_micros: null,
      video_views: null,
      video_view_rate: null,
      average_cpv_micros: null,
      actions_json: null,
      breakdown_json: null,
      data_status: 'revisable',
      coverage_run_id: coverageRunId,
      source_revision: sourceHash,
      source_payload_hash: sourceHash,
      fetched_at: now,
      sync_run_id: syncRunId,
      created_at: now,
      updated_at: now,
    }));
  }
  const watermark = await createStableFingerprint(sourceHashes.sort());
  return Object.freeze({
    date,
    coverageRunId,
    sourceWatermark: watermark,
    entities: Object.freeze(entities),
    dailyFacts: Object.freeze(dailyFacts),
  });
}

function object(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError(`TikTok Ads ${fieldName} is missing`, { code: 'TIKTOK_ADS_DAILY_SOURCE_INVALID' });
  }
  return value;
}
function text(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw permanentError(`TikTok Ads ${fieldName} is missing`, { code: 'TIKTOK_ADS_DAILY_SOURCE_INVALID' });
  }
  return value.trim();
}
function digits(value, fieldName) {
  const valueText = text(String(value ?? ''), fieldName);
  if (!/^\d+$/u.test(valueText)) {
    throw permanentError(`TikTok Ads ${fieldName} must contain digits`, { code: 'TIKTOK_ADS_DAILY_SOURCE_INVALID' });
  }
  return valueText;
}
function count(value, fieldName) {
  const valueText = text(String(value ?? ''), fieldName);
  if (!/^(0|[1-9]\d*)$/u.test(valueText)) {
    throw permanentError(`TikTok Ads ${fieldName} must be a count`, { code: 'TIKTOK_ADS_DAILY_SOURCE_INVALID' });
  }
  const number = Number(valueText);
  if (!Number.isSafeInteger(number)) {
    throw permanentError(`TikTok Ads ${fieldName} exceeds safe integer range`, {
      code: 'TIKTOK_ADS_DAILY_SOURCE_INVALID',
    });
  }
  return number;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw permanentError('TikTok Ads sync timestamp is invalid', { code: 'TIKTOK_ADS_DAILY_RUN_INVALID' });
  }
  return value;
}
