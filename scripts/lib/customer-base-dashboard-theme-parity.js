export const CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION =
  'APPLY_CUSTOMER_BASE_DASHBOARD_THEME_PARITY_V1';

export const CUSTOMER_BASE_DASHBOARD_THEME_STYLE = 'summerBreeze';

const DASHBOARD_BLOCK_COUNTS = Object.freeze([
  Object.freeze({ name: '💬 Customer Service & Leads', blocks: 10 }),
  Object.freeze({ name: '🛡️ Data Quality & Operations', blocks: 6 }),
  Object.freeze({ name: '📊 Executive Marketing Overview', blocks: 10 }),
  Object.freeze({ name: '🌱 Organic Performance', blocks: 20 }),
  Object.freeze({ name: '💰 Paid Ads Performance', blocks: 11 }),
  Object.freeze({ name: '🛒 Commerce & Conversion', blocks: 9 }),
]);

export async function applyCustomerBaseDashboardThemeParity({
  targetClient,
  mode = 'preview',
  confirmation = null,
  folderName = 'Setup Phase | Social MKT Data Hub',
  themeStyle = CUSTOMER_BASE_DASHBOARD_THEME_STYLE,
  onProgress = () => undefined,
}) {
  requireTargetClient(targetClient);
  if (!['preview', 'apply'].includes(mode)) throw new TypeError('mode must be preview or apply');
  if (mode === 'apply' && confirmation !== CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION_REQUIRED', 'Exact Dashboard theme apply confirmation is required');
  }

  const topology = await stage('list_base_blocks', () => listBaseBlocks(targetClient));
  const folder = resolveUniqueNamedBlock(topology, folderName);
  const folderId = requireText(folder?.block_id ?? folder?.id, 'target folder block id');
  const dashboards = await stage('list_dashboards', () => listDashboards(targetClient));

  const targets = [];
  for (const authority of DASHBOARD_BLOCK_COUNTS) {
    const matches = dashboards.filter((item) => dashboardName(item) === authority.name);
    if (matches.length !== 1) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_DASHBOARD_RESOLUTION_FAILED', 'Each authoritative Dashboard must resolve exactly once', {
        dashboardName: authority.name,
        matches: matches.length,
      });
    }
    const dashboardId = requireText(matches[0]?.dashboard_id ?? matches[0]?.id ?? matches[0]?.block_id, `${authority.name} dashboard id`);
    const nav = topology.find((item) => blockId(item) === dashboardId);
    if (!nav || optionalText(nav.parent_id) !== folderId) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_FOLDER_MISMATCH', 'Dashboard is not under the approved Target folder', {
        dashboardName: authority.name,
        expectedParentId: folderId,
        actualParentId: optionalText(nav?.parent_id),
      });
    }
    const blocks = await stage(`list_dashboard_blocks:${authority.name}`, () => listDashboardBlocks(targetClient, dashboardId));
    if (blocks.length !== authority.blocks) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_BLOCK_COUNT_MISMATCH', 'Documented Dashboard blocks drifted before theme parity', {
        dashboardName: authority.name,
        expected: authority.blocks,
        actual: blocks.length,
      });
    }
    targets.push({ name: authority.name, dashboardId, documentedBlockCount: blocks.length });
  }

  // Dashboard containers created through the generic Base Block lifecycle can
  // host Dashboard components yet still reject the specialized Dashboard
  // detail/update route with Lark code=1. Probe the specialized GET route for
  // every target before the first PATCH so a known unsupported container shape
  // can never leave a partial theme write behind.
  const detailProbe = await probeDashboardDetailRoute(targetClient, targets);
  if (!detailProbe.supported) {
    return deepFreeze({
      ok: true,
      contractVersion: 'customer_base_dashboard_theme_parity_v1',
      action: mode,
      status: 'DASHBOARD_THEME_DEFERRED_CONTAINER_UPDATE_UNSUPPORTED',
      targetFolder: folderName,
      expectedThemeStyle: themeStyle,
      dashboards: targets.map((item) => ({
        ...item,
        themeMutationPlanned: false,
        specializedDashboardRouteSupported: false,
      })),
      deferred: {
        reason: 'specialized_dashboard_get_rejected_current_container',
        stage: detailProbe.stage,
        dashboardName: detailProbe.dashboardName,
        causeCode: detailProbe.causeCode,
        causeMessage: detailProbe.causeMessage,
        larkCode: detailProbe.larkCode,
      },
      dashboardThemeMutationCount: 0,
      dashboardBlockMutationCount: 0,
      tableMutationCount: 0,
      fieldMutationCount: 0,
      recordMutationCount: 0,
      viewMutationCount: 0,
      formulaMutationCount: 0,
      roleMutationCount: 0,
      workflowMutationCount: 0,
    });
  }

  if (mode === 'preview') {
    return deepFreeze({
      ok: true,
      contractVersion: 'customer_base_dashboard_theme_parity_v1',
      action: 'preview',
      status: 'DASHBOARD_THEME_PREVIEW_READY',
      targetFolder: folderName,
      expectedThemeStyle: themeStyle,
      dashboards: targets.map((item) => ({
        ...item,
        themeMutationPlanned: true,
        specializedDashboardRouteSupported: true,
      })),
      dashboardThemeMutationCount: 0,
      dashboardBlockMutationCount: 0,
      tableMutationCount: 0,
      fieldMutationCount: 0,
      recordMutationCount: 0,
      viewMutationCount: 0,
      formulaMutationCount: 0,
      roleMutationCount: 0,
      workflowMutationCount: 0,
    });
  }

  const completed = [];
  const results = [];
  for (const target of targets) {
    onProgress({ stage: 'dashboard_theme_apply_start', dashboardName: target.name, completedCount: completed.length });
    let response;
    try {
      response = await targetClient.requestBitableJson(
        `/open-apis/base/v3/bases/${encodeURIComponent(targetClient.appToken)}/dashboards/${encodeURIComponent(target.dashboardId)}`,
        { method: 'PATCH', body: { theme: { theme_style: themeStyle } } },
      );
    } catch (error) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_REQUEST_FAILED', 'Dashboard theme update failed', {
        stage: `patch_dashboard_theme:${target.name}`,
        dashboardName: target.name,
        completedDashboards: completed,
        causeCode: error?.code ?? null,
        causeMessage: error?.message ?? String(error),
      });
    }

    const echoedTheme = extractThemeStyle(response);
    if (echoedTheme !== themeStyle) {
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_RESPONSE_MISMATCH', 'Dashboard theme update response did not echo the expected theme', {
        stage: `patch_dashboard_theme:${target.name}`,
        dashboardName: target.name,
        expected: themeStyle,
        actual: echoedTheme,
        completedDashboards: completed,
      });
    }
    completed.push(target.name);
    results.push({ ...target, themeStyle: echoedTheme, verifiedBy: 'patch-response-echo' });
    onProgress({ stage: 'dashboard_theme_apply_pass', dashboardName: target.name, completedCount: completed.length });
  }

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_dashboard_theme_parity_v1',
    action: 'apply',
    status: 'DASHBOARD_THEME_PASS',
    targetFolder: folderName,
    expectedThemeStyle: themeStyle,
    dashboards: results,
    dashboardThemeMutationCount: results.length,
    dashboardBlockMutationCount: 0,
    tableMutationCount: 0,
    fieldMutationCount: 0,
    recordMutationCount: 0,
    viewMutationCount: 0,
    formulaMutationCount: 0,
    roleMutationCount: 0,
    workflowMutationCount: 0,
  });
}

async function probeDashboardDetailRoute(client, targets) {
  for (const target of targets) {
    try {
      const response = await client.requestBitableJson(
        `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/dashboards/${encodeURIComponent(target.dashboardId)}`,
        { method: 'GET' },
      );
      const detail = response?.data?.dashboard ?? response?.data ?? response ?? {};
      const detailId = optionalText(detail?.dashboard_id ?? detail?.id ?? detail?.block_id);
      const detailName = optionalText(detail?.name);
      if (detailId && detailId !== target.dashboardId) {
        throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_DETAIL_ID_MISMATCH', 'Dashboard detail resolved a different Dashboard id', {
          dashboardName: target.name,
          expected: target.dashboardId,
          actual: detailId,
        });
      }
      if (detailName && detailName !== target.name) {
        throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_DETAIL_NAME_MISMATCH', 'Dashboard detail resolved a different Dashboard name', {
          dashboardName: target.name,
          actual: detailName,
        });
      }
    } catch (error) {
      if (isCurrentContainerUnsupportedError(error)) {
        return {
          supported: false,
          stage: `get_dashboard_detail:${target.name}`,
          dashboardName: target.name,
          causeCode: error?.code ?? null,
          causeMessage: error?.message ?? String(error),
          larkCode: Number(error?.details?.larkCode) || null,
        };
      }
      throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_DETAIL_PREFLIGHT_FAILED', 'Dashboard specialized detail preflight failed', {
        stage: `get_dashboard_detail:${target.name}`,
        dashboardName: target.name,
        causeCode: error?.code ?? null,
        causeMessage: error?.message ?? String(error),
        larkCode: Number(error?.details?.larkCode) || null,
      });
    }
  }
  return { supported: true };
}

function isCurrentContainerUnsupportedError(error) {
  return error?.code === 'LARK_PERMANENT_API_ERROR'
    && Number(error?.details?.status) === 200
    && Number(error?.details?.larkCode) === 1;
}

async function listDashboards(client) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(`/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/dashboards?${params.toString()}`, { method: 'GET' });
    const data = response?.data ?? response ?? {};
    items.push(...collection(data, ['items', 'dashboards']));
    if (data.has_more !== true) return items;
    const next = optionalText(data.page_token);
    if (!next || next === pageToken) throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_PAGINATION_INVALID', 'Dashboard pagination returned an invalid page_token');
    pageToken = next;
  }
  throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_PAGINATION_LIMIT', 'Dashboard pagination exceeded 100 pages');
}

async function listDashboardBlocks(client, dashboardId) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(`/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/dashboards/${encodeURIComponent(dashboardId)}/blocks?${params.toString()}`, { method: 'GET' });
    const data = response?.data ?? response ?? {};
    items.push(...collection(data, ['items', 'blocks']));
    if (data.has_more !== true) return items;
    const next = optionalText(data.page_token);
    if (!next || next === pageToken) throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_BLOCK_PAGINATION_INVALID', 'Dashboard block pagination returned an invalid page_token');
    pageToken = next;
  }
  throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_BLOCK_PAGINATION_LIMIT', 'Dashboard block pagination exceeded 100 pages');
}

async function listBaseBlocks(client) {
  const response = await client.requestBitableJson(`/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/blocks/list`, { method: 'POST', body: {} });
  return collection(response?.data ?? response ?? {}, ['blocks', 'items']);
}

async function stage(name, fn) {
  try {
    return await fn();
  } catch (error) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_PREFLIGHT_FAILED', 'Dashboard theme preflight request failed', {
      stage: name,
      causeCode: error?.code ?? null,
      causeMessage: error?.message ?? String(error),
    });
  }
}

function extractThemeStyle(response) {
  return optionalText(
    response?.data?.theme?.theme_style
      ?? response?.data?.dashboard?.theme?.theme_style
      ?? response?.theme?.theme_style
      ?? response?.dashboard?.theme?.theme_style,
  );
}

function resolveUniqueNamedBlock(blocks, name) {
  const matches = blocks.filter((item) => blockName(item) === name);
  if (matches.length !== 1) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_THEME_FOLDER_RESOLUTION_FAILED', 'Approved Target folder must resolve exactly once', {
      name,
      matches: matches.length,
    });
  }
  return matches[0];
}

function collection(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function dashboardName(value) { return optionalText(value?.name) ?? ''; }
function blockName(value) { return optionalText(value?.name) ?? ''; }
function blockId(value) { return optionalText(value?.block_id ?? value?.id) ?? ''; }
function requireTargetClient(client) {
  if (!client || typeof client.requestBitableJson !== 'function') throw new TypeError('targetClient must be the shared LarkBitableClient');
  requireText(client.appToken, 'targetClient.appToken');
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function requireText(value, name) {
  const result = optionalText(String(value ?? ''));
  if (!result) throw new TypeError(`${name} is required`);
  return result;
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
