import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGoogleAdsLarkSchema } from '../../packages/application/src/use-cases/apply-google-ads-lark-schema.js';
import {
  createGoogleAdsReadyState,
  googleAdsStatefulClient,
} from '../helpers/google-ads-schema-state.js';

test('applies 13 RAW tables, one Asset Group table, extensions, relations and Views with zero drift', async () => {
  const state = createGoogleAdsReadyState();
  const result = await applyGoogleAdsLarkSchema({
    client: googleAdsStatefulClient(state),
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'SCHEMA_APPLY_PASS');
  assert.equal(result.summary.createdRawTables, 13);
  assert.equal(result.summary.createdCanonicalTables, 1);
  assert.equal(result.summary.createdRelationFields, 7);
  assert.equal(result.summary.createdViews, 19);
  assert.equal(result.summary.remainingActions, 0);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.summary.blockingManualActions, 0);
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.renameActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.equal(result.createdTables.length, 14);
  assert.ok(result.createdTables.every((table) => (
    table.tableName.startsWith('RAW_Google_Ads_') || table.tableName === 'MKT_Ads_AssetGroups'
  )));
  assert.equal(state.tables.filter((table) => table.name === 'MKT_Ads_Accounts').length, 1);
  assert.equal(state.tables.filter((table) => table.name === 'MKT_Ads_Ads').length, 1);
  assert.equal(state.writes.some((write) => write.kind === 'record_write'), false);
  assert.equal(state.writes.some((write) => write.kind === 'rename_table'), false);
  assert.equal(Object.keys(result.environmentUpdates).length, 20);
  assert.equal(result.safety.connectorChanged, false);
  assert.equal(result.safety.scheduleChanged, false);
});

test('is idempotent after a successful Google Ads Schema Apply', async () => {
  const state = createGoogleAdsReadyState();
  const client = googleAdsStatefulClient(state);
  await applyGoogleAdsLarkSchema({ client, env: {} });
  const writesBefore = state.writes.length;
  const rerun = await applyGoogleAdsLarkSchema({ client, env: {} });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.summary.appliedActions, 0);
  assert.equal(rerun.summary.createdRawTables, 0);
  assert.equal(rerun.summary.createdCanonicalTables, 0);
  assert.equal(rerun.summary.createdRelationFields, 0);
  assert.equal(rerun.summary.createdViews, 0);
  assert.equal(rerun.summary.updatedViews, 0);
  assert.equal(rerun.summary.remainingActions, 0);
  assert.equal(state.writes.length, writesBefore);
});

test('fails before the first write when Meta or Canonical compatibility is not ready', async () => {
  const state = createGoogleAdsReadyState({
    missingCoreField: { table: 'MKT_Ads_Accounts', field: 'account_id' },
  });
  await assert.rejects(
    applyGoogleAdsLarkSchema({ client: googleAdsStatefulClient(state), env: {} }),
    (error) => error.code === 'GOOGLE_ADS_SCHEMA_APPLY_PLAN_INVALID'
      && error.details.stage === 'initial_preview'
      && error.details.problems.includes('preview_not_ready'),
  );
  assert.equal(state.writes.length, 0);
});

test('reports confirmed progress and reruns safely after a Field failure', async () => {
  const state = createGoogleAdsReadyState({ failFirstCreateField: true });
  const client = googleAdsStatefulClient(state);
  await assert.rejects(
    applyGoogleAdsLarkSchema({ client, env: {} }),
    (error) => {
      assert.equal(error.code, 'TEST_GOOGLE_FIELD_FAILED');
      assert.equal(error.details.stage, 'base_schema');
      assert.equal(error.details.googleAdsSchemaAction.kind, 'create_field');
      assert.equal(error.details.appliedActionCount, 14);
      return true;
    },
  );
  assert.equal(state.writes.filter((write) => write.kind === 'create_table').length, 14);
  assert.equal(state.writes.some((write) => write.kind === 'create_view'), false);

  const rerun = await applyGoogleAdsLarkSchema({ client, env: {} });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.summary.remainingActions, 0);
  assert.equal(state.tables.filter((table) => table.name === 'MKT_Ads_AssetGroups').length, 1);
  assert.equal(state.tables.filter((table) => table.name.startsWith('RAW_Google_Ads_')).length, 13);
});

test('recovers when a View was created but its first filter update failed', async () => {
  const state = createGoogleAdsReadyState({ failFirstViewUpdate: true });
  const client = googleAdsStatefulClient(state);
  await assert.rejects(
    applyGoogleAdsLarkSchema({ client, env: {} }),
    (error) => {
      assert.equal(error.code, 'TEST_GOOGLE_VIEW_FAILED');
      assert.equal(error.details.stage, 'google_ads_view_apply');
      assert.equal(error.details.appliedSchemaActionCount > 0, true);
      return true;
    },
  );
  assert.equal(state.writes.filter((write) => write.kind === 'create_view').length, 1);

  const rerun = await applyGoogleAdsLarkSchema({ client, env: {} });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.summary.remainingActions, 0);
  assert.equal(state.writes.filter((write) => write.kind === 'create_view').length, 19);
});
