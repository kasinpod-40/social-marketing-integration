import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCustomerOrganicHistoryPreviewHttpHandler,
  CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH,
} from '../../apps/sync-worker/src/customer-organic-history-preview-http.js';

const TOKEN = 'history-audit-token';
const TOKEN_DIGEST = 'a'.repeat(64);

function environment() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CUSTOMER_KEY: 'chemistry_k',
    MKT_RESOURCE_OWNER: 'customer',
    MKT_INFRASTRUCTURE_OWNER: 'customer',
    MKT_SOURCE_ASSET_OWNER: 'customer',
    MKT_DATA_OWNER: 'customer',
    LARK_APP_TOKEN: 'Tcm4bYRL4acuQysp6AwlmXBKgbe',
    LARK_TABLE_MKT_CONTENT_DAILY: 'tblODz9RcmCIFtfQ',
    MKT_ORGANIC_HISTORY_TOKEN_SHA256: TOKEN_DIGEST,
    MKT_STATE_DB: { prepare() {} },
  };
}

function request(body = {}) {
  return new Request(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'audit',
      since: '2026-06-19',
      until: '2026-07-28',
      ...body,
    }),
  });
}

test('Customer Organic history Preview audit is fail-closed to exact PROD and read-only mode', async () => {
  let metaCalls = 0;
  const emptyMetaAdapter = {
    async fetchContentPage() { return { rows: [], hasMore: false, nextCursor: null }; },
  };
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? TOKEN_DIGEST : 'b'.repeat(64); },
    createMetaRuntime() {
      metaCalls += 1;
      return {
        sources: { facebook: emptyMetaAdapter, instagram: emptyMetaAdapter },
        mappings: { facebookPageId: 'page', instagramAccountId: 'instagram' },
      };
    },
    async createYouTubeRuntimeClients() {
      return {
        ownerClient: {
          async getChannel() { return { id: 'youtube-channel' }; },
          async queryAnalytics() { return { columnHeaders: [], rows: [] }; },
        },
      };
    },
  });
  const env = {
    ...environment(),
    YOUTUBE_CHANNEL_ID: 'youtube-channel',
    MKT_STATE_DB: {
      prepare() { return { async all() { return { results: [] }; } }; },
    },
  };
  const response = await handler({
    request: request(),
    env,
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.readOnly, true);
  assert.equal(body.result.providerWrites, 0);
  assert.equal(body.result.d1Writes, 0);
  assert.equal(body.result.larkWrites, 0);
  assert.equal(metaCalls, 1);
});

test('Customer Organic history Preview rejects execution and never constructs a source runtime', async () => {
  let constructed = false;
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createMetaRuntime() { constructed = true; return {}; },
  });
  const response = await handler({
    request: request({ mode: 'execute' }),
    env: environment(),
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 400);
  assert.equal(constructed, false);
  assert.equal((await response.json()).code, 'CUSTOMER_ORGANIC_HISTORY_MODE_INVALID');
});

test('Customer Organic history Preview rejects wrong Lark table authority', async () => {
  let constructed = false;
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createMetaRuntime() { constructed = true; return {}; },
  });
  const response = await handler({
    request: request(),
    env: { ...environment(), LARK_TABLE_MKT_CONTENT_DAILY: 'wrong' },
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 400);
  assert.equal(constructed, false);
});

test('Customer Organic history Preview rejects invalid authorization', async () => {
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest() { return 'b'.repeat(64); },
  });
  const response = await handler({
    request: request(),
    env: environment(),
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'CUSTOMER_ORGANIC_HISTORY_UNAUTHORIZED');
});

test('Customer Organic history audit scopes day-by-video Analytics to one oldest D1-proven video', async () => {
  let analyticsInput = null;
  const emptyMetaAdapter = {
    async fetchContentPage() { return { rows: [], hasMore: false, nextCursor: null }; },
  };
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createMetaRuntime() {
      return {
        sources: { facebook: emptyMetaAdapter, instagram: emptyMetaAdapter },
        mappings: { facebookPageId: 'page', instagramAccountId: 'instagram' },
      };
    },
    async createYouTubeRuntimeClients() {
      return {
        ownerClient: {
          async getChannel() { return { id: 'youtube-channel' }; },
          async queryAnalytics(input) {
            analyticsInput = input;
            return {
              columnHeaders: [{ name: 'day' }, { name: 'video' }],
              rows: [['2026-06-20', 'video-a']],
            };
          },
        },
      };
    },
  });
  const env = {
    ...environment(),
    YOUTUBE_CHANNEL_ID: 'youtube-channel',
    MKT_STATE_DB: {
      prepare(sql) {
        return {
          async all() {
            if (sql.includes('SELECT external_content_id')) {
              return { results: [{ external_content_id: 'video-a' }] };
            }
            return { results: [] };
          },
        };
      },
    },
  };
  const response = await handler({
    request: request(),
    env,
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(analyticsInput.filters, 'video==video-a');
  assert.equal(body.result.providers.youtube.sampledVideos, 1);
  assert.equal(body.result.providers.youtube.analyticsRows, 1);
  assert.equal(body.result.providers.youtube.earliestMetricDate, '2026-06-20');
  assert.equal(body.result.providers.youtube.exactHistoricalContentMetricsAvailable, true);
});

test('Customer Organic history audit preserves other provider evidence when YouTube is transient', async () => {
  const emptyMetaAdapter = {
    async fetchContentPage() { return { rows: [], hasMore: false, nextCursor: null }; },
  };
  const handler = createCustomerOrganicHistoryPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createMetaRuntime() {
      return {
        sources: { facebook: emptyMetaAdapter, instagram: emptyMetaAdapter },
        mappings: { facebookPageId: 'page', instagramAccountId: 'instagram' },
      };
    },
    async createYouTubeRuntimeClients() {
      return {
        ownerClient: {
          async getChannel() { return { id: 'youtube-channel' }; },
          async queryAnalytics() {
            const error = new Error('temporary');
            error.code = 'YOUTUBE_TRANSIENT_API_ERROR';
            error.retryable = true;
            throw error;
          },
        },
      };
    },
  });
  const env = {
    ...environment(),
    YOUTUBE_CHANNEL_ID: 'youtube-channel',
    MKT_STATE_DB: {
      prepare(sql) {
        return {
          async all() {
            return sql.includes('SELECT external_content_id')
              ? { results: [{ external_content_id: 'video-a' }] }
              : { results: [] };
          },
        };
      },
    },
  };
  const response = await handler({
    request: request(),
    env,
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_HISTORY_PREVIEW_PATH}`),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.providers.facebook.sourceRead, true);
  assert.equal(body.result.providers.instagram.sourceRead, true);
  assert.equal(body.result.providers.youtube.sourceRead, false);
  assert.equal(body.result.providers.youtube.errorCode, 'YOUTUBE_TRANSIENT_API_ERROR');
});
