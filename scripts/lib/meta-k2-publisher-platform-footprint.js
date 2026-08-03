import { createHash } from 'node:crypto';

const PLATFORM_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;
const DAILY_DATASET = 'meta_ads.performance.daily';

/**
 * Summarize only publisher_platform values and row counts from retained Meta Ads daily units.
 * No account, campaign, ad set, ad, cursor or raw payload identity is returned.
 */
export function summarizeMetaK2PublisherPlatformFootprint(payloads = []) {
  if (!Array.isArray(payloads)) {
    throw footprintError(
      'Meta K2 publisher platform payloads must be an array',
      'META_K2_PLATFORM_FOOTPRINT_PAYLOAD_INVALID',
    );
  }

  const platforms = new Map();
  const invalid = new Map();
  let dailyUnitCount = 0;
  let dailyRowCount = 0;
  let missingRowCount = 0;

  for (const rawPayload of payloads) {
    const payload = requireObject(rawPayload, 'staged payload');
    if (payload.datasetKey !== DAILY_DATASET) continue;
    const rows = requireArray(payload.rows, 'staged daily rows');
    dailyUnitCount += 1;
    dailyRowCount += rows.length;

    for (const rawRow of rows) {
      const row = requireObject(rawRow, 'staged daily row');
      if (row.publisher_platform === null
        || row.publisher_platform === undefined
        || row.publisher_platform === '') {
        missingRowCount += 1;
        continue;
      }
      if (typeof row.publisher_platform !== 'string') {
        increment(invalid, fingerprint(row.publisher_platform));
        continue;
      }
      const platform = row.publisher_platform.trim().toLowerCase();
      if (!PLATFORM_TOKEN.test(platform)) {
        increment(invalid, fingerprint(row.publisher_platform));
        continue;
      }
      increment(platforms, platform);
    }
  }

  const observedRowCount = [...platforms.values()].reduce((total, count) => total + count, 0);
  const invalidRowCount = [...invalid.values()].reduce((total, count) => total + count, 0);
  if (observedRowCount + missingRowCount + invalidRowCount !== dailyRowCount) {
    throw footprintError(
      'Meta K2 publisher platform footprint totals are inconsistent',
      'META_K2_PLATFORM_FOOTPRINT_TOTAL_INVALID',
    );
  }

  return deepFreeze({
    datasetKey: DAILY_DATASET,
    dailyUnitCount,
    dailyRowCount,
    observedRowCount,
    missingRowCount,
    invalidRowCount,
    platforms: [...platforms.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([publisherPlatform, rowCount]) => ({ publisherPlatform, rowCount })),
    invalidValueFingerprints: [...invalid.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sha256, rowCount]) => ({ sha256, rowCount })),
  });
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw footprintError(
      `${fieldName} must be an object`,
      'META_K2_PLATFORM_FOOTPRINT_PAYLOAD_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw footprintError(
      `${fieldName} must be an array`,
      'META_K2_PLATFORM_FOOTPRINT_PAYLOAD_INVALID',
      { fieldName },
    );
  }
  return value;
}

function footprintError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PublisherPlatformFootprintError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
