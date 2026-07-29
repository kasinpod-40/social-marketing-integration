const DASHBOARD_NAME_MAX_LENGTH = 100;

/**
 * Native Lark Base Dashboard contract.
 *
 * ช่องทางใหม่ต้องไหลเข้าหน้าเดิมผ่าน platform/account/capability filters และ Report materialization
 * ห้ามสร้าง Dashboard แยกตามชื่อ Platform.
 */
export const LARK_NATIVE_DASHBOARD_VERSION = 'lark-native-universal-dashboard-v1';

export const LARK_NATIVE_DASHBOARDS = deepFreeze([
  {
    key: 'executive_overview',
    name: '📊 Executive Marketing Overview',
    audience: 'client',
    capability: null,
    sourceViews: [
      '🧭 Dashboard Reports',
      '🧭 Dashboard Metrics',
      '🧭 Dashboard Top Content',
      '🧭 Dashboard Top Ads',
    ],
    sections: ['filters', 'kpi_cards', 'comparison', 'trend', 'top_content', 'top_ads', 'data_quality'],
  },
  {
    key: 'organic_performance',
    name: '🌱 Organic Performance',
    audience: 'client',
    capability: 'organic',
    sourceViews: ['🧭 Dashboard Reports', '🧭 Dashboard Metrics', '🧭 Dashboard Top Content'],
    sections: ['filters', 'kpi_cards', 'comparison', 'trend', 'platform_comparison', 'top_content', 'data_quality'],
  },
  {
    key: 'paid_ads_performance',
    name: '💰 Paid Ads Performance',
    audience: 'client',
    capability: 'paid_ads',
    sourceViews: ['🧭 Dashboard Reports', '🧭 Dashboard Metrics', '🧭 Dashboard Top Ads'],
    sections: ['filters', 'kpi_cards', 'comparison', 'trend', 'platform_comparison', 'top_ads', 'data_quality'],
  },
  {
    key: 'commerce_conversion',
    name: '🛒 Commerce & Conversion',
    audience: 'client',
    capability: 'commerce',
    sourceViews: ['🧭 Dashboard Reports', '🧭 Dashboard Metrics'],
    sections: ['filters', 'kpi_cards', 'comparison', 'trend', 'ranking_collections', 'data_quality'],
  },
  {
    key: 'customer_service_leads',
    name: '💬 Customer Service & Leads',
    audience: 'client',
    capability: 'customer_service',
    sourceViews: ['🧭 Dashboard Reports', '🧭 Dashboard Metrics'],
    sections: ['filters', 'kpi_cards', 'comparison', 'trend', 'ranking_collections', 'data_quality'],
  },
  {
    key: 'data_quality_operations',
    name: '🛡️ Data Quality & Operations',
    audience: 'internal',
    capability: null,
    sourceViews: ['🧭 Dashboard Reports'],
    sections: ['filters', 'freshness', 'coverage', 'data_status', 'connector_health', 'alerts'],
  },
]);

export const LARK_NATIVE_DASHBOARD_INVARIANTS = deepFreeze({
  surface: 'lark_base_native_dashboard',
  externalWebDashboardAllowed: false,
  platformSpecificDashboardAllowed: false,
  accountSpecificDashboardAllowed: false,
  sourceOfTruth: 'validated_report_materializations',
  detailedD1ReadsAllowed: false,
  preserveNull: true,
  observedZero: 0,
  publicApiMutationMode: 'manual_ui_for_chart_and_layout',
  publicApiVerificationMode: 'list_dashboards',
});

export function validateLarkNativeDashboardContract(
  dashboards = LARK_NATIVE_DASHBOARDS,
  invariants = LARK_NATIVE_DASHBOARD_INVARIANTS,
) {
  if (!Array.isArray(dashboards) || dashboards.length !== 6) {
    throw new TypeError('Lark native dashboard contract requires exactly six dashboards');
  }
  const keys = new Set();
  const names = new Set();
  for (const dashboard of dashboards) {
    if (!dashboard || typeof dashboard !== 'object' || Array.isArray(dashboard)) {
      throw new TypeError('Lark native dashboard must be an object');
    }
    requireKey(dashboard.key, 'dashboard.key');
    requireText(dashboard.name, 'dashboard.name');
    if (dashboard.name.length > DASHBOARD_NAME_MAX_LENGTH) {
      throw new TypeError(`Lark dashboard name exceeds ${DASHBOARD_NAME_MAX_LENGTH} characters`);
    }
    if (keys.has(dashboard.key) || names.has(dashboard.name)) {
      throw new TypeError('Lark native dashboard keys and names must be unique');
    }
    keys.add(dashboard.key);
    names.add(dashboard.name);
    if (!['client', 'internal'].includes(dashboard.audience)) {
      throw new TypeError(`Unsupported dashboard audience: ${dashboard.audience}`);
    }
    if (dashboard.capability !== null) requireKey(dashboard.capability, 'dashboard.capability');
    requireNonEmptyTextArray(dashboard.sourceViews, 'dashboard.sourceViews');
    requireNonEmptyTextArray(dashboard.sections, 'dashboard.sections');
  }
  if (invariants?.surface !== 'lark_base_native_dashboard'
    || invariants?.externalWebDashboardAllowed !== false
    || invariants?.platformSpecificDashboardAllowed !== false
    || invariants?.accountSpecificDashboardAllowed !== false
    || invariants?.sourceOfTruth !== 'validated_report_materializations'
    || invariants?.detailedD1ReadsAllowed !== false) {
    throw new TypeError('Lark native dashboard invariants are unsafe');
  }
  return true;
}

function requireNonEmptyTextArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldName} must be non-empty`);
  for (const item of value) requireText(item, fieldName);
}
function requireKey(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(text)) throw new TypeError(`${fieldName} must be an extensible key`);
  return text;
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

validateLarkNativeDashboardContract();
