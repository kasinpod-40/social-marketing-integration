import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeActiveD1Config,
  parseAccountD1Databases,
  parseActiveDeploymentVersionIds,
  readD1BindingDescriptor,
  resolveAccountD1Authority,
  resolveSharedActiveD1BindingId,
} from '../../scripts/lib/meta-paid-lark-active-d1-config.js';

const VERSION_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VERSION_B = '11111111-2222-4333-8444-555555555555';
const ACTIVE_D1 = '12345678-1234-4abc-8def-1234567890ab';
const OTHER_D1 = '87654321-4321-4abc-8def-ba0987654321';
const STALE_D1 = '5f7e3033-7180-4a9c-b344-894072c64616';

function versionJson(databaseId) {
  return JSON.stringify({
    resources: {
      bindings: [
        { name: 'MKT_STATE_DB', type: 'd1', id: databaseId },
        { name: 'MKT_SYNC_QUEUE', type: 'queue', queue_name: 'social-mkt-sync-jobs' },
      ],
    },
  });
}

function sourceConfig(databaseId = STALE_D1) {
  return `{
    // Local private file can legitimately be older than deployed runtime.
    "name": "social-mkt-sync-worker",
    "d1_databases": [
      {
        "binding": "MKT_STATE_DB",
        "database_name": "social-mkt-state-dev",
        "database_id": "${databaseId}",
        "migrations_dir": "./migrations"
      }
    ],
    "vars": { "MKT_CONNECTOR_META_ADS_ENABLED": "false" }
  }`;
}

test('extracts every traffic-bearing version from current deployment', () => {
  const ids = parseActiveDeploymentVersionIds(JSON.stringify({
    versions: [
      { version_id: VERSION_A, percentage: 25 },
      { version_id: VERSION_B, percentage: 75 },
      { version_id: '99999999-8888-4777-8666-555555555555', percentage: 0 },
    ],
  }));
  assert.deepEqual(ids, [VERSION_A, VERSION_B]);
});

test('accepts gradual deployment only when active versions share the exact D1 binding', () => {
  assert.equal(
    resolveSharedActiveD1BindingId([versionJson(ACTIVE_D1), versionJson(ACTIVE_D1)]),
    ACTIVE_D1,
  );
});

test('fails closed when traffic-bearing versions disagree on D1 authority', () => {
  assert.throws(
    () => resolveSharedActiveD1BindingId([versionJson(ACTIVE_D1), versionJson(OTHER_D1)]),
    (error) => error?.code === 'META_PAID_LARK_ACTIVE_D1_BINDING_AMBIGUOUS',
  );
});

test('fails closed when requested D1 binding is absent from active version', () => {
  assert.throws(
    () => resolveSharedActiveD1BindingId([JSON.stringify({ resources: { bindings: [] } })]),
    (error) => error?.code === 'META_PAID_LARK_ACTIVE_D1_BINDING_INVALID',
  );
});

test('reads exact D1 database_name from the private source binding', () => {
  const descriptor = readD1BindingDescriptor(sourceConfig());
  assert.equal(descriptor.bindingName, 'MKT_STATE_DB');
  assert.equal(descriptor.databaseName, 'social-mkt-state-dev');
  assert.equal(descriptor.configuredDatabaseId, STALE_D1);
});

test('parses Wrangler d1 list account inventory with exact name and uuid', () => {
  const databases = parseAccountD1Databases(JSON.stringify([
    { name: 'social-mkt-state-dev', uuid: OTHER_D1 },
  ]));
  assert.deepEqual(databases, [{ name: 'social-mkt-state-dev', uuid: OTHER_D1 }]);
});

test('keeps active Worker D1 authority when that uuid exists in current account', () => {
  const authority = resolveAccountD1Authority({
    sourceText: sourceConfig(),
    activeDatabaseId: ACTIVE_D1,
    d1ListJsonText: JSON.stringify([
      { name: 'active-state', uuid: ACTIVE_D1 },
      { name: 'social-mkt-state-dev', uuid: OTHER_D1 },
    ]),
  });
  assert.equal(authority.authoritySource, 'active_worker_binding_present_in_account');
  assert.equal(authority.databaseId, ACTIVE_D1);
  assert.equal(authority.databaseName, 'active-state');
  assert.equal(authority.activeBindingPresentInAccount, true);
});

test('falls back only to exact database_name when active Worker D1 uuid is absent from current account', () => {
  const authority = resolveAccountD1Authority({
    sourceText: sourceConfig(),
    activeDatabaseId: ACTIVE_D1,
    d1ListJsonText: JSON.stringify([
      { name: 'social-mkt-state-dev', uuid: OTHER_D1 },
    ]),
  });
  assert.equal(authority.authoritySource, 'exact_database_name_present_in_account');
  assert.equal(authority.activeBindingDatabaseId, ACTIVE_D1);
  assert.equal(authority.databaseId, OTHER_D1);
  assert.equal(authority.databaseName, 'social-mkt-state-dev');
  assert.equal(authority.activeBindingPresentInAccount, false);
});

test('fails closed when stale active binding has no unique exact-name account fallback', () => {
  assert.throws(
    () => resolveAccountD1Authority({
      sourceText: sourceConfig(),
      activeDatabaseId: ACTIVE_D1,
      d1ListJsonText: JSON.stringify([{ name: 'different-db', uuid: OTHER_D1 }]),
    }),
    (error) => error?.code === 'META_PAID_LARK_ACCOUNT_D1_NAME_AUTHORITY_INVALID',
  );
});

test('materializes a replacement config without mutating the stale source text', () => {
  const source = sourceConfig();
  const materialized = materializeActiveD1Config(source, ACTIVE_D1);
  assert.match(source, new RegExp(STALE_D1, 'u'));
  assert.doesNotMatch(source, new RegExp(ACTIVE_D1, 'u'));
  assert.match(materialized.text, new RegExp(ACTIVE_D1, 'u'));
  assert.doesNotMatch(materialized.text, new RegExp(STALE_D1, 'u'));
  assert.match(materialized.text, /"MKT_CONNECTOR_META_ADS_ENABLED": "false"/u);
});

test('requires exactly one MKT_STATE_DB object in source config', () => {
  const duplicate = `{
    "d1_databases": [
      { "binding": "MKT_STATE_DB", "database_name": "one", "database_id": "${STALE_D1}" },
      { "binding": "MKT_STATE_DB", "database_name": "two", "database_id": "${OTHER_D1}" }
    ]
  }`;
  assert.throws(
    () => materializeActiveD1Config(duplicate, ACTIVE_D1),
    (error) => error?.code === 'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
  );
});
