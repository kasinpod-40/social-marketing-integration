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

test('local .base authority reader expands nested gzip/base64 JSON and inventories exported resources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-lark-base-export-'));
  const file = join(dir, 'Social MKT Data Hub.base');
  const nested = {
    tables: [
      {
        table_id: 'tblA',
        name: '🪪 MKT_Accounts',
        fields: [
          { field_id: 'fldA', field_name: 'account_key', type: 1 },
          { field_id: 'fldRel', field_name: 'content_link', type: 18 },
          { field_id: 'fldFormula', field_name: 'score', type: 20 },
        ],
        views: [{ view_id: 'vewA', view_name: 'All Records', view_type: 'grid' }],
        records: [{ record_id: 'recA', fields: { account_key: 'a1' } }],
      },
    ],
    dashboards: [{ dashboard_id: 'blkDashboard', name: 'Executive Dashboard', blocks: [] }],
    workflows: [{ workflow_id: 'wkfA', name: 'Weekly Notify', steps: [] }],
    roles: [{ role_id: 'rolA', name: 'Viewer', permissions: {} }],
  };
  await writeFile(file, JSON.stringify({ version: 1, payload: gzipBase64(nested) }), 'utf8');

  try {
    const result = await inspectLarkBaseExport(file);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'local-read-only');
    assert.equal(result.compressedJsonPayloadsExpanded, 1);
    assert.equal(result.counts.tables, 1);
    assert.equal(result.counts.fields, 3);
    assert.equal(result.counts.records, 1);
    assert.equal(result.counts.views, 1);
    assert.equal(result.counts.relationFields, 1);
    assert.equal(result.counts.formulaFields, 1);
    assert.equal(result.counts.dashboards, 1);
    assert.equal(result.counts.workflows, 1);
    assert.equal(result.counts.advancedPermissionRoles, 1);
    assert.deepEqual(result.names.tables, ['🪪 MKT_Accounts']);
    assert.equal(result.remoteMutationCount, 0);
    assert.match(result.file.sha256, /^[0-9a-f]{64}$/u);
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
