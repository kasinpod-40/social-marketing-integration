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
  const result = await runMktAdsCampaignSummaryRetentionOperator({
    execute: true,
    client: {},
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
    async rerunMaterialization() {
      calls.push('idempotency_rerun');
      return {
        campaigns: 45, created: 0, updated: 0, skipped: 45,
        readback: { reconciled: true },
      };
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'preview', 'lock', 'schema_views', 'materialize_retention', 'idempotency_rerun', 'verify',
  ]);
  assert.deepEqual(result.safety.allowedTables, ['MKT_Ads_Campaign_Summary', 'MKT_Ads_Daily']);
  assert.equal(result.safety.d1Mutations, 0);
  assert.equal(result.safety.organicMutations, 0);
});
