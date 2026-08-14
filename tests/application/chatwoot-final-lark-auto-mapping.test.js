import assert from 'node:assert/strict';
import test from 'node:test';
import { CHATWOOT_LARK_BLUEPRINT } from '../../packages/config/src/chatwoot-lark-blueprint.js';
import {
  CHATWOOT_FINAL_LARK_AUTO_MAPPING_CONTRACT_VERSION,
  resolveChatwootFinalLarkAutoMappings,
} from '../../scripts/lib/chatwoot-final-lark-auto-mapping.js';

const TARGET_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
});

function remoteTables() {
  return CHATWOOT_LARK_BLUEPRINT.map((table, index) => ({
    tableId: `tbl_chatwoot_${String(index + 1).padStart(2, '0')}`,
    name: table.logicalName,
  }));
}

test('final UAT auto-resolves all customer-facing Chatwoot tables from reviewed Blueprint aliases', () => {
  const tables = remoteTables();
  const result = resolveChatwootFinalLarkAutoMappings({
    env: TARGET_ENV,
    remoteTables: tables,
  });

  assert.equal(result.contractVersion, CHATWOOT_FINAL_LARK_AUTO_MAPPING_CONTRACT_VERSION);
  assert.equal(result.tableCount, 5);
  assert.equal(result.aliasDiscoveryCount, 5);
  assert.equal(result.staleMappingRepairCount, 0);
  assert.equal(result.configuredMappingCount, 0);
  assert.deepEqual(
    Object.keys(result.values).sort(),
    CHATWOOT_LARK_BLUEPRINT.map((table) => table.envName).sort(),
  );
  for (const [index, table] of CHATWOOT_LARK_BLUEPRINT.entries()) {
    assert.equal(result.values[table.envName], tables[index].tableId);
  }
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.values));
});

test('final UAT repairs stale local Chatwoot table mappings only in the generated config', () => {
  const tables = remoteTables();
  const env = {
    ...TARGET_ENV,
    ...Object.fromEntries(CHATWOOT_LARK_BLUEPRINT.map((table, index) => [
      table.envName,
      `stale_table_${index + 1}`,
    ])),
  };
  const result = resolveChatwootFinalLarkAutoMappings({ env, remoteTables: tables });

  assert.equal(result.tableCount, 5);
  assert.equal(result.aliasDiscoveryCount, 0);
  assert.equal(result.staleMappingRepairCount, 5);
  assert.equal(result.configuredMappingCount, 0);
  for (const [index, table] of CHATWOOT_LARK_BLUEPRINT.entries()) {
    assert.equal(result.values[table.envName], tables[index].tableId);
  }
});

test('final UAT fails closed on missing or ambiguous Chatwoot tables without exposing Table IDs', () => {
  const missing = remoteTables().slice(1);
  assert.throws(
    () => resolveChatwootFinalLarkAutoMappings({ env: TARGET_ENV, remoteTables: missing }),
    (error) => {
      assert.equal(error.code, 'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_BLOCKED');
      assert.deepEqual(error.details.missingTables, ['mktConversations']);
      assert.doesNotMatch(JSON.stringify(error.details), /tbl_chatwoot_/u);
      return true;
    },
  );

  const ambiguous = remoteTables();
  ambiguous.push({ tableId: 'tbl_duplicate_alias', name: CHATWOOT_LARK_BLUEPRINT[0].logicalName });
  assert.throws(
    () => resolveChatwootFinalLarkAutoMappings({ env: TARGET_ENV, remoteTables: ambiguous }),
    (error) => {
      assert.equal(error.code, 'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_BLOCKED');
      assert.deepEqual(error.details.ambiguousTables, ['mktConversations']);
      assert.doesNotMatch(JSON.stringify(error.details), /tbl_duplicate_alias/u);
      return true;
    },
  );
});

test('final UAT rejects configured IDs that point to the wrong reviewed table identity', () => {
  const tables = remoteTables();
  const first = CHATWOOT_LARK_BLUEPRINT[0];
  const env = {
    ...TARGET_ENV,
    [first.envName]: tables[1].tableId,
  };

  assert.throws(
    () => resolveChatwootFinalLarkAutoMappings({ env, remoteTables: tables }),
    (error) => {
      assert.equal(error.code, 'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_BLOCKED');
      assert.deepEqual(error.details.identityMismatches, [first.key]);
      assert.doesNotMatch(JSON.stringify(error.details), /tbl_chatwoot_/u);
      return true;
    },
  );
});
