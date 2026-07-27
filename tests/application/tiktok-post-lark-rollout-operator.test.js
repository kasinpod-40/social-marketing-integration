import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TIKTOK_POST_LARK_AUDIT_PATH,
  TIKTOK_POST_LARK_ENABLE_EVIDENCE_MAX_AGE_MS,
  TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS,
  TIKTOK_POST_LARK_ROUTE_PROBE_COUNT,
  assertTikTokPostLarkRolloutConfirmation,
  buildTikTokPostLarkPostMigrationSql,
  buildTikTokPostLarkPreflightSql,
  createTikTokPostLarkTargetFingerprint,
  extractWranglerD1Rows,
  loadTikTokPostLarkRolloutTarget,
  parseTikTokPostLarkRolloutArgs,
  parseWranglerDeploymentOutput,
  probeTikTokPostLarkRouteStability,
  selectTikTokPostLarkEnableAttemptEvidence,
  validateTikTokPostLarkAuditHttpResponse,
  validateTikTokPostLarkAuditResponse,
  validateTikTokPostLarkFreshEnableEvidence,
  validateTikTokPostLarkNoPendingMigrations,
  validateTikTokPostLarkPendingMigrations,
  validateTikTokPostLarkPostMigrationRow,
  validateTikTokPostLarkPreflightRow,
  validateTikTokPostLarkWranglerConfig,
} from '../../scripts/lib/tiktok-post-lark-rollout-operator.js';

test('operator defaults to plan and rejects unsupported phases', () => {
  assert.deepEqual(parseTikTokPostLarkRolloutArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseTikTokPostLarkRolloutArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseTikTokPostLarkRolloutArgs(['--phase=admit', '--execute']),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_PHASE_INVALID',
  );
});

test('every executable phase requires an exact distinct confirmation', () => {
  for (const [phase, contract] of Object.entries(TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS)) {
    assert.throws(
      () => assertTikTokPostLarkRolloutConfirmation(phase, {}),
      (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_CONFIRMATION_REQUIRED',
    );
    assert.equal(assertTikTokPostLarkRolloutConfirmation(phase, {
      [contract.envName]: contract.value,
    }), true);
  }
  assert.equal(assertTikTokPostLarkRolloutConfirmation('plan', {}), true);
});

test('target is locked to the Integration Workspace and audit token is phase-scoped', () => {
  const env = createTargetEnv();
  const preflight = loadTikTokPostLarkRolloutTarget(env, 'preflight');
  assert.equal(preflight.databaseName, 'social-mkt-state-dev');
  assert.equal(preflight.operatorToken, null);
  const audit = loadTikTokPostLarkRolloutTarget({
    ...env,
    MKT_CONNECTION_OPERATOR_TOKEN: 'local-secret-token',
  }, 'audit');
  assert.equal(audit.operatorToken, 'local-secret-token');
  assert.throws(
    () => loadTikTokPostLarkRolloutTarget({
      ...env,
      TIKTOK_SOURCE_HANDLE: 'another-account',
    }, 'preflight'),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_TARGET_INVALID',
  );
});

test('safe and audit-only Wrangler configs reject every business or schedule gate', () => {
  const safe = validateTikTokPostLarkWranglerConfig(createWranglerConfig(false), {
    auditEnabled: false,
  });
  const audit = validateTikTokPostLarkWranglerConfig(createWranglerConfig(true), {
    auditEnabled: true,
  });
  assert.equal(safe.auditEnabled, false);
  assert.equal(audit.auditEnabled, true);
  assert.throws(
    () => validateTikTokPostLarkWranglerConfig(
      createWranglerConfig(true).replace(
        '"MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED": "false"',
        '"MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED": "true"',
      ),
      { auditEnabled: true },
    ),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
  );
  assert.throws(
    () => validateTikTokPostLarkWranglerConfig(
      createWranglerConfig(true).replace(
        '"MKT_TIKTOK_AUDIT_HTTP_ENABLED": "true"',
        '"MKT_TIKTOK_AUDIT_HTTP_ENABLED": "false"',
      ),
      { auditEnabled: true },
    ),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
  );
});

test('migration gate accepts only reviewed Migration 0016', () => {
  assert.deepEqual(
    validateTikTokPostLarkPendingMigrations('0016_tiktok_post_lark_pipeline.sql'),
    ['0016_tiktok_post_lark_pipeline.sql'],
  );
  assert.equal(validateTikTokPostLarkNoPendingMigrations('No migrations to apply!'), true);
  assert.throws(
    () => validateTikTokPostLarkPendingMigrations([
      '0016_tiktok_post_lark_pipeline.sql',
      '0017_unreviewed.sql',
    ].join('\n')),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_PENDING_MIGRATIONS_MISMATCH',
  );
});

test('preflight SQL is read-only and preflight requires no active work, lock, duplicates or 0016 schema', () => {
  const sql = buildTikTokPostLarkPreflightSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/iu);
  const row = createPreflightRow();
  assert.deepEqual(validateTikTokPostLarkPreflightRow(row), row);
  assert.throws(
    () => validateTikTokPostLarkPreflightRow({ ...row, active_locks: 1 }),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_PREFLIGHT_FAILED',
  );
});

test('post-migration SQL verifies additive schema and zero business drift', () => {
  const sql = buildTikTokPostLarkPostMigrationSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/iu);
  const before = createPreflightRow();
  const after = {
    admission_table_present: 1,
    admission_account_index_present: 1,
    admission_watermark_index_present: 1,
    admission_completed_index_present: 1,
    admission_rows: 0,
    active_work: 0,
    active_locks: 0,
    organic_content_state: 2021,
    organic_content_observations: 2021,
    coverage_entities: 2021,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
  };
  assert.deepEqual(validateTikTokPostLarkPostMigrationRow(after, before), after);
  assert.throws(
    () => validateTikTokPostLarkPostMigrationRow({
      ...after,
      organic_content_state: 2022,
    }, before),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_POST_MIGRATION_FAILED',
  );
});

test('Wrangler D1 response extraction supports standard envelopes', () => {
  assert.deepEqual(extractWranglerD1Rows(JSON.stringify([{
    success: true,
    results: [{ value: 1 }],
  }])), [{ value: 1 }]);
  assert.throws(
    () => extractWranglerD1Rows(JSON.stringify([{ success: true, results: [] }])),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_D1_RESPONSE_EMPTY',
  );
});

test('audit response preserves exact identity and can report not-ready without fake success', () => {
  const response = {
    ok: true,
    audit: {
      mode: 'read_only',
      platform: 'tiktok',
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
      sourceHandle: 'chemistry_k',
      raw: {
        recordCount: 2021,
        sourceWatermark: 'sha256:abc',
      },
      readyForManualProcessing: false,
      issues: [{ code: 'TIKTOK_CROSS_LAYER_GAP' }],
    },
  };
  const result = validateTikTokPostLarkAuditResponse(response, {
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
  });
  assert.equal(result.readyForManualProcessing, false);
  assert.equal(result.issueCount, 1);
  assert.throws(
    () => validateTikTokPostLarkAuditResponse({
      ...response,
      audit: { ...response.audit, sourceHandle: 'other' },
    }, {
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
      sourceHandle: 'chemistry_k',
    }),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
  );
});

test('operator propagates only the sanitized remote code for a failed Audit HTTP response', () => {
  const body = {
    code: 'LARK_TABLE_CONFIG_INVALID',
    raw: { contentId: 'private-content' },
    authorization: 'Bearer private-token',
    token: 'private-token',
  };
  assert.throws(
    () => validateTikTokPostLarkAuditHttpResponse(400, body),
    (error) => {
      assert.equal(error.code, 'TIKTOK_POST_LARK_ROLLOUT_AUDIT_HTTP_FAILED');
      assert.deepEqual(error.details, {
        httpStatus: 400,
        remoteCode: 'LARK_TABLE_CONFIG_INVALID',
      });
      const report = JSON.stringify({
        code: error.code,
        message: error.message,
        details: error.details,
      });
      assert.doesNotMatch(report, /private-content|private-token|authorization|Bearer/iu);
      return true;
    },
  );
});

test('operator falls back when a failed Audit HTTP response has no safe remote code', () => {
  for (const body of [
    {},
    { code: '' },
    { code: null },
    { code: 'invalid code with raw details' },
  ]) {
    assert.throws(
      () => validateTikTokPostLarkAuditHttpResponse(400, body),
      (error) => {
        assert.equal(error.code, 'TIKTOK_POST_LARK_ROLLOUT_AUDIT_HTTP_FAILED');
        assert.deepEqual(error.details, {
          httpStatus: 400,
          remoteCode: 'TIKTOK_POST_LARK_AUDIT_FAILED',
        });
        return true;
      },
    );
  }
  assert.equal(validateTikTokPostLarkAuditHttpResponse(200, { ok: true }), true);
});

test('route stability gate accepts exactly three consecutive 401 responses', async () => {
  const scenario = createProbeScenario([401, 401, 401]);
  const result = await probeTikTokPostLarkRouteStability(scenario.options);
  assert.equal(result.stableRouteStatus, 401);
  assert.equal(result.probes.length, TIKTOK_POST_LARK_ROUTE_PROBE_COUNT);
  assert.deepEqual(result.probes.map((probe) => probe.status), [401, 401, 401]);
  assert.equal(scenario.requests.length, 3);
  assert.deepEqual(scenario.sleepDelays, [250, 250]);
});

test('safe-close stability gate accepts exactly three consecutive 404 responses', async () => {
  const scenario = createProbeScenario([404, 404, 404], { expectedStatus: 404 });
  const result = await probeTikTokPostLarkRouteStability(scenario.options);
  assert.equal(result.stableRouteStatus, 404);
  assert.deepEqual(result.probes.map((probe) => probe.status), [404, 404, 404]);
  assert.equal(scenario.requests.length, 3);
});

test('mixed 401, 404, 401 route responses fail closed with sanitized details', async () => {
  const scenario = createProbeScenario([401, 404, 401]);
  await assert.rejects(
    probeTikTokPostLarkRouteStability(scenario.options),
    (error) => {
      assert.equal(error.code, 'TIKTOK_POST_LARK_ROLLOUT_ROUTE_STABILITY_FAILED');
      assert.deepEqual(error.details.observedStatuses, [401, 404, 401]);
      assert.equal(error.details.requiredConsecutiveProbes, 3);
      assert.equal(error.details.safeCloseRequired, true);
      assert.deepEqual(Object.keys(error.details).sort(), [
        'deploymentVersionId',
        'expectedStatus',
        'observedStatuses',
        'probeTimestamps',
        'requiredConsecutiveProbes',
        'safeCloseRequired',
        'targetFingerprint',
      ]);
      return true;
    },
  );
});

test('late 500 route response fails closed without unbounded retries', async () => {
  const scenario = createProbeScenario([401, 401, 500]);
  await assert.rejects(
    probeTikTokPostLarkRouteStability(scenario.options),
    (error) => {
      assert.equal(error.code, 'TIKTOK_POST_LARK_ROLLOUT_ROUTE_STABILITY_FAILED');
      assert.deepEqual(error.details.observedStatuses, [401, 401, 500]);
      return true;
    },
  );
  assert.equal(scenario.requests.length, 3);
});

test('route probes use unique cache busting, no-cache headers and no authorization', async () => {
  const scenario = createProbeScenario([401, 401, 401]);
  const result = await probeTikTokPostLarkRouteStability(scenario.options);
  const urls = scenario.requests.map(({ url }) => new URL(url));
  assert.equal(new Set(urls.map((url) => url.searchParams.get('mkt_probe'))).size, 3);
  for (const { url, init } of scenario.requests) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, TIKTOK_POST_LARK_AUDIT_PATH);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['Cache-Control'], 'no-cache, no-store');
    assert.equal(init.headers.Pragma, 'no-cache');
    assert.equal('Authorization' in init.headers, false);
    assert.equal('authorization' in init.headers, false);
  }
  const evidence = JSON.stringify(result);
  assert.doesNotMatch(
    evidence,
    /sync-worker\.example\.com|mkt_probe|fixed-nonce|response-body|Authorization/iu,
  );
});

test('target fingerprints are stable for normalized targets and change with target identity', () => {
  const first = createTikTokPostLarkTargetFingerprint({
    origin: 'https://SYNC-WORKER.example.com/',
    pathname: TIKTOK_POST_LARK_AUDIT_PATH,
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
  });
  const normalized = createTikTokPostLarkTargetFingerprint({
    origin: 'https://sync-worker.example.com',
    pathname: TIKTOK_POST_LARK_AUDIT_PATH,
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
  });
  assert.equal(first, normalized);
  for (const changed of [
    { origin: 'https://other.example.com' },
    { pathname: '/operator/tiktok/other' },
    { workerName: 'other-worker' },
    { environment: 'production' },
  ]) {
    assert.notEqual(
      first,
      createTikTokPostLarkTargetFingerprint({
        origin: 'https://sync-worker.example.com',
        pathname: TIKTOK_POST_LARK_AUDIT_PATH,
        workerName: 'social-mkt-sync-worker',
        environment: 'development',
        ...changed,
      }),
    );
  }
});

test('Wrangler deployment parser selects only the typed deploy version field', () => {
  const versionId = '12345678-1234-4123-8123-123456789abc';
  const output = [
    JSON.stringify({
      type: 'wrangler-session',
      version: 1,
      account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    JSON.stringify({
      type: 'deploy',
      version: 1,
      worker_name: 'social-mkt-sync-worker',
      version_id: versionId,
      targets: ['https://private-origin.example.com'],
    }),
  ].join('\n');
  assert.deepEqual(parseWranglerDeploymentOutput(output, {
    workerName: 'social-mkt-sync-worker',
  }), {
    deploymentVersionId: versionId,
    deploymentSource: 'wrangler',
  });
});

test('missing or malformed Wrangler deployment identity fails closed', () => {
  for (const output of [
    '{"type":"wrangler-session","version":1}',
    '{"type":"deploy","version":1,"worker_name":"social-mkt-sync-worker","version_id":"not-a-version"}',
    '{not-json}',
  ]) {
    assert.throws(
      () => parseWranglerDeploymentOutput(output, {
        workerName: 'social-mkt-sync-worker',
      }),
      (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_DEPLOYMENT_ID_UNAVAILABLE',
    );
  }
});

test('fresh stable enable evidence allows the authenticated Audit phase', async () => {
  const evidence = await createEnableEvidence();
  assert.equal(validateTikTokPostLarkFreshEnableEvidence(evidence, {
    now: '2026-07-27T10:00:01.000Z',
    targetFingerprint: evidence.targetFingerprint,
  }), evidence);
});

test('stale, incomplete or superseded enable evidence blocks the authenticated Audit phase', async () => {
  const evidence = await createEnableEvidence();
  for (const options of [
    {
      now: new Date(
        Date.parse(evidence.capturedAt) + TIKTOK_POST_LARK_ENABLE_EVIDENCE_MAX_AGE_MS + 1,
      ),
      targetFingerprint: evidence.targetFingerprint,
    },
    {
      now: '2026-07-27T10:00:01.000Z',
      targetFingerprint: evidence.targetFingerprint,
      latestFailureCapturedAt: '2026-07-27T10:00:00.300Z',
    },
  ]) {
    assert.throws(
      () => validateTikTokPostLarkFreshEnableEvidence(evidence, options),
      (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE',
    );
  }
  assert.throws(
    () => validateTikTokPostLarkFreshEnableEvidence({
      ...evidence,
      deploymentVersionId: null,
    }, {
      now: '2026-07-27T10:00:01.000Z',
      targetFingerprint: evidence.targetFingerprint,
    }),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE',
  );
});

test('safe-close selects a failed enable attempt without successful Audit evidence', () => {
  const failed = {
    phase: 'enable-audit',
    status: 'failed',
    capturedAt: '2026-07-27T10:00:00.000Z',
    safeCloseRequired: true,
  };
  assert.equal(selectTikTokPostLarkEnableAttemptEvidence(null, failed), failed);
});

test('operator persists failed stability separately and only passes enable after the gate', async () => {
  const source = await readFile(
    new URL('../../scripts/tiktok-post-lark-rollout-operator.mjs', import.meta.url),
    'utf8',
  );
  const enableStart = source.indexOf('async function runEnableAudit');
  const auditStart = source.indexOf('async function runAudit');
  const enableSource = source.slice(enableStart, auditStart);
  const gateIndex = enableSource.indexOf('deployAndProbeRoute');
  const passedEvidenceIndex = enableSource.indexOf("saveEvidence('enable-audit'");
  assert.match(source, /saveEvidence\(`\$\{phase\}-failure`/u);
  assert.ok(gateIndex >= 0);
  assert.ok(passedEvidenceIndex > gateIndex);
  assert.match(source, /async function runDisableAudit[\s\S]*requireEnableAttemptEvidence/u);
});

function createTargetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    TIKTOK_SOURCE_HANDLE: 'chemistry_k',
    MKT_TIKTOK_ROLLOUT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_TIKTOK_ROLLOUT_SAFE_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_TIKTOK_ROLLOUT_AUDIT_WRANGLER_CONFIG: 'wrangler.sync.tiktok-audit.jsonc',
    MKT_TIKTOK_ROLLOUT_WORKER_ORIGIN: 'https://social-mkt-sync-worker.example.com',
  };
}

function createProbeScenario(statuses, overrides = {}) {
  const requests = [];
  const sleepDelays = [];
  let timestamp = Date.parse('2026-07-27T10:00:00.100Z');
  const options = {
    origin: 'https://sync-worker.example.com',
    pathname: TIKTOK_POST_LARK_AUDIT_PATH,
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
    deploymentVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expectedStatus: 401,
    createNonce: () => 'fixed-nonce',
    now: () => {
      const value = new Date(timestamp);
      timestamp += 10;
      return value;
    },
    sleep: async (delay) => {
      sleepDelays.push(delay);
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response('response-body-private', { status: statuses[requests.length - 1] });
    },
    ...overrides,
  };
  return { options, requests, sleepDelays };
}

async function createEnableEvidence() {
  const scenario = createProbeScenario([401, 401, 401]);
  const route = await probeTikTokPostLarkRouteStability(scenario.options);
  return {
    phase: 'enable-audit',
    status: 'passed',
    capturedAt: '2026-07-27T10:00:00.300Z',
    deploymentStartedAt: '2026-07-27T10:00:00.000Z',
    deploymentCompletedAt: '2026-07-27T10:00:00.050Z',
    deploymentVersionId: scenario.options.deploymentVersionId,
    deploymentSource: 'wrangler',
    ...route,
  };
}

function createWranglerConfig(auditEnabled) {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
    }],
    queues: {
      producers: [{
        binding: 'MKT_SYNC_QUEUE',
        queue: 'social-mkt-sync-jobs',
      }],
    },
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
      TIKTOK_SOURCE_HANDLE: 'chemistry_k',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
      MKT_TIKTOK_AUDIT_HTTP_ENABLED: String(auditEnabled),
      MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'false',
      MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED: 'false',
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
      MKT_TIME_SERIES_D1_BACKFILL_ENABLED: 'false',
      MKT_REPORT_D1_SHADOW_READ_ENABLED: 'false',
      MKT_REPORT_D1_READ_ENABLED: 'false',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'false',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'false',
      MKT_DLQ_REDRIVE_ENABLED: 'false',
      MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'false',
      MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED: 'false',
      MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED: 'false',
      MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED: 'false',
      MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'false',
      MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'false',
    },
  }, null, 2);
}

function createPreflightRow() {
  return {
    admission_table_present: 0,
    admission_account_index_present: 0,
    admission_watermark_index_present: 0,
    admission_completed_index_present: 0,
    active_work: 0,
    active_locks: 0,
    open_dlq: 1,
    open_alerts: 0,
    organic_content_state: 2021,
    organic_content_observations: 2021,
    coverage_entities: 2021,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
  };
}
