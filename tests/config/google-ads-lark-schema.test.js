import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_ADS_EXPECTED_CANONICAL_DEFINITION_COUNT,
  GOOGLE_ADS_EXPECTED_LINK_FIELD_COUNT,
  GOOGLE_ADS_EXPECTED_NEW_CANONICAL_TABLE_COUNT,
  GOOGLE_ADS_EXPECTED_PHYSICAL_VIEW_COUNT,
  GOOGLE_ADS_EXPECTED_RAW_FIELD_COUNT,
  GOOGLE_ADS_EXPECTED_RAW_TABLE_COUNT,
  GOOGLE_ADS_LARK_SCHEMA,
  GOOGLE_ADS_RAW_TABLE_KEYS,
  GOOGLE_ADS_RELATIONS,
  GOOGLE_ADS_SELECT_OPTION_RULES,
  GOOGLE_ADS_VIEW_CONTRACT,
  validateGoogleAdsLarkSchema,
  validateGoogleAdsRelationTargets,
} from '../../packages/config/src/google-ads-lark-schema.js';
import { GOOGLE_ADS_CANONICAL_EXTENSION_DATA } from '../../packages/config/src/google-ads-canonical-extension-data.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';

test('derives the exact 13 RAW tables, 208 RAW fields and one new Canonical table', () => {
  assert.equal(validateGoogleAdsLarkSchema(), true);
  assert.equal(validateGoogleAdsRelationTargets(), true);
  const raw = GOOGLE_ADS_LARK_SCHEMA.filter((table) => table.googleAds.role === 'raw');
  const newCanonical = GOOGLE_ADS_LARK_SCHEMA.filter((table) => table.googleAds.role === 'new_canonical');
  const existingCanonical = GOOGLE_ADS_LARK_SCHEMA.filter((table) => (
    table.googleAds.role === 'existing_canonical_extension'
  ));
  assert.equal(raw.length, GOOGLE_ADS_EXPECTED_RAW_TABLE_COUNT);
  assert.equal(raw.flatMap((table) => table.fields).length, GOOGLE_ADS_EXPECTED_RAW_FIELD_COUNT);
  assert.equal(newCanonical.length, GOOGLE_ADS_EXPECTED_NEW_CANONICAL_TABLE_COUNT);
  assert.deepEqual(newCanonical.map((table) => table.logicalName), ['MKT_Ads_AssetGroups']);
  assert.equal(existingCanonical.length, 6);
  assert.equal(GOOGLE_ADS_RAW_TABLE_KEYS.length, 13);
  assert.ok(GOOGLE_ADS_LARK_SCHEMA.every((table) => LARK_TABLE_ENV[table.key] === table.envName));
});

test('keeps one Primary Text field first and every Google Ads identifier as Text', () => {
  const raw = GOOGLE_ADS_LARK_SCHEMA.filter((table) => table.googleAds.role === 'raw');
  for (const table of raw) {
    assert.equal(table.fields[0].primary, true, table.logicalName);
    assert.equal(table.fields[0].type, 1, table.logicalName);
    assert.equal(table.fields.filter((field) => field.primary).length, 1, table.logicalName);
    for (const field of table.fields) {
      if (/(^|_)(id|ids)$/iu.test(field.fieldName)) {
        assert.equal(field.type, 1, `${table.logicalName}.${field.fieldName}`);
      }
    }
  }
});

test('resolves controlled options and preserves Google entity semantics', () => {
  const byName = new Map(GOOGLE_ADS_LARK_SCHEMA.map((table) => [table.logicalName, table]));
  const fields = (tableName) => new Map(byName.get(tableName).fields.map((field) => [field.fieldName, field]));
  assert.deepEqual(
    fields('RAW_Google_Ads_Account_Links').get('link_status').property.options.map((option) => option.name),
    ['selectable', 'not_selectable', 'unknown'],
  );
  assert.equal(fields('RAW_Google_Ads_Account_Links').get('link_status').type, 3);
  assert.deepEqual(
    fields('RAW_Google_Ads_Daily').get('report_level').property.options.map((option) => option.name),
    ['account', 'campaign', 'ad_group', 'ad', 'asset_group', 'asset'],
  );
  assert.ok(fields('RAW_Google_Ads_Daily').get('ad_channel').property.options
    .some((option) => option.name === 'google_performance_max_ads'));
  assert.ok(fields('RAW_Google_Ads_Ads').has('ad_id'));
  assert.ok(fields('RAW_Google_Ads_Assets').has('asset_id'));
  assert.ok(fields('RAW_Google_Ads_Asset_Groups').has('asset_group_id'));
  assert.ok(fields('RAW_Google_Ads_Ad_Assets').has('raw_ad_asset_link_key'));
});

test('retains the 44 canonical definitions while deferring Formula implementation', () => {
  assert.equal(
    GOOGLE_ADS_CANONICAL_EXTENSION_DATA.length,
    GOOGLE_ADS_EXPECTED_CANONICAL_DEFINITION_COUNT,
  );
  assert.ok(GOOGLE_ADS_CANONICAL_EXTENSION_DATA.some((row) => row.field === 'budget' && row.formulaHint));
  assert.equal(
    GOOGLE_ADS_LARK_SCHEMA.flatMap((table) => table.fields).some((field) => field.uiType === 'Formula'),
    false,
  );
  assert.ok(GOOGLE_ADS_SELECT_OPTION_RULES.some((rule) => rule.option === 'google_other_ads'));
});

test('builds seven exact Link fields and 19 table-scoped Views', () => {
  assert.equal(GOOGLE_ADS_RELATIONS.length, GOOGLE_ADS_EXPECTED_LINK_FIELD_COUNT);
  assert.ok(GOOGLE_ADS_RELATIONS.some((relation) => (
    relation.sourceTableKey === 'mktAdsAds'
    && relation.field.fieldName === 'creative_links'
    && relation.field.property.multiple === true
    && relation.targetTableKey === 'mktAdsCreatives'
  )));
  assert.ok(GOOGLE_ADS_RELATIONS.some((relation) => (
    relation.sourceTableKey === 'mktAdsAssetGroups'
    && relation.field.fieldName === 'campaign_link'
    && relation.targetTableKey === 'mktAdsCampaigns'
  )));
  const views = GOOGLE_ADS_VIEW_CONTRACT.flatMap((table) => table.views);
  assert.equal(views.length, GOOGLE_ADS_EXPECTED_PHYSICAL_VIEW_COUNT);
  assert.equal(views.filter((view) => view.name === 'Google Ads RAW Errors').length, 13);
  assert.ok(views.some((view) => view.name === 'Google Ads Daily 30D'));
  assert.ok(views.some((view) => view.name === 'Conversion Actions UAT'));
});

test('rejects incomplete and destructive schema variants', () => {
  assert.throws(
    () => validateGoogleAdsLarkSchema(GOOGLE_ADS_LARK_SCHEMA.slice(1)),
    (error) => error.code === 'GOOGLE_ADS_LARK_SCHEMA_INVALID',
  );
  const mutated = structuredClone(GOOGLE_ADS_LARK_SCHEMA);
  const firstRaw = mutated.find((table) => table.googleAds.role === 'raw');
  firstRaw.fields[0].type = 2;
  assert.throws(
    () => validateGoogleAdsLarkSchema(mutated),
    (error) => error.code === 'GOOGLE_ADS_LARK_SCHEMA_INVALID',
  );
});
