import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const ADS_PLATFORMS = new Set(['meta_ads', 'tiktok_ads', 'google_ads']);
const ENTITY_TYPES = new Set(['account', 'campaign', 'ad_group', 'ad', 'creative']);
export const ADS_MONEY_SCALE = 1_000_000;

/** Stable key กลางของ Ads Entity โดยรวม Platform + Account + Entity type + External ID */
export function createAdsEntityKey(input = {}) {
  const platform = requireChoice(input.platform, 'platform', ADS_PLATFORMS);
  const accountId = requireIdentity(input.accountId, 'accountId');
  const entityType = requireChoice(input.entityType, 'entityType', ENTITY_TYPES);
  const externalEntityId = requireIdentity(input.externalEntityId, 'externalEntityId');
  return `${platform}:${accountId}:${entityType}:${externalEntityId}`;
}

/** Stable key ของ Ads daily row ระดับ Account/Campaign/Ad group/Ad/Creative */
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
  const sourceTimezone = requireText(input.sourceTimezone, 'sourceTimezone');
  const base = Object.freeze({
    spend_micros: nullableMoneyMicros(input.spendMicros, 'spendMicros'),
    impressions: nullableCount(input.impressions, 'impressions'),
    reach: nullableCount(input.reach, 'reach'),
    clicks: nullableCount(input.clicks, 'clicks'),
    conversions: nullableNonNegativeNumber(input.conversions, 'conversions'),
    conversion_value_micros: nullableMoneyMicros(input.conversionValueMicros, 'conversionValueMicros'),
  });
  const derived = calculateAdsDerivedMetrics(base);

  return Object.freeze({
    ads_daily_key: createAdsDailyKey({ platform, accountId, entityType, externalEntityId, metricDate }),
    metric_date: dateOnlyInTimeZoneToEpochMilliseconds(metricDate, sourceTimezone, {
      label: 'Ads metricDate',
    }),
    platform,
    ad_channel: requireText(input.adChannel, 'adChannel'),
    account_id: accountId,
    entity_type: entityType,
    external_entity_id: externalEntityId,
    external_campaign_id: optionalIdentity(input.externalCampaignId, 'externalCampaignId'),
    external_ad_group_id: optionalIdentity(input.externalAdGroupId, 'externalAdGroupId'),
    external_ad_id: optionalIdentity(input.externalAdId, 'externalAdId'),
    external_creative_id: optionalIdentity(input.externalCreativeId, 'externalCreativeId'),
    currency: requireCurrency(input.currency),
    ...base,
    spend: microsToCurrencyUnits(base.spend_micros),
    conversion_value: microsToCurrencyUnits(base.conversion_value_micros),
    ...derived,
  });
}

/** Derived rate คำนวณจาก integer micros ซึ่งเป็น Money source of truth เท่านั้น */
export function calculateAdsDerivedMetrics(metrics = {}) {
  const spendMicros = nullableMoneyMicros(metrics.spend_micros, 'spend_micros');
  const impressions = nullableCount(metrics.impressions, 'impressions');
  const clicks = nullableCount(metrics.clicks, 'clicks');
  const conversions = nullableNonNegativeNumber(metrics.conversions, 'conversions');
  const conversionValueMicros = nullableMoneyMicros(
    metrics.conversion_value_micros,
    'conversion_value_micros',
  );
  return Object.freeze({
    ctr: safeDivide(clicks, impressions),
    cpc: microsRateToCurrencyUnits(spendMicros, clicks),
    cpm: impressions && spendMicros !== null
      ? ((spendMicros / impressions) * 1_000) / ADS_MONEY_SCALE
      : null,
    cpa: microsRateToCurrencyUnits(spendMicros, conversions),
    actual_roas: safeDivide(conversionValueMicros, spendMicros),
  });
}

/** แปลง Decimal string จาก Source เป็น integer micros โดยไม่ผ่าน Floating-point */
export function currencyAmountToMicros(value, fieldName = 'currencyAmount') {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a decimal string`);
  const text = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u.exec(text);
  if (!match) throw new TypeError(`${fieldName} must be a non-negative decimal with at most 6 places`);
  const fractional = (match[2] ?? '').padEnd(6, '0');
  const micros = (BigInt(match[1]) * BigInt(ADS_MONEY_SCALE)) + BigInt(fractional || '0');
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${fieldName} exceeds safe integer micros`);
  }
  return Number(micros);
}

function safeDivide(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function microsRateToCurrencyUnits(micros, denominator) {
  const rateMicros = safeDivide(micros, denominator);
  return rateMicros === null ? null : rateMicros / ADS_MONEY_SCALE;
}

function microsToCurrencyUnits(micros) {
  return micros === null ? null : micros / ADS_MONEY_SCALE;
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

function nullableMoneyMicros(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' && /^\d+$/u.test(value.trim())
    ? Number(value.trim())
    : value;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer in micros`);
  }
  return number;
}

function requireCurrency(value) {
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