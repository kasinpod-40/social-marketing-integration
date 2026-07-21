import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  analyzeLarkBaseExport,
  createLarkBaseExportReadOnlyClient,
  redactLarkBaseAnalysisTableIds,
} from '../../packages/shared/src/lark/lark-base-export.js';

function buildDefaultExport() {
  return buildExport({
    baseName: 'Example Base',
    tables: [
      { id: 'tbl_a', name: '🎵 RAW_TikTok_Creator_Videos', records: 20, fieldCount: 18, viewCount: 1 },
      { id: 'tbl_b', name: '🎬 MKT_Content', records: 3, fieldCount: 29, viewCount: 5, repeat: true },
    ],
  });
}

function buildExport(input) {
  const tableMap = Object.fromEntries(input.tables.map((table) => [table.id, { name: table.name }]));
  const blocks = [];
  for (const table of input.tables) {
    const fields = table.fields ?? Array.from({ length: table.fieldCount ?? 0 }, (_, index) => ({ id: `f${index}`, name: `field_${index}`, type: 1 }));
    const views = table.views ?? Array.from({ length: table.viewCount ?? 0 }, (_, index) => ({ id: `v${index}`, name: `view_${index}`, type: 1 }));
    const block = { schema: {
      base: { name: input.baseName ?? 'Example Base' },
      tableMap,
      data: { table: {
        meta: { id: table.id, recordsNum: table.records ?? 0 },
        primaryKey: fields.find((field) => field.isPrimary)?.id ?? '',
        fieldMap: Object.fromEntries(fields.map((field) => [field.id, {
          name: field.name,
          type: field.type,
          isPrimary: field.isPrimary === true,
          ...(field.property ? { property: field.property } : {}),
        }])),
        viewMap: Object.fromEntries(views.map((view) => [view.id, {
          id: view.id,
          name: view.name,
          type: view.type,
          property: null,
        }])),
      } },
    } };
    blocks.push(block);
    if (table.repeat) blocks.push(structuredClone(block));
  }
  return JSON.stringify({ gzipSnapshot: gzipSync(Buffer.from(JSON.stringify(blocks))).toString('base64') });
}

test('analyzes only schema metadata and deduplicates repeated snapshot blocks', () => {
  const result = analyzeLarkBaseExport(buildDefaultExport());
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

test('creates a schema-only read client without exposing record values', async () => {
  const client = createLarkBaseExportReadOnlyClient(buildExport({
    tables: [{
      id: 'tbl_empty', name: 'Empty', records: 0,
      fields: [{ id: 'fld_key', name: 'key', type: 1, isPrimary: true }],
      views: [{ id: 'view_all', name: 'All', type: 1 }],
    }, {
      id: 'tbl_nonempty', name: 'Nonempty', records: 3,
      fields: [{ id: 'fld_value', name: 'value', type: 2, property: { formatter: '0' } }],
      views: [],
    }],
  }));
  const [tables, fields, views, page] = await Promise.all([
    client.listTables(),
    client.listFields({ tableId: 'tbl_empty' }),
    client.listViews({ tableId: 'tbl_empty' }),
    client.listRecordsPage({ tableId: 'tbl_nonempty', pageSize: 1 }),
  ]);
  assert.deepEqual(tables, [{ tableId: 'tbl_empty', name: 'Empty' }, { tableId: 'tbl_nonempty', name: 'Nonempty' }]);
  assert.equal(fields[0].isPrimary, true);
  assert.equal(views[0].viewType, 'grid');
  assert.deepEqual(page.records, [{ recordId: 'offline_record_1', fields: {} }]);
  assert.equal(page.hasMore, true);
});
