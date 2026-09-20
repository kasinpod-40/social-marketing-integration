const HELPER_TABLE = '⏱️ MKT_Service_Response_Ranking';
const DEFAULT_VIEW = '⏱️ Slowest First Response';
const DASHBOARD_BLOCK_NAME = 'Slowest First Response';
const DASHBOARD_NAME = '💬 Customer Service & Leads';
const PERIOD_FIELD = 'Period';
const LEGACY_PERIOD_FIELD = '__mkt_legacy_window_days_single_select_v1';
const PERIODS = Object.freeze([1, 3, 7, 30]);
const TOP_N = 20;

/** Installs a bounded, formula-backed First Response ranking table and Dashboard view. */
export async function installCustomerSlowestFirstResponseDashboard(input = {}) {
  const client = requireDependency(input.client, 'client');
  const chatwoot = requireDependency(input.chatwoot, 'chatwoot');
  const baseToken = requireText(input.baseToken, 'baseToken');
  const dailyTableId = requireText(input.dailyTableId, 'dailyTableId');
  const configuredDashboardId = requireText(input.dashboardId, 'dashboardId');
  const execute = input.execute === true;

  const [tables, agents, inboxes, dashboards] = await Promise.all([
    client.listTables(),
    chatwoot.listAgents(),
    chatwoot.listInboxes(),
    listBaseV3Items(client, basePath(baseToken, '/dashboards')),
  ]);
  const dailyTable = unique(tables, (row) => row.tableId === dailyTableId,
    'Conversation Daily table');
  const dashboard = resolveDashboard(dashboards, configuredDashboardId);
  const dashboardId = requireText(dashboard.dashboard_id ?? dashboard.id, 'dashboardId');
  const helperMatches = tables.filter((row) => row.name === HELPER_TABLE);
  if (helperMatches.length > 1) throw operatorError('Duplicate First Response helper table',
    'CUSTOMER_FIRST_RESPONSE_HELPER_DUPLICATE');
  const existingBlocks = await readDashboardBlocks(client, baseToken, dashboardId);
  const plan = {
    dailyTable: { id: dailyTableId, name: dailyTable.name },
    dashboard: { id: dashboardId, name: dashboard.name },
    helperTableExists: helperMatches.length === 1,
    dashboardBlockExists: existingBlocks.some(
      (block) => block.name?.trim() === DASHBOARD_BLOCK_NAME,
    ),
    agents: agents.length,
    inboxes: inboxes.length,
    periods: PERIODS,
    rows: PERIODS.length * TOP_N,
  };
  if (!execute) {
    const dailyFields = await client.listFields({ tableId: dailyTableId });
    let helperState = null;
    if (helperMatches[0]) {
      const [fields, rows, views] = await Promise.all([
        client.listFields({ tableId: helperMatches[0].tableId }),
        client.listRecords({ tableId: helperMatches[0].tableId, includeRecordMetadata: false }),
        client.listViews({ tableId: helperMatches[0].tableId }),
      ]);
      helperState = {
        id: helperMatches[0].tableId,
        fields: fields.map((field) => field.fieldName),
        rowCount: rows.length,
        views: views.map((view) => view.viewName),
      };
    }
    return {
      mode: 'preview',
      plan,
      dailyPayloadFieldExists: dailyFields.some(
        (field) => field.fieldName === 'first_response_rank_payload',
      ),
      helperState,
      dashboardBlocks: safeBlocks(existingBlocks),
    };
  }

  let dailyFields = await client.listFields({ tableId: dailyTableId });
  assertDailyContract(dailyFields);
  let payloadField = dailyFields.find((field) => field.fieldName === 'first_response_rank_payload');
  if (!payloadField) {
    payloadField = await client.createField({
      tableId: dailyTableId,
      field: formula(
        'first_response_rank_payload',
        'IF(ISBLANK([first_response_seconds]), "", [external_conversation_id] & "|" & IFBLANK([external_agent_id], "") & "|" & IFBLANK([external_inbox_id], "") & "|" & [first_response_seconds] & "|" & [metric_date])',
        'ข้อมูลช่วยสำหรับจัดอันดับ First Response ใน Dashboard; คำนวณอัตโนมัติจากแถว Daily',
      ),
    });
    dailyFields = await client.listFields({ tableId: dailyTableId });
  }

  let helperTable = helperMatches[0] ?? null;
  if (!helperTable) {
    helperTable = await client.createTable({
      name: HELPER_TABLE,
      defaultViewName: DEFAULT_VIEW,
      fields: [
        { fieldName: 'อันดับ', type: 1, uiType: 'Text' },
        { fieldName: 'ranking_key', type: 1, uiType: 'Text' },
        { fieldName: 'window_days', type: 2, uiType: 'Number', property: { formatter: '0' } },
        {
          fieldName: PERIOD_FIELD,
          type: 3,
          uiType: 'SingleSelect',
          property: { options: PERIODS.map((value) => ({ name: String(value) })) },
        },
        { fieldName: 'rank', type: 2, uiType: 'Number', property: { formatter: '0' } },
      ],
    });
  }
  const helperTableId = helperTable.tableId;
  let helperFields = await client.listFields({ tableId: helperTableId });
  const legacyPeriodField = helperFields.find((field) => field.fieldName === LEGACY_PERIOD_FIELD);
  if (legacyPeriodField && !helperFields.some((field) => field.fieldName === PERIOD_FIELD)) {
    await client.updateField({
      tableId: helperTableId,
      fieldId: legacyPeriodField.fieldId,
      field: {
        fieldName: PERIOD_FIELD,
        type: legacyPeriodField.type,
        uiType: legacyPeriodField.uiType,
        description: 'ช่วงเวลาของอันดับ First Response: 1, 3, 7 หรือ 30 วัน',
        property: legacyPeriodField.property,
      },
    });
    helperFields = await client.listFields({ tableId: helperTableId });
  }
  for (const field of buildFormulaFields({ dailyTableName: dailyTable.name, agents, inboxes })) {
    if (helperFields.some((candidate) => candidate.fieldName === field.fieldName)) continue;
    await client.createField({ tableId: helperTableId, field });
    helperFields = await client.listFields({ tableId: helperTableId });
  }

  const existingRows = await client.listRecords({ tableId: helperTableId,
    includeRecordMetadata: false });
  const keys = new Set(existingRows.map((row) => String(row.fields?.ranking_key ?? '').trim())
    .filter(Boolean));
  const missingRows = [];
  for (const days of PERIODS) {
    for (let rank = 1; rank <= TOP_N; rank += 1) {
      const key = `${days}:${rank}`;
      if (keys.has(key)) continue;
      missingRows.push({
        'อันดับ': `#${rank}`,
        ranking_key: key,
        window_days: days,
        [PERIOD_FIELD]: String(days),
        rank,
      });
    }
  }
  if (missingRows.length > 0) {
    await client.batchCreateRecords({ tableId: helperTableId, records: missingRows });
  }

  helperFields = await client.listFields({ tableId: helperTableId });
  const byName = new Map(helperFields.map((field) => [field.fieldName, field]));
  const visibleNames = ['อันดับ', PERIOD_FIELD, 'แชท', 'เอเจน', 'ช่องทาง', 'First Response', 'วันที่ตอบ'];
  const hiddenIds = helperFields
    .filter((field) => !visibleNames.includes(field.fieldName))
    .map((field) => field.fieldId);
  const periodField = requireDependency(byName.get(PERIOD_FIELD), PERIOD_FIELD);
  let views = await client.listViews({ tableId: helperTableId });
  const defaultView = unique(views, (row) => row.viewName === DEFAULT_VIEW, 'default helper view');
  await client.updateView({ tableId: helperTableId, viewId: defaultView.viewId,
    hiddenFields: hiddenIds });
  for (const days of PERIODS) {
    const name = periodViewName(days);
    let view = views.find((row) => row.viewName === name);
    if (!view) {
      view = await client.createView({ tableId: helperTableId, viewName: name, viewType: 'grid' });
      views = await client.listViews({ tableId: helperTableId });
    }
    const option = periodField.property?.options?.find((item) => item.name === String(days));
    await client.updateView({
      tableId: helperTableId,
      viewId: view.viewId,
      hiddenFields: hiddenIds,
      filterInfo: {
        conjunction: 'and',
        conditions: [{
          fieldId: periodField.fieldId,
          fieldType: 3,
          operator: 'is',
          value: requireText(option?.id, `period option ${days}`),
        }],
      },
    });
  }

  let dashboardBlocks = await readDashboardBlocks(client, baseToken, dashboardId);
  let dashboardBlock = dashboardBlocks.find(
    (block) => block.name?.trim() === DASHBOARD_BLOCK_NAME,
  );
  if (!dashboardBlock) {
    throw operatorError('Lark Dashboard Grid block must be imported from the prepared View in UI',
      'CUSTOMER_FIRST_RESPONSE_GRID_IMPORT_REQUIRED', { helperTableId });
  }

  const finalRows = await client.listRecords({ tableId: helperTableId,
    includeRecordMetadata: false });
  const finalViews = await client.listViews({ tableId: helperTableId });
  dashboardBlocks = await readDashboardBlocks(client, baseToken, dashboardId);
  const expectedViewNames = PERIODS.map(periodViewName);
  const blockReadback = dashboardBlocks.find(
    (block) => block.name?.trim() === DASHBOARD_BLOCK_NAME,
  );
  const computedCounts = {
    chat: finalRows.filter((row) => hasValue(row.fields?.['แชท'])).length,
    agent: finalRows.filter((row) => hasValue(row.fields?.['เอเจน'])).length,
    channel: finalRows.filter((row) => hasValue(row.fields?.['ช่องทาง'])).length,
    firstResponse: finalRows.filter((row) => hasValue(row.fields?.['First Response'])).length,
    responseDate: finalRows.filter((row) => hasValue(row.fields?.['วันที่ตอบ'])).length,
  };
  const verified = finalRows.length === PERIODS.length * TOP_N
    && expectedViewNames.every((name) => finalViews.some((view) => view.viewName === name))
    && blockReadback?.type === 'view'
    && Object.values(computedCounts).every((count) => count > 0);
  if (!verified) throw operatorError('First Response dashboard readback did not converge',
    'CUSTOMER_FIRST_RESPONSE_READBACK_FAILED', {
      rowCount: finalRows.length,
      views: finalViews.map((view) => view.viewName),
      block: blockReadback ? { name: blockReadback.name, type: blockReadback.type } : null,
      computedCounts,
    });
  return {
    mode: 'execute',
    plan,
    result: {
      verified,
      dailyPayloadFieldId: payloadField.fieldId,
      helperTableId,
      helperRowCount: finalRows.length,
      views: finalViews.map((view) => view.viewName),
      dashboardBlock: { id: blockReadback.blockId, name: blockReadback.name,
        type: blockReadback.type },
      computedCounts,
    },
  };
}

function buildFormulaFields({ dailyTableName, agents, inboxes }) {
  const filtered = `[${dailyTableName}].FILTER(NOT(ISBLANK(CurrentValue.[first_response_seconds])) && TODATE(CurrentValue.[metric_date]) >= TODAY() - [window_days] && TODATE(CurrentValue.[metric_date]) < TODAY()).SORTBY([${dailyTableName}].[first_response_seconds], FALSE).[first_response_rank_payload]`;
  const payload = `IFERROR(NTH(${filtered}, [rank]), "")`;
  const part = (index) => `NTH(SPLIT([response_payload], "|"), ${index})`;
  const agentSwitch = makeSwitch(part(2), agents.map((row) => [String(row.id), row.name]),
    `"Agent " & ${part(2)}`);
  const inboxSwitch = makeSwitch(part(3), inboxes.map((row) => [String(row.id), formatInbox(row)]),
    `"Inbox " & ${part(3)}`);
  const seconds = `VALUE(${part(4)})`;
  return [
    formula('response_payload', payload, 'แถวต้นทางตามช่วงวันและอันดับ'),
    formula('แชท', `IF(ISBLANK([response_payload]), "", "Chat #" & ${part(1)})`,
      'หมายเลขแชทจาก Chatwoot'),
    formula('เอเจน', `IF(ISBLANK([response_payload]), "", ${agentSwitch})`,
      'ชื่อเอเจนจาก Chatwoot'),
    formula('ช่องทาง', `IF(ISBLANK([response_payload]), "", ${inboxSwitch})`,
      'ช่องทางและ Inbox จาก Chatwoot'),
    formula('First Response', `IF(ISBLANK([response_payload]), "", QUOTIENT(${seconds}, 3600) & "h " & QUOTIENT(MOD(${seconds}, 3600), 60) & "m " & MOD(${seconds}, 60) & "s")`,
      'ระยะเวลาตอบครั้งแรก'),
    formula('วันที่ตอบ', `IF(ISBLANK([response_payload]), "", ${part(5)})`,
      'วันที่เกิด First Response ตาม Asia/Bangkok'),
  ];
}

async function readDashboardBlocks(client, baseToken, dashboardId) {
  const candidates = await listBaseV3Items(client,
    basePath(baseToken, `/dashboards/${encodeURIComponent(dashboardId)}/blocks`));
  const blocks = [];
  for (const candidate of candidates) {
    const blockId = requireText(candidate?.block_id ?? candidate?.blockId ?? candidate?.id,
      'dashboard blockId');
    const response = await client.requestBitableJson(
      basePath(baseToken,
        `/dashboards/${encodeURIComponent(dashboardId)}/blocks/${encodeURIComponent(blockId)}`),
      { method: 'GET' },
    );
    const block = response?.data?.block ?? response?.data ?? response;
    blocks.push({
      blockId,
      name: block?.name ?? candidate?.name ?? null,
      type: block?.type ?? candidate?.type ?? null,
      dataConfig: block?.data_config ?? block?.dataConfig ?? null,
      position: block?.position ?? null,
    });
  }
  return blocks;
}

async function listBaseV3Items(client, path) {
  const response = await client.requestBitableJson(`${path}?page_size=100`, { method: 'GET' });
  const data = response?.data ?? {};
  if (data.has_more === true || data.hasMore === true) {
    throw operatorError('Dashboard collection exceeds reviewed page bound',
      'CUSTOMER_FIRST_RESPONSE_PAGE_BOUND');
  }
  const items = data.items ?? data.dashboards ?? data.blocks ?? [];
  if (!Array.isArray(items)) throw operatorError('Dashboard list response is invalid',
    'CUSTOMER_FIRST_RESPONSE_LIST_INVALID');
  return items;
}

function resolveDashboard(dashboards, configuredId) {
  const matches = dashboards.filter((row) =>
    (row.dashboard_id ?? row.id) === configuredId || row.name === DASHBOARD_NAME);
  return unique(matches, () => true, 'Customer Service dashboard');
}

function assertDailyContract(fields) {
  for (const name of ['first_response_seconds', 'external_conversation_id', 'external_agent_id',
    'external_inbox_id', 'metric_date']) {
    unique(fields, (field) => field.fieldName === name, `Conversation Daily field ${name}`);
  }
}

function formula(fieldName, expression, description) {
  return { fieldName, type: 20, uiType: 'Formula', description,
    property: { formula_expression: expression } };
}

function makeSwitch(expression, pairs, fallback) {
  const args = pairs.flatMap(([id, name]) => [
    `"${escapeFormula(id)}"`, `"${escapeFormula(name)}"`,
  ]);
  return `SWITCH(${expression}, ${[...args, fallback].join(', ')})`;
}

function formatInbox(row) {
  const type = String(row.channel_type ?? '').replace(/^Channel::/u, '') || 'Unknown';
  return `${type} · ${row.name ?? `Inbox ${row.id}`}`;
}

function escapeFormula(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function basePath(baseToken, suffix = '') {
  return `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}${suffix}`;
}

function periodViewName(days) { return `${days} Day${days === 1 ? '' : 's'}`; }

function safeBlocks(blocks) {
  return blocks.map((block) => ({
    name: block.name,
    type: block.type,
    position: block.position,
    ...(block.name?.includes('Slowest First Response') ? { dataConfig: block.dataConfig } : {}),
  }));
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function requireDependency(value, label) {
  if (!value) throw new TypeError(`${label} is required`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

function unique(rows, predicate, label) {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) throw operatorError(`${label} must match exactly once`,
    'CUSTOMER_FIRST_RESPONSE_STATE_INVALID', { label, matches: matches.length });
  return matches[0];
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
