import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getConnectorCatalogEntry,
  listConnectorCatalog,
  listConnectorKeys,
} from '../../packages/config/src/connector-catalog.js';

test('connector catalog uses unique keys and feature flags', () => {
  const catalog = listConnectorCatalog();
  assert.equal(new Set(catalog.map((item) => item.key)).size, catalog.length);
  assert.equal(new Set(catalog.map((item) => item.featureFlagEnv)).size, catalog.length);
  assert.deepEqual(catalog.map((item) => item.key), listConnectorKeys());
});

test('connector catalog resolves normalized keys', () => {
  assert.equal(getConnectorCatalogEntry(' TikTok ').key, 'tiktok');
});

test('connector catalog rejects blank and unknown keys as permanent errors', () => {
  assert.throws(
    () => getConnectorCatalogEntry(''),
    (error) => error?.code === 'UNKNOWN_CONNECTOR',
  );
  assert.throws(
    () => getConnectorCatalogEntry('threads'),
    (error) => error?.code === 'UNKNOWN_CONNECTOR',
  );
});
