import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTikTokPostProcessCoverageReady } from '../../packages/application/src/use-cases/assert-tiktok-post-process-coverage-ready.js';

function gateway(overrides = {}) {
  return {
    async readCoverageRun() {
      return {
        coverage_run_id: 'coverage:tiktok:1',
        status: 'complete',
        expected_entities: 2021,
        observed_entities: 2021,
        expected_rows: 2021,
        observed_rows: 2021,
        failed_rows: 0,
        source_watermark: 'watermark-1',
        completed_at: 1_780_000_000_000,
        ...overrides,
      };
    },
  };
}

test('post-process Coverage gate accepts exact completed proof', async () => {
  const result = await assertTikTokPostProcessCoverageReady({
    gateway: gateway(),
    coverageRunId: 'coverage:tiktok:1',
    expectedSourceWatermark: 'watermark-1',
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.expectedEntities, 2021);
  assert.equal(result.observedEntities, 2021);
  assert.equal(result.failedRows, 0);
  assert.equal(result.sourceWatermark, 'watermark-1');
});

test('post-process Coverage gate rejects incomplete, failed or mismatched proof', async () => {
  for (const currentGateway of [
    gateway({ status: 'running', completed_at: null }),
    gateway({ failed_rows: 1 }),
    gateway({ observed_entities: 2020 }),
    gateway({ observed_rows: 2020 }),
    gateway({ source_watermark: 'watermark-other' }),
  ]) {
    await assert.rejects(() => assertTikTokPostProcessCoverageReady({
      gateway: currentGateway,
      coverageRunId: 'coverage:tiktok:1',
      expectedSourceWatermark: 'watermark-1',
    }), (error) => error.code === 'TIKTOK_POST_PROCESS_COVERAGE_INCOMPLETE');
  }
});

test('post-process Coverage gate rejects a missing durable run', async () => {
  await assert.rejects(() => assertTikTokPostProcessCoverageReady({
    gateway: { async readCoverageRun() { return null; } },
    coverageRunId: 'coverage:tiktok:missing',
    expectedSourceWatermark: 'watermark-1',
  }), (error) => error.code === 'TIKTOK_POST_PROCESS_COVERAGE_INCOMPLETE');
});
