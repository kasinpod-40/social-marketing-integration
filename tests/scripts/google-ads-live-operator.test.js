import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  assertGoogleAdsLiveOperatorConfirmation,
  buildGoogleAdsConnectionGateSql,
  buildGoogleAdsRunVerificationSql,
  compareGoogleAdsLarkDailyNumber,
  compareGoogleAdsRerunVerification,
  GOOGLE_ADS_LARK_DAILY_NUMBER_FORMATTERS,
  loadGoogleAdsLiveOperatorTarget,
  parseGoogleAdsLiveOperatorArgs,
  validateGoogleAdsConnectionGateRow,
  validateGoogleAdsFlagsFalseConfig,
  validateGoogleAdsRunVerificationRow,
} from '../../scripts/lib/google-ads-live-operator.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const FALSE_FLAGS = [
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
];

function configText() {
  return JSON.stringify({
    vars: Object.fromEntries(FALSE_FLAGS.map((flag) => [flag, 'false'])),
    d1_databases: [{ binding: 'MKT_STATE_DB' }],
    queues: { producers: [{ binding: 'MKT_SYNC_QUEUE' }] },
  });
}

function targetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_GOOGLE_ADS_LIVE_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_GOOGLE_ADS_LIVE_API_WRANGLER_CONFIG: 'wrangler.api.dev.jsonc',
    MKT_GOOGLE_ADS_LIVE_SYNC_WRANGLER_CONFIG: 'wrangler.sync.dev.jsonc',
    MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID: '946-357-0541',
    MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID: '566-233-2033',
    MKT_GOOGLE_ADS_SOURCE_TIMEZONE: 'Asia/Bangkok',
  };
}

function verificationRow(overrides = {}) {
  return {
    run_id: RUN_ID,
    mode: 'LIVE',
    transport_status: 'assembling',
    expected_chunk_count: 7,
    received_chunk_count: 7,
    expected_row_count: 1375,
    received_row_count: 1375,
    payload_redacted_at: 100,
    admission_status: 'completed',
    send_attempts: 1,
    completed_at: 100,
    admission_payload_redacted_at: 100,
    work_lifecycle_status: 'completed',
    ads_entity_rows: 1000,
    ads_daily_rows: 375,
    coverage_run_rows: 6,
    ...overrides,
  };
}

function scriptGateRow(overrides = {}) {
  return {
    script_authorized_connection_count: 1,
    connected: 1,
    script_access_allowed: 1,
    api_access_validated: 0,
    api_access_pending: 1,
    advertiser_matches: 1,
    active_credential_matches: 1,
    manager_matches: 1,
    scope_matches: 1,
    ...overrides,
  };
}

test('operator argument and confirmation contracts fail closed', () => {
  assert.deepEqual(parseGoogleAdsLiveOperatorArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseGoogleAdsLiveOperatorArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseGoogleAdsLiveOperatorArgs(['--phase=send']),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_PHASE_INVALID',
  );
  assert.throws(
    () => assertGoogleAdsLiveOperatorConfirmation('migrate', {}),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertGoogleAdsLiveOperatorConfirmation('migrate', {
      CONFIRM_GOOGLE_ADS_LIVE_MIGRATION: 'migrate',
    }),
    true,
  );
});

test('operator locks the exact Integration Workspace and normalized Ads identities', () => {
  const target = loadGoogleAdsLiveOperatorTarget(targetEnv());
  assert.equal(target.environment, 'development');
  assert.equal(target.customerProfile, 'integration_workspace');
  assert.equal(target.customerKey, 'chemistry_k');
  assert.equal(target.managerCustomerId, '9463570541');
  assert.equal(target.advertiserCustomerId, '5662332033');
  assert.throws(
    () => loadGoogleAdsLiveOperatorTarget({ ...targetEnv(), MKT_ENV: 'production' }),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_TARGET_INVALID',
  );
});

test('flags-false config validation requires D1/Queue bindings and disabled schedule', () => {
  const result = validateGoogleAdsFlagsFalseConfig(configText(), configText());
  assert.equal(result.flagsFalse, true);
  assert.equal(result.scheduleDisabled, true);
  assert.throws(
    () => validateGoogleAdsFlagsFalseConfig(
      configText().replace('"MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED":"false"', '"MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED":"true"'),
      configText(),
    ),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_FLAGS_NOT_FALSE',
  );
});

test('connection gate accepts API-pending Script consent and remains read-only', () => {
  const target = loadGoogleAdsLiveOperatorTarget(targetEnv());
  const sql = buildGoogleAdsConnectionGateSql(target);
  assert.match(sql, /SELECT/u);
  assert.match(sql, /encrypted_credentials/u);
  assert.match(sql, /google_ads_api_access_pending/u);
  assert.match(sql, /approvedAdvertiserCustomerId/u);
  assert.match(sql, /json_each/u);
  assert.match(sql, /credential_kind = 'refresh_token'/u);
  assert.doesNotMatch(sql, /ciphertext|\biv\b/u);
  assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE/u);

  const pending = validateGoogleAdsConnectionGateRow(scriptGateRow());
  assert.equal(pending.script_authorized_connection_count, 1);
  assert.equal(pending.api_access_pending, 1);
  assert.equal(pending.api_access_validated, 0);

  const validated = validateGoogleAdsConnectionGateRow(scriptGateRow({
    api_access_pending: 0,
    api_access_validated: 1,
  }));
  assert.equal(validated.api_access_validated, 1);

  assert.throws(
    () => validateGoogleAdsConnectionGateRow(scriptGateRow({ manager_matches: 0 })),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_CONNECTION_GATE_FAILED',
  );
  assert.throws(
    () => validateGoogleAdsConnectionGateRow(scriptGateRow({ scope_matches: 0 })),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_CONNECTION_GATE_FAILED',
  );
});

test('LIVE verification requires complete reconciliation and exact rerun count stability', () => {
  const sql = buildGoogleAdsRunVerificationSql(RUN_ID);
  assert.match(sql, new RegExp(RUN_ID, 'u'));
  assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE/u);

  const verified = validateGoogleAdsRunVerificationRow(verificationRow());
  assert.equal(verified.admissionStatus, 'completed');
  assert.equal(verified.coverageRunRows, 6);
  assert.deepEqual(
    compareGoogleAdsRerunVerification(verificationRow(), verificationRow()),
    { businessFactDrift: false, changed: [] },
  );
  assert.throws(
    () => compareGoogleAdsRerunVerification(
      verificationRow(),
      verificationRow({ ads_daily_rows: 376 }),
    ),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_RERUN_DRIFT',
  );
});

test('Lark daily parity honors field formatter precision without weakening canonical facts', () => {
  assert.deepEqual(GOOGLE_ADS_LARK_DAILY_NUMBER_FORMATTERS.conversions, {
    formatter: '0.0',
    decimalPlaces: 1,
  });

  const liveDisplayCases = [
    ['cpc', 19.38, 19.3759582, 19.38],
    ['cpm', 16.91, 16.91337133379888, 16.91],
    ['spend', 180.61, 180.612355, 180.61],
    ['conversion_value', 2.01, 2.011443, 2.01],
    ['ctr', 0.035, 0.0350794027020621, 0.035],
    ['conversions', 2, 2.011443, 2],
  ];

  for (const [field, actual, expected, expectedDisplay] of liveDisplayCases) {
    const result = compareGoogleAdsLarkDailyNumber(field, actual, expected);
    assert.equal(result.matches, true, `${field} should match its Lark display precision`);
    assert.equal(result.mode, 'lark-display');
    assert.equal(result.expectedCanonical, expected);
    assert.equal(result.expectedDisplay, expectedDisplay);
  }

  const conversionDrift = compareGoogleAdsLarkDailyNumber('conversions', 2.1, 2.011443);
  assert.equal(conversionDrift.matches, false);
  assert.equal(conversionDrift.expectedDisplay, 2);

  const microsDrift = compareGoogleAdsLarkDailyNumber('spend_micros', 180612354, 180612355);
  assert.equal(microsDrift.matches, false);
  assert.equal(microsDrift.mode, 'canonical-exact');
  assert.equal(microsDrift.formatter, null);

  const nullParity = compareGoogleAdsLarkDailyNumber('cpa', null, null);
  assert.equal(nullParity.matches, true);
  assert.equal(compareGoogleAdsLarkDailyNumber('cpa', null, 1.25).matches, false);
});

test('operator default invocation is plan-only and performs no external command', () => {
  const result = spawnSync(process.execPath, [
    resolve('scripts/google-ads-live-operator.mjs'),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {},
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.executed, false);
  assert.equal(output.requestedPhase, null);
  assert.equal(output.safety.scheduleActivation, false);
  assert.equal(output.safety.secretMutation, false);
  assert.match(output.note, /No Git, Wrangler, D1, Queue, Lark, Secret or Google Ads command/u);
});
