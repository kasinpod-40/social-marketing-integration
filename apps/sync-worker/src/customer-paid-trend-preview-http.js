import { createHash, timingSafeEqual } from 'node:crypto';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { json } from '../../../packages/shared/src/http/response.js';

export const CUSTOMER_PAID_TREND_PREVIEW_PATH = '/__codex/customer-paid-trend-v1';
const BASE_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const METRIC_TABLE_ID = 'tblHqEtDEUiqFhYx';
const TOP_ADS_TABLE_NAME = '📣 MKT_Report_Top_Ads';
const TOP_CONTENT_TABLE_NAME = '🏆 MKT_Report_Top_Content';
const PAID_DASHBOARD_NAME = '💰 Paid Ads Performance';
const ORGANIC_DASHBOARD_NAME = '🌱 Organic Performance';
const OLD_BLOCK_NAME = '🏆 คลิกตามโฆษณาและแคมเปญ';
const ARCHIVED_BLOCK_NAME = '🗑️ เลิกใช้ — กราฟคลิกแบบเดิม';
const COMBINED_BLOCK_NAME = '📈 แนวโน้ม Impressions, CPM และ CPC';
const LEGACY_IMPRESSIONS_BLOCK_NAME = '👁 แนวโน้ม Impressions';
const IMPRESSIONS_BLOCK_NAME = '📈 แนวโน้ม Impressions และ Clicks';
const CLICKS_BLOCK_NAME = '🖱 แนวโน้ม Clicks';
const ARCHIVED_CLICKS_BLOCK_NAME = '🗑️ เลิกใช้ — Clicks แยกเดิม';
const ARCHIVED_IMPRESSIONS_BLOCK_NAME = '🗑️ เลิกใช้ — Impressions แยกเดิม';
const COST_BLOCK_NAME = '💰 แนวโน้ม CPM และ CPC';
const TOP_ADS_TITLE = '🏆 ผลงานโฆษณา/แคมเปญในช่วงที่เลือก';
const TOP_ADS_SPEND_BLOCK_NAME = '💸 Top 10 ตาม Spend';
const TOP_ADS_CLICKS_BLOCK_NAME = '🖱 Top 10 ตาม Clicks';
const TOP_ADS_CTR_BLOCK_NAME = '📊 CTR ของ Top 10';
const ADS_IN_PERIOD_BLOCK_NAME = '📣 Ads ที่มีการใช้งานในช่วงที่เลือก';
const ADS_IN_PERIOD_LIMIT = 10;
const ORGANIC_CONTENT_CHART_NAME = '📈 Views เทียบ Engagement ตาม Content';
const ORGANIC_CONTENT_LIMIT = 10;
const TARGET_TREND_BLOCK_ID = 'chtlgbj9oUdshNJTDXlMFLeppEP';

export function createCustomerPaidTrendPreviewHttpHandler() {
  return async ({ request, env }) => {
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    if (!authorized(request, env)) return json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
    try {
      assertEnvironment(env);
      const body = await request.json();
      const client = createLarkBitableClientFromEnv(env);
      const mode = String(body?.mode ?? 'inspect');
      const result = mode === 'inspect'
        ? await inspect(client)
        : mode === 'inspect_organic'
          ? await inspectOrganic(client)
        : mode === 'apply_schema'
          ? await applySchema(client)
          : mode === 'apply_dashboard'
            ? await applyDashboard(client)
            : mode === 'apply_organic_content_chart'
              ? await applyOrganicContentChart(client)
            : null;
      if (!result) return json({ ok: false, code: 'MODE_INVALID' }, { status: 400 });
      return json({ ok: true, result });
    } catch (error) {
      return json({ ok: false, code: error?.code ?? 'PAID_TREND_FAILED', error: error?.message ?? String(error) }, { status: 500 });
    }
  };
}

async function inspectOrganic(client) {
  const [tables, dashboards] = await Promise.all([
    client.listTables(),
    listItems(client, `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards`),
  ]);
  const table = exactlyOne(tables.filter((row) => row.name === TOP_CONTENT_TABLE_NAME), 'Top Content table');
  const metricTable = exactlyOne(tables.filter((row) => row.tableId === METRIC_TABLE_ID), 'Metric table');
  const dashboard = exactlyOne(dashboards.filter((row) => row.name === ORGANIC_DASHBOARD_NAME), 'Organic dashboard');
  const dashboardId = dashboard.dashboard_id ?? dashboard.id ?? dashboard.block_id;
  const [blocks, topContentFields, metricFields, periodMetricRecords, topContentRecords] = await Promise.all([
    readBlocks(client, dashboardId),
    client.listFields({ tableId: table.tableId }),
    client.listFields({ tableId: metricTable.tableId }),
    client.searchRecordsByFieldValues({
      tableId: metricTable.tableId,
      fieldName: 'metric_key',
      values: [
        'facebook:period_views', 'facebook:period_likes', 'facebook:period_comments',
        'facebook:period_shares', 'facebook:period_engagement', 'facebook:period_engagement_rate',
      ],
    }),
    client.searchRecordsByFieldValues({
      tableId: table.tableId,
      fieldName: 'platform',
      values: ['facebook'],
    }),
  ]);
  const chartBlocks = blocks.filter((block) => block.name === ORGANIC_CONTENT_CHART_NAME);
  const computed = chartBlocks.length === 1
    ? summarizeComputedData((await client.requestBitableJson(
      `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/blocks/${chartBlocks[0].id}/data`,
      { method: 'GET' },
    ))?.data)
    : null;
  return {
    table: { id: table.tableId, name: table.name },
    sharedFields: {
      topContent: topContentFields.filter((field) => [
        '__mkt_legacy_window_days_single_select_v1', 'window_days', 'platform',
      ].includes(field.fieldName)).map(safeField),
      metricValues: metricFields.filter((field) => [
        '__mkt_legacy_window_days_single_select_v1', 'window_days', 'platform',
      ].includes(field.fieldName)).map(safeField),
    },
    dashboard: { id: dashboardId, name: dashboard.name },
    blocks: chartBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      type: block.type,
      position: block.position,
      dataConfig: block.dataConfig,
    })),
    slicers: blocks.filter((block) => block.type === 'slicer').map((block) => ({
      id: block.id,
      position: block.position,
      dataConfig: block.dataConfig,
    })),
    periodCards: blocks.filter((block) => [
      '👁 Period Views', '❤️ Period Likes', '💬 Period Comments', '🔁 Period Shares',
      '🤝 Period Engagement', '📊 Period Engagement Rate',
    ].includes(block.name)).map((block) => ({
      id: block.id,
      name: block.name,
      type: block.type,
      dataConfig: block.dataConfig,
    })),
    facebookOneDayReadback: {
      metricValues: periodMetricRecords.filter((record) => (
        selectName(record.fields?.platform) === 'facebook'
        && Number(record.fields?.window_days) === 1
        && selectName(record.fields?.customer_profile) === 'chemistry_k'
      )).map((record) => ({
        metricKey: record.fields?.metric_key,
        currentValue: record.fields?.current_value,
        displayValue: record.fields?.display_value,
        windowDays: record.fields?.window_days,
      })),
      topContent: topContentRecords.filter((record) => (
        Number(record.fields?.window_days) === 1
        && selectName(record.fields?.customer_profile) === 'chemistry_k'
      )).map((record) => ({
        rank: record.fields?.rank,
        caption: record.fields?.caption,
        periodViews: record.fields?.period_views,
        periodLikes: record.fields?.period_likes,
        periodComments: record.fields?.period_comments,
        periodShares: record.fields?.period_shares,
        periodEngagement: record.fields?.period_engagement,
      })),
    },
    computed,
  };
}

async function applyOrganicContentChart(client) {
  const [tables, dashboards] = await Promise.all([
    client.listTables(),
    listItems(client, `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards`),
  ]);
  exactlyOne(tables.filter((row) => row.tableId === METRIC_TABLE_ID), 'Metric table');
  const dashboard = exactlyOne(dashboards.filter((row) => row.name === ORGANIC_DASHBOARD_NAME), 'Organic dashboard');
  const dashboardId = dashboard.dashboard_id ?? dashboard.id ?? dashboard.block_id;
  const blocks = await readBlocks(client, dashboardId);
  const existing = uniqueBlockByName(blocks, ORGANIC_CONTENT_CHART_NAME);
  const position = existing?.position ?? {
    x: 0,
    y: blocks.reduce((bottom, block) => Math.max(
      bottom,
      Number(block.position?.y ?? 0) + Number(block.position?.h ?? 1),
    ), 0),
    w: 12,
    h: 7,
  };
  const chart = await upsertDashboardBlock({
    client,
    dashboardId,
    existing,
    name: ORGANIC_CONTENT_CHART_NAME,
    type: 'line',
    position,
    dataConfig: {
      table_name: '📊 MKT_Report_Metric_Values',
      group_by: [{ field_name: 'content_chart_label', mode: 'integrated', sort: { type: 'value', order: 'desc' } }],
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: 'customer_profile', operator: 'is', value: ['chemistry_k'] },
          { field_name: 'report_type', operator: 'is', value: ['dashboard_performance_report'] },
          { field_name: 'metric_key', operator: 'contains', value: [':content_performance'] },
          { field_name: 'content_chart_label', operator: 'isNotEmpty' },
          { field_name: 'rank', operator: 'isLessEqual', value: ORGANIC_CONTENT_LIMIT },
        ],
      },
      series: [
        { field_name: 'content_period_views', rollup: 'SUM' },
        { field_name: 'content_period_engagement', rollup: 'SUM' },
      ],
    },
  });
  const computedResponse = await client.requestBitableJson(
    `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/blocks/${chart.id}/data`,
    { method: 'GET' },
  );
  const computed = summarizeComputedData(computedResponse?.data);
  if (!computed.validProtocol
    || computed.measureCount !== 2
    || computed.rowCount > ORGANIC_CONTENT_LIMIT
    || (computed.rowCount > 0 && !computed.hasNumericValue)) {
    throw new Error('Organic Content Views/Engagement chart computed data is invalid');
  }
  const readback = exactlyOne(
    (await readBlocks(client, dashboardId)).filter((block) => block.id === chart.id),
    'Organic Content chart readback',
  );
  return {
    verified: true,
    dashboard: { id: dashboardId, name: dashboard.name },
    block: {
      id: readback.id,
      name: readback.name,
      type: readback.type,
      position: readback.position,
      dataConfig: readback.dataConfig,
    },
    computed,
  };
}

async function inspect(client) {
  const [tables, dashboards, fields, trendRecords] = await Promise.all([
    client.listTables(),
    listItems(client, `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards`),
    client.listFields({ tableId: METRIC_TABLE_ID }),
    client.searchRecordsByFieldValues({
      tableId: METRIC_TABLE_ID,
      fieldName: 'metric_key',
      values: ['meta_ads:ads_daily_trend', 'google_ads:ads_daily_trend'],
    }),
  ]);
  const table = exactlyOne(tables.filter((row) => row.tableId === METRIC_TABLE_ID), 'Metric table');
  const dashboard = exactlyOne(dashboards.filter((row) => row.name === PAID_DASHBOARD_NAME), 'Paid dashboard');
  const dashboardId = dashboard.dashboard_id ?? dashboard.id ?? dashboard.block_id;
  const blocks = await readBlocks(client, dashboardId);
  return {
    baseTokenMatches: client.appToken === BASE_TOKEN,
    metricTable: { id: table.tableId, name: table.name },
    fields: fields.filter((field) => [
      'dimension_type', 'metric_date', 'daily_impressions', 'daily_cpc', 'daily_cpm',
      'daily_clicks',
      'ad_chart_label', 'ad_spend_amount', 'ad_clicks', 'ad_ctr_percent',
      '__mkt_legacy_window_days_single_select_v1', 'platform',
    ].includes(field.fieldName)).map(safeField),
    dashboard: { id: dashboardId, name: dashboard.name },
    trendRows: summarizeTrendRows(trendRecords),
    blocks: blocks.map((block) => ({
      id: block.id, name: block.name, type: block.type, position: block.position,
      ...(block.type === 'slicer'
        || block.id === TARGET_TREND_BLOCK_ID
        || [
          OLD_BLOCK_NAME, COMBINED_BLOCK_NAME, LEGACY_IMPRESSIONS_BLOCK_NAME, IMPRESSIONS_BLOCK_NAME,
          CLICKS_BLOCK_NAME, ARCHIVED_CLICKS_BLOCK_NAME, ARCHIVED_IMPRESSIONS_BLOCK_NAME, COST_BLOCK_NAME,
          TOP_ADS_TITLE, TOP_ADS_SPEND_BLOCK_NAME, TOP_ADS_CLICKS_BLOCK_NAME, TOP_ADS_CTR_BLOCK_NAME,
          ADS_IN_PERIOD_BLOCK_NAME,
        ].includes(block.name)
        ? { dataConfig: block.dataConfig }
        : {}),
    })),
  };
}

function summarizeTrendRows(records) {
  const groups = new Map();
  for (const record of records) {
    const fields = record.fields ?? {};
    const platform = selectName(fields.platform);
    const windowDays = selectName(fields.__mkt_legacy_window_days_single_select_v1);
    const key = `${platform}:${windowDays}`;
    const current = groups.get(key) ?? { platform, windowDays, count: 0, dates: [] };
    current.count += 1;
    current.dates.push(Number(fields.metric_date));
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    platform: group.platform,
    windowDays: group.windowDays,
    count: group.count,
    firstDate: new Date(Math.min(...group.dates)).toISOString().slice(0, 10),
    lastDate: new Date(Math.max(...group.dates)).toISOString().slice(0, 10),
  })).sort((a, b) => `${a.platform}:${a.windowDays}`.localeCompare(`${b.platform}:${b.windowDays}`));
}

function selectName(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return selectName(value[0]);
  if (value && typeof value === 'object') return String(value.name ?? value.text ?? value.value ?? '');
  return String(value ?? '');
}

async function applySchema(client) {
  const tables = await client.listTables();
  const topAdsTable = exactlyOne(tables.filter((table) => table.name === TOP_ADS_TABLE_NAME), 'Top Ads table');
  const fields = await client.listFields({ tableId: METRIC_TABLE_ID });
  const byName = new Map(fields.map((field) => [field.fieldName, field]));
  const desired = [
    { fieldName: 'metric_date', type: 5, uiType: 'DateTime', description: 'วันที่ของแนวโน้ม Paid Ads รายวัน' },
    { fieldName: 'daily_impressions', type: 2, uiType: 'Number', description: 'Impressions ของวัน', property: { formatter: '1,000' } },
    { fieldName: 'daily_clicks', type: 2, uiType: 'Number', description: 'Clicks ของวัน', property: { formatter: '1,000' } },
    { fieldName: 'daily_cpc', type: 2, uiType: 'Number', description: 'CPC ของวันในหน่วยสกุลเงินจริง', property: { formatter: '1,000.00' } },
    { fieldName: 'daily_cpm', type: 2, uiType: 'Number', description: 'CPM ของวันในหน่วยสกุลเงินจริง', property: { formatter: '1,000.00' } },
    { fieldName: 'ad_chart_label', type: 1, uiType: 'Text', description: 'อันดับและชื่อ Ads/แคมเปญที่มีการใช้งานในช่วงที่เลือก' },
    { fieldName: 'ad_spend_amount', type: 2, uiType: 'Number', description: 'Spend ของ Ads/แคมเปญในช่วงที่เลือก', property: { formatter: '1,000.00' } },
    { fieldName: 'ad_clicks', type: 2, uiType: 'Number', description: 'Clicks ของ Ads/แคมเปญในช่วงที่เลือก', property: { formatter: '1,000' } },
    { fieldName: 'ad_ctr_percent', type: 2, uiType: 'Number', description: 'CTR ของ Ads/แคมเปญในช่วงที่เลือก', property: { formatter: '0.00' } },
    { fieldName: 'content_chart_label', type: 1, uiType: 'Text', description: 'อันดับและชื่อ Content ในช่วงที่เลือก' },
    { fieldName: 'content_period_views', type: 2, uiType: 'Number', description: 'Views ของ Content ในช่วงที่เลือก', property: { formatter: '1,000' } },
    { fieldName: 'content_period_engagement', type: 2, uiType: 'Number', description: 'Engagement ของ Content ในช่วงที่เลือก', property: { formatter: '1,000' } },
  ];
  const created = [];
  for (const field of desired) {
    const existing = byName.get(field.fieldName);
    if (existing) {
      if (Number(existing.type) !== field.type) throw new Error(`Field type conflict: ${field.fieldName}`);
      continue;
    }
    await client.createField({ tableId: METRIC_TABLE_ID, field });
    created.push(field.fieldName);
  }
  const dimension = exactlyOne(fields.filter((field) => field.fieldName === 'dimension_type'), 'dimension_type');
  const options = dimension.property?.options ?? [];
  let dimensionOptionAdded = false;
  if (!options.some((option) => option.name === 'day')) {
    await client.updateField({
      tableId: METRIC_TABLE_ID,
      fieldId: dimension.fieldId,
      field: {
        fieldName: dimension.fieldName,
        type: dimension.type,
        uiType: dimension.uiType,
        description: dimension.description,
        property: { ...dimension.property, options: [...options, { name: 'day', color: options.length % 8 }] },
      },
    });
    dimensionOptionAdded = true;
  }
  const readback = await client.listFields({ tableId: METRIC_TABLE_ID });
  const readbackByName = new Map(readback.map((field) => [field.fieldName, field]));
  for (const field of desired) {
    if (Number(readbackByName.get(field.fieldName)?.type) !== field.type) throw new Error(`Field readback failed: ${field.fieldName}`);
  }
  if (!(readbackByName.get('dimension_type')?.property?.options ?? []).some((option) => option.name === 'day')) {
    throw new Error('dimension_type day option readback failed');
  }
  const topAdsFields = await client.listFields({ tableId: topAdsTable.tableId });
  const topAdsByName = new Map(topAdsFields.map((field) => [field.fieldName, field]));
  const desiredTopAds = [
    { fieldName: 'ad_chart_label', type: 1, uiType: 'Text', description: 'อันดับและชื่อโฆษณา/แคมเปญสำหรับ Dashboard' },
    { fieldName: 'spend_amount', type: 2, uiType: 'Number', description: 'ยอดใช้จ่ายในหน่วยสกุลเงินจริง', property: { formatter: '1,000.00' } },
    { fieldName: 'ctr_percent', type: 2, uiType: 'Number', description: 'CTR ในหน่วยเปอร์เซ็นต์', property: { formatter: '0.00' } },
  ];
  const topAdsCreated = [];
  for (const field of desiredTopAds) {
    const existing = topAdsByName.get(field.fieldName);
    if (existing) {
      if (Number(existing.type) !== field.type) throw new Error(`Field type conflict: ${field.fieldName}`);
      continue;
    }
    await client.createField({ tableId: topAdsTable.tableId, field });
    topAdsCreated.push(field.fieldName);
  }
  const topAdsReadback = new Map(
    (await client.listFields({ tableId: topAdsTable.tableId })).map((field) => [field.fieldName, field]),
  );
  for (const field of desiredTopAds) {
    if (Number(topAdsReadback.get(field.fieldName)?.type) !== field.type) {
      throw new Error(`Field readback failed: ${field.fieldName}`);
    }
  }
  return { created, topAdsCreated, dimensionOptionAdded, verified: true };
}

async function applyDashboard(client) {
  const dashboards = await listItems(client, `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards`);
  const dashboard = exactlyOne(dashboards.filter((row) => row.name === PAID_DASHBOARD_NAME), 'Paid dashboard');
  const dashboardId = dashboard.dashboard_id ?? dashboard.id ?? dashboard.block_id;
  let blocks = await readBlocks(client, dashboardId);
  const oldBlocks = blocks.filter((block) => [OLD_BLOCK_NAME, ARCHIVED_BLOCK_NAME].includes(block.name));
  if (oldBlocks.length > 1) throw new Error('Paid trend block identity is ambiguous');
  const old = oldBlocks[0] ?? null;
  const impressionsLine = blocks.find((block) => block.id !== TARGET_TREND_BLOCK_ID
    && block.type === 'line'
    && [CLICKS_BLOCK_NAME, ARCHIVED_CLICKS_BLOCK_NAME, IMPRESSIONS_BLOCK_NAME].includes(block.name))
    ?? null;
  const legacyImpressions = blocks.find((block) => block.id === TARGET_TREND_BLOCK_ID)
    ?? blocks.find((block) => block.type === 'combo'
      && [COMBINED_BLOCK_NAME, LEGACY_IMPRESSIONS_BLOCK_NAME].includes(block.name))
    ?? null;
  const impressionsPosition = { x: 0, y: 8, w: 12, h: 6 };
  const costsPosition = { x: 0, y: 14, w: 12, h: 6 };
  const sharedConfig = {
    table_name: '📊 MKT_Report_Metric_Values',
    group_by: [{ field_name: 'metric_date', mode: 'integrated', sort: { type: 'group', order: 'asc' } }],
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'customer_profile', operator: 'is', value: ['chemistry_k'] },
        { field_name: 'report_type', operator: 'is', value: ['dashboard_performance_report'] },
        { field_name: 'dimension_type', operator: 'is', value: ['day'] },
        { field_name: 'metric_key', operator: 'contains', value: [':ads_daily_trend'] },
      ],
    },
  };
  const impressionsConfig = {
    ...sharedConfig,
    series: [
      { field_name: 'daily_impressions', rollup: 'SUM' },
      { field_name: 'daily_clicks', rollup: 'SUM' },
    ],
  };
  const costsConfig = {
    ...sharedConfig,
    series: [
      { field_name: 'daily_cpm', rollup: 'AVERAGE' },
      { field_name: 'daily_cpc', rollup: 'AVERAGE' },
    ],
  };
  let legacyImpressionsArchived = false;
  if (legacyImpressions && legacyImpressions.id !== impressionsLine?.id) {
    try {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${legacyImpressions.id}`,
        { method: 'DELETE', retryMode: 'none' },
      );
    } catch {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${legacyImpressions.id}`,
        { method: 'PATCH', body: {
          name: ARCHIVED_IMPRESSIONS_BLOCK_NAME,
          position: { x: 11, y: 35, w: 1, h: 1 },
        }, retryMode: 'none' },
      );
      legacyImpressionsArchived = true;
    }
  }
  const impressions = await upsertDashboardBlock({
    client, dashboardId, existing: impressionsLine, name: IMPRESSIONS_BLOCK_NAME,
    type: 'line', dataConfig: impressionsConfig, position: impressionsPosition,
  });
  const costs = await upsertDashboardBlock({
    client, dashboardId, existing: uniqueBlockByName(blocks, COST_BLOCK_NAME), name: COST_BLOCK_NAME,
    type: 'line', dataConfig: costsConfig, position: costsPosition,
  });
  await upsertDashboardBlock({
    client, dashboardId, existing: uniqueBlockByName(blocks, TOP_ADS_TITLE), name: TOP_ADS_TITLE,
    type: 'text',
    dataConfig: { text: '## 🏆 ผลงานโฆษณา/แคมเปญในช่วงที่เลือก\nแสดงเฉพาะ Ads ที่มีการใช้งานจริงใน Channel และ Period ที่เลือก เรียงตาม Spend' },
    position: { x: 0, y: 20, w: 12, h: 1 },
  });
  const adsInPeriodConfig = {
    table_name: '📊 MKT_Report_Metric_Values',
    group_by: [{ field_name: 'ad_chart_label', mode: 'integrated', sort: { type: 'value', order: 'desc' } }],
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'customer_profile', operator: 'is', value: ['chemistry_k'] },
        { field_name: 'report_type', operator: 'is', value: ['dashboard_performance_report'] },
        { field_name: 'metric_key', operator: 'contains', value: [':ad_clicks'] },
        { field_name: 'ad_chart_label', operator: 'isNotEmpty' },
        { field_name: 'rank', operator: 'isLessEqual', value: ADS_IN_PERIOD_LIMIT },
      ],
    },
    series: [
      { field_name: 'ad_spend_amount', rollup: 'SUM' },
      { field_name: 'ad_clicks', rollup: 'SUM' },
      { field_name: 'ad_ctr_percent', rollup: 'AVERAGE' },
    ],
  };
  const adsInPeriod = await upsertDashboardBlock({
    client,
    dashboardId,
    existing: uniqueBlockByName(blocks, ADS_IN_PERIOD_BLOCK_NAME)
      ?? uniqueBlockByName(blocks, TOP_ADS_SPEND_BLOCK_NAME),
    name: ADS_IN_PERIOD_BLOCK_NAME,
    type: 'bar',
    dataConfig: adsInPeriodConfig,
    position: { x: 0, y: 21, w: 12, h: 8 },
  });
  const archivedDetailBlocks = [];
  for (const [index, name] of [TOP_ADS_CLICKS_BLOCK_NAME, TOP_ADS_CTR_BLOCK_NAME].entries()) {
    const block = uniqueBlockByName(blocks, name);
    if (!block) continue;
    try {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${block.id}`,
        { method: 'DELETE', retryMode: 'none' },
      );
    } catch {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${block.id}`,
        { method: 'PATCH', body: {
          name: `🗑️ เลิกใช้ — รายละเอียด Ads ${index + 1}`,
          position: { x: 11, y: 36 + index, w: 1, h: 1 },
        }, retryMode: 'none' },
      );
      archivedDetailBlocks.push(block.id);
    }
  }
  const comparisonLayout = new Map([
    ['⚖️ Platform Comparison', { x: 0, y: 29, w: 12, h: 1 }],
    ['💸 Ad Spend by Platform', { x: 0, y: 30, w: 6, h: 5 }],
    ['🖱 Clicks by Platform', { x: 6, y: 30, w: 6, h: 5 }],
  ]);
  for (const block of blocks) {
    const position = comparisonLayout.get(block.name);
    if (!position) continue;
    await client.requestBitableJson(
      `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${block.id}`,
      { method: 'PATCH', body: { position }, retryMode: 'none' },
    );
  }
  const computed = {};
  for (const [key, block, expectedMeasures] of [
    ['impressionsAndClicks', impressions, 2], ['costs', costs, 2],
    ['adsInPeriod', adsInPeriod, 3],
  ]) {
    const response = await client.requestBitableJson(
      `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/blocks/${block.id}/data`,
      { method: 'GET' },
    );
    computed[key] = summarizeComputedData(response?.data);
    if (!computed[key].validProtocol || !computed[key].hasNumericValue
      || computed[key].measureCount !== expectedMeasures
      || (key === 'adsInPeriod' && computed[key].rowCount > ADS_IN_PERIOD_LIMIT)) {
      throw new Error(`Paid ${key} chart computed data is invalid`);
    }
  }
  let oldBlockArchived = false;
  if (old) {
    try {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${old.id}`,
        { method: 'DELETE', retryMode: 'none' },
      );
    } catch (error) {
      await client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${old.id}`,
        { method: 'PATCH', body: {
          name: '·',
          position: { x: 11, y: 34, w: 1, h: 1 },
        }, retryMode: 'none' },
      );
      oldBlockArchived = true;
    }
  }
  blocks = await readBlocks(client, dashboardId);
  const finalIds = [impressions, costs, adsInPeriod].map((block) => block.id);
  const finalBlocks = finalIds.map((id) => exactlyOne(blocks.filter((block) => block.id === id), `final block ${id}`));
  if (blocks.some((block) => block.name === OLD_BLOCK_NAME)) throw new Error('Old Paid Ads block still exists');
  return {
    verified: finalBlocks.length === 3,
    oldBlockArchived,
    legacyImpressionsArchived,
    archivedDetailBlocks,
    deleteScopeRequired: oldBlockArchived ? 'base:dashboard:delete' : null,
    blocks: finalBlocks.map((block) => ({
      id: block.id, name: block.name, type: block.type, position: block.position, dataConfig: block.dataConfig,
    })),
    computed,
  };
}

async function upsertDashboardBlock(input) {
  if (input.existing && input.existing.type !== input.type) {
    throw new Error(`${input.name} block type conflict: ${input.existing.type}`);
  }
  if (input.existing) {
    try {
      await input.client.requestBitableJson(
        `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${input.dashboardId}/blocks/${input.existing.id}`,
        {
          method: 'PATCH',
          body: { name: input.name, data_config: input.dataConfig, position: input.position },
          retryMode: 'none',
        },
      );
    } catch (error) {
      throw new Error(`${input.name} update failed: ${error?.message ?? String(error)}`);
    }
    return input.existing;
  }
  const response = await input.client.requestBitableJson(
    `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${input.dashboardId}/blocks`,
    {
      method: 'POST',
      body: { name: input.name, type: input.type, data_config: input.dataConfig, position: input.position },
      retryMode: 'none',
    },
  );
  return normalizeBlock(response?.data?.block ?? response?.data ?? response);
}

function uniqueBlockByName(blocks, name) {
  const matches = blocks.filter((block) => block.name === name);
  if (matches.length > 1) throw new Error(`${name} block identity is ambiguous`);
  return matches[0] ?? null;
}

function summarizeComputedData(protocol) {
  const measures = Array.isArray(protocol?.measures) ? protocol.measures : [];
  const dimensions = Array.isArray(protocol?.dimensions) ? protocol.dimensions : [];
  const rows = Array.isArray(protocol?.main_data) ? protocol.main_data : [];
  const aliases = measures.map((measure) => measure?.alias).filter(Boolean);
  const hasNumericValue = rows.some((row) => aliases.some((alias) => {
    const value = row?.[alias]?.value ?? row?.[alias];
    return typeof value === 'number' && Number.isFinite(value);
  }));
  return {
    validProtocol: Array.isArray(protocol?.main_data)
      && Array.isArray(protocol?.measures)
      && Array.isArray(protocol?.dimensions),
    rowCount: rows.length,
    measureCount: measures.length,
    dimensionCount: dimensions.length,
    hasNumericValue,
  };
}

async function readBlocks(client, dashboardId) {
  const items = await listItems(client, `/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks`);
  const blocks = [];
  for (const item of items) {
    const id = item.block_id ?? item.id;
    const response = await client.requestBitableJson(`/open-apis/base/v3/bases/${BASE_TOKEN}/dashboards/${dashboardId}/blocks/${id}`, { method: 'GET' });
    blocks.push(normalizeBlock(response?.data?.block ?? response?.data ?? response));
  }
  return blocks;
}

async function listItems(client, path) {
  const response = await client.requestBitableJson(`${path}?page_size=100`, { method: 'GET' });
  const data = response?.data ?? {};
  if (data.has_more === true) throw new Error('Dashboard list exceeded one reviewed page');
  return data.items ?? data.dashboards ?? data.blocks ?? [];
}

function normalizeBlock(value) {
  let dataConfig = value?.data_config ?? value?.dataConfig ?? {};
  if (typeof dataConfig === 'string') dataConfig = JSON.parse(dataConfig);
  return {
    id: String(value?.block_id ?? value?.id),
    name: value?.name ?? null,
    type: value?.type ?? null,
    position: value?.position ?? null,
    dataConfig,
    raw: value,
  };
}

function safeField(field) {
  return { fieldId: field.fieldId, fieldName: field.fieldName, type: field.type, uiType: field.uiType, property: field.property };
}
function exactlyOne(rows, label) { if (rows.length !== 1) throw new Error(`${label} must resolve exactly once`); return rows[0]; }
function assertEnvironment(env) {
  if (env.MKT_ENV !== 'production' || env.MKT_CUSTOMER_PROFILE !== 'chemistry_k' || env.LARK_APP_TOKEN !== BASE_TOKEN || env.LARK_TABLE_MKT_REPORT_METRIC_VALUES !== METRIC_TABLE_ID) {
    throw new Error('Customer Paid trend operator environment mismatch');
  }
}
function authorized(request, env) {
  const value = request.headers.get('authorization') ?? '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : '';
  const expected = String(env.MKT_OPERATOR_TOKEN_SHA256 ?? '');
  const observed = createHash('sha256').update(token).digest('hex');
  return expected.length === observed.length && timingSafeEqual(Buffer.from(expected), Buffer.from(observed));
}
