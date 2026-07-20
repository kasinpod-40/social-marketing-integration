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

test('every connector declares a frozen large-account activation contract', () => {
  const catalog = listConnectorCatalog();
  for (const connector of catalog) {
    assert.ok(connector.largeAccount.minimumFixtureItems > 0);
    assert.equal(typeof connector.largeAccount.primaryEntity, 'string');
    assert.equal(Object.isFrozen(connector.largeAccount), true);
    assert.equal(Object.isFrozen(connector.largeAccount.gates), true);
    assert.equal(Object.isFrozen(connector.largeAccount.missingGates), true);
  }
});

test('YouTube is technical/fixture ready while every connector remains blocked from Production until Live UAT', () => {
  const youtube = getConnectorCatalogEntry('youtube');
  const tiktok = getConnectorCatalogEntry('tiktok');
  const instagram = getConnectorCatalogEntry('instagram');

  assert.equal(youtube.largeAccount.status, 'dev_ready');
  assert.equal(youtube.largeAccount.minimumFixtureItems, 1000);
  assert.deepEqual(youtube.largeAccount.missingGates, ['liveAccountUat']);
  assert.equal(youtube.largeAccount.productionReady, false);

  assert.equal(tiktok.largeAccount.status, 'foundation_ready');
  assert.ok(tiktok.largeAccount.missingGates.includes('durableResume'));
  assert.ok(tiktok.largeAccount.missingGates.includes('largeAccountFixture'));

  assert.equal(instagram.largeAccount.status, 'planned');
  assert.equal(instagram.largeAccount.minimumFixtureItems, 2000);
  assert.equal(instagram.largeAccount.productionReady, false);
});
