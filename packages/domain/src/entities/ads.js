import { bangkokDateToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const ADS_PLATFORMS = new Set(['meta_ads', 'tiktok_ads', 'google_ads']);
const ENTITY_TYPES = new Set(['account', 'campaign', 'ad_group', 'creative']);

/** Stable key กลางของ Ads Entity โดยรวม Platform + Account + Entity type + External ID */
export function createAdsEntityKey(input = {}) {
  const platform = requireChoice(input.platform, 'platform', ADS_PLATFORMS);
  const accountId = requireIdentity(input.accountId, 'accountId');
  const entityType = requireChoice(input.entityType, 'entityType', ENTITY_TYPES);
  const externalEntityId = requireIdentity(input.externalEntityId, 'externalEntityId');
  return `${platform}:${accountId}:${entityType}:${externalEntityId}`;
}

/** Stable key ของ Ads daily row ระดับ Account/Campaign/Ad group/Creative */
export function createAdsDailyKey(input = {}) {
  const metricDate = requireDateOnly(input.metricDate, { label: 'Ads metricDate' });
  return `${createAdsEntityKey(input)}:${metricDate}`;
}

/** สร้าง Canonical MKT_Ads_Daily row และคำนวณ Rate จากองค์ประกอบ ไม่เชื่อค่า Derived ที่ปะปนจาก Source */
export function createAdsDailyRow(input = {}) {
  const platform = requireChoice(input.platform, 'platform', ADS_PLATFORMS);
  const accountId = requireIdentity(input.accountId, 'accountId');
  const entityType = requireChoice(input.entityType, 'entityType', ENTITY_TYPES);
  const externalEntityId = requireIdentity(input.externalEntityId, 'externalEntityId');
  const metricDate = requireDateOnly(input.metricDate, { label: 'Ads metricDate' });
  const base = Object.freeze({
    spend: nullableNonNegativeNumber(input.spend, 'spend'),
    impressions: nullableCount(input.impressions, 'impressions'),
    reach: nullableCount(input.reach, 'reach'),
    clicks: nullableCount(input.clicks, 'clicks'),
    conversions: nullableNonNegativeNumber(input.conversions, 'conversions'),
    conversion_value: nullableNonNegativeNumber(input.conversionValue, 'conversionValue'),
  });
  const derived = calculateAdsDerivedMetrics(base);

  return Object.freeze({
    ads_daily_key: createAdsDailyKey({ platform, accountId, entityType, externalEntityId, metricDate }),
    metric_date: bangkokDateToEpochMilliseconds(metricDate, { label: 'Ads metricDate' }),
    platform,
    ad_channel: requireText(input.adChannel, 'adChannel'),
    account_id: accountId,
    entity_type: entityType,
    external_entity_id: externalEntityId,
    external_campaign_id: optionalIdentity(input.externalCampaignId, 'externalCampaignId'),
    external_ad_group_id: optionalIdentity(input.externalAdGroupId, 'externalAdGroupId'),
    external_creative_id: optionalIdentity(input.externalCreativeId, 'externalCreativeId'),
    currency: optionalCurrency(input.currency),
    ...base,
    ...derived,
  });
}

/** Derived rate คืน null เมื่อองค์ประกอบไม่ครบหรือหารด้วยศูนย์ เพื่อไม่สร้างผลลัพธ์ศูนย์ปลอม */
export function calculateAdsDerivedMetrics(metrics = {}) {
  const spend = nullableNonNegativeNumber(metrics.spend, 'spend');
  const impressions = nullableCount(metrics.impressions, 'impressions');
  const clicks = nullableCount(metrics.clicks, 'clicks');
  const conversionValue = nullableNonNegativeNumber(metrics.conversion_value, 'conversion_value');
  return Object.freeze({
    ctr: safeDivide(clicks, impressions),
    cpc: safeDivide(spend, clicks),
    cpm: impressions && spend !== null ? (spend / impressions) * 1_000 : null,
    actual_roas: safeDivide(conversionValue, spend),
  });
}

function safeDivide(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function nullableCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  return number;
}

function nullableNonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative finite number`);
  return number;
}

function optionalCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = requireText(value, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(text)) throw new TypeError('currency must be a 3-letter code');
  return text;
}

function optionalIdentity(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentity(value, fieldName);
}

function requireIdentity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.has(text)) throw new TypeError(`${fieldName} is unsupported: ${text}`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Ads model requires ${fieldName}`);
  return value.trim();
}
