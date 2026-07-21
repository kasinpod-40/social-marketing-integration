import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { analyzeLarkBaseExport, redactLarkBaseAnalysisTableIds } from '../../packages/shared/src/lark/lark-base-export.js';

function buildExport() {
  const tableMap = {
    tbl_a: { name: '🎵 RAW_TikTok_Creator_Videos' },
    tbl_b: { name: '🎬 MKT_Content' },
  };
  const block = (id, records, fieldCount, viewCount) => ({ schema: {
    base: { name: 'Example Base' }, tableMap,
    data: { table: {
      meta: { id, recordsNum: records },
      fieldMap: Object.fromEntries(Array.from({ length: fieldCount }, (_, index) => [`f${index}`, {}])),
      viewMap: Object.fromEntries(Array.from({ length: viewCount }, (_, index) => [`v${index}`, {}])),
    } },
  } });
  const snapshot = [block('tbl_a', 20, 18, 1), block('tbl_b', 3, 29, 5), block('tbl_b', 3, 29, 5)];
  return JSON.stringify({ gzipSnapshot: gzipSync(Buffer.from(JSON.stringify(snapshot))).toString('base64') });
}

test('analyzes only schema metadata and deduplicates repeated snapshot blocks', () => {
  const result = analyzeLarkBaseExport(buildExport());
  assert.equal(result.baseName, 'Example Base');
  assert.equal(result.snapshotBlockCount, 3);
  assert.equal(result.uniqueTableCount, 2);
  assert.equal(result.duplicateSnapshotBlockCount, 1);
  assert.deepEqual(result.totals, { records: 23, fields: 47, views: 6 });
  assert.equal(result.tables.find((table) => table.tableId === 'tbl_a')?.records, 20);
  const redacted = redactLarkBaseAnalysisTableIds(result);
  assert.equal('tableId' in redacted.tables[0], false);
  assert.equal('tableId' in redacted.duplicateSnapshotBlocks[0], false);
});

test('rejects invalid exports without attempting record inspection', () => {
  assert.throws(() => analyzeLarkBaseExport('{}'), /gzipSnapshot is required/u);
  assert.throws(() => analyzeLarkBaseExport({ gzipSnapshot: 'not-gzip' }), /valid gzip JSON/u);
});
