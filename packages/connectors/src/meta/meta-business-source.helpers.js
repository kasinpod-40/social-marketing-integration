import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export function requireMetaReadClient(value) {
  if (typeof value?.get !== 'function' || typeof value?.getPage !== 'function') {
    throw new TypeError('Meta business source adapter requires client.get/getPage');
  }
  return value;
}

export function requireMetaExternalId(value, fieldName) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`Meta source requires ${fieldName}`);
  }
  const text = String(value).trim();
  if (text === '' || /[:/?#]/u.test(text)) {
    throw new TypeError(`Meta source ${fieldName} is invalid`);
  }
  return text;
}

export function normalizeMetaAdAccountId(value, fieldName = 'adAccountId') {
  const normalized = requireMetaExternalId(value, fieldName).replace(/^act_/iu, '');
  if (normalized === '') throw new TypeError(`Meta source ${fieldName} is invalid`);
  return normalized;
}

export function buildMetaDatasetPath(dataset, replacements = {}) {
  const path = dataset.pathTemplate.replace(/\{([a-z_]+)\}/gu, (_match, key) => {
    if (!Object.hasOwn(replacements, key)) {
      throw new TypeError(`Meta dataset path is missing ${key}`);
    }
    return requireMetaExternalId(replacements[key], key);
  });
  if (/[{}]/u.test(path)) throw new TypeError('Meta dataset path contains unresolved variables');
  return path;
}

export function fieldsQuery(dataset) {
  return dataset.fields.join(',');
}

export function metricQuery(dataset) {
  if (!Array.isArray(dataset.metrics) || dataset.metrics.length === 0) {
    throw new TypeError(`Meta dataset ${dataset.key} has no approved candidate metrics`);
  }
  return dataset.metrics.join(',');
}

export function normalizeMetaPageOptions(input = {}) {
  return Object.freeze({
    after: optionalText(input.after),
    visitedCursors: Object.freeze(
      Array.isArray(input.visitedCursors)
        ? input.visitedCursors.map((cursor) => requireOpaqueCursor(cursor))
        : [],
    ),
  });
}

export function normalizeMetaDateRange(input = {}, maxDays = null) {
  const hasSince = input.since !== null && input.since !== undefined && input.since !== '';
  const hasUntil = input.until !== null && input.until !== undefined && input.until !== '';
  if (!hasSince && !hasUntil) return Object.freeze({ since: null, until: null });
  if (!hasSince || !hasUntil) throw new TypeError('Meta date range requires both since and until');
  const since = requireDateOnly(input.since, { label: 'Meta since' });
  const until = requireDateOnly(input.until, { label: 'Meta until' });
  if (until < since) throw new RangeError('Meta until must not be before since');
  if (maxDays !== null) {
    const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`))
      / 86_400_000 + 1;
    if (days > maxDays) {
      throw new RangeError(`Meta date range exceeds ${maxDays} inclusive days`);
    }
  }
  return Object.freeze({ since, until });
}

export function assertMetaIdentity(actual, expected, code) {
  const normalizedActual = requireMetaExternalId(actual, 'providerIdentity');
  const normalizedExpected = requireMetaExternalId(expected, 'expectedIdentity');
  if (normalizedActual !== normalizedExpected) {
    throw permanentError('Meta source identity mismatch', { code });
  }
  return normalizedActual;
}

export function createMetaSourcePageEnvelope(input = {}) {
  if (!Array.isArray(input.page?.rows)) {
    throw new TypeError('Meta source page requires rows array');
  }
  if (typeof input.page.hasMore !== 'boolean') {
    throw new TypeError('Meta source page requires hasMore boolean');
  }
  const rows = input.page.rows.map((row) => deepFreeze(row));
  const nextCursor = input.page.hasMore
    ? optionalText(input.page.nextCursor)
    : null;
  if (input.page.hasMore && !nextCursor) {
    throw new TypeError('Meta source page with more data requires nextCursor');
  }
  return deepFreeze({
    datasetKey: input.datasetKey,
    sourceAccountId: input.sourceAccountId,
    sourceEntityId: input.sourceEntityId ?? null,
    rows,
    hasMore: input.page.hasMore,
    nextCursor,
  });
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('Meta optional value must be text');
  return value.trim() || null;
}

function requireOpaqueCursor(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Meta visitedCursor must be non-empty text');
  }
  return value.trim();
}
