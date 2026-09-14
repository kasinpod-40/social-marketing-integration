import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { readYouTubeChannelIdFromEnv } from '../../../packages/config/src/youtube-organic-runtime-config.js';
import { createMetaTokenConnectionRuntime } from '../../../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createYouTubeRuntimeClients } from './youtube-runtime-clients.js';

export const CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH =
  '/__codex/customer-organic-history-v1';

const CUSTOMER_LARK_APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const CUSTOMER_CONTENT_DAILY_TABLE_ID = 'tblODz9RcmCIFtfQ';
const CUSTOMER_PLATFORMS = Object.freeze(['facebook', 'instagram', 'tiktok', 'youtube']);
const MAX_BODY_BYTES = 16_384;
const MAX_META_PAGES = 25;
const MAX_ANALYTICS_PAGES = 100;
const ANALYTICS_PAGE_SIZE = 200;

/** Preview-only, GET-only source capability audit for the exact Customer PROD runtime. */
export function createCustomerOrganicHistoryPreviewHttpHandler(dependencies = {}) {
  const digest = dependencies.digest ?? sha256;
  const metaRuntimeFactory = dependencies.createMetaRuntime ?? createMetaTokenConnectionRuntime;
  const youtubeRuntimeFactory = dependencies.createYouTubeRuntimeClients
    ?? createYouTubeRuntimeClients;

  return async function handle({ request, env, url }) {
    if (url.pathname !== CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH) return null;
    try {
      if (request.method !== 'POST') {
        return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, {
          status: 405,
          headers: { allow: 'POST', ...noStoreHeaders() },
        });
      }
      const runtime = assertExactCustomerRuntime(env);
      await requireAuthorization(request, env, digest);
      const body = await readBoundedJson(request);
      if (body?.mode !== 'audit') {
        throw operatorError('Organic history Preview mode must be audit',
          'CUSTOMER_ORGANIC_HISTORY_MODE_INVALID');
      }
      const period = normalizePeriod(body);
      const result = await auditCustomerOrganicHistory({
        env,
        runtime,
        period,
        metaRuntimeFactory,
        youtubeRuntimeFactory,
      });
      return json({ ok: true, result }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'CUSTOMER_ORGANIC_HISTORY_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'CUSTOMER_ORGANIC_HISTORY_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

export async function auditCustomerOrganicHistory(input = {}) {
  const meta = input.metaRuntimeFactory({
    ...input.env,
    MKT_META_INSTAGRAM_CONTENT_SINCE: input.period.since,
    MKT_META_INSTAGRAM_CONTENT_UNTIL: input.period.until,
    META_MAX_PAGES: String(MAX_META_PAGES),
  });
  const [facebook, instagram, youtube, d1] = await Promise.all([
    auditMetaPlatform({
      platform: 'facebook',
      adapter: meta.sources.facebook,
      sourceAccountId: meta.mappings.facebookPageId,
      period: input.period,
    }),
    auditMetaPlatform({
      platform: 'instagram',
      adapter: meta.sources.instagram,
      sourceAccountId: meta.mappings.instagramAccountId,
      period: input.period,
    }),
    auditYouTube({
      env: input.env,
      runtime: input.runtime,
      period: input.period,
      youtubeRuntimeFactory: input.youtubeRuntimeFactory,
    }),
    readD1Coverage(input.env.MKT_STATE_DB),
  ]);
  return deepFreeze({
    mode: 'audit',
    readOnly: true,
    providerWrites: 0,
    d1Writes: 0,
    larkWrites: 0,
    period: input.period,
    providers: { facebook, instagram, tiktok: tiktokCapability(d1), youtube },
    d1,
  });
}

async function auditMetaPlatform({ platform, adapter, sourceAccountId, period }) {
  if (!adapter || !sourceAccountId) {
    throw operatorError(`${platform} source runtime is unavailable`,
      'CUSTOMER_ORGANIC_HISTORY_SOURCE_UNAVAILABLE', { platform });
  }
  const contentRows = await listMetaContent({ platform, adapter, sourceAccountId, period });
  const samples = [];
  for (const row of contentRows.slice(0, 3)) {
    const response = platform === 'facebook'
      ? await adapter.fetchContentInsightsPage({
        pageId: sourceAccountId,
        contentId: requireText(row.id, 'facebook content id'),
        since: period.since,
        until: period.until,
      })
      : await adapter.fetchContentInsightsPage({
        accountId: sourceAccountId,
        mediaId: requireText(row.id, 'instagram media id'),
        since: period.since,
        until: period.until,
      });
    samples.push(summarizeMetaInsights(response.rows));
  }
  const publishedDates = contentRows.map((row) => metaPublishedDate(platform, row)).filter(Boolean).sort();
  return deepFreeze({
    sourceRead: true,
    contentRows: contentRows.length,
    earliestPublishedDate: publishedDates[0] ?? null,
    latestPublishedDate: publishedDates.at(-1) ?? null,
    sampledContentInsights: samples,
    exactHistoricalContentMetricsAvailable: samples.some((sample) => sample.historicalValues > 0),
  });
}

async function listMetaContent({ platform, adapter, sourceAccountId, period }) {
  const rows = [];
  let after = null;
  const visitedCursors = [];
  for (let page = 1; page <= MAX_META_PAGES; page += 1) {
    const response = platform === 'facebook'
      ? await adapter.fetchContentPage({
        pageId: sourceAccountId,
        since: period.since,
        until: period.until,
        after,
        visitedCursors,
      })
      : await adapter.fetchContentPage({
        accountId: sourceAccountId,
        since: period.since,
        until: period.until,
        after,
        visitedCursors,
      });
    rows.push(...response.rows);
    if (!response.hasMore) return rows;
    if (!response.nextCursor || visitedCursors.includes(response.nextCursor)) {
      throw operatorError(`${platform} content pagination did not advance`,
        'CUSTOMER_ORGANIC_HISTORY_PAGINATION_INVALID', { platform, page });
    }
    if (after) visitedCursors.push(after);
    after = response.nextCursor;
  }
  throw operatorError(`${platform} content audit exceeded its page limit`,
    'CUSTOMER_ORGANIC_HISTORY_PAGINATION_LIMIT', { platform, maxPages: MAX_META_PAGES });
}

function summarizeMetaInsights(rows) {
  let historicalValues = 0;
  let currentOnlyValues = 0;
  const metrics = [];
  for (const row of rows ?? []) {
    metrics.push(String(row?.name ?? 'unknown'));
    if (Array.isArray(row?.values) && row.values.some((value) => value?.end_time)) {
      historicalValues += row.values.length;
    } else if (row?.total_value !== undefined || row?.value !== undefined
      || Array.isArray(row?.values)) {
      currentOnlyValues += 1;
    }
  }
  return deepFreeze({
    metrics: [...new Set(metrics)].sort(),
    historicalValues,
    currentOnlyValues,
  });
}

async function auditYouTube({ env, runtime, period, youtubeRuntimeFactory }) {
  const channelId = readYouTubeChannelIdFromEnv(env);
  const clients = await youtubeRuntimeFactory(env, {
    publicApiKeyOnly: false,
    analyticsEnabled: true,
    customerKey: runtime.customerKey,
    channelId,
  });
  if (!clients.ownerClient) {
    throw operatorError('YouTube Owner Analytics runtime is unavailable',
      'CUSTOMER_ORGANIC_HISTORY_SOURCE_UNAVAILABLE', { platform: 'youtube' });
  }
  const channel = await clients.ownerClient.getChannel({ mine: true });
  if (String(channel?.id ?? '') !== channelId) {
    throw operatorError('YouTube Owner identity differs from the Customer allowlist',
      'CUSTOMER_ORGANIC_HISTORY_IDENTITY_MISMATCH', { platform: 'youtube' });
  }
  let startIndex = 1;
  let rowCount = 0;
  let earliestDate = null;
  let latestDate = null;
  const videoIds = new Set();
  for (let page = 1; page <= MAX_ANALYTICS_PAGES; page += 1) {
    const result = await clients.ownerClient.queryAnalytics({
      channelId,
      startDate: period.since,
      endDate: period.until,
      dimensions: 'day,video',
      metrics: 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration',
      sort: 'day,video',
      maxResults: ANALYTICS_PAGE_SIZE,
      startIndex,
    });
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const headers = Array.isArray(result?.columnHeaders) ? result.columnHeaders : [];
    const dayIndex = headers.findIndex((header) => header?.name === 'day');
    const videoIndex = headers.findIndex((header) => header?.name === 'video');
    for (const row of rows) {
      const day = dayIndex >= 0 ? String(row[dayIndex] ?? '') : '';
      if (/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
        earliestDate = earliestDate === null || day < earliestDate ? day : earliestDate;
        latestDate = latestDate === null || day > latestDate ? day : latestDate;
      }
      if (videoIndex >= 0 && row[videoIndex] !== null && row[videoIndex] !== undefined) {
        videoIds.add(String(row[videoIndex]));
      }
    }
    rowCount += rows.length;
    if (rows.length < ANALYTICS_PAGE_SIZE) {
      return deepFreeze({
        sourceRead: true,
        ownerIdentityMatched: true,
        analyticsRows: rowCount,
        distinctVideos: videoIds.size,
        earliestMetricDate: earliestDate,
        latestMetricDate: latestDate,
        exactHistoricalContentMetricsAvailable: rowCount > 0,
      });
    }
    startIndex += rows.length;
  }
  throw operatorError('YouTube Analytics audit exceeded its page limit',
    'CUSTOMER_ORGANIC_HISTORY_PAGINATION_LIMIT', {
      platform: 'youtube',
      maxPages: MAX_ANALYTICS_PAGES,
    });
}

async function readD1Coverage(db) {
  if (typeof db?.prepare !== 'function') {
    throw operatorError('Customer D1 binding is unavailable',
      'CUSTOMER_ORGANIC_HISTORY_RUNTIME_INVALID');
  }
  const result = await db.prepare(`
    SELECT platform, MIN(metric_date) AS min_metric_date,
           MAX(metric_date) AS max_metric_date, COUNT(*) AS rows,
           COUNT(DISTINCT external_content_id) AS distinct_content
    FROM organic_content_observations
    WHERE customer_key = 'chemistry_k' AND account_key = 'chemistry_k'
      AND platform IN ('facebook','instagram','tiktok','youtube')
    GROUP BY platform ORDER BY platform ASC
  `).all();
  const rows = Array.isArray(result) ? result : (result?.results ?? []);
  return deepFreeze(CUSTOMER_PLATFORMS.map((platform) => {
    const row = rows.find((candidate) => candidate.platform === platform) ?? {};
    return {
      platform,
      minMetricDate: row.min_metric_date ?? null,
      maxMetricDate: row.max_metric_date ?? null,
      rows: Number(row.rows ?? 0),
      distinctContent: Number(row.distinct_content ?? 0),
    };
  }));
}

function tiktokCapability(d1) {
  const row = d1.find((item) => item.platform === 'tiktok');
  return deepFreeze({
    sourceRead: false,
    source: 'lark_native_current_snapshot_only',
    minMetricDate: row?.minMetricDate ?? null,
    exactHistoricalContentMetricsAvailable: false,
  });
}

function metaPublishedDate(platform, row) {
  const raw = platform === 'facebook' ? row?.created_time : row?.timestamp;
  if (typeof raw !== 'string') return null;
  const instant = Date.parse(raw);
  return Number.isFinite(instant) ? new Date(instant).toISOString().slice(0, 10) : null;
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production'
    || runtime.profileKey !== 'chemistry_k'
    || runtime.customerKey !== 'chemistry_k'
    || runtime.infrastructureOwner !== 'customer'
    || env?.LARK_APP_TOKEN !== CUSTOMER_LARK_APP_TOKEN
    || env?.LARK_TABLE_MKT_CONTENT_DAILY !== CUSTOMER_CONTENT_DAILY_TABLE_ID
    || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw operatorError('Preview operator runtime is not exact Customer PROD',
      'CUSTOMER_ORGANIC_HISTORY_RUNTIME_INVALID');
  }
  return runtime;
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_ORGANIC_HISTORY_TOKEN_SHA256);
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw operatorError('Preview operator authorization was rejected',
      'CUSTOMER_ORGANIC_HISTORY_UNAUTHORIZED');
  }
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large',
      'CUSTOMER_ORGANIC_HISTORY_BODY_TOO_LARGE');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large',
      'CUSTOMER_ORGANIC_HISTORY_BODY_TOO_LARGE');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw operatorError('Preview operator request is invalid JSON',
      'CUSTOMER_ORGANIC_HISTORY_BODY_INVALID');
  }
}

function normalizePeriod(body) {
  const since = requireDate(body?.since, 'since');
  const until = requireDate(body?.until, 'until');
  if (since !== '2026-06-19' || until < since || until > '2026-07-28') {
    throw operatorError('Organic history audit period escapes the reviewed gap',
      'CUSTOMER_ORGANIC_HISTORY_PERIOD_INVALID', { since, until });
  }
  return Object.freeze({ since, until });
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  const instant = Date.parse(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)
    || !Number.isFinite(instant)
    || new Date(instant).toISOString().slice(0, 10) !== text) {
    throw operatorError(`${fieldName} must be a valid YYYY-MM-DD`,
      'CUSTOMER_ORGANIC_HISTORY_PERIOD_INVALID', { fieldName });
  }
  return text;
}

function requireSha256(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError('Preview operator token digest is invalid',
      'CUSTOMER_ORGANIC_HISTORY_RUNTIME_INVALID');
  }
  return text;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`${fieldName} is required`, 'CUSTOMER_ORGANIC_HISTORY_INPUT_INVALID');
  }
  return value.trim();
}

function noStoreHeaders() {
  return { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
