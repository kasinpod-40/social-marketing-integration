import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { inspectLarkBaseExportSourceModel } from '../../scripts/lib/lark-base-export-source-client.js';

function gzipBase64(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

function snapshot({ colInfos, recordId, key }) {
  return {
    schema: {
      tableMap: { tblA: { id: 'tblA', name: 'Accounts' } },
      data: {
        table: {
          meta: { id: 'tblA', rev: 7 },
          primaryKey: 'fldKey',
          fieldMap: {
            fldKey: { name: 'account_key', isPrimary: true, type: 1, fieldUIType: 'Text', description: {} },
            fldOne: { name: 'one', isPrimary: false, type: 1, fieldUIType: 'Text', description: {} },
            fldTwo: { name: 'two', isPrimary: false, type: 1, fieldUIType: 'Text', description: {} },
          },
          viewMap: {
            vewAll: {
              id: 'vewAll', name: 'All Accounts', type: 1, publicLevel: 0, bizType: 0,
              property: {
                fields: ['fldKey', 'fldOne', 'fldTwo'],
                filterInfo: null,
                sortInfo: [],
                group: [],
                colInfos,
                rowHeightLevel: 1,
                frozenColCount: 1,
              },
            },
          },
          views: ['vewAll'],
        },
        recordMap: {
          [recordId]: {
            fldKey: { value: [{ type: 'text', text: key }] },
            fldOne: { value: [{ type: 'text', text: 'one' }] },
            fldTwo: { value: [{ type: 'text', text: 'two' }] },
          },
        },
        recordMeta: {},
      },
      structVersion: 5,
    },
  };
}

async function writeFixture(file, secondColInfos) {
  await writeFile(file, JSON.stringify({
    gzipSnapshot: gzipBase64([
      snapshot({
        colInfos: {
          fldOne: { width: 180, hidden: true },
          fldTwo: { width: 180, hidden: true },
          fldKey: { width: 180, hidden: false },
        },
        recordId: 'rec1',
        key: 'a1',
      }),
      snapshot({ colInfos: secondColInfos, recordId: 'rec2', key: 'a2' }),
    ]),
    gzipExtraInfo: gzipBase64({}),
    gzipBaseRole: gzipBase64([]),
    gzipAccessConfig: gzipBase64({}),
    gzipDashboard: gzipBase64([]),
    gzipAutomation: gzipBase64([]),
    sign: 'fixture-signature',
  }), 'utf8');
}

test('duplicate snapshot views canonicalize hidden field set order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-hidden-order-'));
  const file = join(dir, 'source.base');
  await writeFixture(file, {
    fldTwo: { width: 180, hidden: true },
    fldKey: { width: 180, hidden: false },
    fldOne: { width: 180, hidden: true },
  });

  try {
    const result = await inspectLarkBaseExportSourceModel(file);
    assert.equal(result.ok, true);
    assert.equal(result.tables, 1);
    assert.equal(result.records, 2);
    assert.equal(result.views, 1);
    assert.deepEqual(result.diagnostics.duplicateSnapshotTableIds, ['tblA']);
    assert.equal(result.remoteRequestCount, 0);
    assert.equal(result.remoteMutationCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate snapshot views still fail closed when hidden field membership changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-hidden-drift-'));
  const file = join(dir, 'source.base');
  await writeFixture(file, {
    fldTwo: { width: 180, hidden: false },
    fldKey: { width: 180, hidden: false },
    fldOne: { width: 180, hidden: true },
  });

  try {
    await assert.rejects(
      () => inspectLarkBaseExportSourceModel(file),
      (error) => {
        assert.equal(error.code, 'LARK_BASE_EXPORT_DUPLICATE_ENTITY_CONFLICT');
        assert.equal(error.details.differenceCount > 0, true);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
