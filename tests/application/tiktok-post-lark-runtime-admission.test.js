import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTikTokPostLarkRuntime,
  resolveTikTokProbePageSize,
} from '../../apps/sync-worker/src/tiktok-post-lark-job-router.js';

function runtime(overrides = {}) {
  return {
    environment: 'development',
    profileKey: 'integration_workspace',
    infrastructureOwner: 'developer',
    customerKey: 'chemistry_k',
    ...overrides,
  };
}

test('TikTok post-Lark runtime preserves the reviewed Integration Workspace path', () => {
  assert.doesNotThrow(() => assertTikTokPostLarkRuntime(runtime()));
});

test('TikTok post-Lark runtime admits only the exact customer Production ownership tuple', () => {
  assert.doesNotThrow(() => assertTikTokPostLarkRuntime(runtime({
    environment: 'production',
    profileKey: 'chemistry_k',
    infrastructureOwner: 'customer',
  })));
});

test('TikTok post-Lark runtime rejects foreign Production profiles and ownership', () => {
  for (const candidate of [
    runtime({ environment: 'production', profileKey: 'other', infrastructureOwner: 'customer' }),
    runtime({ environment: 'production', profileKey: 'chemistry_k', infrastructureOwner: 'developer' }),
    runtime({ environment: 'production', profileKey: 'chemistry_k', infrastructureOwner: 'customer', customerKey: 'other' }),
  ]) {
    assert.throws(
      () => assertTikTokPostLarkRuntime(candidate),
      (error) => error?.code === 'TIKTOK_POST_LARK_ENVIRONMENT_BLOCKED',
    );
  }
});

test('TikTok watermark probe page size is independent from Free-safe business source chunks', () => {
  assert.equal(resolveTikTokProbePageSize({
    MKT_TIKTOK_PROBE_PAGE_SIZE: '500',
    MKT_TIKTOK_SOURCE_PAGE_SIZE: '25',
  }), 500);
  assert.equal(resolveTikTokProbePageSize({ MKT_TIKTOK_SOURCE_PAGE_SIZE: '25' }), 500);
});
