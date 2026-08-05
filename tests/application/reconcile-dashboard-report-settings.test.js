import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDashboardReportSettingsReconciliation,
  planDashboardReportSettingsReconciliation,
} from '../../packages/application/src/use-cases/reconcile-dashboard-report-settings.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import {
  DASHBOARD_REPORT_PLATFORM_SCOPES,
  createReportSettingRowsForProfile,
} from '../../packages/config/src/report-settings.seed.js';

const EXPECTED_CANONICAL_COUNT = 2 + (DASHBOARD_REPORT_PLATFORM_SCOPES.length * 8);
const DESTINATION = 'runtime-destination';
const DESTINATION_HASH =
  '2682b75c9df1350ff5ee97b5c4f13ccbd0e973cab835c9a6306599526aec1a7a';
const ACTIVE_KEYS = Object.freeze([1, 3, 7, 30].map(
  (windowDays) => `integration_workspace:facebook:rolling:${windowDays}d`,
).sort());

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

function canonicalRecords(activeKeys = []) {
  const active = new Set(activeKeys);
  return createReportSettingRowsForProfile('integration_workspace').map((row) => ({
    recordId: `canonical:${row.report_setting_key}`,
    fields: {
      ...row,
      ai_enabled: active.has(row.report_setting_key),
      notification_enabled: active.has(row.report_setting_key),
      group_id: active.has(row.report_setting_key) ? DESTINATION : null,
    },
  }));
}

function activeAuthority() {
  return {
    state: 'active',
    settingKeys: ACTIVE_KEYS,
    groupId: DESTINATION,
    destinationKeyHash: DESTINATION_HASH,
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
    notificationRuntimeState: 'inactive',
    preservedNotificationRuntimeSettingCount: 0,
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
  assert.equal(result.verification.notificationRuntimeState, 'inactive');
  assert.equal(result.verification.preservedNotificationRuntimeSettingCount, 0);
  assert.equal(result.verification.legacyActive, 0);
  assert.equal(result.verification.legacyRetainedDisabled, 2);
  assert.equal(result.deleteCount, 0);
});

test('preserves exact four active Notification Runtime Settings without updates', async () => {
  const repository = buildRepository(canonicalRecords(ACTIVE_KEYS));
  const syncEngine = new TableSyncEngine();
  const plan = await planDashboardReportSettingsReconciliation({
    repository,
    syncEngine,
    tableId: 'settings',
    profileKey: 'integration_workspace',
    notificationRuntimeAuthority: activeAuthority(),
  });
  assert.equal(plan.summary.canonicalCreates, 0);
  assert.equal(plan.summary.canonicalUpdates, 0);
  assert.equal(plan.summary.canonicalSkipped, EXPECTED_CANONICAL_COUNT);
  assert.equal(plan.summary.notificationRuntimeState, 'active');
  assert.equal(plan.summary.preservedNotificationRuntimeSettingCount, 4);

  const result = await applyDashboardReportSettingsReconciliation({
    repository,
    syncEngine,
    plan,
  });
  assert.equal(result.canonical.created, 0);
  assert.equal(result.canonical.updated, 0);
  assert.equal(result.verification.notificationRuntimeState, 'active');
  assert.equal(result.verification.preservedNotificationRuntimeSettingCount, 4);

  const activeRows = repository.rows.filter((record) => (
    record.fields.ai_enabled === true || record.fields.notification_enabled === true
  ));
  assert.deepEqual(
    activeRows.map((record) => record.fields.report_setting_key).sort(),
    ACTIVE_KEYS,
  );
  assert.ok(activeRows.every((record) => record.fields.group_id === DESTINATION));
});

test('rejects active Notification Runtime authority outside canonical Settings', async () => {
  const repository = buildRepository(canonicalRecords(ACTIVE_KEYS));
  await assert.rejects(
    () => planDashboardReportSettingsReconciliation({
      repository,
      syncEngine: new TableSyncEngine(),
      tableId: 'settings',
      profileKey: 'integration_workspace',
      notificationRuntimeAuthority: {
        ...activeAuthority(),
        settingKeys: [...ACTIVE_KEYS.slice(0, 3), 'not-canonical'],
      },
    }),
    (error) => error.code === 'DASHBOARD_REPORT_NOTIFICATION_RUNTIME_SCOPE_INVALID',
  );
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
