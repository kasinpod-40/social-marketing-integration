import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  LARK_TABLE_ENV,
} from '../../packages/config/src/lark-table-config.js';
import {
  applyMetaHistoryLarkRuntimeEnvironment,
  materializeMetaHistoryLarkRuntimeConfig,
} from '../../scripts/lib/meta-history-runtime-authority.js';

function fixtureMappings() {
  return Object.fromEntries(
    META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((tableKey, index) => [
      LARK_TABLE_ENV[tableKey],
      `tbl_fixture_${String(index + 1).padStart(2, '0')}`,
    ]),
  );
}

function fixtureConfig(overrides = {}) {
  const vars = {
    ...fixtureMappings(),
    ...overrides,
  };
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    vars,
  }, null, 2);
}

test('Meta Lark runtime hydrates missing shell table mappings from the reviewed safe config', () => {
  const mappings = fixtureMappings();
  const configText = fixtureConfig();
  const runtime = applyMetaHistoryLarkRuntimeEnvironment(configText, {});

  for (const [envName, tableId] of Object.entries(mappings)) {
    assert.equal(runtime[envName], tableId);
  }

  const materialized = materializeMetaHistoryLarkRuntimeConfig(configText, runtime);
  for (const [envName, tableId] of Object.entries(mappings)) {
    assert.match(materialized, new RegExp(`"${envName}"\\s*:\\s*"${tableId}"`, 'u'));
  }
});

test('Meta Lark runtime accepts an environment mapping only when it matches the safe config', () => {
  const mappings = fixtureMappings();
  const [envName, tableId] = Object.entries(mappings)[0];
  const runtime = applyMetaHistoryLarkRuntimeEnvironment(
    fixtureConfig(),
    { [envName]: tableId },
  );

  assert.equal(runtime[envName], tableId);
});

test('Meta Lark runtime rejects environment and safe-config table mapping drift', () => {
  const mappings = fixtureMappings();
  const [envName] = Object.keys(mappings);

  assert.throws(
    () => applyMetaHistoryLarkRuntimeEnvironment(
      fixtureConfig(),
      { [envName]: 'tbl_conflicting_environment_value' },
    ),
    (error) => error?.code === 'META_HISTORY_LARK_TABLE_MAPPING_MISMATCH',
  );
});

test('Meta Lark runtime still fails closed when a required mapping exists in neither authority', () => {
  const mappings = fixtureMappings();
  const [missingEnvName] = Object.keys(mappings);
  const configText = fixtureConfig({ [missingEnvName]: '' });

  assert.throws(
    () => applyMetaHistoryLarkRuntimeEnvironment(configText, {}),
    (error) => error?.code === 'META_HISTORY_LARK_TABLE_MAPPING_MISSING',
  );
});
