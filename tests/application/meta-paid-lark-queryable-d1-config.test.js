import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeNameResolvedD1Config,
  parseResolvedD1Info,
} from '../../scripts/lib/meta-paid-lark-queryable-d1-config.js';

const STALE_D1 = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const RESOLVED_D1 = '12345678-1234-4abc-8def-1234567890ab';

function sourceWithMiddleId() {
  return `{
    "name": "social-mkt-sync-worker",
    "d1_databases": [
      {
        "binding": "MKT_STATE_DB",
        "database_name": "social-mkt-state-prod",
        "database_id": "${STALE_D1}",
        "migrations_dir": "./migrations"
      }
    ],
    "vars": { "MKT_CONNECTOR_META_ADS_ENABLED": "false" }
  }`;
}

test('removes only database_id so Wrangler must resolve exact database_name through API', () => {
  const source = sourceWithMiddleId();
  const result = materializeNameResolvedD1Config(source);
  assert.equal(result.databaseName, 'social-mkt-state-prod');
  assert.equal(result.configuredDatabaseId, STALE_D1);
  assert.doesNotMatch(result.text, /database_id/u);
  assert.match(result.text, /"database_name": "social-mkt-state-prod"/u);
  assert.match(result.text, /"migrations_dir": "\.\/migrations"/u);
  assert.match(result.text, /"MKT_CONNECTOR_META_ADS_ENABLED": "false"/u);
  assert.match(source, new RegExp(STALE_D1, 'u'));
});

test('removes database_id safely when it is the final binding property', () => {
  const source = `{
    "d1_databases": [
      {
        "binding": "MKT_STATE_DB",
        "database_name": "social-mkt-state-prod",
        "database_id": "${STALE_D1}"
      }
    ]
  }`;
  const result = materializeNameResolvedD1Config(source);
  assert.doesNotMatch(result.text, /database_id/u);
  assert.match(result.text, /"database_name": "social-mkt-state-prod"/u);
});

test('keeps an already name-resolved binding unchanged', () => {
  const source = `{
    "d1_databases": [
      {
        "binding": "MKT_STATE_DB",
        "database_name": "social-mkt-state-prod",
        "migrations_dir": "./migrations"
      }
    ]
  }`;
  const result = materializeNameResolvedD1Config(source);
  assert.equal(result.configuredDatabaseId, null);
  assert.equal(result.text, source);
});

test('fails closed without exact database_name', () => {
  const source = `{
    "d1_databases": [
      { "binding": "MKT_STATE_DB", "database_id": "${STALE_D1}" }
    ]
  }`;
  assert.throws(
    () => materializeNameResolvedD1Config(source),
    (error) => error?.code === 'META_PAID_LARK_QUERYABLE_D1_DATABASE_NAME_MISSING',
  );
});

test('fails closed when binding is duplicated', () => {
  const source = `{
    "d1_databases": [
      { "binding": "MKT_STATE_DB", "database_name": "a" },
      { "binding": "MKT_STATE_DB", "database_name": "b" }
    ]
  }`;
  assert.throws(
    () => materializeNameResolvedD1Config(source),
    (error) => error?.code === 'META_PAID_LARK_QUERYABLE_D1_CONFIG_BINDING_INVALID',
  );
});

test('parses exact name-resolved D1 info', () => {
  assert.deepEqual(
    parseResolvedD1Info(
      JSON.stringify({ name: 'social-mkt-state-prod', uuid: RESOLVED_D1 }),
      'social-mkt-state-prod',
    ),
    { databaseName: 'social-mkt-state-prod', databaseId: RESOLVED_D1 },
  );
});

test('rejects a different resolved database name', () => {
  assert.throws(
    () => parseResolvedD1Info(
      JSON.stringify({ name: 'other-db', uuid: RESOLVED_D1 }),
      'social-mkt-state-prod',
    ),
    (error) => error?.code === 'META_PAID_LARK_QUERYABLE_D1_NAME_MISMATCH',
  );
});
