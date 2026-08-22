const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', '']);

export const META_END_TO_END_FLAG_ENV = Object.freeze({
  sourceRead: 'MKT_META_SOURCE_READ_ENABLED',
  d1Write: 'MKT_META_D1_WRITE_ENABLED',
  larkWrite: 'MKT_META_LARK_WRITE_ENABLED',
  reportRead: 'MKT_META_REPORT_READ_ENABLED',
});

/**
 * Customer-facing Lark projection only. Provider/source facts remain durable in D1 and are not
 * mirrored into Lark RAW tables. Meta Organic exposes Canonical Account/Content rows; Meta Ads
 * exposes Account plus report-range activity Campaign, AdSet, Ad, Creative and Daily facts.
 */
export const META_END_TO_END_LARK_TABLES = Object.freeze([
  table('canonical.accounts', 'mktAccounts', 'account_key'),
  table('canonical.accountDaily', 'mktAccountDaily', 'account_daily_key'),
  table('canonical.content', 'mktContent', 'content_key'),
  table('canonical.contentDaily', 'mktContentDaily', 'content_daily_key'),
  table('canonical.adsAccounts', 'mktAdsAccounts', 'ads_account_key'),
  table('canonical.adsCampaigns', 'mktAdsCampaigns', 'ads_campaign_key'),
  table('canonical.adsAdGroups', 'mktAdsAdGroups', 'ads_ad_group_key'),
  table('canonical.adsAds', 'mktAdsAds', 'ads_ad_key'),
  table('canonical.adsCreatives', 'mktAdsCreatives', 'ads_creative_key'),
  table('canonical.adsDaily', 'mktAdsDaily', 'ads_daily_key'),
]);

export const META_END_TO_END_REQUIRED_LARK_TABLE_KEYS = Object.freeze(
  [...new Set(META_END_TO_END_LARK_TABLES.map((entry) => entry.tableKey))],
);

export const META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAdGroups',
  'mktAdsAds',
]);

/**
 * Workstream-local fail-closed gates. Connector flags in the central catalog remain an
 * additional requirement; this module never activates a connector by itself.
 */
export function loadMetaEndToEndRuntimeConfig(env = {}) {
  return deepFreeze({
    flags: Object.fromEntries(Object.entries(META_END_TO_END_FLAG_ENV).map(([key, envName]) => [
      key,
      readBoolean(env?.[envName], envName),
    ])),
    limits: {
      sourcePageSize: boundedInteger(env?.MKT_META_SOURCE_PAGE_SIZE, 100, 1, 100),
      sourceMaxPages: boundedInteger(env?.MKT_META_SOURCE_MAX_PAGES, 100, 1, 100),
      sourceMaxUnits: boundedInteger(env?.MKT_META_SOURCE_MAX_UNITS, 500, 1, 2_500),
      sourceMaxRows: boundedInteger(env?.MKT_META_SOURCE_MAX_ROWS, 50_000, 1, 50_000),
      sourceMaxUnitBytes: boundedInteger(
        env?.MKT_META_SOURCE_MAX_UNIT_BYTES,
        524_288,
        1_024,
        1_048_576,
      ),
      d1RowsPerInvocation: boundedInteger(
        env?.MKT_META_D1_ROWS_PER_INVOCATION,
        250,
        1,
        1_000,
      ),
      larkTablesPerInvocation: boundedInteger(
        env?.MKT_META_LARK_TABLES_PER_INVOCATION,
        1,
        1,
        4,
      ),
    },
  });
}

export function assertMetaEndToEndGates(config, required = {}) {
  const flags = config?.flags ?? {};
  const missing = [];
  for (const key of ['sourceRead', 'd1Write', 'larkWrite', 'reportRead']) {
    if (required[key] === true && flags[key] !== true) missing.push(META_END_TO_END_FLAG_ENV[key]);
  }
  if (missing.length > 0) {
    const error = new Error(`Meta end-to-end gates are disabled: ${missing.join(', ')}`);
    error.code = 'META_END_TO_END_GATES_DISABLED';
    error.retryable = false;
    error.details = Object.freeze({ missingFlags: Object.freeze(missing) });
    throw error;
  }
  return config;
}

function table(path, tableKey, keyField) {
  return Object.freeze({ path, tableKey, keyField });
}

function readBoolean(value, envName) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new TypeError(`${envName} must be a boolean-like value`);
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`Meta runtime limit must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
