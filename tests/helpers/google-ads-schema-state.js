import { GOOGLE_ADS_CANONICAL_CORE } from '../../packages/config/src/google-ads-canonical-core.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const META_TABLES = Object.freeze([
  ['tblMetaAccounts', 'RAW_Meta_Organic_Accounts'],
  ['tblMetaContent', 'RAW_Meta_Organic_Content'],
  ['tblMetaMetrics', 'RAW_Meta_Organic_Metrics'],
  ['tblAdsEntities', 'RAW_Ads_Entities'],
  ['tblAdsDailyShared', 'RAW_Ads_Daily'],
  ['tblAccountDaily', 'MKT_Account_Daily'],
]);

const CANONICAL_TABLE_IDS = Object.freeze({
  MKT_Ads_Accounts: 'tblCanonicalAccounts',
  MKT_Ads_Campaigns: 'tblCanonicalCampaigns',
  MKT_Ads_AdGroups: 'tblCanonicalAdGroups',
  MKT_Ads_Ads: 'tblCanonicalAds',
  MKT_Ads_Creatives: 'tblCanonicalCreatives',
  MKT_Ads_Daily: 'tblCanonicalDaily',
});

export function createGoogleAdsReadyState(input = {}) {
  const tables = [{ tableId: 'tblTikTokNative', name: '🎵 RAW_TikTok_Creator_Videos' }];
  if (!input.omitMetaDependencies) {
    tables.push(...META_TABLES.map(([tableId, name]) => ({ tableId, name })));
  }
  for (const [name, tableId] of Object.entries(CANONICAL_TABLE_IDS)) {
    if (input.omitCanonicalTable === name) continue;
    tables.push({ tableId, name });
  }
  if (input.includeLegacyMetaTables) {
    tables.push(
      { tableId: 'tblLegacyCampaigns', name: 'RAW_TikTok_Business_Campaigns' },
      { tableId: 'tblLegacyGoogle', name: 'RAW_Google_Campaigns' },
    );
  }

  const fields = new Map();
  const views = new Map();
  for (const [tableName, expectedFields] of Object.entries(GOOGLE_ADS_CANONICAL_CORE)) {
    const tableId = CANONICAL_TABLE_IDS[tableName];
    if (!tables.some((table) => table.tableId === tableId)) continue;
    fields.set(tableId, expectedFields.map(([fieldName, type], index) => fieldShape({
      fieldId: `fld${token(tableName)}${index + 1}`,
      fieldName,
      type: input.coreTypeMismatch?.table === tableName
        && input.coreTypeMismatch?.field === fieldName
        ? input.coreTypeMismatch.type
        : type,
      uiType: uiType(type),
      isPrimary: index === 0,
      property: propertyForCoreField(fieldName, type, input),
    })));
    views.set(tableId, [defaultView(tableId)]);
  }
  for (const [tableId] of META_TABLES) {
    fields.set(tableId, []);
    views.set(tableId, []);
  }
  fields.set('tblTikTokNative', []);
  views.set('tblTikTokNative', []);

  if (input.missingCoreField) {
    const tableId = CANONICAL_TABLE_IDS[input.missingCoreField.table];
    fields.set(
      tableId,
      (fields.get(tableId) ?? []).filter((field) => field.fieldName !== input.missingCoreField.field),
    );
  }

  return {
    tables,
    fields,
    views,
    writes: [],
    nextTable: 1,
    nextField: 1,
    nextView: 1,
    failFirstCreateField: input.failFirstCreateField === true,
    failFirstViewUpdate: input.failFirstViewUpdate === true,
  };
}

export function createPreMetaGoogleAdsState() {
  const state = createGoogleAdsReadyState({ omitMetaDependencies: true, includeLegacyMetaTables: true });
  state.tables.push(
    { tableId: 'tblLegacyAdGroups', name: 'RAW_TikTok_Business_AdGroups' },
    { tableId: 'tblLegacyAds', name: 'RAW_TikTok_Business_Ads' },
    { tableId: 'tblLegacyLists', name: 'RAW_Google_Customer_Lists' },
  );
  return state;
}

export function googleAdsStatefulClient(state, options = {}) {
  const readOnly = options.readOnly === true;
  const client = {
    async listTables() { return structuredClone(state.tables); },
    async listFields({ tableId }) { return structuredClone(state.fields.get(tableId) ?? []); },
    async listViews({ tableId }) { return structuredClone(state.views.get(tableId) ?? []); },
    async getView({ tableId, viewId }) {
      return structuredClone((state.views.get(tableId) ?? []).find((view) => view.viewId === viewId));
    },
  };
  if (readOnly) return client;

  return Object.assign(client, {
    async createTable({ name, fields: desiredFields, defaultViewName }) {
      const tableId = `tblGoogleNew${state.nextTable++}`;
      const table = { tableId, name };
      state.tables.push(table);
      state.fields.set(tableId, desiredFields.map((field, index) => fieldShape({
        ...field,
        fieldId: `fldGoogleNew${state.nextField++}`,
        isPrimary: index === 0,
      })));
      state.views.set(tableId, [{
        viewId: `vewGoogleDefault${state.nextView++}`,
        viewName: defaultViewName,
        viewType: 'grid',
        property: { hiddenFields: [], filterInfo: null },
      }]);
      state.writes.push({ kind: 'create_table', tableId, name });
      return structuredClone(table);
    },
    async createField({ tableId, field }) {
      if (state.failFirstCreateField) {
        state.failFirstCreateField = false;
        throw permanentError('simulated Google field failure', { code: 'TEST_GOOGLE_FIELD_FAILED' });
      }
      const created = fieldShape({
        ...field,
        fieldId: `fldGoogleNew${state.nextField++}`,
        isPrimary: false,
      });
      const tableFields = state.fields.get(tableId) ?? [];
      tableFields.push(created);
      state.fields.set(tableId, tableFields);
      state.writes.push({ kind: field.type === 18 ? 'create_relation_field' : 'create_field', tableId, fieldName: field.fieldName });
      return structuredClone(created);
    },
    async updateField({ tableId, fieldId, field }) {
      const tableFields = state.fields.get(tableId) ?? [];
      const index = tableFields.findIndex((candidate) => candidate.fieldId === fieldId);
      if (index < 0) throw new Error(`missing field ${fieldId}`);
      tableFields[index] = fieldShape({
        ...field,
        fieldId,
        isPrimary: tableFields[index].isPrimary === true,
      });
      state.writes.push({ kind: 'update_field', tableId, fieldId, fieldName: field.fieldName });
      return structuredClone(tableFields[index]);
    },
    async createView({ tableId, viewName, viewType }) {
      const view = {
        viewId: `vewGoogleNew${state.nextView++}`,
        viewName,
        viewType,
        property: { hiddenFields: [], filterInfo: null },
      };
      const tableViews = state.views.get(tableId) ?? [];
      tableViews.push(view);
      state.views.set(tableId, tableViews);
      state.writes.push({ kind: 'create_view', tableId, viewName });
      return structuredClone(view);
    },
    async updateView({ tableId, viewId, filterInfo, hiddenFields }) {
      if (state.failFirstViewUpdate) {
        state.failFirstViewUpdate = false;
        throw permanentError('simulated Google view failure', { code: 'TEST_GOOGLE_VIEW_FAILED' });
      }
      const view = (state.views.get(tableId) ?? []).find((candidate) => candidate.viewId === viewId);
      if (!view) throw new Error(`missing view ${viewId}`);
      if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
      if (hiddenFields !== undefined) view.property.hiddenFields = structuredClone(hiddenFields);
      state.writes.push({ kind: 'update_view', tableId, viewId });
      return structuredClone(view);
    },
  });
}

export function canonicalTableIds() {
  return { ...CANONICAL_TABLE_IDS };
}

function fieldShape(input) {
  const property = input.property ? structuredClone(input.property) : null;
  if (Array.isArray(property?.options)) {
    property.options = property.options.map((option, index) => ({
      ...option,
      id: option.id ?? `opt${token(input.fieldName)}${index + 1}`,
    }));
  }
  return {
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    type: input.type,
    uiType: input.uiType ?? uiType(input.type),
    description: input.description ?? '',
    isPrimary: input.isPrimary === true,
    property,
  };
}

function propertyForCoreField(fieldName, type, input) {
  if (type === 5) return { date_formatter: 'yyyy/MM/dd', auto_fill: false };
  if (type !== 3) return null;
  const options = {
    platform: ['meta_ads', 'tiktok_ads', 'google_ads'],
    ad_channel: [
      'meta_ads', 'youtube_ads', 'google_search_ads', 'google_display_ads',
      'google_demand_gen_ads', 'google_performance_max_ads', 'google_shopping_ads',
      'google_app_ads', 'google_other_ads',
    ],
    status: ['active', 'paused', 'removed', 'unknown'],
    resource_owner: ['developer_dev', 'client_production'],
    entity_type: ['account', 'campaign', 'ad_group', 'ad', 'creative', 'asset_group'],
    creative_type: ['image', 'video', 'carousel', 'text'],
  }[fieldName] ?? ['unknown'];
  const selected = input.useLegacyGoogleOther && fieldName === 'ad_channel'
    ? [...options.filter((name) => name !== 'google_other_ads'), 'google_other']
    : options;
  return { options: selected.map((name, index) => ({ name, color: index % 8 })) };
}

function defaultView(tableId) {
  return {
    viewId: `vewDefault${token(tableId)}`,
    viewName: 'Grid',
    viewType: 'grid',
    property: { hiddenFields: [], filterInfo: null },
  };
}

function uiType(type) {
  return ({ 1: 'Text', 2: 'Number', 3: 'SingleSelect', 5: 'DateTime', 7: 'Checkbox', 15: 'Url', 18: 'SingleLink' })[type] ?? null;
}

function token(value) {
  return String(value).replace(/[^A-Za-z0-9]+/gu, '');
}
