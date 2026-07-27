import { describe, expect, it, vi } from 'vitest';
import {
  createTikTokPostLarkAuditHttpHandler,
  TIKTOK_POST_LARK_AUDIT_PATH,
} from '../../apps/sync-worker/src/tiktok-post-lark-audit-http.js';
import { WORKER_RUNTIME_VERSION_HEADER } from '../../packages/shared/src/cloudflare/worker-version.js';

const VERSION_ID = '12345678-1234-4123-8123-123456789abc';

function createHandler(send) {
  return createTikTokPostLarkAuditHttpHandler({
    loadRuntimeConfig() {
      return {
        environment: 'development',
        profileKey: 'integration_workspace',
        customerKey: 'chemistry_k',
        connectors: {
          tiktok: {
            accountKey: 'chemistry_k',
            sourceHandle: 'chemistry_k',
          },
        },
      };
    },
    createInfrastructure() {
      return { repository: {} };
    },
    createAuditStore() {
      return {};
    },
    async audit() {
      return {
        mode: 'read_only',
        platform: 'tiktok',
        customerKey: 'chemistry_k',
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
        raw: { recordCount: 2021, sourceWatermark: 'sha256:fixture' },
        d1: {},
        canonical: {},
        gaps: [],
        issues: [],
        readyForManualProcessing: true,
      };
    },
    queue: { send },
  });
}

describe('TikTok Audit exact Worker version in Workers runtime', () => {
  it('attests the runtime version on guarded 401 and 200 responses without Queue writes', async () => {
    const send = vi.fn(async () => undefined);
    const handler = createHandler(send);
    const runtimeEnv = {
      MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'true',
      MKT_CONNECTION_OPERATOR_TOKEN: 'operator-secret',
      MKT_TIKTOK_SOURCE_PAGE_SIZE: '500',
      MKT_TIKTOK_SOURCE_MAX_PAGES: '1000',
      LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS: 'raw',
      LARK_TABLE_MKT_CONTENT: 'content',
      LARK_TABLE_MKT_CONTENT_DAILY: 'daily',
      CF_VERSION_METADATA: { id: VERSION_ID },
      MKT_SYNC_QUEUE: { send },
    };

    const unauthorizedRequest = new Request(
      `https://example.com${TIKTOK_POST_LARK_AUDIT_PATH}`,
      { method: 'GET' },
    );
    const unauthorized = await handler({
      request: unauthorizedRequest,
      url: new URL(unauthorizedRequest.url),
      env: runtimeEnv,
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get(WORKER_RUNTIME_VERSION_HEADER)).toBe(VERSION_ID);

    const authorizedRequest = new Request(
      `https://example.com${TIKTOK_POST_LARK_AUDIT_PATH}`,
      {
        method: 'GET',
        headers: { authorization: 'Bearer operator-secret' },
      },
    );
    const authorized = await handler({
      request: authorizedRequest,
      url: new URL(authorizedRequest.url),
      env: runtimeEnv,
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get(WORKER_RUNTIME_VERSION_HEADER)).toBe(VERSION_ID);
    expect((await authorized.json()).ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
