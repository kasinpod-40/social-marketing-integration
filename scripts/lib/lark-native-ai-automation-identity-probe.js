import {
  LARK_NATIVE_AI_AUTOMATION_ACTIVE_STATUSES,
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_TITLES,
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
  LARK_NATIVE_AI_AUTOMATION_INACTIVE_STATUSES,
} from '../../packages/config/src/lark-native-ai-automation-identity-probe-contract.js';

const ACTIVE_STATUSES = new Set(LARK_NATIVE_AI_AUTOMATION_ACTIVE_STATUSES);
const INACTIVE_STATUSES = new Set(LARK_NATIVE_AI_AUTOMATION_INACTIVE_STATUSES);

export async function inspectLarkNativeAiAutomationIdentity(input = {}) {
  const client = requireClient(input.client);
  const expectedTitles = normalizeExpectedTitles(input.expectedTitles);
  const inventory = requireArray(await client.listAutomations(), 'listAutomations result');
  const blockers = [];
  const items = [];

  for (const title of expectedTitles) {
    const matches = inventory.filter((item) => optionalText(item?.title) === title);
    if (matches.length === 0) {
      blockers.push(blocker('TARGET_AUTOMATION_MISSING', { title }));
      items.push(freeze({ title, state: 'missing', count: 0 }));
      continue;
    }
    if (matches.length > 1) {
      blockers.push(blocker('TARGET_AUTOMATION_DUPLICATE', { title, count: matches.length }));
      items.push(freeze({ title, state: 'duplicate', count: matches.length }));
      continue;
    }

    const summary = normalizeAutomationSummary(matches[0], title);
    const status = normalizeStatus(summary.status);
    if (ACTIVE_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_AUTOMATION_ALREADY_ACTIVE',
      { title, status },
    ));
    if (!ACTIVE_STATUSES.has(status) && !INACTIVE_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_AUTOMATION_STATUS_UNSUPPORTED',
      { title, status },
    ));

    const hydrated = normalizeHydratedWorkflow(
      await client.getWorkflow({ workflowId: summary.workflowId }),
      title,
    );
    if (hydrated.workflowId && hydrated.workflowId !== summary.workflowId) blockers.push(blocker(
      'TARGET_AUTOMATION_IDENTITY_MISMATCH',
      { title },
    ));
    if (hydrated.title && hydrated.title !== title) blockers.push(blocker(
      'TARGET_AUTOMATION_TITLE_MISMATCH',
      { title, observedTitle: hydrated.title },
    ));

    items.push(freeze({
      title,
      state: INACTIVE_STATUSES.has(status) ? 'existing_inactive' : 'existing_unsafe',
      count: 1,
      workflowId: summary.workflowId,
      status,
      topology: summarizeWorkflowTopology(hydrated.definition),
    }));
  }

  blockers.sort(compareBlockers);
  return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
    status: blockers.length === 0 ? 'ready_for_inactive_configuration_review' : 'blocked',
    inventoryCount: inventory.length,
    targetCount: expectedTitles.length,
    resolvedTargetCount: items.filter(({ count }) => count === 1).length,
    inactiveTargetCount: items.filter(({ state }) => state === 'existing_inactive').length,
    items,
    blockerCount: blockers.length,
    blockers,
    safety: freeze({
      readOnly: true,
      automationCreateCount: 0,
      automationUpdateCount: 0,
      automationStatusChangeCount: 0,
      recordWriteCount: 0,
      nativeAiCallCount: 0,
      notificationCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  });
}

export function summarizeWorkflowTopology(value) {
  const definition = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const stepTypes = steps.map((step) => normalizeStepType(
    step?.type ?? step?.step_type ?? step?.stepType ?? step?.action_type ?? step?.actionType,
  )).filter(Boolean);
  const normalized = stepTypes.map((type) => type.toLowerCase());
  return freeze({
    stepCount: steps.length,
    stepTypes: freeze(stepTypes),
    hasAiGeneratedTextAction: normalized.some((type) => (
      type.includes('aigeneratedtext') || type.includes('generatedtext') || type.includes('ai')
    )),
    hasMessageAction: normalized.some((type) => (
      type.includes('message') || type.includes('send')
    )),
    hasDelay: normalized.some((type) => type.includes('delay')),
    hasTrigger: normalized.some((type) => type.includes('trigger')),
  });
}

function normalizeAutomationSummary(value, expectedTitle) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const workflowId = requireWorkflowId(
    source.workflowId ?? source.workflow_id ?? source.id,
    `${expectedTitle}.workflowId`,
  );
  const title = requireText(source.title ?? source.name, `${expectedTitle}.title`);
  if (title !== expectedTitle) throw probeError(
    'Automation inventory title changed during normalization',
    'LARK_NATIVE_AI_AUTOMATION_TITLE_INVALID',
    { expectedTitle, observedTitle: title },
  );
  return freeze({
    workflowId,
    title,
    status: requireText(source.status ?? source.state, `${expectedTitle}.status`),
  });
}

function normalizeHydratedWorkflow(value, expectedTitle) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const nested = source.workflow && typeof source.workflow === 'object' ? source.workflow : source;
  const workflowId = optionalText(nested.workflow_id ?? nested.workflowId ?? nested.id);
  const title = optionalText(nested.title ?? nested.name);
  if (workflowId && !isWorkflowId(workflowId)) throw probeError(
    'Hydrated workflow returned an unsupported identity',
    'LARK_NATIVE_AI_AUTOMATION_WORKFLOW_ID_INVALID',
    { title: expectedTitle },
  );
  return freeze({
    workflowId,
    title,
    definition: nested,
  });
}

function normalizeExpectedTitles(value) {
  const source = value ?? LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_TITLES;
  const titles = requireArray(source, 'expectedTitles').map((title, index) => (
    requireText(title, `expectedTitles[${index}]`)
  ));
  if (titles.length !== 2 || new Set(titles).size !== 2) {
    throw new TypeError('Exactly two unique Automation titles are required');
  }
  return freeze(titles);
}

function requireClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('client is required');
  }
  for (const method of ['listAutomations', 'getWorkflow']) {
    if (typeof value[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return value;
}

function normalizeStatus(value) {
  return requireText(value, 'status').toLowerCase();
}
function normalizeStepType(value) {
  const text = optionalText(value);
  return text ? text.replace(/[^A-Za-z0-9]/gu, '') : '';
}
function requireWorkflowId(value, field) {
  const text = requireText(value, field);
  if (!isWorkflowId(text)) throw probeError(
    'Automation identity is not a supported Lark workflow ID',
    'LARK_NATIVE_AI_AUTOMATION_WORKFLOW_ID_INVALID',
    { field },
  );
  return text;
}
function isWorkflowId(value) {
  return typeof value === 'string' && /^wkf[A-Za-z0-9_-]{4,}$/u.test(value);
}
function blocker(code, details = {}) {
  return freeze({ code, ...details });
}
function compareBlockers(left, right) {
  return left.code.localeCompare(right.code)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}
function requireText(value, field) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireArray(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}
export function probeError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiAutomationIdentityProbeError';
  error.code = code;
  error.details = freeze({ ...details });
  return error;
}
