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

function snapshot({ tableId, tableMap, primaryKey, fields, views, viewOrder, records }) {
  return {
    schema: {
      tableMap,
      data: {
        table: {
          meta: { id: tableId, rev: 7 },
          primaryKey,
          fieldMap: fields,
          viewMap: views,
          views: viewOrder,
        },
        recordMap: records,
        recordMeta: {},
      },
      structVersion: 5,
    },
  };
}

async function writeFixture(file) {
  const tableMap = {
    tblA: { id: 'tblA', name: 'Accounts' },
    tblB: { id: 'tblB', name: 'Campaigns' },
  };
  const accountFields = {
    fldKey: { name: 'account_key', isPrimary: true, type: 1, fieldUIType: 'Text', description: {} },
    fldStatus: {
      name: 'status', isPrimary: false, type: 3, fieldUIType: 'SingleSelect',
      property: { options: [{ id: 'optActive', name: 'active', color: 1 }, { id: 'optPaused', name: 'paused', color: 2 }] },
      description: { content: [{ type: 'text', text: 'Account status' }] },
    },
    fldTags: {
      name: 'tags', isPrimary: false, type: 4, fieldUIType: 'MultiSelect',
      property: { options: [{ id: 'optA', name: 'A', color: 0 }, { id: 'optB', name: 'B', color: 1 }] },
      description: {},
    },
    fldUrl: { name: 'url', isPrimary: false, type: 15, fieldUIType: 'Url', property: { extractExternalUrl: false }, description: {} },
  };
  const campaignFields = {
    fldCampaign: { name: 'campaign_key', isPrimary: true, type: 1, fieldUIType: 'Text', description: {} },
    fldAccount: {
      name: 'account_link', isPrimary: false, type: 18, fieldUIType: 'SingleLink',
      property: { tableId: 'tblA', multiple: false, viewId: '', baseToken: '' }, description: {},
    },
    fldBudgetMicros: { name: 'budget_micros', isPrimary: false, type: 2, fieldUIType: 'Number', property: { formatter: '#,##0' }, description: {} },
    fldBudget: {
      name: 'budget', isPrimary: false, type: 20, fieldUIType: 'Formula',
      property: { formatter: '0.00', formula: 'bitable::$table[tblB].$field[fldBudgetMicros]/1000000' }, description: {},
    },
  };
  const accountViews = {
    vewAll: {
      id: 'vewAll', name: 'All Accounts', type: 1, publicLevel: 0, bizType: 0,
      property: {
        fields: ['fldKey', 'fldStatus', 'fldTags', 'fldUrl'],
        filterInfo: { conjunction: 'and', conditions: [{ conditionId: 'con1', fieldId: 'fldStatus', fieldType: 3, operator: 'is', value: ['optActive'] }] },
        sortInfo: [{ fieldId: 'fldKey', desc: false }],
        group: [],
        colInfos: { fldKey: { width: 180, hidden: false }, fldUrl: { width: 180, hidden: true } },
        rowHeightLevel: 1,
        frozenColCount: 1,
        cardViewSetting: null,
        hierarchyConfig: null,
        colorInfo: null,
      },
    },
  };
  const campaignViews = {
    vewCampaign: {
      id: 'vewCampaign', name: 'Campaigns', type: 1, publicLevel: 0, bizType: 0,
      property: {
        fields: ['fldCampaign', 'fldAccount', 'fldBudgetMicros', 'fldBudget'],
        filterInfo: null,
        sortInfo: [],
        group: [{ fieldId: 'fldAccount', desc: true }],
        colInfos: {},
        rowHeightLevel: 1,
        frozenColCount: 1,
      },
    },
  };

  const snapshots = [
    snapshot({
      tableId: 'tblA', tableMap, primaryKey: 'fldKey', fields: accountFields, views: accountViews, viewOrder: ['vewAll'],
      records: {
        recA: {
          fldKey: { value: [{ type: 'text', text: 'a1' }] },
          fldStatus: { value: 'optActive' },
          fldTags: { value: ['optA', 'optB'] },
          fldUrl: { value: [{ type: 'url', text: 'Example', link: 'https://example.com' }] },
        },
      },
    }),
    snapshot({
      tableId: 'tblB', tableMap, primaryKey: 'fldCampaign', fields: campaignFields, views: campaignViews, viewOrder: ['vewCampaign'],
      records: {
        recB1: {
          fldCampaign: { value: [{ type: 'text', text: 'c1' }] },
          fldAccount: null,
          fldBudgetMicros: { value: 1_000_000 },
          fldBudget: null,
        },
      },
    }),
    snapshot({
      tableId: 'tblB', tableMap, primaryKey: 'fldCampaign', fields: campaignFields, views: campaignViews, viewOrder: ['vewCampaign'],
      records: {
        recB2: {
          fldCampaign: { value: [{ type: 'text', text: 'c2' }] },
          fldAccount: null,
          fldBudgetMicros: { value: 2_000_000 },
          fldBudget: null,
        },
      },
    }),
  ];

  await writeFile(file, JSON.stringify({
    gzipSnapshot: gzipBase64(snapshots),
    gzipExtraInfo: gzipBase64({ maxAutoNum: 2 }),
    gzipBaseRole: gzipBase64([{ roleId: 'rolA', name: 'Reader', tableRoleMap: {} }]),
    gzipAccessConfig: gzipBase64({ defaultConfig: {} }),
    gzipDashboard: gzipBase64([{ dashboardID: 1, snapshot: '', charts: [] }]),
    gzipAutomation: gzipBase64([{ id: 2, trigger_name: 'Weekly Notify' }]),
    sign: 'fixture-signature',
  }), 'utf8');
}

test('export source adapter exposes consolidator-compatible tables, fields, records and rich view metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-source-client-'));
  const file = join(dir, 'source.base');
  await writeFixture(file);

  try {
    const client = await createLarkBaseExportSourceClient(file);
    const tables = await client.listTables();
    assert.deepEqual(tables.map((table) => table.name), ['Accounts', 'Campaigns']);

    const accountFields = await client.listFields({ tableId: 'tblA' });
    assert.equal(accountFields.find((field) => field.fieldName === 'account_key').isPrimary, true);
    assert.equal(accountFields.find((field) => field.fieldName === 'status').description, 'Account status');

    const accountRecords = await client.listRecords({ tableId: 'tblA' });
    assert.deepEqual(accountRecords[0].fields, {
      account_key: 'a1',
      status: 'active',
      tags: ['A', 'B'],
      url: { text: 'Example', link: 'https://example.com' },
    });

    const relation = (await client.listFields({ tableId: 'tblB' })).find((field) => field.fieldName === 'account_link');
    const formula = (await client.listFields({ tableId: 'tblB' })).find((field) => field.fieldName === 'budget');
    const micros = (await client.listFields({ tableId: 'tblB' })).find((field) => field.fieldName === 'budget_micros');
    assert.equal(relation.property.table_id, 'tblA');
    assert.equal(formula.property.formula_expression, 'bitable::$table[tblB].$field[fldBudgetMicros]/1000000');
    assert.equal(micros.property.formatter, '1,000');

    const campaignRecords = await client.listRecords({ tableId: 'tblB' });
    assert.deepEqual(campaignRecords.map((record) => record.fields.campaign_key), ['c1', 'c2']);

    const view = await client.getView({ tableId: 'tblA', viewId: 'vewAll' });
    assert.deepEqual(view.property.hiddenFields, ['fldUrl']);
    assert.deepEqual(view.property.fieldOrder, ['fldKey', 'fldStatus', 'fldTags', 'fldUrl']);
    assert.deepEqual(view.property.sortInfo, [{ fieldId: 'fldKey', desc: false }]);
    assert.equal(view.property.filterInfo.conditions[0].value[0], 'optActive');

    const resources = client.getExportResources();
    assert.equal(resources.dashboards.length, 1);
    assert.equal(resources.workflows.length, 1);
    assert.equal(resources.roles.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('export source model dedupes duplicate snapshot chunks without remote requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-export-source-model-'));
  const file = join(dir, 'source.base');
  await writeFixture(file);

  try {
    const result = await inspectLarkBaseExportSourceModel(file);
    assert.equal(result.ok, true);
    assert.equal(result.tables, 2);
    assert.equal(result.fields, 8);
    assert.equal(result.records, 3);
    assert.equal(result.views, 2);
    assert.deepEqual(result.diagnostics.duplicateSnapshotTableIds, ['tblB']);
    assert.equal(result.diagnostics.rawViewFeatureCounts.filtered, 1);
    assert.equal(result.diagnostics.rawViewFeatureCounts.sorted, 1);
    assert.equal(result.diagnostics.rawViewFeatureCounts.grouped, 1);
    assert.equal(result.diagnostics.rawViewFeatureCounts.hiddenFields, 1);
    assert.equal(result.remoteRequestCount, 0);
    assert.equal(result.remoteMutationCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
