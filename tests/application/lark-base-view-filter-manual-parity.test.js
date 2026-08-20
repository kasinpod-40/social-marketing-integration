import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLarkBaseViewFilterParity,
  projectLarkBaseSourceForAutomaticViewFilterParity,
} from '../../packages/application/src/use-cases/lark-base-view-filter-parity.js';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

const dynamicFilter = () => ({
  conjunction: 'and',
  conditions: [
    { fieldId: 'fld_platform', fieldType: 3, operator: 'is', value: ['google_ads'] },
    { fieldId: 'fld_date', fieldType: 5, operator: 'is', value: ['TheLastMonth'] },
  ],
});

test('classifies only the unsupported dynamic Date token as manual', () => {
  assert.equal(classifyLarkBaseViewFilterParity(dynamicFilter()).ownership, 'ui-manual-unsupported-view-dynamic-date-token');
  assert.equal(classifyLarkBaseViewFilterParity({
    conjunction: 'and',
    conditions: [{ fieldId: 'fld_date', fieldType: 5, operator: 'is', value: ['Today'] }],
  }).ownership, 'automatic');
  assert.equal(classifyLarkBaseViewFilterParity({
    conjunction: 'and',
    conditions: [{ fieldId: 'fld_text', fieldType: 1, operator: 'is', value: ['TheLastMonth'] }],
  }).ownership, 'automatic');
  assert.equal(classifyLarkBaseViewFilterParity({
    conjunction: 'and',
    conditions: [{ fieldId: 'fld_date', fieldType: 5, operator: 'is', value: ['UnknownRelativeToken'] }],
  }).ownership, 'automatic');
});

test('projects the entire mixed platform + TheLastMonth filter out of automatic writes', async () => {
  const source = {
    listTables: async () => [{ tableId: 'src_ads', name: '📈 MKT_Ads_Daily' }],
    getView: async () => ({
      viewId: 'vew_google_30d', viewName: '📈 Google Ads Daily 30D', viewType: 'grid', publicLevel: 'Public',
      property: { hiddenFields: ['fld_hidden'], filterInfo: dynamicFilter() },
    }),
  };
  const projection = projectLarkBaseSourceForAutomaticViewFilterParity(source);
  await projection.client.listTables();
  const view = await projection.client.getView({ tableId: 'src_ads', viewId: 'vew_google_30d' });
  assert.equal(view.property.filterInfo, null);
  assert.deepEqual(view.property.hiddenFields, ['fld_hidden']);
  assert.deepEqual(projection.getRequirements(), [{
    ownership: 'ui-manual-unsupported-view-dynamic-date-token',
    tableName: '📈 MKT_Ads_Daily',
    viewName: '📈 Google Ads Daily 30D',
    conditionCount: 2,
    dynamicDateTokenCount: 1,
    dynamicDateTokens: ['TheLastMonth'],
  }]);
});

class ReadClient {
  constructor(filterInfo) {
    this.filterInfo = filterInfo;
  }
  async listTables() { return [{ tableId: this === sourceClient ? 'src_ads' : 'tgt_ads', name: '📈 MKT_Ads_Daily' }]; }
  async listFields() {
    const prefix = this === sourceClient ? 'src' : 'tgt';
    return [
      { fieldId: `${prefix}_key`, fieldName: 'key', type: 1, uiType: 'Text', description: '', isPrimary: true, property: null },
      { fieldId: `${prefix}_platform`, fieldName: 'platform', type: 3, uiType: 'SingleSelect', description: '', isPrimary: false, property: { options: [{ id: `${prefix}_google`, name: 'google_ads', color: 0 }] } },
      { fieldId: `${prefix}_date`, fieldName: 'metric_date', type: 5, uiType: 'DateTime', description: '', isPrimary: false, property: { date_formatter: 'yyyy/MM/dd', auto_fill: false } },
    ];
  }
  async listRecords() { return [{ recordId: this === sourceClient ? 'src_rec' : 'tgt_rec', fields: { key: 'k1', platform: 'google_ads', metric_date: 1 } }]; }
  async listViews() { return [{ viewId: this === sourceClient ? 'src_view' : 'tgt_view', viewName: '📈 Google Ads Daily 30D', viewType: 'grid', publicLevel: 'Public', property: {} }]; }
  async getView() {
    const prefix = this === sourceClient ? 'src' : 'tgt';
    return {
      viewId: `${prefix}_view`, viewName: '📈 Google Ads Daily 30D', viewType: 'grid', publicLevel: 'Public',
      property: { hiddenFields: [], filterInfo: this.filterInfo },
    };
  }
}

let sourceClient;
let targetClient;

test('canonical verifier keeps TheLastMonth View filter as explicit manual parity instead of false automatic mismatch', async () => {
  sourceClient = new ReadClient(dynamicFilter());
  targetClient = new ReadClient(null);
  const result = await verifyLarkBaseCloneCanonicalParity({ sourceClient, targetClient, expectedTableNames: ['📈 MKT_Ads_Daily'] });
  assert.equal(result.ok, true);
  assert.equal(result.summary.manualViewFilterRequirements, 1);
  assert.equal(result.manualParity.viewFilters.required, true);
  assert.equal(result.manualParity.viewFilters.requirements[0].viewName, '📈 Google Ads Daily 30D');
});

test('canonical verifier still fails closed for supported Date filter drift', async () => {
  sourceClient = new ReadClient({
    conjunction: 'and',
    conditions: [{ fieldId: 'src_date', fieldType: 5, operator: 'is', value: ['Today'] }],
  });
  targetClient = new ReadClient(null);
  const result = await verifyLarkBaseCloneCanonicalParity({ sourceClient, targetClient, expectedTableNames: ['📈 MKT_Ads_Daily'] });
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.code === 'CANONICAL_VERIFY_VIEW_CONFIG_MISMATCH'));
});
