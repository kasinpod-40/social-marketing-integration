import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDashboardReportSettingsReconciliation,
  planDashboardReportSettingsReconciliation,
} from '../../packages/application/src/use-cases/reconcile-dashboard-report-settings.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { DASHBOARD_REPORT_PLATFORM_SCOPES } from '../../packages/config/src/report-settings.seed.js';

const EXPECTED_CANONICAL_COUNT = 2 + (DASHBOARD_REPORT_PLATFORM_SCOPES.length * 7);

function legacyRecord(key, profile = 'dev_ft_pumkin') {
  return {
    recordId: `record:${key}`,
    fields: {
      report_setting_key: key,
      customer_profile: profile,
      platforms: ['tiktok'],
      enabled: true,
    },
  };
}

function buildRepository(records = [
  legacyRecord('dev_ft_pumkin:tiktok:daily'),
  legacyRecord('dev_ft_pumkin:tiktok:weekly'),
]) {
  const rows = structuredClone(records);
  let nextId = 1;
  return {
    rows,
    async prepareRows(_tableId, values) { return structuredClone(values); },
    async listByFieldValues(_tableId, fieldName, values) {
      return rows.filter((record) => values.includes(record.fields[fieldName]));
    },
    async createMany(_tableId, values) {
      for (const fields of values) {
        rows.push({ recordId: `created-${nextId++}`, fields: structuredClone(fields) });
      }
      return { created: values.length };
    },
    async updateMany(_tableId, values) {
      for (const value of values) {
        const record = rows.find((candidate) => candidate.recordId === value.recordId);
        record.fields = { ...record.fields, ...structuredClone(value.fields) };
      }
      return { updated: values.length };
    },
  };
}

test('creates canonical dashboard settings before disabling exact legacy rows', async () => {
  const repository = buildRepository();
  const syncEngine = new TableSyncEngine();
  const plan = await planDashboardReportSettingsReconciliation({
    repository,
    syncEngine,
    tableId: 'settings',
    profileKey: 'integration_workspace',
  });
  assert.deepEqual(plan.summary, {
    canonicalExpected: EXPECTED_CANONICAL_COUNT,
    canonicalCreates: EXPECTED_CANONICAL_COUNT,
    canonicalUpdates: 0,
    canonicalSkipped: 0,
    legacyFound: 2,
    legacyEnabled: 2,
    legacyAlreadyDisabled: 0,
    deleteCount: 0,
  });

  const result = await applyDashboardReportSettingsReconciliation({
    repository,
    syncEngine,
    plan,
  });
  assert.equal(result.canonical.created, EXPECTED_CANONICAL_COUNT);
  assert.equal(result.legacyDisabled, 2);
  assert.equal(result.verification.canonicalActive, EXPECTED_CANONICAL_COUNT);
  assert.equal(result.verification.legacyActive, 0);
  assert.equal(result.verification.legacyRetainedDisabled, 2);
  assert.equal(result.deleteCount, 0);
});

test('fails closed when an exact legacy key has an unexpected profile identity', async () => {
  const repository = buildRepository([
    legacyRecord('dev_ft_pumkin:tiktok:daily', 'integration_workspace'),
  ]);
  await assert.rejects(
    () => planDashboardReportSettingsReconciliation({
      repository,
      syncEngine: new TableSyncEngine(),
      tableId: 'settings',
      profileKey: 'integration_workspace',
    }),
    (error) => error.code === 'DASHBOARD_REPORT_LEGACY_SCOPE_INVALID',
  );
});

test('refuses Production profile reconciliation', async () => {
  const repository = buildRepository([]);
  await assert.rejects(
    () => planDashboardReportSettingsReconciliation({
      repository,
      syncEngine: new TableSyncEngine(),
      tableId: 'settings',
      profileKey: 'chemistry_k',
    }),
    (error) => error.code === 'DASHBOARD_REPORT_SETTINGS_PROFILE_INVALID',
  );
});
