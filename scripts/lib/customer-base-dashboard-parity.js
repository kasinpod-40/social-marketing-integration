const CURRENT_DASHBOARD_AUTHORITY = Object.freeze([
  Object.freeze({ sourceOrdinal: 1, name: '💬 Customer Service & Leads', chartCount: 11 }),
  Object.freeze({ sourceOrdinal: 2, name: '🛡️ Data Quality & Operations', chartCount: 8 }),
  Object.freeze({ sourceOrdinal: 3, name: '📊 Executive Marketing Overview', chartCount: 11 }),
  Object.freeze({ sourceOrdinal: 4, name: '🌱 Organic Performance', chartCount: 22 }),
  Object.freeze({ sourceOrdinal: 5, name: '💰 Paid Ads Performance', chartCount: 13 }),
  Object.freeze({ sourceOrdinal: 6, name: '🛒 Commerce & Conversion', chartCount: 10 }),
]);

const CHART_KIND_TO_API_TYPE = new Map([
  [4194304, 'statistics'],
  [1049345, 'column'],
  [134217728, 'text'],
]);
const UNSUPPORTED_CHART_KINDS = new Map([
  [2147483948, 'slicer'],
  [1073741825, 'table_view'],
]);
const SUPPORTED_ROLLUPS = new Set(['SUM', 'MAX', 'MIN', 'AVERAGE']);
const SUPPORTED_SORT_TYPES = new Set(['group', 'value', 'view']);
const SUPPORTED_SORT_ORDERS = new Set(['asc', 'desc']);
const VALUELESS_FILTER_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);
const SUPPORTED_NUMBER_FORMATS = new Set([
  'digital',
  'digital_without_separator',
  'percentage_rounded',
  'cyn_rounded',
  'dollar_rounded',
]);

export const CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION =
  'APPLY_CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_PARITY_V1';

/**
 * Decode the exact current Source dashboard snapshots into the documented
 * Base v3 Dashboard API contract. Internal Source IDs are used only while
 * resolving semantic Table/Field/View/Select-option names and are never
 * included in the returned plan.
 */
export async function buildCustomerBaseDashboardParityPlan({ sourceClient }) {
  requireClient(sourceClient);
  const resources = requireObject(sourceClient.getExportResources(), 'export resources');
  const dashboards = requireArray(resources.dashboards ?? [], 'dashboards');
  if (dashboards.length !== CURRENT_DASHBOARD_AUTHORITY.length) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_COUNT_MISMATCH', 'Current Source must contain exactly six Dashboards', {
      expected: CURRENT_DASHBOARD_AUTHORITY.length,
      actual: dashboards.length,
    });
  }

  const references = await buildReferenceMaps(sourceClient);
  const plannedDashboards = dashboards.map((dashboard, index) => buildDashboardPlan({
    dashboard,
    authority: CURRENT_DASHBOARD_AUTHORITY[index],
    references,
  }));

  const totalBlocks = plannedDashboards.reduce((sum, dashboard) => sum + dashboard.blocks.length, 0);
  const documentedApiBlocks = plannedDashboards.reduce(
    (sum, dashboard) => sum + dashboard.blocks.filter((block) => block.supportedByDocumentedApi).length,
    0,
  );
  const unsupportedBlocks = totalBlocks - documentedApiBlocks;

  if (totalBlocks !== 75 || documentedApiBlocks !== 66 || unsupportedBlocks !== 9) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SUPPORTED_SCOPE_MISMATCH', 'Dashboard Source no longer matches the reviewed documented-API boundary', {
      totalBlocks,
      documentedApiBlocks,
      unsupportedBlocks,
    });
  }

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_dashboard_documented_api_parity_v1',
    mode: 'local-source-plan',
    themeStyle: 'summerBreeze',
    dashboards: plannedDashboards,
    summary: {
      dashboardCount: plannedDashboards.length,
      dashboardBlockCount: totalBlocks,
      documentedApiBlockCount: documentedApiBlocks,
      unsupportedBlockCount: unsupportedBlocks,
      unsupportedByKind: countBy(
        plannedDashboards.flatMap((dashboard) => dashboard.blocks)
          .filter((block) => !block.supportedByDocumentedApi)
          .map((block) => block.sourceKind),
      ),
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

/**
 * Inspect or materialize only the documented Dashboard API subset. The live
 * materialization path intentionally follows the already-proven BNK sequence:
 * list -> create missing resource -> list readback. Deep Dashboard GET, deep
 * block GET, theme PATCH and delete operations are excluded from this loop so
 * an eventually-consistent detail endpoint cannot strand a partially-created
 * customer Dashboard. Target state itself is the resumable ledger.
 */
export async function applyCustomerBaseDashboardParity({
  plan,
  targetClient,
  mode = 'preview',
  confirmation = null,
  folderName = 'Setup Phase | Social MKT Data Hub',
  requiredTargetAnchorTableNames = [],
  onProgress = () => undefined,
}) {
  requirePlan(plan);
  requireTargetClient(targetClient);
  if (!['preview', 'apply'].includes(mode)) throw new TypeError('mode must be preview or apply');
  if (mode === 'apply' && confirmation !== CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_CONFIRMATION_REQUIRED', 'Exact Dashboard apply confirmation is required');
  }

  await verifyTargetAnchors(targetClient, requiredTargetAnchorTableNames);
  const baseBlocks = await listBaseBlocks(targetClient);
  const folder = resolveUniqueNamedBlock(baseBlocks, folderName, 'folder');
  const folderId = requireText(folder?.block_id ?? folder?.id, 'target folder block id');
  const initialDashboards = await listDashboards(targetClient);
  const mutationLog = [];
  const results = [];

  for (const dashboardPlan of plan.dashboards) {
    const result = await ensureDashboard({
      targetClient,
      dashboardPlan,
      folderId,
      initialDashboards,
      mode,
      mutationLog,
      onProgress,
    });
    results.push(result);
  }

  const documentedApiMismatchCount = results.reduce((sum, dashboard) => sum + dashboard.documentedApiMismatchCount, 0);
  const unsupportedRemainingCount = results.reduce((sum, dashboard) => sum + dashboard.unsupportedRemainingCount, 0);
  const themeDeferredCount = results.filter((dashboard) => dashboard.themeParity === 'deferred_post_materialization').length;
  const previewReady = mode === 'preview';

  return deepFreeze({
    ok: previewReady || documentedApiMismatchCount === 0,
    contractVersion: plan.contractVersion,
    action: mode,
    status: previewReady
      ? 'DASHBOARD_DOCUMENTED_API_PREVIEW_READY'
      : (documentedApiMismatchCount === 0
        ? (unsupportedRemainingCount === 0
          ? 'DASHBOARD_DOCUMENTED_API_BLOCKS_PASS'
          : 'DASHBOARD_DOCUMENTED_API_BLOCKS_PASS_WITH_UNSUPPORTED_REMAINDER')
        : 'DASHBOARD_DOCUMENTED_API_MISMATCH'),
    targetFolder: folderName,
    dashboards: results,
    summary: {
      dashboardCount: results.length,
      documentedApiBlockCount: plan.summary.documentedApiBlockCount,
      documentedApiMismatchCount,
      unsupportedRemainingCount,
      unsupportedByKind: plan.summary.unsupportedByKind,
      themeDeferredCount,
      expectedThemeStyle: plan.themeStyle,
    },
    mutations: mutationLog,
    dashboardMutationCount: mutationLog.filter((item) => item.kind === 'dashboard').length,
    dashboardBlockMutationCount: mutationLog.filter((item) => item.kind === 'dashboard_block').length,
    tableMutationCount: 0,
    fieldMutationCount: 0,
    recordMutationCount: 0,
    viewMutationCount: 0,
    formulaMutationCount: 0,
    roleMutationCount: 0,
    workflowMutationCount: 0,
  });
}

function buildDashboardPlan({ dashboard, authority, references }) {
  const source = requireObject(dashboard, `dashboard[${authority.sourceOrdinal}]`);
  const charts = requireArray(source.charts ?? [], `dashboard[${authority.sourceOrdinal}].charts`);
  if (charts.length !== authority.chartCount) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_CHART_COUNT_MISMATCH', 'Dashboard block count differs from current Source authority', {
      dashboardOrdinal: authority.sourceOrdinal,
      dashboardName: authority.name,
      expected: authority.chartCount,
      actual: charts.length,
    });
  }

  const layout = decodeBase64Json(source.snapshot, `dashboard[${authority.sourceOrdinal}].snapshot`);
  const layoutMap = requireObject(layout?.map, `dashboard[${authority.sourceOrdinal}].snapshot.map`);
  const root = requireObject(layoutMap.rootWidget, `dashboard[${authority.sourceOrdinal}].rootWidget`);
  const childIds = requireArray(root.children ?? [], `dashboard[${authority.sourceOrdinal}].rootWidget.children`);
  if (childIds.length !== charts.length) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_LAYOUT_BLOCK_COUNT_MISMATCH', 'Dashboard layout child count differs from chart inventory', {
      dashboardOrdinal: authority.sourceOrdinal,
      chartCount: charts.length,
      layoutChildren: childIds.length,
    });
  }

  const positions = requireObject(root?.data?.desktop?.position ?? {}, `dashboard[${authority.sourceOrdinal}].positions`);
  const usedCharts = new Set();
  const blocks = childIds.map((widgetId, layoutOrdinal) => {
    const widget = requireObject(layoutMap[widgetId], `dashboard[${authority.sourceOrdinal}].widget[${widgetId}]`);
    const chart = matchChart(widget, charts, usedCharts, authority.sourceOrdinal);
    usedCharts.add(chart);
    return buildBlockPlan({
      chart,
      widget,
      widgetId,
      position: positions[widgetId],
      layoutOrdinal: layoutOrdinal + 1,
      dashboardOrdinal: authority.sourceOrdinal,
      references,
    });
  });

  if (usedCharts.size !== charts.length) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_CHART_MAPPING_INCOMPLETE', 'Not every Source chart mapped to exactly one layout widget', {
      dashboardOrdinal: authority.sourceOrdinal,
      mapped: usedCharts.size,
      charts: charts.length,
    });
  }

  const topText = blocks
    .filter((block) => block.type === 'text')
    .sort(comparePosition)[0];
  if (!topText || topText.name !== authority.name) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_TITLE_MISMATCH', 'Dashboard top title differs from current Source authority', {
      dashboardOrdinal: authority.sourceOrdinal,
      expected: authority.name,
      actual: topText?.name ?? null,
    });
  }

  assertUniqueNames(blocks, `Dashboard ${authority.name}`);
  return deepFreeze({
    sourceOrdinal: authority.sourceOrdinal,
    name: authority.name,
    chartCount: authority.chartCount,
    isAdvancedPermEnabled: source.isAdvancedPermEnabled === true,
    blocks,
  });
}

function buildBlockPlan({ chart, widget, widgetId, position, layoutOrdinal, dashboardOrdinal, references }) {
  const snapshot = decodeBase64Json(chart.snapshot, `dashboard[${dashboardOrdinal}].chart[${layoutOrdinal}].snapshot`);
  const chartKind = finiteInteger(snapshot?.viewModel?.chartKind, 'chartKind');
  const type = CHART_KIND_TO_API_TYPE.get(chartKind) ?? null;
  const sourceKind = type ?? UNSUPPORTED_CHART_KINDS.get(chartKind) ?? `unknown:${chartKind}`;
  if (!type && !UNSUPPORTED_CHART_KINDS.has(chartKind)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_CHART_KIND_UNREVIEWED', 'Source Dashboard contains an unreviewed chart kind', {
      dashboardOrdinal,
      layoutOrdinal,
      chartKind,
    });
  }

  const normalizedPosition = normalizePosition(position, `dashboard[${dashboardOrdinal}].widget[${widgetId}].position`);
  if (type === 'text') {
    const text = extractRichText(snapshot);
    return deepFreeze({
      sourceOrdinal: layoutOrdinal,
      name: firstNonEmptyLine(text),
      sourceKind: 'text',
      supportedByDocumentedApi: true,
      type: 'text',
      dataConfig: { text: toMarkdownText(snapshot, text) },
      position: normalizedPosition,
    });
  }

  if (type) {
    return deepFreeze({
      sourceOrdinal: layoutOrdinal,
      name: requireText(widget?.name, `dashboard[${dashboardOrdinal}] block name`),
      sourceKind: type,
      supportedByDocumentedApi: true,
      type,
      dataConfig: buildDataConfig(snapshot, type, references),
      position: normalizedPosition,
    });
  }

  if (sourceKind === 'slicer') {
    const slicer = requireObject(snapshot?.dataSourcesExtra?.slicer, `dashboard[${dashboardOrdinal}] slicer config`);
    const dataConfig = buildDataConfig(snapshot, 'slicer-probe', references, { allowSlicer: true });
    const defaultValue = mapPossibleReference(slicer.defaultValue, references);
    return deepFreeze({
      sourceOrdinal: layoutOrdinal,
      name: optionalText(slicer.desc) ?? optionalText(widget?.name) ?? `Slicer ${layoutOrdinal}`,
      sourceKind: 'slicer',
      supportedByDocumentedApi: false,
      type: null,
      dataConfig: null,
      position: normalizedPosition,
      manualReference: {
        tableName: dataConfig.table_name,
        fieldName: dataConfig.group_by?.[0]?.field_name ?? null,
        selectMode: slicer.selectMode ?? null,
        displayMode: slicer.displayMode ?? null,
        defaultValue,
      },
    });
  }

  const rawTableId = optionalText(snapshot?.tableView?.tableId) ?? optionalText(widget?.data?.tableId);
  const rawViewId = optionalText(snapshot?.tableView?.viewId) ?? optionalText(widget?.data?.viewId);
  const tableName = rawTableId ? references.tableById.get(rawTableId) : null;
  const view = rawViewId ? references.viewById.get(rawViewId) : null;
  if (!tableName || !view || view.tableName !== tableName) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_TABLE_VIEW_REFERENCE_UNMAPPED', 'Table View widget references could not be mapped to semantic names', {
      dashboardOrdinal,
      blockName: optionalText(widget?.name),
    });
  }
  return deepFreeze({
    sourceOrdinal: layoutOrdinal,
    name: requireText(widget?.name, `dashboard[${dashboardOrdinal}] Table View name`),
    sourceKind: 'table_view',
    supportedByDocumentedApi: false,
    type: null,
    dataConfig: null,
    position: normalizedPosition,
    manualReference: { tableName, viewName: view.viewName },
  });
}

function buildDataConfig(snapshot, type, references, options = {}) {
  const sources = requireArray(snapshot?.dataSources ?? [], 'chart dataSources');
  if (sources.length !== 1) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_MULTI_SOURCE_UNSUPPORTED', 'Current Dashboard API parity supports exactly one Source per reviewed block', {
      dataSourceCount: sources.length,
    });
  }
  const rangeDefinition = parseStructuredJson(sources[0]?.rangeDefinition, 'rangeDefinition');
  const tableId = findKnownReference(rangeDefinition?.refMap, references.tableById);
  const tableName = tableId ? references.tableById.get(tableId) : null;
  if (!tableName) throw codedError('CUSTOMER_BASE_DASHBOARD_TABLE_UNMAPPED', 'Dashboard chart Source Table could not be mapped');
  const dataCondition = requireObject(rangeDefinition?.dataCondition, 'rangeDefinition.dataCondition');
  const result = { table_name: tableName };

  const series = dataCondition.seriesArray;
  if (series === 'COUNTA') {
    result.count_all = true;
  } else if (Array.isArray(series)) {
    result.series = series.map((item) => {
      const field = requireMappedField(item?.fieldId, references, tableName);
      const rollup = requireText(item?.rollup, `${field.fieldName} rollup`).toUpperCase();
      if (!SUPPORTED_ROLLUPS.has(rollup)) {
        throw codedError('CUSTOMER_BASE_DASHBOARD_ROLLUP_UNSUPPORTED', 'Dashboard series uses an unsupported rollup', { rollup });
      }
      return { field_name: field.fieldName, rollup };
    });
  } else {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SERIES_UNSUPPORTED', 'Dashboard block has an unsupported series definition');
  }

  const group = Array.isArray(dataCondition.group) ? dataCondition.group : [];
  if (group.length > 0) {
    result.group_by = group.map((item) => {
      const field = requireMappedField(item?.fieldId, references, tableName);
      const mapped = {
        field_name: field.fieldName,
        mode: optionalText(item?.mode) ?? 'integrated',
      };
      if (item?.sort) mapped.sort = normalizeGroupSort(item.sort);
      return mapped;
    });
  }

  const filterInfo = dataCondition?.source?.filterInfo;
  if (filterInfo) result.filter = normalizeChartFilter(filterInfo, references, tableName);

  if (type === 'statistics') {
    const formatInfo = snapshot?.viewModel?.rules?.statistics?.formatInfo;
    if (formatInfo && typeof formatInfo === 'object') {
      const formatName = optionalText(formatInfo.formatName);
      const precision = formatInfo.precision;
      const numberFormat = {};
      if (formatName) {
        if (!SUPPORTED_NUMBER_FORMATS.has(formatName)) {
          throw codedError('CUSTOMER_BASE_DASHBOARD_NUMBER_FORMAT_UNSUPPORTED', 'Statistics block uses an unsupported number format', { formatName });
        }
        numberFormat.formatName = formatName;
      }
      if (precision !== undefined && precision !== null) {
        const value = finiteInteger(precision, 'statistics precision');
        if (value < 0 || value > 9) throw new TypeError('statistics precision must be 0..9');
        numberFormat.precision = value;
      }
      if (Object.keys(numberFormat).length > 0) result.number_format = numberFormat;
    }
  }

  if (options.allowSlicer === true) return result;
  if (!result.count_all && !result.series) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_METRIC_MISSING', 'Dashboard chart requires count_all or series');
  }
  return result;
}

function normalizeChartFilter(filterInfo, references, tableName) {
  const source = requireObject(filterInfo, 'chart filterInfo');
  return {
    conjunction: source.conjunction === 'or' ? 'or' : 'and',
    conditions: requireArray(source.conditions ?? [], 'chart filter conditions').map((condition) => {
      const field = requireMappedField(condition?.fieldId, references, tableName);
      const operator = requireText(condition?.operator, 'chart filter operator');
      const normalized = { field_name: field.fieldName, operator };
      if (!VALUELESS_FILTER_OPERATORS.has(operator)) {
        normalized.value = normalizeFilterValue(condition?.value, field, references);
      }
      return normalized;
    }),
  };
}

function normalizeFilterValue(value, field, references) {
  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) {
      try { source = JSON.parse(trimmed); } catch { source = value; }
    }
  }
  const values = Array.isArray(source) ? source : [source];
  const mapped = values.map((item) => {
    if (typeof item === 'string' && references.optionById.has(item)) {
      const option = references.optionById.get(item);
      if (option.tableName !== field.tableName || option.fieldName !== field.fieldName) {
        throw codedError('CUSTOMER_BASE_DASHBOARD_OPTION_FIELD_MISMATCH', 'Dashboard filter option belongs to a different Field');
      }
      return option.optionName;
    }
    return item;
  });

  if (field.type === 3) {
    if (mapped.length !== 1) throw codedError('CUSTOMER_BASE_DASHBOARD_SINGLE_SELECT_FILTER_MULTI_VALUE', 'SingleSelect Dashboard filter must contain one option');
    return mapped[0];
  }
  if (field.type === 4) return mapped;
  if (mapped.length === 1) return mapped[0];
  return mapped;
}

function normalizeGroupSort(sort) {
  const type = requireText(sort?.sortType ?? sort?.type, 'group sort type').toLowerCase();
  if (!SUPPORTED_SORT_TYPES.has(type)) throw codedError('CUSTOMER_BASE_DASHBOARD_SORT_TYPE_UNSUPPORTED', 'Dashboard group sort type is unsupported', { type });
  let order = optionalText(sort?.sortOrder ?? sort?.order)?.toLowerCase() ?? null;
  if (!order && (type === 'group' || type === 'view')) order = 'asc';
  if (!order || !SUPPORTED_SORT_ORDERS.has(order)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SORT_ORDER_REQUIRED', 'Dashboard value sort requires an explicit supported direction', { type, order });
  }
  return { type, order };
}

function extractRichText(snapshot) {
  const textMap = snapshot?.text?.initialAttributedTexts?.text;
  if (!textMap || typeof textMap !== 'object' || Array.isArray(textMap)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_TEXT_SNAPSHOT_INVALID', 'Rich Text block has no exported text payload');
  }
  const keys = Object.keys(textMap).sort((a, b) => Number(a) - Number(b));
  const raw = keys.map((key) => String(textMap[key] ?? '')).join('');
  const cleaned = raw.split('\n').map((line) => line.startsWith('*') ? line.slice(1) : line).join('\n').trim();
  if (!cleaned) throw codedError('CUSTOMER_BASE_DASHBOARD_TEXT_EMPTY', 'Rich Text block is empty');
  return cleaned;
}

function toMarkdownText(snapshot, text) {
  const hasH2 = Object.values(snapshot?.text?.apool?.numToAttrib ?? {}).some(
    (value) => Array.isArray(value) && value[0] === 'heading' && value[1] === 'h2',
  );
  if (!hasH2) return text;
  const lines = text.split('\n');
  if (lines[0]?.trim()) lines[0] = `## ${lines[0].trim()}`;
  return lines.join('\n');
}

function matchChart(widget, charts, usedCharts, dashboardOrdinal) {
  const chartId = optionalText(widget?.data?.chartId);
  const token = optionalText(widget?.data?.token);
  let matches = [];
  if (chartId) matches = charts.filter((chart) => !usedCharts.has(chart) && String(chart?.chartID ?? '') === chartId);
  if (matches.length === 0 && token) matches = charts.filter((chart) => !usedCharts.has(chart) && String(chart?.token ?? '') === token);
  if (matches.length !== 1) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_WIDGET_CHART_MAPPING_AMBIGUOUS', 'Dashboard widget did not map to exactly one Source chart', {
      dashboardOrdinal,
      widgetName: optionalText(widget?.name),
      matches: matches.length,
    });
  }
  return matches[0];
}

async function buildReferenceMaps(sourceClient) {
  const tableById = new Map();
  const fieldById = new Map();
  const optionById = new Map();
  const viewById = new Map();
  for (const table of await sourceClient.listTables()) {
    const tableId = requireText(table?.tableId, 'Source tableId');
    const tableName = requireText(table?.name, 'Source table name');
    tableById.set(tableId, tableName);
    for (const field of await sourceClient.listFields({ tableId })) {
      const fieldId = requireText(field?.fieldId, `${tableName} fieldId`);
      const fieldName = requireText(field?.fieldName, `${tableName} fieldName`);
      const normalized = { tableId, tableName, fieldName, type: Number(field?.type) };
      fieldById.set(fieldId, normalized);
      const options = Array.isArray(field?.property?.options)
        ? field.property.options
        : (Array.isArray(field?.exportProperty?.options) ? field.exportProperty.options : []);
      for (const option of options) {
        const optionId = optionalText(option?.id);
        if (!optionId) continue;
        optionById.set(optionId, {
          tableName,
          fieldName,
          optionName: requireText(option?.name, `${tableName}.${fieldName} option name`),
        });
      }
    }
    for (const view of await sourceClient.listViews({ tableId })) {
      const viewId = requireText(view?.viewId, `${tableName} viewId`);
      viewById.set(viewId, { tableName, viewName: requireText(view?.viewName, `${tableName} viewName`) });
    }
  }
  return { tableById, fieldById, optionById, viewById };
}

async function ensureDashboard({ targetClient, dashboardPlan, folderId, initialDashboards, mode, mutationLog, onProgress }) {
  let dashboards = initialDashboards.filter((item) => dashboardName(item) === dashboardPlan.name);
  if (dashboards.length > 1) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_DUPLICATE_TARGET', 'Target contains duplicate Dashboard names', { name: dashboardPlan.name });
  }

  const resumedExistingDashboard = dashboards.length === 1;
  if (dashboards.length === 0) {
    if (mode === 'apply') {
      await requestDashboardApi(
        targetClient,
        `create_dashboard:${dashboardPlan.name}`,
        `/open-apis/base/v3/bases/${encodeURIComponent(targetClient.appToken)}/blocks`,
        {
          method: 'POST',
          retryMode: 'rate_limit_only',
          body: { type: 'dashboard', name: dashboardPlan.name, parent_id: folderId },
        },
      );
      mutationLog.push({ kind: 'dashboard', action: 'create', dashboardName: dashboardPlan.name });
      onProgress({ stage: 'dashboard_created', dashboardName: dashboardPlan.name });
      const refreshed = await listDashboards(targetClient);
      dashboards = refreshed.filter((item) => dashboardName(item) === dashboardPlan.name);
      if (dashboards.length !== 1) {
        throw codedError('CUSTOMER_BASE_DASHBOARD_CREATE_READBACK_MISMATCH', 'Dashboard did not materialize exactly once after create', { name: dashboardPlan.name });
      }
    } else {
      return previewMissingDashboard(dashboardPlan);
    }
  }

  const dashboard = dashboards[0];
  const dashboardId = requireText(dashboard?.dashboard_id ?? dashboard?.id ?? dashboard?.block_id, 'dashboard id');
  const baseBlocks = await listBaseBlocks(targetClient);
  const nav = baseBlocks.find((item) => blockId(item) === dashboardId);
  if (!nav || optionalText(nav.parent_id) !== folderId) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_FOLDER_MISMATCH', 'Dashboard is not under the approved Target folder', {
      dashboardName: dashboardPlan.name,
      expectedParentId: folderId,
      actualParentId: optionalText(nav?.parent_id),
    });
  }

  let existingBlocks = await listDashboardBlocks(targetClient, dashboardId);
  const existingBlockCountAtStart = existingBlocks.length;
  const byName = groupBy(existingBlocks, blockName);
  const supportedBlocks = dashboardPlan.blocks.filter((block) => block.supportedByDocumentedApi);
  const unsupportedBlocks = dashboardPlan.blocks.filter((block) => !block.supportedByDocumentedApi);
  const expectedNames = new Set(dashboardPlan.blocks.map((block) => block.name));
  const unknownNames = existingBlocks.map(blockName).filter((name) => name && !expectedNames.has(name));
  if (unknownNames.length > 0) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_UNKNOWN_TARGET_BLOCK', 'Target Dashboard contains block names outside current Source authority', {
      dashboardName: dashboardPlan.name,
      unknownNames,
    });
  }

  let missing = 0;
  for (const spec of supportedBlocks) {
    const matches = byName.get(spec.name) ?? [];
    if (matches.length > 1) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_DUPLICATE_BLOCK', 'Target Dashboard contains duplicate block names', {
        dashboardName: dashboardPlan.name,
        blockName: spec.name,
      });
    }
    if (matches.length === 1) {
      verifyExistingBlockSummary(matches[0], spec);
      continue;
    }

    missing += 1;
    if (mode !== 'apply') continue;

    await requestDashboardApi(
      targetClient,
      `create_dashboard_block:${dashboardPlan.name}:${spec.name}`,
      `/open-apis/base/v3/bases/${encodeURIComponent(targetClient.appToken)}/dashboards/${encodeURIComponent(dashboardId)}/blocks`,
      {
        method: 'POST',
        retryMode: 'rate_limit_only',
        body: {
          name: spec.name,
          type: spec.type,
          data_config: spec.dataConfig,
          position: spec.position,
        },
      },
    );
    mutationLog.push({ kind: 'dashboard_block', action: 'create', dashboardName: dashboardPlan.name, blockName: spec.name, type: spec.type });
    onProgress({ stage: 'dashboard_block_created', dashboardName: dashboardPlan.name, blockName: spec.name });

    existingBlocks = await listDashboardBlocks(targetClient, dashboardId);
    const created = existingBlocks.filter((item) => blockName(item) === spec.name);
    if (created.length !== 1) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_CREATE_READBACK_MISMATCH', 'Dashboard block did not materialize exactly once after create', {
        dashboardName: dashboardPlan.name,
        blockName: spec.name,
      });
    }
    verifyExistingBlockSummary(created[0], spec);
    byName.set(spec.name, created);
  }

  if (mode === 'apply') {
    existingBlocks = await listDashboardBlocks(targetClient, dashboardId);
    missing = supportedBlocks.filter((spec) => !existingBlocks.some((item) => blockName(item) === spec.name)).length;
  }

  return deepFreeze({
    name: dashboardPlan.name,
    dashboardId,
    expectedBlocks: dashboardPlan.blocks.length,
    documentedApiBlocks: supportedBlocks.length,
    documentedApiMismatchCount: missing,
    resumedExistingDashboard,
    existingBlockCountAtStart,
    themeParity: 'deferred_post_materialization',
    deepDetailVerification: 'deferred_post_materialization',
    unsupportedRemainingCount: unsupportedBlocks.length,
    unsupportedBlocks: unsupportedBlocks.map((block) => ({
      name: block.name,
      sourceKind: block.sourceKind,
      position: block.position,
      manualReference: block.manualReference ?? null,
    })),
  });
}

function verifyExistingBlockSummary(summary, spec) {
  const actualType = optionalText(summary?.type);
  if (actualType && actualType !== spec.type) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_TYPE_CONFLICT', 'Existing Dashboard block type differs from Source', {
      blockName: spec.name,
      expectedType: spec.type,
      actualType,
    });
  }

  const actualDataConfig = summary?.data_config ?? summary?.dataConfig;
  if (actualDataConfig && !semanticSubset(spec.dataConfig, actualDataConfig)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_DATA_CONFLICT', 'Existing Dashboard block list readback data_config differs from Source', {
      blockName: spec.name,
    });
  }

  if (summary?.position && !semanticSubset(spec.position, summary.position)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_POSITION_CONFLICT', 'Existing Dashboard block list readback position differs from Source', {
      blockName: spec.name,
      expected: spec.position,
      actual: summary.position,
    });
  }
}

function previewMissingDashboard(dashboardPlan) {
  const supported = dashboardPlan.blocks.filter((block) => block.supportedByDocumentedApi);
  const unsupported = dashboardPlan.blocks.filter((block) => !block.supportedByDocumentedApi);
  return deepFreeze({
    name: dashboardPlan.name,
    dashboardId: null,
    expectedBlocks: dashboardPlan.blocks.length,
    documentedApiBlocks: supported.length,
    unsupportedRemainingCount: unsupported.length,
    unsupportedBlocks: unsupported.map((block) => ({
      name: block.name,
      sourceKind: block.sourceKind,
      position: block.position,
      manualReference: block.manualReference ?? null,
    })),
    documentedApiMismatchCount: supported.length,
    resumedExistingDashboard: false,
    existingBlockCountAtStart: 0,
    themeParity: 'deferred_post_materialization',
    deepDetailVerification: 'deferred_post_materialization',
  });
}

async function verifyTargetAnchors(targetClient, requiredNames) {
  if (!Array.isArray(requiredNames) || requiredNames.length === 0) return;
  const tables = await targetClient.listTables();
  const names = new Set(tables.map((table) => table.name));
  const missing = requiredNames.filter((name) => !names.has(name));
  if (missing.length > 0) throw codedError('CUSTOMER_BASE_DASHBOARD_TARGET_ANCHOR_MISSING', 'Target Base identity anchors are missing', { missing });
}

async function listDashboards(client) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const response = await requestDashboardApi(
      client,
      'list_dashboards',
      `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/dashboards?${params.toString()}`,
      { method: 'GET' },
    );
    const data = response?.data ?? response ?? {};
    items.push(...collection(data, ['items', 'dashboards']));
    if (data.has_more !== true) return items;
    const next = optionalText(data.page_token);
    if (!next || next === pageToken) throw codedError('CUSTOMER_BASE_DASHBOARD_PAGINATION_INVALID', 'Dashboard pagination returned an invalid page_token');
    pageToken = next;
  }
  throw codedError('CUSTOMER_BASE_DASHBOARD_PAGINATION_LIMIT', 'Dashboard pagination exceeded 100 pages');
}

async function listDashboardBlocks(client, dashboardId) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const response = await requestDashboardApi(
      client,
      'list_dashboard_blocks',
      `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/dashboards/${encodeURIComponent(dashboardId)}/blocks?${params.toString()}`,
      { method: 'GET' },
    );
    const data = response?.data ?? response ?? {};
    items.push(...collection(data, ['items', 'blocks']));
    if (data.has_more !== true) return items;
    const next = optionalText(data.page_token);
    if (!next || next === pageToken) throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_PAGINATION_INVALID', 'Dashboard block pagination returned an invalid page_token');
    pageToken = next;
  }
  throw codedError('CUSTOMER_BASE_DASHBOARD_BLOCK_PAGINATION_LIMIT', 'Dashboard block pagination exceeded 100 pages');
}

async function listBaseBlocks(client) {
  const response = await requestDashboardApi(
    client,
    'list_base_blocks',
    `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/blocks/list`,
    { method: 'POST', body: {} },
  );
  return collection(response?.data ?? response ?? {}, ['blocks', 'items']);
}

async function requestDashboardApi(client, stage, path, options) {
  try {
    return await client.requestBitableJson(path, options);
  } catch (error) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_API_STAGE_FAILED', `Dashboard API stage failed: ${stage}`, {
      stage,
      causeCode: error?.code ?? null,
      status: error?.details?.status ?? null,
      larkCode: error?.details?.larkCode ?? null,
      retryAfter: error?.details?.retryAfter ?? null,
    });
  }
}

function resolveUniqueNamedBlock(blocks, name, expectedKind) {
  const matches = blocks.filter((item) => blockName(item) === name);
  if (matches.length !== 1) throw codedError('CUSTOMER_BASE_DASHBOARD_FOLDER_RESOLUTION_FAILED', 'Approved Target folder must resolve exactly once', { name, matches: matches.length, expectedKind });
  return matches[0];
}

function collection(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function dashboardName(value) { return optionalText(value?.name) ?? ''; }
function blockName(value) { return optionalText(value?.name) ?? ''; }
function blockId(value) { return optionalText(value?.block_id ?? value?.id) ?? ''; }

function requireMappedField(fieldIdValue, references, expectedTableName) {
  const fieldId = requireText(fieldIdValue, 'Dashboard Source fieldId');
  const field = references.fieldById.get(fieldId);
  if (!field || field.tableName !== expectedTableName) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_FIELD_UNMAPPED', 'Dashboard Source Field could not be mapped in the expected Table', { expectedTableName });
  }
  return field;
}

function mapPossibleReference(value, references) {
  if (typeof value !== 'string') return value ?? null;
  if (references.optionById.has(value)) return references.optionById.get(value).optionName;
  if (references.fieldById.has(value)) return references.fieldById.get(value).fieldName;
  if (references.tableById.has(value)) return references.tableById.get(value);
  if (references.viewById.has(value)) return references.viewById.get(value).viewName;
  return value;
}

function findKnownReference(value, map) {
  if (typeof value === 'string') return map.has(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKnownReference(item, map);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      const found = findKnownReference(nested, map);
      if (found) return found;
    }
  }
  return null;
}

function parseStructuredJson(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = requireText(value, label);
  try { return JSON.parse(text); } catch (error) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_STRUCTURED_JSON_INVALID', `${label} is not valid JSON`, { cause: error?.message ?? String(error) });
  }
}

function decodeBase64Json(value, label) {
  const text = requireText(value, label).replace(/\s+/gu, '');
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/u.test(text)) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SNAPSHOT_ENCODING_INVALID', `${label} is not strict Base64`);
  }
  try { return JSON.parse(Buffer.from(text, 'base64').toString('utf8')); } catch (error) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SNAPSHOT_JSON_INVALID', `${label} is not Base64 UTF-8 JSON`, { cause: error?.message ?? String(error) });
  }
}

function normalizePosition(value, label) {
  const source = requireObject(value, label);
  const result = {};
  for (const key of ['x', 'y', 'w', 'h']) {
    const number = Number(source[key]);
    if (!Number.isFinite(number)) throw new TypeError(`${label}.${key} must be numeric`);
    result[key] = number;
  }
  if (result.x < 0 || result.y < 0 || result.w < 1 || result.w > 12 || result.h < 1 || result.x + result.w > 12) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_POSITION_OUT_OF_RANGE', 'Source Dashboard position is outside the documented 12-column grid', { label, position: result });
  }
  return result;
}

function firstNonEmptyLine(text) {
  const value = text.split('\n').map((line) => line.trim()).find(Boolean);
  return requireText(value, 'Rich Text first line');
}

function comparePosition(a, b) {
  return a.position.y - b.position.y || a.position.x - b.position.x || a.sourceOrdinal - b.sourceOrdinal;
}

function assertUniqueNames(blocks, label) {
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.name)) throw codedError('CUSTOMER_BASE_DASHBOARD_DUPLICATE_SOURCE_BLOCK_NAME', `${label} contains duplicate block names`, { name: block.name });
    seen.add(block.name);
  }
}

function semanticSubset(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => semanticSubset(value, actual[index]));
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => Object.prototype.hasOwnProperty.call(actual, key) && semanticSubset(value, actual[key]));
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
function groupBy(values, keyFn) {
  const result = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(value);
  }
  return result;
}
function requireClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews', 'getExportResources']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
  }
}
function requireTargetClient(client) {
  if (!client || typeof client.listTables !== 'function' || typeof client.requestBitableJson !== 'function') {
    throw new TypeError('targetClient must be the shared LarkBitableClient');
  }
  requireText(client.appToken, 'targetClient.appToken');
}
function requirePlan(plan) {
  if (!plan || plan.contractVersion !== 'customer_base_dashboard_documented_api_parity_v1') throw new TypeError('invalid Customer Base Dashboard parity plan');
}
function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function requireText(value, name) {
  const result = optionalText(String(value ?? ''));
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}
function finiteInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`);
  return number;
}
function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
