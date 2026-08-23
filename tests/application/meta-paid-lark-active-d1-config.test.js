import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeActiveD1Config,
  parseActiveDeploymentVersionIds,
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

test('materializes a replacement config without mutating the stale source text', () => {
  const source = `{
    // Local private file can legitimately be older than deployed runtime.
    "name": "social-mkt-sync-worker",
    "d1_databases": [
      {
        "binding": "MKT_STATE_DB",
        "database_name": "social-mkt-state-dev",
        "database_id": "${STALE_D1}",
        "migrations_dir": "./migrations"
      }
    ],
    "vars": { "MKT_CONNECTOR_META_ADS_ENABLED": "false" }
  }`;

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
      { "binding": "MKT_STATE_DB", "database_id": "${STALE_D1}" },
      { "binding": "MKT_STATE_DB", "database_id": "${OTHER_D1}" }
    ]
  }`;
  assert.throws(
    () => materializeActiveD1Config(duplicate, ACTIVE_D1),
    (error) => error?.code === 'META_PAID_LARK_ACTIVE_D1_CONFIG_BINDING_INVALID',
  );
});
