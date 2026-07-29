/**
 * Universal Dashboard contract.
 *
 * Dashboard surfaces discover channels, capabilities, accounts, metrics, collections and report
 * periods from validated materializations. A new source must not require Dashboard/View code.
 */
export const UNIVERSAL_MARKETING_DASHBOARD_VERSION = 'universal-marketing-dashboard-v1';

export const UNIVERSAL_MARKETING_DASHBOARD_CONTRACT = deepFreeze({
  schemaVersion: UNIVERSAL_MARKETING_DASHBOARD_VERSION,
  sourceOfTruth: 'validated_report_materializations',
  platformDiscovery: 'materialization.platformScope',
  capabilityDiscovery: 'materialization.capability',
  accountDiscovery: 'materialization.accountId',
  metricDiscovery: 'materialization.metricPayload.clientVisible',
  collectionDiscovery: 'materialization.collections',
  periodDiscovery: 'materialization.period',
  filterKeys: [
    'customerKey',
    'customerProfile',
    'platform',
    'capability',
    'accountId',
    'periodKind',
    'windowDays',
    'reportSettingKey',
  ],
  sectionStrategy: 'group_by_discovered_capability',
  collectionStrategy: 'render_discovered_collection_kinds',
  legacyCollectionCompatibility: ['topContent', 'topAds'],
  dataQuality: {
    preserveNull: true,
    observedZero: 0,
    warnWhenStatusIsNot: 'complete',
    exposeCoverageRate: true,
  },
  invariants: {
    platformSpecificDashboardCode: false,
    capabilitySpecificDashboardCode: false,
    collectionSpecificDashboardCode: false,
    platformSpecificLarkView: false,
    metricSpecificColumnRequired: false,
    accountSpecificDashboardCode: false,
    detailedD1ReadsAllowed: false,
  },
});

export function validateUniversalMarketingDashboardContract(
  value = UNIVERSAL_MARKETING_DASHBOARD_CONTRACT,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Universal Marketing Dashboard contract must be an object');
  }
  if (value.schemaVersion !== UNIVERSAL_MARKETING_DASHBOARD_VERSION) {
    throw new TypeError('Universal Marketing Dashboard contract version mismatch');
  }
  if (value.sourceOfTruth !== 'validated_report_materializations') {
    throw new TypeError('Universal Marketing Dashboard must read validated materializations only');
  }
  if (value.collectionStrategy !== 'render_discovered_collection_kinds') {
    throw new TypeError('Universal Marketing Dashboard collections must be dynamically discovered');
  }
  if (!Array.isArray(value.filterKeys) || value.filterKeys.length === 0) {
    throw new TypeError('Universal Marketing Dashboard requires dynamic filter keys');
  }
  if (new Set(value.filterKeys).size !== value.filterKeys.length) {
    throw new TypeError('Universal Marketing Dashboard filter keys must be unique');
  }
  if (value.invariants?.platformSpecificDashboardCode !== false
    || value.invariants?.capabilitySpecificDashboardCode !== false
    || value.invariants?.collectionSpecificDashboardCode !== false
    || value.invariants?.platformSpecificLarkView !== false
    || value.invariants?.metricSpecificColumnRequired !== false
    || value.invariants?.accountSpecificDashboardCode !== false
    || value.invariants?.detailedD1ReadsAllowed !== false) {
    throw new TypeError('Universal Marketing Dashboard invariants are unsafe');
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

validateUniversalMarketingDashboardContract();
