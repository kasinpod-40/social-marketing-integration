import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { inspectLarkBaseExport } from '../../scripts/lib/lark-base-export.js';

function gzipBase64(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

function snapshotEntry({ tableId, tableName, fields, views, records }) {
  return {
    schema: {
      base: {},
      owner: {},
      tableMap: {
        tblA: { id: 'tblA', name: '🪪 MKT_Accounts' },
        tblB: { id: 'tblB', name: '📣 MKT_Report_Top_Ads' },
      },
      data: {
        table: {
          meta: { id: tableId },
          fieldMap: fields,
          viewMap: views,
        },
        recordMap: records,
        recordMeta: {},
      },
      structVersion: 1,
    },
  };
}

test('local .base authority reader parses actual gzip envelope and dedupes chunked snapshot IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-lark-base-export-'));
  const file = join(dir, 'Social MKT Data Hub.base');
  const snapshots = [
    snapshotEntry({
      tableId: 'tblA',
      fields: {
        fldA: { name: 'account_key', type: 1 },
        fldRel: { name: 'content_link', type: 18 },
        fldFormula: { name: 'score', type: 20 },
      },
      views: { vewA: { id: 'vewA', type: 1 } },
      records: { recA: { fields: { fldA: 'a1' } } },
    }),
    snapshotEntry({
      tableId: 'tblB',
      fields: { fldB: { name: 'ad_key', type: 1 } },
      views: { vewB: { id: 'vewB', type: 1 } },
      records: { recB: { fields: { fldB: 'b1' } } },
    }),
    // Same table is repeated to emulate the real export's chunked snapshot entry.
    snapshotEntry({
      tableId: 'tblB',
      fields: { fldB: { name: 'ad_key', type: 1 } },
      views: { vewB: { id: 'vewB', type: 1 } },
      records: { recB: { fields: { fldB: 'b1' } } },
    }),
  ];
  const envelope = {
    gzipSnapshot: gzipBase64(snapshots),
    gzipExtraInfo: gzipBase64({ maxAutoNum: 1 }),
    gzipBaseRole: gzipBase64([{ roleId: 'rolA', name: 'Reader' }]),
    gzipAccessConfig: gzipBase64({ defaultConfig: {} }),
    gzipDashboard: gzipBase64([{ dashboardID: 1, snapshot: '', charts: [] }]),
    gzipAutomation: gzipBase64([{ id: 2, trigger_name: 'Weekly Notify' }]),
    sign: 'fixture-signature',
  };
  await writeFile(file, JSON.stringify(envelope), 'utf8');

  try {
    const result = await inspectLarkBaseExport(file);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'local-read-only');
    assert.equal(result.contractVersion, 'lark_base_export_authority_inspection_v2');
    assert.equal(result.counts.tables, 2);
    assert.equal(result.counts.fields, 4);
    assert.equal(result.counts.records, 2);
    assert.equal(result.counts.views, 2);
    assert.equal(result.counts.relationFields, 1);
    assert.equal(result.counts.formulaFields, 1);
    assert.equal(result.counts.dashboards, 1);
    assert.equal(result.counts.workflows, 1);
    assert.equal(result.counts.advancedPermissionRoles, 1);
    assert.deepEqual(result.names.tables, ['📣 MKT_Report_Top_Ads', '🪪 MKT_Accounts'].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(result.names.roles, ['Reader']);
    assert.equal(result.snapshot.entryCount, 3);
    assert.equal(result.snapshot.uniqueTableCount, 2);
    assert.deepEqual(result.snapshot.duplicateSnapshotTables, [{
      tableId: 'tblB',
      name: '📣 MKT_Report_Top_Ads',
      snapshotEntryCount: 2,
    }]);
    assert.equal(result.envelope.signPresent, true);
    assert.equal(result.remoteMutationCount, 0);
    assert.match(result.file.sha256, /^[0-9a-f]{64}$/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local .base authority reader fails closed on missing canonical payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-lark-base-export-missing-'));
  const file = join(dir, 'invalid.base');
  await writeFile(file, JSON.stringify({ gzipSnapshot: gzipBase64([]), sign: 'x' }), 'utf8');

  try {
    await assert.rejects(
      inspectLarkBaseExport(file),
      { code: 'LARK_BASE_EXPORT_PAYLOAD_MISSING' },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local .base authority reader fails closed on non-JSON input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-lark-base-export-invalid-'));
  const file = join(dir, 'invalid.base');
  await writeFile(file, 'not-json', 'utf8');

  try {
    await assert.rejects(
      inspectLarkBaseExport(file),
      { code: 'LARK_BASE_EXPORT_INVALID_JSON' },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
