import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CHATWOOT_LARK_BLUEPRINT,
  CHATWOOT_LARK_FIELD_TYPE,
} from '../../packages/config/src/chatwoot-lark-blueprint.js';
import {
  assertChatwootLarkSchemaApplyConfirmation,
  buildChatwootLarkEnvironmentUpdates,
  buildChatwootLarkSchemaApplyEvidence,
  buildChatwootLarkSchemaApplyPlan,
  parseChatwootLarkSchemaApplyArgs,
  safeChatwootLarkSchemaApplyPlan,
  validateChatwootLarkMetadataEvidence,
} from '../../scripts/lib/chatwoot-lark-schema-apply.js';

const T = CHATWOOT_LARK_FIELD_TYPE;

test('Chatwoot Lark schema operator is plan-only and requires exact confirmation', () => {
  assert.deepEqual(parseChatwootLarkSchemaApplyArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseChatwootLarkSchemaApplyArgs(['--phase=apply', '--execute']),
    { phase: 'apply', execute: true },
  );
  assert.throws(
    () => parseChatwootLarkSchemaApplyArgs(['--execute']),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_PLAN_EXECUTE_INVALID',
  );
  assert.throws(
    () => assertChatwootLarkSchemaApplyConfirmation({}),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertChatwootLarkSchemaApplyConfirmation({
    CONFIRM_CHATWOOT_LARK_SCHEMA: 'APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA',
  }), true);
  const plan = safeChatwootLarkSchemaApplyPlan();
  assert.equal(plan.planOnly, true);
  assert.equal(plan.execution.additiveOnly, true);
  assert.equal(plan.execution.renameDeleteOrTypeChange, false);
  assert.equal(plan.execution.automaticDevVarsEdit, false);
});

test('metadata evidence accepts the exact five-table additive-only result', () => {
  const reviewed = validateChatwootLarkMetadataEvidence(metadataEvidence());
  assert.equal(reviewed.allowedTableKeys.length, 5);
  assert.equal(reviewed.actions.length, 5);
  assert.equal(reviewed.actions.every((action) => action.action === 'create_table'), true);
  assert.match(reviewed.evidenceSha256, /^[0-9a-f]{64}$/u);
});

test('metadata evidence rejects destructive counts and blockers', () => {
  const destructive = metadataEvidence();
  destructive.additivePlan.changeFieldTypeCount = 1;
  assert.throws(
    () => validateChatwootLarkMetadataEvidence(destructive),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_EVIDENCE_INVALID',
  );

  const blocked = metadataEvidence();
  blocked.blockers.typeMismatches.push({ tableKey: 'mktConversations' });
  assert.throws(
    () => validateChatwootLarkMetadataEvidence(blocked),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_EVIDENCE_INVALID',
  );
});

test('all-missing plan creates five customer-facing tables with transport-compatible field types', () => {
  const reviewedEvidence = validateChatwootLarkMetadataEvidence(metadataEvidence());
  const plan = buildChatwootLarkSchemaApplyPlan({
    analysis: analysisFromEvidence(metadataEvidence()),
    reviewedEvidence,
    bindings: {},
  });
  assert.equal(plan.alreadyReady, false);
  assert.equal(plan.mutationActionCount, 5);
  assert.equal(plan.bindingActionCount, 0);
  assert.equal(plan.actions.length, 5);

  const conversations = plan.actions.find((action) => action.tableKey === 'mktConversations');
  assert.equal(conversations.action, 'create_table');
  assert.equal(conversations.fields[0].fieldName, 'conversation_key');
  assert.equal(conversations.fields[0].primary, true);
  assert.equal(field(conversations, 'status').type, T.TEXT);
  assert.equal(field(conversations, 'source_updated_at').type, T.NUMBER);
});

test('partial apply recovery permits reviewed bind actions plus remaining table creation', () => {
  const reviewedEvidence = validateChatwootLarkMetadataEvidence(metadataEvidence());
  const evidence = metadataEvidence();
  evidence.additivePlan.actions = [
    { action: 'bind_table_env', tableKey: 'mktConversations' },
    ...evidence.additivePlan.actions.filter((action) => action.tableKey !== 'mktConversations'),
  ];
  evidence.additivePlan.actionCount = evidence.additivePlan.actions.length;
  const analysis = analysisFromEvidence(evidence);
  const plan = buildChatwootLarkSchemaApplyPlan({
    analysis,
    reviewedEvidence,
    bindings: {
      mktConversations: { tableKey: 'mktConversations', tableId: 'tbl_conversations', source: 'alias_discovery' },
    },
  });
  assert.equal(plan.mutationActionCount, 4);
  assert.equal(plan.bindingActionCount, 1);
  assert.ok(plan.actions.some((action) => (
    action.action === 'bind_table_env'
      && action.tableKey === 'mktConversations'
      && action.tableId === 'tbl_conversations'
  )));
});

test('already-ready metadata is an idempotent zero-mutation apply plan', () => {
  const reviewedEvidence = validateChatwootLarkMetadataEvidence(metadataEvidence());
  const plan = buildChatwootLarkSchemaApplyPlan({
    analysis: {
      decision: 'PASS_CHATWOOT_LARK_METADATA_READY',
      status: 'ready',
      accepted: true,
      additivePlan: { actions: [] },
    },
    reviewedEvidence,
    bindings: {},
  });
  assert.equal(plan.alreadyReady, true);
  assert.equal(plan.mutationActionCount, 0);
  assert.deepEqual(plan.actions, []);
});

test('unreviewed tables and current blockers fail closed before mutation', () => {
  const reviewedEvidence = validateChatwootLarkMetadataEvidence(metadataEvidence());
  const drift = analysisFromEvidence(metadataEvidence());
  drift.additivePlan.actions = [{ action: 'create_table', tableKey: 'mktConversations' }];
  assert.throws(
    () => buildChatwootLarkSchemaApplyPlan({
      analysis: drift,
      reviewedEvidence: { ...reviewedEvidence, allowedTableKeys: ['mktInboxDaily'] },
      bindings: {},
    }),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_PLAN_DRIFT',
  );

  const blocked = analysisFromEvidence(metadataEvidence());
  blocked.decision = 'CHATWOOT_LARK_TYPE_MISMATCH_BLOCKED';
  blocked.status = 'blocked';
  blocked.blockers.typeMismatches = [{ tableKey: 'mktConversations' }];
  assert.throws(
    () => buildChatwootLarkSchemaApplyPlan({ analysis: blocked, reviewedEvidence, bindings: {} }),
    (error) => error.code === 'CHATWOOT_LARK_SCHEMA_CURRENT_PLAN_BLOCKED',
  );
});

test('environment mappings are complete while sanitized summary persists no raw table IDs', () => {
  const bindings = Object.fromEntries(CHATWOOT_LARK_BLUEPRINT.map((table) => [
    table.key,
    { tableId: `tbl_${table.key}` },
  ]));
  const updates = buildChatwootLarkEnvironmentUpdates(bindings);
  assert.equal(updates.tableCount, 5);
  assert.equal(updates.text.trim().split('\n').length, 5);
  assert.ok(updates.text.includes('LARK_TABLE_MKT_CONVERSATIONS=tbl_mktConversations'));

  const evidence = buildChatwootLarkSchemaApplyEvidence({
    plan: {
      actionFingerprint: 'a'.repeat(64),
      mutationActionCount: 5,
      bindingActionCount: 0,
    },
    verification: {
      decision: 'PASS_CHATWOOT_LARK_METADATA_READY',
      accepted: true,
      inventory: { resolvedTableCount: 5, missingTableCount: 0 },
    },
    environmentUpdates: updates,
    appliedActions: CHATWOOT_LARK_BLUEPRINT.map((table) => ({
      action: 'create_table', tableKey: table.key, status: 'created',
    })),
    capturedAt: '2026-07-28T00:00:00.000Z',
  });
  const text = JSON.stringify(evidence);
  assert.equal(text.includes('tbl_mktConversations'), false);
  assert.equal(evidence.result.createdTableCount, 5);
  assert.equal(evidence.boundaries.rawTableIdsPersistedInSummary, false);
});

test('CLI source contains no record, destructive, config-edit, Provider, D1, Queue, or deploy path', async () => {
  const source = await readFile('scripts/chatwoot-lark-schema-apply.mjs', 'utf8');
  for (const forbidden of [
    'batchCreateRecords(', 'batchUpdateRecords(', 'deleteTable(', 'deleteField(', 'renameTable(',
    "writeFile('.dev.vars'", 'CHATWOOT_API_ACCESS_TOKEN', '.send(', 'wrangler deploy', 'd1 execute',
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden source fragment: ${forbidden}`);
  }
  assert.ok(source.includes('client.createTable('));
  assert.ok(source.includes('client.createField('));
  assert.ok(source.includes('environment-updates.env'));
});

function metadataEvidence() {
  const actions = CHATWOOT_LARK_BLUEPRINT.map((table) => ({
    action: 'create_table',
    tableKey: table.key,
    createName: table.createName,
    primaryField: table.primaryField,
    fieldCount: table.fields.length,
  }));
  return {
    phase: 'lark-preflight',
    contractVersion: 'chatwoot-lark-metadata-readiness-v1',
    status: 'action_required',
    accepted: false,
    decision: 'CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED',
    inventory: {
      expectedTableCount: 5,
      resolvedTableCount: 0,
      missingTableCount: 5,
      remoteTableCount: 56,
    },
    additivePlan: {
      actionCount: actions.length,
      actions,
      destructiveActions: 0,
      renameTableCount: 0,
      deleteTableCount: 0,
      deleteFieldCount: 0,
      changeFieldTypeCount: 0,
    },
    blockers: {
      ambiguousTables: [],
      identityMismatches: [],
      missingPrimaryKeys: [],
      typeMismatches: [],
    },
    missingFields: [],
    boundaries: {
      metadataReadOnly: true,
      larkRequestCount: 1,
      larkRecordReadCount: 0,
      larkMutationCount: 0,
      providerRequestCount: 0,
      d1MutationCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleWebhookActionCount: 0,
      credentialValuesPersisted: false,
      rawMetadataPayloadPersisted: false,
      destructivePlanActionCount: 0,
    },
  };
}

function analysisFromEvidence(evidence) {
  return structuredClone({
    status: evidence.status,
    accepted: evidence.accepted,
    decision: evidence.decision,
    additivePlan: evidence.additivePlan,
    blockers: evidence.blockers,
    inventory: evidence.inventory,
    missingFields: evidence.missingFields,
  });
}

function field(tableAction, fieldName) {
  return tableAction.fields.find((candidate) => candidate.fieldName === fieldName);
}
