import {
  LARK_NATIVE_DASHBOARDS,
  LARK_NATIVE_DASHBOARD_INVARIANTS,
  LARK_NATIVE_DASHBOARD_VERSION,
  validateLarkNativeDashboardContract,
} from '../../../config/src/lark-native-dashboard-contract.js';

/**
 * Read-only inventory audit ของ Lark Native Dashboards.
 * Public OpenAPI ตรวจได้เฉพาะ Dashboard identity; Chart/Layout ต้องสร้างและตรวจใน Lark UI.
 */
export async function auditLarkNativeDashboards(input = {}) {
  const client = requireClient(input.client);
  const contract = input.contract ?? LARK_NATIVE_DASHBOARDS;
  const invariants = input.invariants ?? LARK_NATIVE_DASHBOARD_INVARIANTS;
  validateLarkNativeDashboardContract(contract, invariants);

  const live = await client.listDashboards();
  const byName = new Map();
  for (const dashboard of live) {
    const normalized = normalizeLiveDashboard(dashboard);
    const group = byName.get(normalized.name) ?? [];
    group.push(normalized);
    byName.set(normalized.name, group);
  }

  const expectedNames = new Set(contract.map((dashboard) => dashboard.name));
  const present = [];
  const missing = [];
  const conflicts = [];
  const manualActions = [];

  for (const expected of contract) {
    const matches = byName.get(expected.name) ?? [];
    if (matches.length > 1) {
      conflicts.push(Object.freeze({
        code: 'LARK_NATIVE_DASHBOARD_DUPLICATE_NAME',
        dashboardKey: expected.key,
        dashboardName: expected.name,
        blockIds: Object.freeze(matches.map((item) => item.blockId).sort()),
        message: `พบ Native Dashboard ชื่อซ้ำ: ${expected.name}`,
      }));
      continue;
    }
    if (matches.length === 0) {
      missing.push(expected);
      manualActions.push(Object.freeze({
        code: 'LARK_NATIVE_DASHBOARD_CREATE_IN_UI_REQUIRED',
        dashboardKey: expected.key,
        dashboardName: expected.name,
        audience: expected.audience,
        capability: expected.capability,
        sourceViews: expected.sourceViews,
        sections: expected.sections,
        message: `สร้าง ${expected.name} ใน Lark Base UI แล้วผูก Chart กับ Universal Report Views ตาม Contract`,
      }));
      continue;
    }
    present.push(Object.freeze({
      ...expected,
      blockId: matches[0].blockId,
    }));
    manualActions.push(Object.freeze({
      code: 'LARK_NATIVE_DASHBOARD_LAYOUT_REVIEW_REQUIRED',
      dashboardKey: expected.key,
      dashboardName: expected.name,
      blockId: matches[0].blockId,
      sourceViews: expected.sourceViews,
      sections: expected.sections,
      message: `ตรวจ Chart, Layout, Filters และ Audience ของ ${expected.name} ใน Lark UI`,
    }));
  }

  const unmanaged = live
    .map(normalizeLiveDashboard)
    .filter((dashboard) => !expectedNames.has(dashboard.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  return deepFreeze({
    mode: 'read_only_audit',
    dashboardVersion: LARK_NATIVE_DASHBOARD_VERSION,
    surface: invariants.surface,
    complete: missing.length === 0 && conflicts.length === 0,
    readyForManualBuild: conflicts.length === 0,
    summary: {
      expectedDashboards: contract.length,
      liveDashboards: live.length,
      presentDashboards: present.length,
      missingDashboards: missing.length,
      duplicateNameConflicts: conflicts.length,
      unmanagedDashboards: unmanaged.length,
      manualActions: manualActions.length,
    },
    present,
    missing,
    conflicts,
    unmanaged,
    manualActions,
    apiBoundary: {
      listIdentitySupported: true,
      copySupported: true,
      chartLayoutMutationSupported: false,
      chartLayoutVerification: 'manual_lark_ui',
    },
  });
}

function normalizeLiveDashboard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Live Lark dashboard must be an object');
  }
  return Object.freeze({
    blockId: requireText(value.blockId ?? value.block_id, 'dashboard.blockId'),
    name: requireText(value.name, 'dashboard.name'),
  });
}
function requireClient(value) {
  if (typeof value?.listDashboards !== 'function') {
    throw new TypeError('Lark native dashboard audit requires client.listDashboards');
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
