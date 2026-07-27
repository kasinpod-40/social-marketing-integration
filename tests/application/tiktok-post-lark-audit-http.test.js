import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokPostLarkAuditHttpHandler,
  TIKTOK_POST_LARK_AUDIT_PATH,
} from '../../apps/sync-worker/src/tiktok-post-lark-audit-http.js';

const baseEnv = Object.freeze({
  MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'true',
  MKT_CONNECTION_OPERATOR_TOKEN: 'operator-secret',
  MKT_TIKTOK_SOURCE_PAGE_SIZE: '500',
  MKT_TIKTOK_SOURCE_MAX_PAGES: '1000',
  LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS: 'raw',
  LARK_TABLE_MKT_CONTENT: 'content',
  LARK_TABLE_MKT_CONTENT_DAILY: 'daily',
});

function context(env, token = 'operator-secret', method = 'GET') {
  const request = new Request(`https://example.com${TIKTOK_POST_LARK_AUDIT_PATH}`, {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  return { request, env, url: new URL(request.url) };
}

function createHandler(calls, options = {}) {
  return createTikTokPostLarkAuditHttpHandler({
    loadRuntimeConfig() {
      return {
        environment: 'development',
        profileKey: 'integration_workspace',
        customerKey: 'chemistry_k',
        connectors: { tiktok: { accountKey: 'chemistry_k', sourceHandle: 'chemistry_k' } },
      };
    },
    createInfrastructure() {
      return { repository: { listPage() {} } };
    },
    createAuditStore() {
      return { audit() {} };
    },
    async audit(input) {
      calls.push(input);
      if (options.auditError) throw options.auditError;
      return {
        mode: 'read_only',
        readyForManualProcessing: true,
        raw: { recordCount: 2021, sourceWatermark: 'watermark-1' },
      };
    },
  });
}

test('TikTok audit route is indistinguishable from missing while disabled', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler(context({ ...baseEnv, MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'false' }));
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('TikTok audit route requires the operator bearer token', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler(context(baseEnv, 'wrong-token'));
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, 'TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED');
  assert.equal(calls.length, 0);
});

test('TikTok audit route uses a stable fallback code without exposing generic error internals', async () => {
  const calls = [];
  const error = new Error('simulated internal failure');
  error.stack = 'stack containing token=private-token';
  error.details = {
    token: 'private-token',
    tableId: 'private-table',
  };
  const handler = createHandler(calls, { auditError: error });
  const response = await handler(context(baseEnv));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    error: 'TikTok audit failed',
    code: 'TIKTOK_POST_LARK_AUDIT_FAILED',
  });
  assert.doesNotMatch(
    JSON.stringify(body),
    /simulated internal failure|stack|details|private-token|private-table|token/iu,
  );
  assert.equal(calls.length, 1);
});

test('TikTok audit route preserves a known sanitized operational error code', async () => {
  const calls = [];
  const error = new Error('internal table configuration details');
  error.code = 'LARK_TABLE_CONFIG_INVALID';
  const handler = createHandler(calls, { auditError: error });
  const response = await handler(context(baseEnv));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    error: 'TikTok audit failed',
    code: 'LARK_TABLE_CONFIG_INVALID',
  });
  assert.doesNotMatch(JSON.stringify(body), /internal table configuration details/iu);
});

test('authorized TikTok audit route returns read-only sanitized evidence', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler(context(baseEnv));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.audit.mode, 'read_only');
  assert.equal(body.audit.raw.recordCount, 2021);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customerKey, 'chemistry_k');
  assert.equal(calls[0].accountKey, 'chemistry_k');
  assert.equal(calls[0].tables.rawTikTokCreatorVideos, 'raw');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('TikTok audit route rejects non-GET methods before dependencies run', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler(context(baseEnv, 'operator-secret', 'POST'));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.equal(calls.length, 0);
});
