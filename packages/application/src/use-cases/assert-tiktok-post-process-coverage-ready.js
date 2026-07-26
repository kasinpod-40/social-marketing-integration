import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Re-read durable Coverage before a post-processing Report request can be admitted. */
export async function assertTikTokPostProcessCoverageReady(input = {}) {
  const gateway = requireGateway(input.gateway);
  const coverageRunId = requireText(input.coverageRunId, 'coverageRunId');
  const coverage = await gateway.readCoverageRun(coverageRunId);
  const expectedEntities = nullableInteger(coverage?.expected_entities);
  const observedEntities = nullableInteger(coverage?.observed_entities);
  const expectedRows = nullableInteger(coverage?.expected_rows);
  const observedRows = nullableInteger(coverage?.observed_rows);
  const failedRows = nullableInteger(coverage?.failed_rows) ?? 0;
  const ready = coverage?.status === 'complete'
    && coverage?.completed_at !== null
    && coverage?.completed_at !== undefined
    && failedRows === 0
    && (expectedEntities === null || expectedEntities === observedEntities)
    && (expectedRows === null || expectedRows === observedRows);
  if (!ready) {
    throw permanentError('TikTok post-processing Report requires completed Coverage', {
      code: 'TIKTOK_POST_PROCESS_COVERAGE_INCOMPLETE',
      details: {
        coverageRunId,
        status: coverage?.status ?? null,
        expectedEntities,
        observedEntities,
        expectedRows,
        observedRows,
        failedRows,
      },
    });
  }
  return Object.freeze({
    coverageRunId,
    status: coverage.status,
    expectedEntities,
    observedEntities,
    expectedRows,
    observedRows,
    failedRows,
    sourceWatermark: coverage.source_watermark ?? null,
    completedAt: Number(coverage.completed_at),
  });
}

function requireGateway(value) {
  if (typeof value?.readCoverageRun !== 'function') {
    throw new TypeError('TikTok post-processing Coverage gate requires gateway.readCoverageRun');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok post-processing Coverage gate requires ${fieldName}`);
  }
  return value.trim();
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
