import test from 'node:test';
import assert from 'node:assert/strict';
import { previewGoogleAdsLarkSchema } from '../../packages/application/src/use-cases/preview-google-ads-lark-schema.js';
import {
  createGoogleAdsReadyState,
  createPreMetaGoogleAdsState,
  googleAdsStatefulClient,
} from '../helpers/google-ads-schema-state.js';

test('keeps Preview read-only and blocks before Meta/shared cutover', async () => {
  const state = createPreMetaGoogleAdsState();
  const result = await previewGoogleAdsLarkSchema({
    client: googleAdsStatefulClient(state, { readOnly: true }),
    env: {},
  });
  assert.equal(result.mode, 'read_only_preview');
  assert.equal(result.readyForApplyAuthorization, false);
  assert.equal(result.metaDependencyReady, false);
  assert.ok(result.conflicts.some((conflict) => conflict.code === 'GOOGLE_ADS_META_DEPENDENCY_NOT_READY'));
  assert.ok(result.conflicts.some((conflict) => conflict.code === 'GOOGLE_ADS_META_LEGACY_TABLE_REMAINS'));
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.renameActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.equal(state.writes.length, 0);
});

test('plans exact create-only Google schema after Meta and Canonical core gates pass', async () => {
  const state = createGoogleAdsReadyState();
  const result = await previewGoogleAdsLarkSchema({
    client: googleAdsStatefulClient(state, { readOnly: true }),
    env: {},
  });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.metaDependencyReady, true);
  assert.equal(result.canonicalCoreReady, true);
  assert.equal(result.summary.rawTables, 13);
  assert.equal(result.summary.createTables, 14);
  assert.equal(result.actions.filter((action) => action.kind === 'create_table').length, 14);
  assert.equal(result.actions.filter((action) => action.kind === 'create_relation_field').length, 7);
  assert.equal(result.summary.deferredRelationFields, 3);
  assert.equal(result.summary.createViews, 19);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.blockingManualActions.length, 0);
  assert.equal(result.nonBlockingManualActions.length, 1);
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.renameActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.ok(result.actions.filter((action) => action.kind === 'create_table').every((action) => (
    action.logicalName.startsWith('RAW_Google_Ads_') || action.logicalName === 'MKT_Ads_AssetGroups'
  )));
  assert.equal(state.writes.length, 0);
});

test('blocks Canonical core missing/type mismatch without planning a duplicate Canonical table', async () => {
  const state = createGoogleAdsReadyState({
    missingCoreField: { table: 'MKT_Ads_Accounts', field: 'account_id' },
    coreTypeMismatch: { table: 'MKT_Ads_Daily', field: 'currency', type: 3 },
  });
  const result = await previewGoogleAdsLarkSchema({
    client: googleAdsStatefulClient(state, { readOnly: true }),
    env: {},
  });
  assert.equal(result.readyForApplyAuthorization, false);
  assert.equal(result.canonicalCoreReady, false);
  assert.ok(result.conflicts.some((conflict) => (
    conflict.code === 'GOOGLE_ADS_CANONICAL_CORE_FIELD_MISSING'
    && conflict.fieldName === 'account_id'
  )));
  assert.ok(result.conflicts.some((conflict) => (
    conflict.code === 'GOOGLE_ADS_CANONICAL_CORE_FIELD_TYPE_MISMATCH'
    && conflict.fieldName === 'currency'
  )));
  assert.equal(result.actions.some((action) => (
    action.kind === 'create_table' && action.logicalName === 'MKT_Ads_Accounts'
  )), false);
  assert.equal(state.writes.length, 0);
});

test('blocks google_other_ads when the shared Canonical option already uses google_other', async () => {
  const state = createGoogleAdsReadyState({ useLegacyGoogleOther: true });
  const result = await previewGoogleAdsLarkSchema({
    client: googleAdsStatefulClient(state, { readOnly: true }),
    env: {},
  });
  assert.equal(result.readyForApplyAuthorization, false);
  assert.ok(result.conflicts.some((conflict) => (
    conflict.code === 'GOOGLE_ADS_OTHER_CHANNEL_OPTION_DECISION_REQUIRED'
  )));
  assert.equal(state.writes.length, 0);
});
