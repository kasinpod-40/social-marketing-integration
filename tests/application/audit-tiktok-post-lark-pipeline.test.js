import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTikTokPostLarkPipeline } from '../../packages/application/src/use-cases/audit-tiktok-post-lark-pipeline.js';

function rawRecord(id) {
  return {
    recordId: `raw-${id}`,
    lastModifiedTime: 1_780_000_000_000 + id,
    fields: {
      video_id: String(id),
      shareable_url: `https://www.tiktok.com/@chemistry_k/video/${id}`,
      description: `video ${id}`,
      views: id * 10,
    },
  };
}

function canonicalRecord(id, keyField, key) {
  return {
    recordId: `${keyField}-${id}`,
    fields: {
      [keyField]: key,
      platform: 'tiktok',
      account_id: 'chemistry_k',
      external_content_id: String(id),
    },
  };
}

function buildRepository(options = {}) {
  const rows = new Map([
    ['raw', [rawRecord(1), rawRecord(2)]],
    ['content', (options.contentIds ?? [1, 2]).map(
      (id) => canonicalRecord(id, 'content_key', `tiktok:chemistry_k:${id}`),
    )],
    ['daily', (options.dailyIds ?? [1, 2]).map(
      (id) => canonicalRecord(id, 'content_daily_key', `tiktok:chemistry_k:${id}:2026-07-25`),
    )],
  ]);
  return {
    async listPage(tableId) {
      return {
        records: rows.get(tableId) ?? [],
        hasMore: false,
        nextPageToken: null,
      };
    },
  };
}

function buildD1Audit(options = {}) {
  const ids = options.d1Ids ?? [1, 2];
  return {
    async audit(input) {
      options.onAudit?.(input);
      return Object.freeze({
        state: { totalRows: ids.length, distinctKeys: ids.length, duplicateKeys: 0, missingKeys: 0 },
        observations: { totalRows: ids.length, distinctKeys: ids.length, duplicateKeys: 0, missingKeys: 0 },
        contentIdentities: ids.map((id) => ({
          contentKey: `tiktok:chemistry_k:${id}`,
          externalContentId: String(id),
        })),
        coverage: {
          coverageRunId: 'coverage:tiktok:1',
          status: 'complete',
          expectedEntities: ids.length,
          observedEntities: ids.length,
          failedRows: 0,
          sourceWatermark: 'watermark-1',
        },
        coverageEntities: {
          totalRows: ids.length,
          distinctKeys: ids.length,
          duplicateKeys: 0,
          observedRows: ids.length,
          nonObservedRows: 0,
        },
        missingObservationRows: options.missingObservationRows ?? 0,
        missingCoverageRows: options.missingCoverageRows ?? 0,
      });
    },
  };
}

const input = Object.freeze({
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  sourceHandle: 'chemistry_k',
  tables: {
    rawTikTokCreatorVideos: 'raw',
    mktContent: 'content',
    mktContentDaily: 'daily',
  },
});

test('read-only TikTok audit proves exact RAW, D1 and Canonical parity', async () => {
  const result = await auditTikTokPostLarkPipeline({
    ...input,
    repository: buildRepository(),
    d1AuditStore: buildD1Audit(),
  });

  assert.equal(result.mode, 'read_only');
  assert.equal(result.raw.recordCount, 2);
  assert.equal(result.d1.state.totalRows, 2);
  assert.equal(result.canonical.content.matchingRows, 2);
  assert.equal(result.canonical.daily.matchingRows, 2);
  assert.equal(result.gaps.rawMissingInD1.count, 0);
  assert.equal(result.gaps.d1MissingInContent.count, 0);
  assert.equal(result.gaps.contentMissingInDaily.count, 0);
  assert.equal(result.readyForManualProcessing, true);
  assert.deepEqual(result.issues, []);
});

test('read-only TikTok audit clamps the D1 identity bound independently from Lark pagination', async () => {
  let observed = null;
  await auditTikTokPostLarkPipeline({
    ...input,
    repository: buildRepository(),
    d1AuditStore: buildD1Audit({ onAudit: (value) => { observed = value; } }),
    pageSize: 500,
    maxPages: 1_000,
  });

  assert.equal(observed.maxContentRecords, 50_000);
  assert.equal(observed.customerKey, 'chemistry_k');
  assert.equal(observed.accountKey, 'chemistry_k');
});

test('read-only TikTok audit reports compact cross-layer gaps without payload data', async () => {
  const result = await auditTikTokPostLarkPipeline({
    ...input,
    repository: buildRepository({ contentIds: [1], dailyIds: [1] }),
    d1AuditStore: buildD1Audit({ missingCoverageRows: 1 }),
  });

  assert.equal(result.readyForManualProcessing, false);
  assert.equal(result.gaps.rawMissingInContent.count, 1);
  assert.deepEqual(result.gaps.rawMissingInContent.externalContentIds, ['2']);
  assert.equal(result.gaps.d1MissingInContent.count, 1);
  assert.ok(result.issues.some((issue) => issue.code === 'TIKTOK_D1_COVERAGE_GAP'));
  assert.ok(result.issues.some((issue) => issue.code === 'TIKTOK_CROSS_LAYER_GAP'));
  assert.equal(JSON.stringify(result).includes('video 1'), false);
});

test('read-only TikTok audit rejects duplicate Canonical stable keys', async () => {
  const repository = buildRepository();
  const original = repository.listPage;
  repository.listPage = async (tableId, options) => {
    const page = await original(tableId, options);
    if (tableId !== 'content') return page;
    return {
      ...page,
      records: [
        canonicalRecord(1, 'content_key', 'tiktok:chemistry_k:1'),
        canonicalRecord(2, 'content_key', 'tiktok:chemistry_k:1'),
      ],
    };
  };
  const result = await auditTikTokPostLarkPipeline({
    ...input,
    repository,
    d1AuditStore: buildD1Audit(),
  });
  assert.equal(result.canonical.content.duplicateKeyCount, 1);
  assert.ok(result.issues.some((issue) => issue.code === 'TIKTOK_CANONICAL_CONTENT_KEY_INVALID'));
});
