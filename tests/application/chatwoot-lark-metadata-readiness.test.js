import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATWOOT_LARK_BLUEPRINT,
  CHATWOOT_LARK_FIELD_TYPE,
  CHATWOOT_REQUIRED_LARK_TABLE_KEYS,
  validateChatwootLarkBlueprint,
} from '../../packages/config/src/chatwoot-lark-blueprint.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { CHATWOOT_LARK_WRITE_TARGETS } from '../../packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js';
import {
  analyzeChatwootLarkMetadata,
  assertChatwootLarkMetadataConfirmation,
  buildChatwootLarkMetadataEvidence,
  discoverChatwootLarkTables,
  loadChatwootLarkMetadataTarget,
  parseChatwootLarkMetadataArgs,
  safeChatwootLarkMetadataPlan,
} from '../../scripts/lib/chatwoot-lark-metadata-readiness.js';

const T = CHATWOOT_LARK_FIELD_TYPE;

test('Chatwoot Lark blueprint contains the exact 15 write targets and Stable keys', () => {
  assert.equal(validateChatwootLarkBlueprint(), true);
  assert.equal(CHATWOOT_LARK_BLUEPRINT.length, 15);
  assert.deepEqual(
    CHATWOOT_LARK_BLUEPRINT.map((table) => [table.key, table.primaryField]),
    CHATWOOT_LARK_WRITE_TARGETS.map((target) => [target.tableKey, target.keyField]),
  );
  assert.deepEqual(CHATWOOT_REQUIRED_LARK_TABLE_KEYS, CHATWOOT_LARK_WRITE_TARGETS.map((row) => row.tableKey));
  const conversations = CHATWOOT_LARK_BLUEPRINT.find((table) => table.key === 'rawChatwootConversations');
  assert.ok(conversations.fields.some((field) => field.fieldName === 'reopen_count_delta'));
  assert.equal(conversations.fields.some((field) => field.fieldName === 'reopen_count'), false);
});

test('Chatwoot Lark metadata operator is plan-only by default and requires exact confirmation', () => {
  assert.deepEqual(parseChatwootLarkMetadataArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseChatwootLarkMetadataArgs(['--phase=lark-preflight', '--execute']),
    { phase: 'lark-preflight', execute: true },
  );
  assert.throws(
    () => parseChatwootLarkMetadataArgs(['--execute']),
    (error) => error.code === 'CHATWOOT_LARK_METADATA_PLAN_EXECUTE_INVALID',
  );
  assert.throws(
    () => assertChatwootLarkMetadataConfirmation({}),
    (error) => error.code === 'CHATWOOT_LARK_METADATA_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertChatwootLarkMetadataConfirmation({
    CONFIRM_CHATWOOT_LARK_METADATA: 'READ_ONLY_CHATWOOT_LARK_METADATA',
  }), true);
  const plan = safeChatwootLarkMetadataPlan();
  assert.equal(plan.planOnly, true);
  assert.equal(plan.execution.mutations, false);
  assert.equal(plan.execution.renameDeleteOrTypeChange, false);
});

test('Chatwoot Lark metadata target locks Integration Workspace and reads optional table mappings', () => {
  const env = targetEnv();
  const target = loadChatwootLarkMetadataTarget(env);
  assert.equal(target.environment, 'development');
  assert.equal(target.customerProfile, 'integration_workspace');
  assert.equal(target.customerKey, 'chemistry_k');
  assert.equal(target.tableCount, 15);
  assert.equal(target.tableRefs.rawChatwootAccounts.configuredTableId, 'tbl_rawChatwootAccounts');
  assert.throws(
    () => loadChatwootLarkMetadataTarget({ ...env, MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin' }),
    (error) => error.code === 'CHATWOOT_LARK_METADATA_TARGET_INVALID',
  );
});

test('complete matching Lark metadata is accepted', () => {
  const fixture = completeFixture();
  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  assert.equal(analysis.accepted, true);
  assert.equal(analysis.status, 'ready');
  assert.equal(analysis.decision, 'PASS_CHATWOOT_LARK_METADATA_READY');
  assert.equal(analysis.additivePlan.actionCount, 0);
  assert.deepEqual(analysis.blockers.typeMismatches, []);
});

test('missing table, env mapping, and non-primary field produce additive-only plan', () => {
  const fixture = completeFixture();
  const missingTableKey = 'rawChatwootTeams';
  fixture.remoteTables = fixture.remoteTables.filter((table) => table.name !== 'RAW_Chatwoot_Teams');
  fixture.tableRefs[missingTableKey] = {
    envName: LARK_TABLE_ENV[missingTableKey],
    configuredTableId: null,
  };
  fixture.fieldsByKey.rawChatwootAgents = fixture.fieldsByKey.rawChatwootAgents
    .filter((field) => field.fieldName !== 'availability_status');
  fixture.tableRefs.rawChatwootLabels = {
    envName: LARK_TABLE_ENV.rawChatwootLabels,
    configuredTableId: null,
  };

  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  assert.equal(analysis.decision, 'CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED');
  assert.equal(analysis.accepted, false);
  assert.ok(analysis.additivePlan.actions.some((action) => (
    action.action === 'create_table' && action.tableKey === missingTableKey
  )));
  assert.ok(analysis.additivePlan.actions.some((action) => (
    action.action === 'create_field'
      && action.tableKey === 'rawChatwootAgents'
      && action.fieldName === 'availability_status'
  )));
  assert.ok(analysis.additivePlan.actions.some((action) => (
    action.action === 'bind_table_env' && action.tableKey === 'rawChatwootLabels'
  )));
  assert.equal(analysis.additivePlan.destructiveActions, 0);
  assert.equal(analysis.additivePlan.changeFieldTypeCount, 0);
});

test('compatible existing transport types are accepted without type mutation', () => {
  const fixture = completeFixture();
  replaceFieldType(fixture, 'rawChatwootInboxes', 'enable_auto_assignment', T.NUMBER);
  replaceFieldType(fixture, 'rawChatwootInboxes', 'source_updated_at', T.NUMBER);
  replaceFieldType(fixture, 'rawChatwootInboxes', 'channel_type', T.TEXT);
  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  assert.equal(analysis.decision, 'PASS_CHATWOOT_LARK_METADATA_READY');
  assert.deepEqual(analysis.blockers.typeMismatches, []);
});

test('incompatible field type or non-primary Stable key blocks instead of planning mutation', () => {
  const fixture = completeFixture();
  replaceFieldType(fixture, 'rawChatwootAccounts', 'external_account_id', T.TEXT);
  fixture.fieldsByKey.rawChatwootAccounts = fixture.fieldsByKey.rawChatwootAccounts.map((field) => (
    field.fieldName === 'account_state_key' ? { ...field, isPrimary: false } : field
  ));
  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  assert.equal(analysis.decision, 'CHATWOOT_LARK_TYPE_MISMATCH_BLOCKED');
  assert.equal(analysis.accepted, false);
  assert.equal(analysis.blockers.typeMismatches.length, 1);
  assert.deepEqual(analysis.blockers.missingPrimaryKeys, ['rawChatwootAccounts.account_state_key:not_primary']);
  assert.equal(analysis.additivePlan.changeFieldTypeCount, 0);
});

test('ambiguous table aliases fail closed', () => {
  const fixture = completeFixture();
  fixture.tableRefs.rawChatwootAccounts = {
    envName: LARK_TABLE_ENV.rawChatwootAccounts,
    configuredTableId: null,
  };
  fixture.remoteTables.push({ tableId: 'tbl_duplicate', name: '📞 RAW_Chatwoot_Accounts' });
  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  assert.equal(analysis.decision, 'CHATWOOT_LARK_TABLE_AMBIGUOUS_BLOCKED');
  assert.deepEqual(analysis.blockers.ambiguousTables, ['rawChatwootAccounts']);
});

test('evidence persists no raw table IDs, credentials, or metadata payloads', () => {
  const fixture = completeFixture();
  const target = loadChatwootLarkMetadataTarget(targetEnv());
  const discovery = discoverChatwootLarkTables(fixture);
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey: fixture.fieldsByKey });
  const evidence = buildChatwootLarkMetadataEvidence({
    target,
    analysis,
    capturedAt: '2026-07-28T00:00:00.000Z',
    larkRequestCount: 16,
  });
  const text = JSON.stringify(evidence);
  assert.equal(text.includes('tbl_rawChatwootAccounts'), false);
  assert.equal(text.includes('LARK_APP_SECRET'), false);
  assert.equal(text.includes('access_token'), false);
  assert.equal(evidence.boundaries.larkMutationCount, 0);
  assert.equal(evidence.boundaries.larkRecordReadCount, 0);
  assert.equal(evidence.boundaries.rawMetadataPayloadPersisted, false);
});

function completeFixture() {
  const remoteTables = CHATWOOT_LARK_BLUEPRINT.map((table) => ({
    tableId: `tbl_${table.key}`,
    name: table.logicalName,
  }));
  const tableRefs = Object.fromEntries(CHATWOOT_LARK_BLUEPRINT.map((table) => [table.key, {
    envName: table.envName,
    configuredTableId: `tbl_${table.key}`,
  }]));
  const fieldsByKey = Object.fromEntries(CHATWOOT_LARK_BLUEPRINT.map((table) => [
    table.key,
    table.fields.map((field) => ({
      fieldName: field.fieldName,
      type: field.type,
      isPrimary: field.primary,
    })),
  ]));
  return { remoteTables, tableRefs, fieldsByKey };
}

function targetEnv() {
  const env = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  };
  for (const tableKey of CHATWOOT_REQUIRED_LARK_TABLE_KEYS) {
    env[LARK_TABLE_ENV[tableKey]] = `tbl_${tableKey}`;
  }
  return env;
}

function replaceFieldType(fixture, tableKey, fieldName, type) {
  fixture.fieldsByKey[tableKey] = fixture.fieldsByKey[tableKey].map((field) => (
    field.fieldName === fieldName ? { ...field, type } : field
  ));
}
