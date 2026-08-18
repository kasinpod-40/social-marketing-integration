import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  createLarkBaseExportSourceClient,
  inspectLarkBaseExportSourceModel,
} from '../../scripts/lib/lark-base-export-source-client.js';

function gzipBase64(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

function snapshot({ tableId, name, recordId, key }) {
  return {
    schema: {
      tableMap: { [tableId]: { id: tableId, name } },
      data: {
        table: {
          meta: { id: tableId, rev: 1 },
          primaryKey: `${tableId}_key`,
          fieldMap: {
            [`${tableId}_key`]: {
              name: 'key',
              isPrimary: true,
              type: 1,
              fieldUIType: 'Text',
              description: {},
            },
          },
          viewMap: {
            [`${tableId}_view`]: {
              id: `${tableId}_view`,
              name: 'All Records',
              type: 1,
              publicLevel: 0,
              property: { fields: [`${tableId}_key`], colInfos: {} },
            },
          },
          views: [`${tableId}_view`],
        },
        recordMap: {
          [recordId]: {
            [`${tableId}_key`]: { value: [{ type: 'text', text: key }] },
          },
        },
      },
    },
  };
}

async function writeFixture(file) {
  await writeFile(file, JSON.stringify({
    gzipSnapshot: gzipBase64([
      snapshot({ tableId: 'tblClone', name: '🪪 MKT_Accounts', recordId: 'recClone', key: 'a1' }),
      snapshot({ tableId: 'tblTikTok', name: '🎵 RAW_TikTok_Creator_Videos', recordId: 'recTikTok', key: 'v1' }),
    ]),
    gzipExtraInfo: gzipBase64({}),
    gzipBaseRole: gzipBase64([]),
    gzipAccessConfig: gzipBase64({}),
    gzipDashboard: gzipBase64([]),
    gzipAutomation: gzipBase64([]),
    sign: 'fixture',
  }), 'utf8');
}

test('clone-scope adapter excludes protected external table without changing export authority model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-scope-'));
  const file = join(dir, 'source.base');
  await writeFixture(file);

  try {
    const authority = await inspectLarkBaseExportSourceModel(file);
    assert.equal(authority.tables, 2);
    assert.equal(authority.records, 2);

    const client = await createLarkBaseExportSourceClient(file, {
      excludedTableNames: ['🎵 RAW_TikTok_Creator_Videos'],
    });
    const tables = await client.listTables();
    assert.deepEqual(tables.map((table) => table.name), ['🪪 MKT_Accounts']);

    const diagnostics = client.getExportDiagnostics();
    assert.equal(diagnostics.scopedTableCount, 1);
    assert.deepEqual(diagnostics.excludedTableNames, ['🎵 RAW_TikTok_Creator_Videos']);

    await assert.rejects(
      () => client.listRecords({ tableId: 'tblTikTok' }),
      (error) => {
        assert.equal(error.code, 'LARK_BASE_EXPORT_TABLE_OUTSIDE_SCOPE');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
