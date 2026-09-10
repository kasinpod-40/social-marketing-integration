import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runMktAdsCampaignSummaryRetentionOperator } from '../../packages/application/src/use-cases/run-mkt-ads-campaign-summary-retention-operator.js';
import {
  buildSharedTableLarkSchemaFromCsv,
  buildSharedTableViewContractFromCsv,
} from '../../packages/config/src/shared-table-lark-schema.js';

const ROOT = new URL('../../', import.meta.url);

async function contract() {
  const base = new URL('docs/shared-table-blueprint-v0.12.1/', ROOT);
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv, viewPlanCsv] = await Promise.all([
    readFile(new URL('table-inventory.csv', base), 'utf8'),
    readFile(new URL('fields.csv', base), 'utf8'),
    readFile(new URL('migration-map.csv', base), 'utf8'),
    readFile(new URL('view-plan.csv', base), 'utf8'),
  ]);
  return {
    schema: buildSharedTableLarkSchemaFromCsv({ tableInventoryCsv, fieldsCsv, migrationMapCsv }),
    views: buildSharedTableViewContractFromCsv({ viewPlanCsv }),
  };
}

test('one-command operator runs the exact Paid-only stages in order', async () => {
  const calls = [];
  let previews = 0;
  let tableName = 'MKT_Ads_Campaign_Summary';
  const targetGroup = [{ field: 'period_month_th', desc: true }];
  const targetSort = [];
  const targetVisible = [
    'campaign_summary_key',
    'campaign_name', 'platform', 'status', 'period_month_th', 'period_start', 'period_end',
    'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'conversion_value', 'cpa', 'roas',
    'currency', 'account_id', 'campaign_id', 'last_synced_at', 'period_kind',
  ];
  const viewState = new Map(['📊 Overview', '🔵 Meta', '🔴 Google', '⚫ TikTok'].map((name, index) => [
    `viw${index}`,
    {
      viewId: `viw${index}`,
      viewName: name,
      groupConfig: index === 0 ? [] : structuredClone(targetGroup),
      sortConfig: structuredClone(targetSort),
      visibleFields: structuredClone(targetVisible),
    },
  ]));
  const result = await runMktAdsCampaignSummaryRetentionOperator({
    execute: true,
    client: {
      async listTables() {
        calls.push('list_tables');
        return [{ tableId: 'tblSummary', name: tableName }];
      },
      async renameTable({ tableId, name }) {
        calls.push('rename_table');
        assert.equal(tableId, 'tblSummary');
        tableName = name;
        return { tableId, name };
      },
      async listViews({ tableId }) {
        calls.push('view_presentation');
        assert.equal(tableId, 'tblSummary');
        return [...viewState.values()].map(({ viewId, viewName }) => ({ viewId, viewName }));
      },
      async getViewGroup({ viewId }) { return { groupConfig: structuredClone(viewState.get(viewId).groupConfig) }; },
      async setViewGroup({ viewId, groupConfig }) {
        calls.push('set_group');
        viewState.get(viewId).groupConfig = structuredClone(groupConfig);
      },
      async getViewSort({ viewId }) { return { sortConfig: structuredClone(viewState.get(viewId).sortConfig) }; },
      async setViewSort() { throw new Error('unchanged sort must not be rewritten'); },
      async getViewVisibleFields({ viewId }) {
        return { visibleFields: structuredClone(viewState.get(viewId).visibleFields) };
      },
      async setViewVisibleFields() { throw new Error('unchanged visible fields must not be rewritten'); },
    },
    db: {
      prepare(sql) {
        assert.match(sql, /FROM sync_locks/u);
        return { bind() { return { async first() { calls.push('lock'); return { active_locks: 0 }; } }; } };
      },
    },
    env: { LARK_TABLE_MKT_ADS_DAILY: 'tblDaily' },
    contract: await contract(),
    repository: {},
    syncEngine: {},
    customerKey: 'chemistry_k',
    now: () => Date.parse('2026-09-10T01:00:00.000Z'),
    async previewSchema() {
      previews += 1;
      calls.push(previews === 1 ? 'preview' : 'verify');
      return {
        actions: [], conflicts: [], manualActions: [], readyForApplyAuthorization: true,
      };
    },
    async applySchema(input) {
      calls.push('schema_views');
      assert.equal(input.schema.length, 1);
      assert.equal(input.views.length, 4);
      return { environmentUpdates: { LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY: 'tblSummary' } };
    },
    async runMaintenance(input) {
      calls.push('materialize_retention');
      assert.deepEqual(input.tables, {
        mktAdsCampaignSummary: 'tblSummary',
        mktAdsDaily: 'tblDaily',
      });
      return { status: 'completed' };
    },
    async materializeHistory(input) {
      calls.push('history');
      assert.equal(input.historyStart, undefined);
      return {
        months: 4, campaigns: 185, created: 140, updated: 0, skipped: 45,
        readback: { reconciled: true },
      };
    },
    async rerunHistory() {
      calls.push('history_idempotency_rerun');
      return {
        months: 4, campaigns: 185, created: 0, updated: 0, skipped: 185,
        readback: { reconciled: true },
      };
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'preview', 'lock', 'schema_views', 'list_tables', 'rename_table', 'list_tables',
    'view_presentation', 'set_group', 'materialize_retention', 'history', 'history_idempotency_rerun', 'verify',
  ]);
  assert.deepEqual(result.tablePresentation, {
    tableId: 'tblSummary', name: '📊 MKT_Ads_Campaign_Summary', renamed: true, preservedTableId: true,
  });
  assert.equal(result.presentation.groupBy, 'period_month_th');
  assert.equal(result.viewPresentation.mutatedViews, 1);
  assert.deepEqual(result.viewPresentation.views[0].actions, ['group']);
  assert.deepEqual(result.safety.allowedTables, ['MKT_Ads_Campaign_Summary', 'MKT_Ads_Daily']);
  assert.equal(result.safety.d1Mutations, 0);
  assert.equal(result.safety.organicMutations, 0);
});
