import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createLarkBaseExportSourceClient } from '../../scripts/lib/lark-base-export-source-client.js';

function gzipBase64(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

async function writeNumberFixture(file, followersValue) {
  const snapshots = [{
    schema: {
      tableMap: { tblDaily: { id: 'tblDaily', name: 'Account Daily' } },
      data: {
        table: {
          meta: { id: 'tblDaily', rev: 1 },
          primaryKey: 'fldKey',
          fieldMap: {
            fldKey: {
              name: 'account_daily_key',
              isPrimary: true,
              type: 1,
              fieldUIType: 'Text',
              description: {},
            },
            fldFollowers: {
              name: 'followers',
              isPrimary: false,
              type: 2,
              fieldUIType: 'Number',
              property: { formatter: '#,##0' },
              description: {},
            },
          },
          viewMap: {},
          views: [],
        },
        recordMap: {
          recDaily: {
            fldKey: { value: [{ type: 'text', text: 'instagram:17841413521012797:2026-08-10' }] },
            fldFollowers: { value: followersValue },
          },
        },
        recordMeta: {},
      },
      structVersion: 5,
    },
  }];

  await writeFile(file, JSON.stringify({
    gzipSnapshot: gzipBase64(snapshots),
    gzipExtraInfo: gzipBase64({}),
    gzipBaseRole: gzipBase64([]),
    gzipAccessConfig: gzipBase64({}),
    gzipDashboard: gzipBase64([]),
    gzipAutomation: gzipBase64([]),
    sign: 'number-normalization-fixture',
  }), 'utf8');
}

test('export Source normalizes Number-string cells to OpenAPI numbers without coercing Text keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-number-values-'));
  const file = join(dir, 'source.base');
  await writeNumberFixture(file, '1234');

  try {
    const client = await createLarkBaseExportSourceClient(file);
    const [record] = await client.listRecords({ tableId: 'tblDaily' });

    assert.equal(record.fields.account_daily_key, 'instagram:17841413521012797:2026-08-10');
    assert.equal(typeof record.fields.account_daily_key, 'string');
    assert.equal(record.fields.followers, 1234);
    assert.equal(typeof record.fields.followers, 'number');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('export Source fails closed instead of emitting a non-numeric Number write value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-number-invalid-'));
  const file = join(dir, 'source.base');
  await writeNumberFixture(file, 'not-a-number');

  try {
    await assert.rejects(
      () => createLarkBaseExportSourceClient(file),
      (error) => error?.code === 'LARK_BASE_EXPORT_NUMBER_CELL_INVALID'
        && error?.details?.fieldName === 'followers',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
