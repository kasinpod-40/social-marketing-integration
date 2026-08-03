import {
  REPORT_LIVE_CLOSURE_WINDOWS,
  assertReportLiveClosureDescriptor,
} from './channel-descriptors.js';

export const REPORT_LIVE_CLOSURE_STAGES = Object.freeze([
  'repository_gate',
  'runtime_safe_state_gate',
  'source_readiness',
  'coverage_validation',
  'report_identity_planning',
  'materialization_plan',
  'd1_persistence',
  'lark_write',
  'd1_lark_parity',
  'same_input_replay',
  'zero_drift_verification',
  'safe_restore',
  'sanitized_evidence',
]);

export const REPORT_MISSING_VALUE_CONTRACT = Object.freeze({
  unavailable: Object.freeze({ value: null, display: 'N/A' }),
  missing: Object.freeze({ value: null, display: 'N/A' }),
  incomplete: Object.freeze({ value: null, display: 'N/A', partial: true }),
  covered_empty: Object.freeze({ value: null, status: 'no_data_confirmed' }),
  observed_zero: Object.freeze({ value: 0 }),
});

export function buildReportIdentities({ customerKey, customerProfile, descriptor, accountId }) {
  assertReportLiveClosureDescriptor(descriptor);
  for (const [field, value] of Object.entries({ customerKey, customerProfile, accountId })) requireText(value, field);
  return Object.freeze(REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => Object.freeze({
    customer_key: customerKey,
    customer_profile: customerProfile,
    platform: descriptor.platform,
    capability: descriptor.capability,
    account_id: accountId,
    period_kind: 'rolling',
    window_days: windowDays,
    report_setting_key: `${descriptor.platform}_${descriptor.capability}_${windowDays}d`,
    metric_scope: `${descriptor.platform}_${descriptor.capability}`,
  })));
}

export function buildStableReportKeys(identity, { metricKey = null, entityKey = null, rank = null } = {}) {
  const base = [
    identity.customer_key,
    identity.customer_profile,
    identity.platform,
    identity.capability,
    identity.account_id,
    identity.period_kind,
    identity.window_days,
    identity.report_setting_key,
    identity.metric_scope,
  ].join(':');
  const result = {
    report_id: `report:${base}`,
    report_metric_key: metricKey === null ? null : `report_metric:${base}:${metricKey}`,
    report_content_key: entityKey === null ? null : `report_content:${base}:${entityKey}:${rank ?? 0}`,
    report_ad_key: entityKey === null ? null : `report_ad:${base}:${entityKey}:${rank ?? 0}`,
  };
  return Object.freeze(result);
}

export async function runReportLiveClosureFramework({ descriptor, target, adapters, execute = false }) {
  assertReportLiveClosureDescriptor(descriptor);
  assertAdapters(adapters);
  const evidence = [];
  const context = Object.freeze({ descriptor, target, execute });

  const repository = await runGate('repository_gate', adapters.repositoryGate, context, evidence);
  const runtime = await runGate('runtime_safe_state_gate', adapters.runtimeGate, { ...context, repository }, evidence);
  const source = await runGate('source_readiness', adapters.sourceReadiness, { ...context, repository, runtime }, evidence);
  const coverage = await runGate('coverage_validation', adapters.coverageValidation, {
    ...context, repository, runtime, source,
  }, evidence);
  const identities = buildReportIdentities({
    customerKey: target.customerKey,
    customerProfile: target.customerProfile,
    accountId: target.accountId,
    descriptor,
  });
  evidence.push(freezeStage('report_identity_planning', true, { count: identities.length }));

  const plan = await runGate('materialization_plan', adapters.materializationPlan, {
    ...context, repository, runtime, source, coverage, identities,
  }, evidence);

  if (!execute) return freezeSummary({ descriptor, target, identities, plan, evidence, status: 'READY_FOR_LIVE' });

  const persisted = await runGate('d1_persistence', adapters.d1Persistence, { ...context, identities, plan }, evidence);
  const lark = await runGate('lark_write', adapters.larkWrite, { ...context, identities, plan, persisted }, evidence);
  const parity = await runGate('d1_lark_parity', adapters.parity, { ...context, identities, persisted, lark }, evidence);
  const replay = await runGate('same_input_replay', adapters.sameInputReplay, {
    ...context, identities, plan, persisted, lark, parity,
  }, evidence);
  const zeroDrift = await runGate('zero_drift_verification', adapters.zeroDrift, {
    ...context, identities, replay,
  }, evidence);
  const restore = await runGate('safe_restore', adapters.safeRestore, { ...context, zeroDrift }, evidence);
  await runGate('sanitized_evidence', adapters.sanitizedEvidence, { ...context, evidence, restore }, evidence);

  return freezeSummary({ descriptor, target, identities, plan, evidence, status: 'CLOSED' });
}

async function runGate(stage, adapter, context, evidence) {
  try {
    const result = await adapter(context);
    if (result?.ok !== true) throw frameworkError(`${stage} did not pass`, 'REPORT_LIVE_CLOSURE_GATE_BLOCKED', { stage });
    evidence.push(freezeStage(stage, true, sanitize(result)));
    return result;
  } catch (error) {
    evidence.push(freezeStage(stage, false, {
      code: error?.code ?? 'REPORT_LIVE_CLOSURE_GATE_FAILED',
      message: error?.message ?? `${stage} failed`,
    }));
    throw error;
  }
}

function assertAdapters(adapters) {
  for (const stage of REPORT_LIVE_CLOSURE_STAGES) {
    const key = {
      repository_gate: 'repositoryGate',
      runtime_safe_state_gate: 'runtimeGate',
      source_readiness: 'sourceReadiness',
      coverage_validation: 'coverageValidation',
      report_identity_planning: null,
      materialization_plan: 'materializationPlan',
      d1_persistence: 'd1Persistence',
      lark_write: 'larkWrite',
      d1_lark_parity: 'parity',
      same_input_replay: 'sameInputReplay',
      zero_drift_verification: 'zeroDrift',
      safe_restore: 'safeRestore',
      sanitized_evidence: 'sanitizedEvidence',
    }[stage];
    if (key && typeof adapters?.[key] !== 'function') throw frameworkError(
      `Adapter ${key} is required`,
      'REPORT_LIVE_CLOSURE_ADAPTER_MISSING',
      { stage, adapter: key },
    );
  }
}

function freezeSummary({ descriptor, target, identities, plan, evidence, status }) {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_framework_v1',
    frameworkStatus: 'READY',
    firstAdopter: descriptor.platform === 'youtube' ? 'youtube' : null,
    channel: `${descriptor.platform}:${descriptor.capability}`,
    status,
    target: Object.freeze({ ...target }),
    identities,
    plan,
    evidence: Object.freeze(evidence),
    remoteWriteCount: status === 'READY_FOR_LIVE' ? 0 : null,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function freezeStage(stage, ok, details) {
  return Object.freeze({ stage, ok, details: Object.freeze({ ...details }) });
}

function sanitize(value) {
  const blocked = /token|secret|authorization|cookie|password|tableId|databaseId/iu;
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !blocked.test(key)));
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw frameworkError(
    `${field} is required`,
    'REPORT_LIVE_CLOSURE_IDENTITY_INVALID',
    { field },
  );
}

function frameworkError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLiveClosureFrameworkError';
  error.code = code;
  error.details = details;
  return error;
}
