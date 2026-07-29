import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIVERSAL_MARKETING_DASHBOARD_CONTRACT,
  UNIVERSAL_MARKETING_DASHBOARD_VERSION,
  validateUniversalMarketingDashboardContract,
} from '../../packages/config/src/universal-marketing-dashboard-contract.js';
import { DASHBOARD_REPORT_BLUEPRINT } from '../../packages/config/src/dashboard-report-blueprint.js';

test('Universal Dashboard discovers channels, capabilities, collections and metrics', () => {
  assert.equal(validateUniversalMarketingDashboardContract(), true);
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_VERSION, 'universal-marketing-dashboard-v1');
  assert.equal(Object.isFrozen(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT), true);
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.platformDiscovery, 'materialization.platformScope');
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.capabilityDiscovery, 'materialization.capability');
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.metricDiscovery, 'materialization.metricPayload.clientVisible');
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.collectionDiscovery, 'materialization.collections');
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.collectionStrategy, 'render_discovered_collection_kinds');
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.invariants.platformSpecificDashboardCode, false);
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.invariants.capabilitySpecificDashboardCode, false);
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.invariants.collectionSpecificDashboardCode, false);
  assert.equal(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT.invariants.platformSpecificLarkView, false);

  const encoded = JSON.stringify(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT);
  for (const literal of [
    'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads', 'tiktok_ads',
    'commerce', 'customer_service', 'top_products', 'top_agents',
  ]) {
    assert.equal(encoded.includes(literal), false, `contract must not hardcode ${literal}`);
  }
});

test('Dashboard blueprint delegates platform discovery to materializations and shared registry', () => {
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.schemaVersion, 'dashboard-report-blueprint-v3');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.platformAuthority, 'report_platform_adapter_registry');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.platformDiscovery, 'validated_materializations');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.universalRenderer.version, UNIVERSAL_MARKETING_DASHBOARD_VERSION);
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.universalRenderer.platformSpecificCodeAllowed, false);
  assert.equal(Object.hasOwn(DASHBOARD_REPORT_BLUEPRINT, 'platformScopes'), false);
});

test('Universal Dashboard contract fails closed when source-specific behavior is allowed', () => {
  const platformSpecific = structuredClone(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT);
  platformSpecific.invariants.platformSpecificDashboardCode = true;
  assert.throws(
    () => validateUniversalMarketingDashboardContract(platformSpecific),
    /invariants are unsafe/u,
  );

  const collectionSpecific = structuredClone(UNIVERSAL_MARKETING_DASHBOARD_CONTRACT);
  collectionSpecific.invariants.collectionSpecificDashboardCode = true;
  assert.throws(
    () => validateUniversalMarketingDashboardContract(collectionSpecific),
    /invariants are unsafe/u,
  );
});
