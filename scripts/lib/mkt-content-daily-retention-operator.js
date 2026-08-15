const METRIC_FIELDS = Object.freeze([
  'views',
  'likes',
  'comments',
  'shares',
  'unique_viewers',
  'avg_watch_time_seconds',
  'total_watch_time_seconds',
  'completion_rate',
]);

export function assertDeferredPlatformDeleteScope(plan, deferredPlatform = 'facebook') {
  const platform = requireText(deferredPlatform, 'deferredPlatform').toLowerCase();
  if (!plan?.deferredPlatforms?.includes(platform)) {
    throw operatorError('Required deferred platform is not protected', 'MKT_CONTENT_DAILY_DEFERRED_PLATFORM_REQUIRED');
  }
  const violations = (plan.deletes ?? []).filter((row) => row.platform === platform);
  if (violations.length > 0) {
    throw operatorError('Delete plan contains a protected platform row', 'MKT_CONTENT_DAILY_PROTECTED_DELETE_DETECTED', {
      platform,
      violationCount: violations.length,
    });
  }
  return Object.freeze({ platform, protectedRows: plan.deferredPlatformPreservedCount });
}

export function reconcileLatestLarkWithD1(input = {}) {
  const records = requireArray(input.records, 'records');
  const d1Rows = requireArray(input.d1Rows, 'd1Rows');
  const deferred = new Set(requireArray(input.deferredPlatforms ?? [], 'deferredPlatforms')
    .map((value) => requireText(value, 'deferredPlatform').toLowerCase()));
  const requireMetricParity = input.requireMetricParity !== false;
  const sourceBacked = normalizeSourceBacked(input.sourceBackedExternalIdsByPlatform ?? {});
  const required = input.requiredExternalIdsByPlatform === undefined
    ? null
    : normalizeSourceBacked(input.requiredExternalIdsByPlatform);
  const larkLatest = latestLarkRows(records, deferred);
  const d1History = new Map();
  for (const row of d1Rows) {
    const identity = identityOf({
      platform: row.platform,
      externalContentId: row.external_content_id,
    });
    if (deferred.has(identity.platform)) continue;
    const rows = d1History.get(identity.key) ?? [];
    rows.push(row);
    d1History.set(identity.key, rows);
  }

  const missingInD1 = [];
  const mismatches = [];
  for (const [key, lark] of larkLatest.entries()) {
    const larkDate = dateOnly(lark.metricDate);
    const candidates = (d1History.get(key) ?? []).filter((row) => String(row.metric_date) <= larkDate);
    const d1 = candidates.sort(compareD1History).at(-1);
    if (!d1 && (sourceBacked.get(lark.platform)?.has(lark.externalContentId)
      || (required !== null && !required.get(lark.platform)?.has(lark.externalContentId)))) {
      continue;
    }
    if (!d1) {
      missingInD1.push(key);
      continue;
    }
    for (const field of METRIC_FIELDS) {
      if (!sameNullableNumber(lark.fields[field], d1[field])) {
        mismatches.push({ identity: key, field });
      }
    }
  }
  const d1OnlyCount = [...d1History.keys()].filter((key) => !larkLatest.has(key)).length;
  if (missingInD1.length > 0 || (requireMetricParity && mismatches.length > 0)) {
    throw operatorError('Latest non-deferred Lark rows are not backed by D1 sparse history', 'MKT_CONTENT_DAILY_D1_LARK_PARITY_FAILED', {
      larkLatestCount: larkLatest.size,
      d1IdentityCount: d1History.size,
      missingInD1Count: missingInD1.length,
      d1OnlyCount,
      mismatchCount: mismatches.length,
      missingInD1: missingInD1.slice(0, 10),
      mismatches: mismatches.slice(0, 10),
    });
  }
  return Object.freeze({
    larkLatestCount: larkLatest.size,
    d1IdentityCount: d1History.size,
    missingInD1Count: 0,
    d1OnlyCount,
    mismatchCount: 0,
    observedMetricDriftCount: mismatches.length,
    requireMetricParity,
    requiredIdentityPolicy: required === null ? 'all_lark_latest' : 'delete_affected_only',
    policy: 'latest_sparse_observation_at_or_before_lark_metric_date',
    metricFields: METRIC_FIELDS,
  });
}

function normalizeSourceBacked(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('sourceBackedExternalIdsByPlatform must be an object');
  }
  return new Map(Object.entries(value).map(([platform, ids]) => [
    requireText(platform, 'sourceBackedPlatform').toLowerCase(),
    new Set(requireArray(ids instanceof Set ? [...ids] : ids, 'sourceBackedExternalIds')
      .map((id) => requireText(id, 'sourceBackedExternalId'))),
  ]));
}

export function summarizePlatforms(rows, selector = (row) => row.platform) {
  const counts = {};
  for (const row of requireArray(rows, 'rows')) {
    const platform = selector(row) ?? 'unmanaged';
    counts[platform] = (counts[platform] ?? 0) + 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))));
}

function latestLarkRows(records, deferred) {
  const rows = new Map();
  for (const record of records) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    const recordId = text(record?.recordId ?? record?.record_id);
    const platform = textValue(fields.platform)?.toLowerCase();
    const accountId = textValue(fields.account_id);
    const externalContentId = textValue(fields.external_content_id);
    const metricDate = epochValue(fields.metric_date);
    if (!recordId || !platform || !accountId || !externalContentId || !metricDate || deferred.has(platform)) continue;
    const identity = identityOf({ platform, externalContentId });
    const candidate = { recordId, platform, accountId, externalContentId, metricDate, fields };
    const current = rows.get(identity.key);
    if (!current || current.metricDate < metricDate
      || (current.metricDate === metricDate && current.recordId.localeCompare(recordId) < 0)) {
      rows.set(identity.key, candidate);
    }
  }
  return rows;
}

function identityOf(input) {
  const platform = requireText(input.platform, 'platform').toLowerCase();
  const externalContentId = requireText(input.externalContentId, 'externalContentId');
  return Object.freeze({ platform, key: `${platform}\u0000${externalContentId}` });
}

function compareD1History(left, right) {
  return String(left.metric_date).localeCompare(String(right.metric_date))
    || Number(left.observed_at ?? 0) - Number(right.observed_at ?? 0)
    || String(left.observation_key ?? '').localeCompare(String(right.observation_key ?? ''));
}

function dateOnly(epoch) {
  const date = new Date(Number(epoch) + (7 * 3_600_000));
  return date.toISOString().slice(0, 10);
}

function sameNullableNumber(left, right) {
  const a = nullableNumber(left);
  const b = nullableNumber(right);
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value) && value.length === 1) return nullableNumber(value[0]);
  if (value && typeof value === 'object') return nullableNumber(value.value ?? value.text ?? value.name);
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function textValue(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value) && value.length === 1) return textValue(value[0]);
  if (value && typeof value === 'object') return textValue(value.text ?? value.name ?? value.value);
  return null;
}

function epochValue(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.trunc(number);
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value, fieldName) {
  const result = text(value);
  if (!result) throw new TypeError(`${fieldName} is required`);
  return result;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MktContentDailyRetentionOperatorError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
