const ORGANIC_PLATFORMS = new Set(['facebook', 'instagram']);

/** D1 is the historical/report source; Lark is not read for report history. */
export async function loadMetaOrganicD1ReportSource(input = {}) {
  const store = requireMethods(input.store, ['listOrganicContentObservations'], 'store');
  const platform = requireChoice(input.platform, 'platform', ORGANIC_PLATFORMS);
  const contentKeys = uniqueTextArray(input.contentKeys, 'contentKeys', 500);
  const fromObservedAt = optionalTimestamp(input.fromObservedAt, 'fromObservedAt');
  const toObservedAt = optionalTimestamp(input.toObservedAt, 'toObservedAt');
  const limitPerContent = boundedInteger(input.limitPerContent ?? 1000, 'limitPerContent', 1, 1000);
  const observations = [];
  const saturatedContentKeys = [];
  for (const contentKey of contentKeys) {
    const rows = await store.listOrganicContentObservations({
      contentKey,
      fromObservedAt,
      toObservedAt,
      limit: limitPerContent,
    });
    for (const row of rows) {
      if (row.platform === platform) observations.push(Object.freeze({ ...row }));
    }
    if (rows.length >= limitPerContent) saturatedContentKeys.push(contentKey);
  }
  observations.sort((left, right) => (
    Number(left.observed_at) - Number(right.observed_at)
    || String(left.observation_key).localeCompare(String(right.observation_key))
  ));
  return Object.freeze({
    schemaVersion: 'meta_organic_d1_report_source_v1',
    platform,
    contentKeys: Object.freeze(contentKeys),
    observations: Object.freeze(observations),
    rowCount: observations.length,
    truncated: saturatedContentKeys.length > 0,
    saturatedContentKeys: Object.freeze(saturatedContentKeys),
    dataStatus: saturatedContentKeys.length > 0
      ? 'partial'
      : (observations.length === 0 ? 'no_data_confirmed' : 'complete'),
  });
}

export async function loadMetaAdsD1ReportSource(input = {}) {
  const store = requireMethods(input.store, ['listAdsDailyFacts'], 'store');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const periodStart = requireDate(input.periodStart, 'periodStart');
  const periodEnd = requireDate(input.periodEnd, 'periodEnd');
  const limit = boundedInteger(input.limit ?? 5000, 'limit', 1, 5000);
  const rows = await store.listAdsDailyFacts({
    customerKey,
    platform: 'meta_ads',
    accountKey,
    periodStart,
    periodEnd,
    limit,
  });
  const facts = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  const truncated = rows.length >= limit;
  return Object.freeze({
    schemaVersion: 'meta_ads_d1_report_source_v1',
    platform: 'meta_ads',
    customerKey,
    accountKey,
    periodStart,
    periodEnd,
    facts,
    rowCount: facts.length,
    limit,
    truncated,
    dataStatus: truncated ? 'partial' : (facts.length === 0 ? 'no_data_confirmed' : 'revisable'),
  });
}

function uniqueTextArray(value, fieldName, maximum) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  const values = [...new Set(value.map((item) => requireText(item, `${fieldName} item`)))];
  if (values.length > maximum) throw new TypeError(`${fieldName} exceeds ${maximum} items`);
  return values.sort();
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.has(text)) throw new TypeError(`${fieldName} is unsupported`);
  return text;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function optionalTimestamp(value, fieldName) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function requireMethods(value, methods, fieldName) {
  if (!value || typeof value !== 'object') throw new TypeError(`${fieldName} is required`);
  for (const method of methods) {
    if (typeof value[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
