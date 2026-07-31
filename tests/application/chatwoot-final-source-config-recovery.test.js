import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  CHATWOOT_FINAL_UAT_TABLES,
} from '../../scripts/lib/chatwoot-final-30d-daily-uat.js';
import {
  CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION,
  CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
  assertChatwootFinalSourceConfigRecoveryConfirmation,
  assertChatwootFinalSourceIncidentClosable,
  assertChatwootFinalSourceIncidentOpen,
  assertChatwootFinalSourceIncidentResolved,
  assertChatwootFinalSourceRecoverySummary,
  buildChatwootFinalSourceIncidentClosureSql,
  buildChatwootFinalSourceIncidentSql,
  materializeChatwootFinalSourceConfig,
  resolveChatwootFinalSourceIdentity,
  validateChatwootFinalSourceIncidentClosureResults,
} from '../../scripts/lib/chatwoot-final-source-config-recovery.js';

const CURRENT_HEAD = 'c03ca9af7ddc0b8f72527419fc193eb49e1c590d';
const RECOVERY_REFERENCE = `chatwoot-source-config-recovery:${CURRENT_HEAD}`;

function sourceConfig() {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: './apps/sync-worker/src/index.js',
    compatibility_date: '2026-07-15',
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
      CHATWOOT_BASE_URL: 'https://stale.invalid.example',
      CHATWOOT_ACCOUNT_ID: '999',
    },
  }, null, 2);
}

function sourceEnv(overrides = {}) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    CHATWOOT_BASE_URL: 'https://chatwoot.customer.test',
    CHATWOOT_ACCOUNT_ID: '14',
    ...overrides,
  };
}

function incidentRow(overrides = {}) {
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  const row = {
    queue_rows: 1,
    queue_attempts: 1,
    queue_generation_min: incident.generation,
    queue_generation_max: incident.generation,
    queue_requested_min: incident.requestedAt,
    queue_requested_max: incident.requestedAt,
    queue_message_id: incident.messageId,
    metadata_rows: 1,
    recovery_status: 'not_started',
    recovery_reference: null,
    audit_reference: null,
    metadata_generation: incident.generation,
    metadata_requested_at: incident.requestedAt,
    terminal_rows: 1,
    terminal_status: 'open',
    terminal_error_code: incident.errorCode,
    terminal_error_message: incident.errorMessage,
    terminal_retry_count: 1,
    terminal_job_type: incident.jobType,
    alert_rows: 1,
    alert_status: 'open',
    alert_type: 'queue_permanent_failure',
    alert_severity: 'critical',
    alert_platform: 'chatwoot',
    alert_error_code: incident.errorCode,
    sync_rows: 0,
    work_rows: 0,
    phase_rows: 0,
    coverage_rows: 0,
    active_locks: 0,
  };
  for (const tableName of new Set(CHATWOOT_FINAL_UAT_TABLES.map((spec) => spec.d1Table))) {
    row[tableName] = 0;
  }
  return { ...row, ...overrides };
}

test('recovery confirmation and success marker are exact', () => {
  const contract = CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION;
  assert.equal(contract.envName, 'CONFIRM_CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY');
  assert.equal(contract.value, 'RECOVER_CHATWOOT_SOURCE_CONFIG_AND_COMPLETE_UAT');
  assert.equal(
    CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER,
    'CHATWOOT_SOURCE_CONFIG_RECOVERY_COMPLETED_SAFE',
  );
  assert.throws(
    () => assertChatwootFinalSourceConfigRecoveryConfirmation({}),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertChatwootFinalSourceConfigRecoveryConfirmation({
    [contract.envName]: contract.value,
  }), true);
});

test('source identity requires an exact non-placeholder HTTPS origin and positive account', () => {
  const resolved = resolveChatwootFinalSourceIdentity(sourceEnv());
  assert.equal(resolved.baseUrl, 'https://chatwoot.customer.test');
  assert.equal(resolved.accountId, '14');
  assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => resolveChatwootFinalSourceIdentity(sourceEnv({ CHATWOOT_BASE_URL: 'http://chatwoot.test' })),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
  );
  assert.throws(
    () => resolveChatwootFinalSourceIdentity(sourceEnv({ CHATWOOT_BASE_URL: 'https://chatwoot.test/path' })),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
  );
  assert.throws(
    () => resolveChatwootFinalSourceIdentity(sourceEnv({ CHATWOOT_ACCOUNT_ID: '0' })),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
  );
});

test('private config materializes both required non-secret source fields and no credential', () => {
  const identity = resolveChatwootFinalSourceIdentity(sourceEnv());
  const materialized = materializeChatwootFinalSourceConfig(sourceConfig(), identity);
  const config = JSON.parse(materialized.text);
  assert.equal(config.vars.CHATWOOT_BASE_URL, identity.baseUrl);
  assert.equal(config.vars.CHATWOOT_ACCOUNT_ID, identity.accountId);
  assert.deepEqual(materialized.materializedFields, [
    'CHATWOOT_BASE_URL',
    'CHATWOOT_ACCOUNT_ID',
  ]);
  assert.equal(materialized.secretValuesMaterialized, 0);
  assert.equal('CHATWOOT_API_ACCESS_TOKEN' in config.vars, false);
  assert.equal(config.main, './apps/sync-worker/src/index.js');
});

test('read-only incident SQL pins exact retained identity and avoids LIKE/GLOB', () => {
  const sql = buildChatwootFinalSourceIncidentSql();
  assert.match(sql, /^SELECT\b/iu);
  assert.match(sql, new RegExp(CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT.operationId, 'u'));
  assert.match(sql, new RegExp(CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT.dlqId, 'u'));
  assert.match(sql, new RegExp(CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT.alertId, 'u'));
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE)\b/iu);
  assert.doesNotMatch(sql, /\b(?:LIKE|GLOB)\b/iu);
});

test('open incident validator requires exact terminal failure and zero pre-UAT business state', () => {
  assert.equal(assertChatwootFinalSourceIncidentOpen(incidentRow()).accepted, true);
  assert.throws(
    () => assertChatwootFinalSourceIncidentOpen(incidentRow({ queue_attempts: 2 })),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
  );
  assert.throws(
    () => assertChatwootFinalSourceIncidentOpen(incidentRow({ chatwoot_account_state: 1 })),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
  );
});

test('closure validator accepts only exact same-reference partial progress', () => {
  const partial = incidentRow({
    terminal_status: 'resolved',
    recovery_status: 'in_progress',
    recovery_reference: RECOVERY_REFERENCE,
    alert_status: 'open',
    chatwoot_account_state: 10,
  });
  assert.equal(assertChatwootFinalSourceIncidentClosable(partial, {
    recoveryReference: RECOVERY_REFERENCE,
  }).accepted, true);
  assert.throws(
    () => assertChatwootFinalSourceIncidentClosable({
      ...partial,
      recovery_reference: `chatwoot-source-config-recovery:${'a'.repeat(40)}`,
    }, {
      recoveryReference: RECOVERY_REFERENCE,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
  );
  assert.throws(
    () => assertChatwootFinalSourceIncidentClosable({
      ...partial,
      work_rows: 1,
    }, {
      recoveryReference: RECOVERY_REFERENCE,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
  );
});

test('closure SQL mutates only three exact retained reliability records without redrive or delete', () => {
  const sql = buildChatwootFinalSourceIncidentClosureSql({
    completedAt: Date.parse('2026-08-01T00:00:00Z'),
    recoveryReference: RECOVERY_REFERENCE,
  });
  assert.match(sql, /UPDATE dead_letter_jobs/u);
  assert.match(sql, /UPDATE dead_letter_operation_metadata/u);
  assert.match(sql, /UPDATE system_alerts/u);
  assert.match(sql, /status='resolved'/u);
  assert.match(sql, /SELECT changes\(\) AS dead_letter_rows/u);
  assert.match(sql, /SELECT changes\(\) AS metadata_rows/u);
  assert.match(sql, /SELECT changes\(\) AS alert_rows/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|DELETE|DROP|ALTER|REPLACE|CREATE)\b/iu);
  assert.doesNotMatch(sql, /\b(?:chatwoot_account_state|chatwoot_conversation_state|data_coverage_runs|sync_work_runs)\b\s+SET/iu);
  assert.doesNotMatch(sql, /redrive_requested_at|redriven_at|replay_payload_json/iu);
});

test('closure result validator requires one exact row from every statement', () => {
  assert.deepEqual(validateChatwootFinalSourceIncidentClosureResults([
    { dead_letter_rows: 1 },
    { metadata_rows: 1 },
    { alert_rows: 1 },
  ]), {
    statementCount: 3,
    updatedRows: 3,
  });
  assert.throws(
    () => validateChatwootFinalSourceIncidentClosureResults([
      { dead_letter_rows: 1 },
      { metadata_rows: 0 },
      { alert_rows: 1 },
    ]),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_CLOSURE_RESULT_INVALID',
  );
});

test('resolved incident preserves immutable old identity and exact recovery reference', () => {
  const resolved = incidentRow({
    recovery_status: 'completed',
    recovery_reference: RECOVERY_REFERENCE,
    audit_reference: RECOVERY_REFERENCE,
    terminal_status: 'resolved',
    alert_status: 'resolved',
    chatwoot_account_state: 10,
  });
  assert.equal(assertChatwootFinalSourceIncidentResolved(resolved, {
    recoveryReference: RECOVERY_REFERENCE,
  }).accepted, true);
  assert.throws(
    () => assertChatwootFinalSourceIncidentResolved(resolved, {
      recoveryReference: `chatwoot-source-config-recovery:${'a'.repeat(40)}`,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_CLOSURE_INVALID',
  );
});

test('incident closure is gated by the fully accepted Final UAT summary', () => {
  const summary = {
    ok: true,
    marker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    initial30DayVerified: true,
    initialReplayVerified: true,
    daily3DayVerified: true,
    dailyReplayVerified: true,
    restoredAllFlagsFalse: true,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  };
  assert.equal(assertChatwootFinalSourceRecoverySummary(summary), true);
  assert.throws(
    () => assertChatwootFinalSourceRecoverySummary({ ...summary, dailyReplayVerified: false }),
    (error) => error?.code === 'CHATWOOT_FINAL_SOURCE_CONFIG_UAT_SUMMARY_INVALID',
  );
});

test('public recovery launcher delegates Queue ownership and resumes from persisted summary', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-source-config-recovery-launcher.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(!args\.includes\(EXECUTE_ARGUMENT\)\)/u);
  assert.match(source, /materializeChatwootFinalSourceConfig/u);
  assert.match(source, /CHATWOOT_BASE_URL/u);
  assert.match(source, /CHATWOOT_ACCOUNT_ID/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_EVIDENCE_DIR/u);
  assert.match(source, /summaryExists/u);
  assert.match(source, /chatwoot-final-30d-daily-uat-launcher\.mjs/u);
  assert.match(source, /assertChatwootFinalSourceRecoverySummary/u);
  assert.match(source, /assertChatwootFinalSourceIncidentClosable/u);
  assert.match(source, /validateChatwootFinalSourceIncidentClosureResults/u);
  assert.match(source, /CHATWOOT_FINAL_SOURCE_CONFIG_CONCURRENT_DEPLOYMENT/u);
  assert.match(source, /currentUatSnapshotDrift:\s*false/u);
  assert.doesNotMatch(source, /\/queues\/[^\s]*\/messages/u);
  assert.doesNotMatch(source, /wrangler['"],\s*'queues',\s*'send'/u);
  assert.doesNotMatch(source, /MKT_SCHEDULE_CHATWOOT_ENABLED[^\n]*['"]true['"]/u);
  assert.doesNotMatch(source, /MKT_CHATWOOT_WEBHOOK_ENABLED[^\n]*['"]true['"]/u);
  assert.doesNotMatch(source, /production:\s*true/u);
});
