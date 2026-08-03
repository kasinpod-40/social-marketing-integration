import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_PLAN_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_AI_OUTPUT_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_MANAGED_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_REQUIRED_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_SAFETY_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_READINESS_PLAN_SCHEMA_VERSION,
} from '../../../config/src/lark-native-ai-controlled-preview-executor-contract.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const IDENTITY_FIELDS = Object.freeze([
  'ai_run_key',
  'scope_type',
  'channel_key',
  'capability',
  'window_days',
]);

export async function buildLarkNativeAiControlledPreviewExecutionPlan(input = {}) {
  const repository = normalizeRepository(input.repository);
  const readinessPlans = Array.isArray(input.readinessPlans ?? input.readiness_plans)
    ? (input.readinessPlans ?? input.readiness_plans)
    : [];
  const existingRecords = normalizeExistingRecords(input.existingRecords ?? input.existing_records ?? []);
  const blockers = [];
  const desiredRows = inspectReadinessPlans(readinessPlans, repository, blockers);
  inspectExistingInventory(existingRecords, desiredRows, blockers);

  let actions = blockers.length === 0 ? buildActions(desiredRows, existingRecords, blockers) : [];
  const boundedBlockers = boundBlockers(blockers);
  if (boundedBlockers.length > 0) actions = [];

  const counts = countActions(actions);
  const status = boundedBlockers.length > 0
    ? 'blocked'
    : (counts.write === 0 ? 'zero_drift' : 'ready_to_apply');
  const planCore = {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_PLAN_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_CONTRACT_VERSION,
    mode: 'controlled_preview_execution_plan',
    status,
    nextAction: resolveNextAction(status),
    repository,
    authority: buildAuthority(readinessPlans, repository),
    targetTable: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE,
    windows: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS,
    expectedRowCount: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedTotalRows,
    desiredRowCount: desiredRows.length,
    existingRecordCount: existingRecords.length,
    managedExistingRecordCount: existingRecords.filter(({ fields }) => desiredRows.some(
      ({ fields: desiredFields }) => desiredFields.ai_run_key === fields.ai_run_key,
    )).length,
    actions: Object.freeze(actions),
    counts,
    blockers: Object.freeze(boundedBlockers),
    safety: Object.freeze({
      executorPlanImplemented: true,
      remoteApplyImplemented: false,
      executionAuthorized: false,
      deleteActionCount: 0,
      aiCallCount: 0,
      larkRecordReadCount: 0,
      larkRecordWriteCount: 0,
      remoteD1ActionCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      providerActionCount: 0,
      automationCount: 0,
      notificationCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  };
  const planId = await sha256Hex(stableStringify({
    ...planCore,
    actions: planCore.actions.map(sanitizeActionForIdentity),
  }));
  return deepFreeze({ ...planCore, planId });
}

export function simulateLarkNativeAiControlledPreviewExecution(plan, existingRecordsInput = []) {
  if (!isObject(plan) || !['ready_to_apply', 'zero_drift'].includes(plan.status)) {
    throw codedError(
      'LARK_NATIVE_AI_EXECUTION_PLAN_NOT_APPLICABLE',
      'Execution plan must be ready_to_apply or zero_drift.',
    );
  }
  if (plan.safety?.executionAuthorized !== false || plan.safety?.deleteActionCount !== 0) {
    throw codedError(
      'LARK_NATIVE_AI_EXECUTION_PLAN_SAFETY_INVALID',
      'Execution plan safety contract is invalid.',
    );
  }

  const records = normalizeExistingRecords(existingRecordsInput).map(cloneRecord);
  const byRecordId = new Map(records.map((record) => [record.recordId, record]));
  const byAiRunKey = new Map(records
    .filter(({ fields }) => text(fields.ai_run_key))
    .map((record) => [record.fields.ai_run_key, record]));

  for (const action of plan.actions ?? []) {
    if (action.action === 'no_op') continue;
    if (action.action === 'create') {
      if (byAiRunKey.has(action.aiRunKey)) {
        throw codedError(
          'LARK_NATIVE_AI_SIMULATION_CREATE_CONFLICT',
          `Duplicate ai_run_key: ${action.aiRunKey}`,
        );
      }
      const recordId = uniqueSimulationRecordId(action.aiRunKey, byRecordId);
      const record = { recordId, fields: structuredClone(action.fields) };
      records.push(record);
      byRecordId.set(recordId, record);
      byAiRunKey.set(action.aiRunKey, record);
      continue;
    }
    if (action.action === 'update') {
      const record = byRecordId.get(action.recordId);
      if (!record || record.fields.ai_run_key !== action.aiRunKey) {
        throw codedError(
          'LARK_NATIVE_AI_SIMULATION_UPDATE_TARGET_MISSING',
          `Missing update target: ${action.aiRunKey}`,
        );
      }
      Object.assign(record.fields, structuredClone(action.fieldsPatch));
      continue;
    }
    throw codedError(
      'LARK_NATIVE_AI_SIMULATION_ACTION_UNSUPPORTED',
      `Unsupported action: ${action.action}`,
    );
  }

  return deepFreeze(records
    .map(cloneRecord)
    .sort((left, right) => String(left.fields.ai_run_key ?? left.recordId)
      .localeCompare(String(right.fields.ai_run_key ?? right.recordId))));
}

function inspectReadinessPlans(plans, repository, blockers) {
  const desiredRows = [];
  const windows = new Set();
  const authorityVectors = [];

  if (plans.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedWindows) {
    blockers.push(blocker('READINESS_PLAN_COUNT_INVALID', 'readinessPlans', {
      expected: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedWindows,
      actual: plans.length,
    }));
  }

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const label = `readinessPlans[${index}]`;
    if (!isObject(plan)) {
      blockers.push(blocker('READINESS_PLAN_INVALID', label));
      continue;
    }

    inspectReadinessContract(plan, label, blockers);
    const windowDays = inspectWindow(plan, label, windows, blockers);
    inspectReadinessRepository(plan, repository, label, blockers);
    inspectReadinessAuthority(plan, label, blockers);

    const rows = plan.larkPlan?.rows;
    if (plan.larkPlan?.targetTable !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE
      || !Array.isArray(rows)
      || rows.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedRowsPerWindow) {
      blockers.push(blocker('READINESS_PLAN_LARK_ROWS_INVALID', `${label}.larkPlan`));
      continue;
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const rowLabel = `${label}.larkPlan.rows[${rowIndex}]`;
      if (!isObject(row) || !isObject(row.fields)) {
        blockers.push(blocker('READINESS_ROW_INVALID', rowLabel));
        continue;
      }
      inspectDesiredFields(row.fields, windowDays, rowLabel, blockers);
      desiredRows.push(Object.freeze({
        windowDays,
        windowOrder: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS.indexOf(windowDays),
        rowOrder: rowIndex,
        rowType: text(row.rowType),
        channelKey: text(row.channelKey),
        platform: text(row.platform),
        fields: deepFreeze(structuredClone(row.fields)),
      }));
    }
    authorityVectors.push(readinessAuthorityVector(plan));
  }

  for (const expectedWindow of LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS) {
    if (!windows.has(expectedWindow)) {
      blockers.push(blocker('READINESS_PLAN_WINDOW_MISSING', 'readinessPlans', {
        windowDays: expectedWindow,
      }));
    }
  }
  inspectAuthorityConsistency(authorityVectors, blockers);
  desiredRows.sort((left, right) => left.windowOrder - right.windowOrder || left.rowOrder - right.rowOrder);
  if (desiredRows.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedTotalRows) {
    blockers.push(blocker('DESIRED_ROW_COUNT_INVALID', 'readinessPlans', {
      expected: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.expectedTotalRows,
      actual: desiredRows.length,
    }));
  }
  inspectDesiredIdentityUniqueness(desiredRows, blockers);
  return desiredRows;
}

function inspectReadinessContract(plan, label, blockers) {
  if (plan.schemaVersion !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_READINESS_PLAN_SCHEMA_VERSION
    || plan.mode !== 'controlled_preview_readiness') {
    blockers.push(blocker('READINESS_PLAN_CONTRACT_INVALID', label));
  }
  if (plan.status !== 'ready_for_controlled_preview'
    || !Array.isArray(plan.blockers)
    || plan.blockers.length !== 0) {
    blockers.push(blocker('READINESS_PLAN_NOT_READY', label, { status: plan.status ?? null }));
  }
}

function inspectWindow(plan, label, windows, blockers) {
  const windowDays = positiveInteger(plan.runIdentity?.windowDays);
  if (!LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS.includes(windowDays)) {
    blockers.push(blocker(
      'READINESS_PLAN_WINDOW_UNSUPPORTED',
      `${label}.runIdentity.windowDays`,
      { windowDays },
    ));
  } else if (windows.has(windowDays)) {
    blockers.push(blocker(
      'READINESS_PLAN_WINDOW_DUPLICATE',
      `${label}.runIdentity.windowDays`,
      { windowDays },
    ));
  } else {
    windows.add(windowDays);
  }
  return windowDays;
}

function inspectReadinessRepository(plan, repository, label, blockers) {
  const planRepository = plan.repository ?? {};
  if (repository.branch !== 'main' || !repository.clean || !repository.exactHeadSha) {
    blockers.push(blocker('EXECUTOR_REPOSITORY_AUTHORITY_INVALID', 'repository'));
  }
  if (planRepository.branch !== 'main'
    || planRepository.clean !== true
    || planRepository.exactHeadSha !== repository.exactHeadSha) {
    blockers.push(blocker('READINESS_PLAN_REPOSITORY_MISMATCH', `${label}.repository`));
  }
  if (plan.approval?.present !== true
    || plan.approval?.valid !== true
    || plan.approval?.approvedHeadSha !== repository.exactHeadSha) {
    blockers.push(blocker('READINESS_PLAN_APPROVAL_INVALID', `${label}.approval`));
  }
}

function inspectReadinessAuthority(plan, label, blockers) {
  const schema = plan.schemaAuthority ?? {};
  const remote = plan.remoteAuthority ?? {};
  const safety = plan.safety ?? {};
  if (schema.status !== 'zero_drift'
    || schema.requiredViewCount !== 6
    || schema.exactViewFilterCount !== 6
    || schema.remainingLogicalActionCount !== 0
    || !SHA256.test(schema.evidenceSha256 ?? '')) {
    blockers.push(blocker('READINESS_PLAN_SCHEMA_AUTHORITY_INVALID', `${label}.schemaAuthority`));
  }
  if (remote.metaRemoteLockReleased !== true
    || remote.workerFlagsAllFalse !== true
    || remote.previewUrlsDisabled !== true
    || remote.productionBlocked !== true
    || remote.scheduleEnabled !== false
    || !SHA256.test(remote.evidenceSha256 ?? '')) {
    blockers.push(blocker('READINESS_PLAN_REMOTE_AUTHORITY_INVALID', `${label}.remoteAuthority`));
  }
  if (safety.executionAuthorized !== false
    || safety.aiCallCount !== 0
    || safety.larkRecordWriteCount !== 0
    || safety.notificationCount !== 0
    || safety.scheduleEnabled !== false
    || safety.production !== 'BLOCKED') {
    blockers.push(blocker('READINESS_PLAN_SAFETY_INVALID', `${label}.safety`));
  }
  for (const [field, value] of [
    ['planId', plan.planId],
    ['previewRunKey', plan.previewRunKey],
    ['evidenceChecksum', plan.evidenceChecksum],
    ['dedupeKey', plan.dedupeKey],
    ['promptSha256', plan.promptPackage?.promptSha256],
    ['referenceOutputSha256', plan.promptPackage?.referenceOutputSha256],
  ]) {
    if (!SHA256.test(value ?? '')) {
      blockers.push(blocker('READINESS_PLAN_HASH_INVALID', `${label}.${field}`));
    }
  }
}

function inspectDesiredFields(fields, windowDays, label, blockers) {
  const keys = Object.keys(fields);
  const missing = LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_REQUIRED_FIELDS
    .filter((field) => !Object.prototype.hasOwnProperty.call(fields, field));
  const unexpected = keys
    .filter((field) => !LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_REQUIRED_FIELDS.includes(field));
  if (missing.length > 0) {
    blockers.push(blocker('DESIRED_ROW_FIELD_MISSING', label, { fields: missing }));
  }
  if (unexpected.length > 0) {
    blockers.push(blocker('DESIRED_ROW_FIELD_UNEXPECTED', label, { fields: unexpected }));
  }
  if (String(fields.window_days) !== String(windowDays)) {
    blockers.push(blocker('DESIRED_ROW_WINDOW_MISMATCH', label));
  }
  for (const [field, expected] of Object.entries(
    LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_SAFETY_FIELDS,
  )) {
    if (!same(fields[field], expected)) {
      blockers.push(blocker('DESIRED_ROW_SAFETY_INVALID', `${label}.${field}`));
    }
  }
  if (!identity(fields.ai_run_key) || !SHA256.test(fields.dedupe_key ?? '')) {
    blockers.push(blocker('DESIRED_ROW_IDENTITY_INVALID', label));
  }
}

function inspectDesiredIdentityUniqueness(rows, blockers) {
  const aiRunKeys = new Set();
  const dedupeKeys = new Set();
  for (const row of rows) {
    const aiRunKey = row.fields.ai_run_key;
    const dedupeKey = row.fields.dedupe_key;
    if (aiRunKeys.has(aiRunKey)) blockers.push(blocker('DESIRED_AI_RUN_KEY_DUPLICATE', aiRunKey));
    if (dedupeKeys.has(dedupeKey)) blockers.push(blocker('DESIRED_DEDUPE_KEY_DUPLICATE', dedupeKey));
    aiRunKeys.add(aiRunKey);
    dedupeKeys.add(dedupeKey);
  }
}

function inspectAuthorityConsistency(vectors, blockers) {
  if (vectors.length === 0) return;
  const first = stableStringify(vectors[0]);
  for (let index = 1; index < vectors.length; index += 1) {
    if (stableStringify(vectors[index]) !== first) {
      blockers.push(blocker('READINESS_PLAN_AUTHORITY_INCONSISTENT', `readinessPlans[${index}]`));
    }
  }
}

function readinessAuthorityVector(plan) {
  return Object.freeze({
    customerKey: plan.runIdentity?.customerKey ?? null,
    periodEnd: plan.runIdentity?.periodEnd ?? null,
    comparisonMode: plan.runIdentity?.comparisonMode ?? null,
    promptVersion: plan.runIdentity?.promptVersion ?? null,
    outputSchemaVersion: plan.runIdentity?.outputSchemaVersion ?? null,
    schemaEvidenceSha256: plan.schemaAuthority?.evidenceSha256 ?? null,
    remoteEvidenceSha256: plan.remoteAuthority?.evidenceSha256 ?? null,
    approvalId: plan.approval?.approvalId ?? null,
    approvedHeadSha: plan.approval?.approvedHeadSha ?? null,
  });
}

function inspectExistingInventory(records, desiredRows, blockers) {
  if (records.length > LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.maximumExistingRecords) {
    blockers.push(blocker('EXISTING_RECORD_LIMIT_EXCEEDED', 'existingRecords', {
      count: records.length,
    }));
  }
  const desiredAiRunKeys = new Set(desiredRows.map(({ fields }) => fields.ai_run_key));
  const aiRunKeyCounts = new Map();
  const dedupeOwners = new Map();

  for (const record of records) {
    const aiRunKey = text(record.fields.ai_run_key);
    const dedupeKey = text(record.fields.dedupe_key);
    if (aiRunKey) aiRunKeyCounts.set(aiRunKey, (aiRunKeyCounts.get(aiRunKey) ?? 0) + 1);
    if (dedupeKey) {
      const owners = dedupeOwners.get(dedupeKey) ?? new Set();
      owners.add(aiRunKey ?? `record:${record.recordId}`);
      dedupeOwners.set(dedupeKey, owners);
    }
  }

  for (const [aiRunKey, count] of aiRunKeyCounts.entries()) {
    if (desiredAiRunKeys.has(aiRunKey) && count !== 1) {
      blockers.push(blocker('EXISTING_AI_RUN_KEY_DUPLICATE', aiRunKey, { count }));
    }
  }
  for (const row of desiredRows) {
    const owners = dedupeOwners.get(row.fields.dedupe_key);
    if (owners && (!owners.has(row.fields.ai_run_key) || owners.size !== 1)) {
      blockers.push(blocker('EXISTING_DEDUPE_KEY_CONFLICT', row.fields.dedupe_key));
    }
  }
}

function buildActions(desiredRows, existingRecords, blockers) {
  const byAiRunKey = new Map();
  for (const record of existingRecords) {
    const aiRunKey = text(record.fields.ai_run_key);
    if (!aiRunKey) continue;
    const matches = byAiRunKey.get(aiRunKey) ?? [];
    matches.push(record);
    byAiRunKey.set(aiRunKey, matches);
  }

  const actions = [];
  for (const desired of desiredRows) {
    const aiRunKey = desired.fields.ai_run_key;
    const matches = byAiRunKey.get(aiRunKey) ?? [];
    if (matches.length === 0) {
      actions.push(deepFreeze({
        action: 'create',
        reason: 'missing_record',
        aiRunKey,
        dedupeKey: desired.fields.dedupe_key,
        windowDays: desired.windowDays,
        channelKey: desired.channelKey,
        fields: structuredClone(desired.fields),
      }));
      continue;
    }
    if (matches.length !== 1) {
      blockers.push(blocker('EXISTING_AI_RUN_KEY_DUPLICATE', aiRunKey, { count: matches.length }));
      continue;
    }

    const existing = matches[0];
    if (!isSafeExistingPreview(existing.fields)) {
      blockers.push(blocker('EXISTING_RECORD_NOT_SAFE_PREVIEW', aiRunKey));
      continue;
    }
    if (!identityFieldsMatch(existing.fields, desired.fields)) {
      blockers.push(blocker('EXISTING_RECORD_IDENTITY_CONFLICT', aiRunKey));
      continue;
    }

    const sameEvidence = existing.fields.dedupe_key === desired.fields.dedupe_key;
    const managedPatch = diffFields(
      existing.fields,
      desired.fields,
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_MANAGED_FIELDS,
    );
    if (sameEvidence && Object.keys(managedPatch).length === 0) {
      actions.push(deepFreeze({
        action: 'no_op',
        reason: 'same_evidence_zero_drift',
        recordId: existing.recordId,
        aiRunKey,
        dedupeKey: desired.fields.dedupe_key,
        windowDays: desired.windowDays,
        channelKey: desired.channelKey,
      }));
      continue;
    }

    actions.push(deepFreeze({
      action: 'update',
      reason: sameEvidence ? 'managed_field_drift' : 'evidence_revision',
      recordId: existing.recordId,
      aiRunKey,
      dedupeKey: desired.fields.dedupe_key,
      windowDays: desired.windowDays,
      channelKey: desired.channelKey,
      clearsAiOutput: !sameEvidence,
      fieldsPatch: sameEvidence
        ? managedPatch
        : buildEvidenceRevisionPatch(existing.fields, desired.fields),
    }));
  }
  return actions;
}

function buildEvidenceRevisionPatch(existing, desired) {
  const patch = { ...diffFields(
    existing,
    desired,
    LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_MANAGED_FIELDS,
  ) };
  for (const field of LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_AI_OUTPUT_FIELDS) {
    patch[field] = null;
  }
  patch.generation_status = desired.generation_status;
  patch.failure_code = null;
  return deepFreeze(patch);
}

function diffFields(existing, desired, fields) {
  const patch = {};
  for (const field of fields) {
    if (!same(existing[field], desired[field])) {
      patch[field] = structuredClone(desired[field]);
    }
  }
  return deepFreeze(patch);
}

function isSafeExistingPreview(fields) {
  return Object.entries(LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_SAFETY_FIELDS)
    .every(([field, expected]) => same(fields[field], expected));
}

function identityFieldsMatch(existing, desired) {
  return IDENTITY_FIELDS.every((field) => same(existing[field], desired[field]));
}

function countActions(actions) {
  const create = actions.filter(({ action }) => action === 'create').length;
  const update = actions.filter(({ action }) => action === 'update').length;
  const noOp = actions.filter(({ action }) => action === 'no_op').length;
  return Object.freeze({
    create,
    update,
    noOp,
    write: create + update,
    delete: 0,
    total: actions.length,
  });
}

function buildAuthority(plans, repository) {
  const first = plans.find(isObject) ?? {};
  return Object.freeze({
    repositoryHeadSha: repository.exactHeadSha,
    schemaEvidenceSha256: first.schemaAuthority?.evidenceSha256 ?? null,
    remoteEvidenceSha256: first.remoteAuthority?.evidenceSha256 ?? null,
    approvalId: first.approval?.approvalId ?? null,
    approvedHeadSha: first.approval?.approvedHeadSha ?? null,
    readinessPlanIds: Object.freeze(plans.map((plan) => plan?.planId ?? null)),
  });
}

function resolveNextAction(status) {
  return {
    blocked: 'resolve_execution_plan_blockers',
    ready_to_apply: 'implement_and_review_separate_remote_lark_apply',
    zero_drift: 'retain_zero_write_evidence',
  }[status];
}

function normalizeRepository(value = {}) {
  return Object.freeze({
    branch: text(value.branch),
    clean: value.clean === true,
    exactHeadSha: sha40(value.exactHeadSha ?? value.exact_head_sha),
  });
}

function normalizeExistingRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (!isObject(item) || !isObject(item.fields)) {
      throw codedError(
        'LARK_NATIVE_AI_EXISTING_RECORD_INVALID',
        `existingRecords[${index}] must include fields.`,
      );
    }
    const recordId = text(item.recordId ?? item.record_id);
    if (!recordId) {
      throw codedError(
        'LARK_NATIVE_AI_EXISTING_RECORD_ID_REQUIRED',
        `existingRecords[${index}].recordId is required.`,
      );
    }
    return deepFreeze({ recordId, fields: structuredClone(item.fields) });
  });
}

function boundBlockers(blockers) {
  const sorted = blockers
    .map((item) => deepFreeze(structuredClone(item)))
    .sort((left, right) => left.code.localeCompare(right.code)
      || left.subject.localeCompare(right.subject));
  if (sorted.length <= LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.maximumBlockers) {
    return sorted;
  }
  return [
    ...sorted.slice(0, LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS.maximumBlockers - 1),
    blocker('BLOCKER_LIMIT_REACHED', 'blockers', { count: sorted.length }),
  ];
}

function sanitizeActionForIdentity(action) {
  return {
    action: action.action,
    reason: action.reason,
    recordId: action.recordId ?? null,
    aiRunKey: action.aiRunKey,
    dedupeKey: action.dedupeKey,
    windowDays: action.windowDays,
    channelKey: action.channelKey,
    fields: action.fields ?? null,
    fieldsPatch: action.fieldsPatch ?? null,
  };
}

function uniqueSimulationRecordId(aiRunKey, byRecordId) {
  const base = `sim_${aiRunKey.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 24)}`;
  let candidate = base;
  let suffix = 1;
  while (byRecordId.has(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function cloneRecord(record) {
  return { recordId: record.recordId, fields: structuredClone(record.fields) };
}

function blocker(code, subject, details = null) {
  return Object.freeze({
    code,
    subject,
    details: details ? Object.freeze(structuredClone(details)) : null,
  });
}

function same(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return stableStringify(left) === stableStringify(right);
}
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function identity(value) {
  const item = text(value);
  return item && item.length <= 512 ? item : null;
}
function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function sha40(value) {
  const item = text(value);
  return item && GIT_SHA.test(item) ? item : null;
}
function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
