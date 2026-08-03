import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS,
  LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
  LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES,
} from '../../packages/config/src/lark-native-ai-disabled-workflows-contract.js';

const DISABLED_STATUSES = new Set(['disabled', 'inactive', 'off', 'draft']);
const ENABLED_STATUSES = new Set(['enabled', 'active', 'running', 'on']);
const READ_AFTER_CREATE_DELAY_MS = 10_000;

export async function planLarkNativeAiDisabledWorkflows(input = {}) {
  const client = requireClient(input.client, false);
  const definitions = normalizeDefinitions(input.definitions);
  const inventory = requireArray(await client.listWorkflows(), 'listWorkflows result');
  const blockers = [];
  const items = [];

  for (const definition of definitions) {
    const matches = inventory.filter(({ title }) => title === definition.title);
    if (matches.length === 0) {
      items.push(freeze({
        title: definition.title,
        intent: definition.intent,
        state: 'create_inactive_placeholder',
        count: 0,
        expectedStepCount: definition.steps.length,
        triggerTable: definition.triggerTable,
        delayMinutes: LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES,
      }));
      continue;
    }
    if (matches.length > 1) {
      blockers.push(blocker('TARGET_WORKFLOW_DUPLICATE', {
        title: definition.title,
        count: matches.length,
      }));
      items.push(freeze({
        title: definition.title,
        intent: definition.intent,
        state: 'duplicate',
        count: matches.length,
        expectedStepCount: definition.steps.length,
      }));
      continue;
    }

    const hydrated = await client.getWorkflow({
      workflowId: requireText(matches[0].workflowId, `${definition.title}.workflowId`),
    });
    const status = normalizeStatus(hydrated?.status ?? matches[0].status);
    const steps = requireArray(hydrated?.steps ?? [], `${definition.title}.steps`);
    const placeholder = inspectLarkNativeAiInactivePlaceholderSteps({
      steps,
      definition,
    });
    if (ENABLED_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_ALREADY_ENABLED',
      { title: definition.title, status },
    ));
    if (!DISABLED_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_STATUS_UNSUPPORTED',
      { title: definition.title, status },
    ));
    if (!placeholder.ok) blockers.push(blocker(
      'TARGET_WORKFLOW_PLACEHOLDER_DRIFT',
      {
        title: definition.title,
        observedStepCount: steps.length,
        reasons: placeholder.reasons,
      },
    ));
    items.push(freeze({
      title: definition.title,
      intent: definition.intent,
      state: placeholder.ok ? 'existing_inactive_placeholder' : 'configured_drift',
      status,
      count: 1,
      expectedStepCount: definition.steps.length,
      observedStepCount: steps.length,
      triggerTable: definition.triggerTable,
      delayMinutes: LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES,
      placeholderExact: placeholder.ok,
    }));
  }

  blockers.sort(compareBlockers);
  const createCount = items.filter(({ state }) => state === 'create_inactive_placeholder').length;
  const existingCount = items.filter(({ state }) => state === 'existing_inactive_placeholder').length;
  return freeze({
    ok: blockers.length === 0,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    status: blockers.length > 0
      ? 'blocked'
      : (createCount === 0 ? 'zero_drift' : 'ready_to_create_inactive_placeholders'),
    workflowCount: definitions.length,
    plannedCreateCount: createCount,
    existingInactivePlaceholderCount: existingCount,
    existingDisabledShellCount: existingCount,
    items,
    blockerCount: blockers.length,
    blockers,
  });
}

export async function applyLarkNativeAiDisabledWorkflows(input = {}) {
  const client = requireClient(input.client, true);
  const definitions = normalizeDefinitions(input.definitions);
  const repositoryHead = requireHead(input.repositoryHead);
  const sleep = typeof input.sleep === 'function'
    ? input.sleep
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const before = await planLarkNativeAiDisabledWorkflows({ client, definitions });
  if (!before.ok) throw workflowError(
    'Inactive Lark Workflow placeholders are blocked by live inventory drift',
    'LARK_NATIVE_AI_DISABLED_WORKFLOWS_BLOCKED',
    { blockerCount: before.blockerCount, blockers: before.blockers },
  );
  if (before.status === 'zero_drift') return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    mode: 'already_zero_drift',
    status: 'zero_drift',
    createdWorkflowCount: 0,
    workflowCount: before.workflowCount,
    items: before.items,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });

  const missingTitles = new Set(before.items
    .filter(({ state }) => state === 'create_inactive_placeholder')
    .map(({ title }) => title));
  let createdWorkflowCount = 0;
  const createdTitles = [];
  for (const definition of definitions) {
    if (!missingTitles.has(definition.title)) continue;
    const clientToken = await buildClientToken(repositoryHead, definition.title);
    try {
      await client.createWorkflow({
        clientToken,
        title: definition.title,
        steps: definition.steps,
      });
      createdWorkflowCount += 1;
      createdTitles.push(definition.title);
    } catch (cause) {
      throw workflowError(
        'Lark Workflow placeholder create stopped; no automatic retry was attempted',
        'LARK_NATIVE_AI_DISABLED_WORKFLOW_CREATE_FAILED',
        {
          createdWorkflowCount,
          createdTitles,
          failedTitle: definition.title,
          causeCode: optionalText(cause?.code) ?? null,
        },
        cause,
      );
    }
  }

  await sleep(READ_AFTER_CREATE_DELAY_MS);
  const after = await planLarkNativeAiDisabledWorkflows({ client, definitions });
  if (!after.ok || after.status !== 'zero_drift'
    || after.existingInactivePlaceholderCount !== definitions.length) throw workflowError(
    'Lark Workflows did not reach exact inactive-placeholder zero drift',
    'LARK_NATIVE_AI_DISABLED_WORKFLOW_READBACK_INVALID',
    {
      createdWorkflowCount,
      status: after.status,
      blockerCount: after.blockerCount,
      blockers: after.blockers,
      existingInactivePlaceholderCount: after.existingInactivePlaceholderCount,
    },
  );

  return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    mode: 'applied',
    status: 'zero_drift',
    createdWorkflowCount,
    workflowCount: after.workflowCount,
    items: after.items,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

export function inspectLarkNativeAiInactivePlaceholderSteps(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const definition = input.definition ?? {};
  const reasons = [];
  if (steps.length !== 2) reasons.push('STEP_COUNT');

  const triggers = steps.filter((step) => normalizeStepType(step?.type) === 'addrecordtrigger');
  const delays = steps.filter((step) => normalizeStepType(step?.type) === 'delay');
  if (triggers.length !== 1) reasons.push('TRIGGER_COUNT');
  if (delays.length !== 1) reasons.push('DELAY_COUNT');

  const trigger = triggers.length === 1 ? triggers[0] : null;
  const delay = delays.length === 1 ? delays[0] : null;
  if (trigger) {
    const tableName = optionalText(trigger?.data?.table_name ?? trigger?.data?.tableName);
    if (tableName !== definition.triggerTable) reasons.push('TRIGGER_TABLE');
    const watchedField = optionalText(
      trigger?.data?.watched_field_name ?? trigger?.data?.watchedFieldName,
    );
    if (watchedField && watchedField !== definition.watchedField) reasons.push('WATCHED_FIELD');
    if (hasChildren(trigger)) reasons.push('TRIGGER_CHILDREN');
  }
  if (delay) {
    const duration = Number(delay?.data?.duration);
    if (duration !== LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES) {
      reasons.push('DELAY_DURATION');
    }
    if (hasChildren(delay)) reasons.push('DELAY_CHILDREN');
  }
  if (trigger && delay) {
    const triggerNext = optionalText(trigger.next);
    const delayId = optionalText(delay.id);
    if (!triggerNext || !delayId || triggerNext !== delayId) reasons.push('TRIGGER_NEXT');
    if (delay.next !== null && delay.next !== undefined && optionalText(delay.next)) {
      reasons.push('DELAY_NEXT');
    }
  }

  return freeze({
    ok: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)].sort()),
  });
}

async function buildClientToken(repositoryHead, title) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode([
      LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
      repositoryHead,
      title,
    ].join('\n')),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `mkt-${hex.slice(0, 48)}`;
}

function normalizeDefinitions(value) {
  const source = value ?? LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS;
  const definitions = requireArray(source, 'definitions').map((item, index) => freeze({
    title: requireText(item?.title, `definitions[${index}].title`),
    intent: requireText(item?.intent, `definitions[${index}].intent`),
    triggerTable: requireText(item?.triggerTable, `definitions[${index}].triggerTable`),
    watchedField: requireText(item?.watchedField, `definitions[${index}].watchedField`),
    steps: requireArray(item?.steps ?? [], `definitions[${index}].steps`),
  }));
  if (definitions.length !== 2 || definitions.some(({ steps }) => steps.length !== 2)) {
    throw new TypeError('Exactly two two-step inactive Workflow placeholder definitions are required');
  }
  for (const definition of definitions) {
    const inspection = inspectLarkNativeAiInactivePlaceholderSteps({
      steps: definition.steps,
      definition,
    });
    if (!inspection.ok) throw new TypeError(
      `Invalid inactive Workflow placeholder definition: ${inspection.reasons.join(',')}`,
    );
  }
  const titles = new Set(definitions.map(({ title }) => title));
  if (titles.size !== definitions.length) throw new TypeError('Workflow titles must be unique');
  return definitions;
}

function requireClient(value, createRequired) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('client is required');
  }
  for (const method of ['listWorkflows', 'getWorkflow']) {
    if (typeof value[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  if (createRequired && typeof value.createWorkflow !== 'function') {
    throw new TypeError('client.createWorkflow is required');
  }
  return value;
}

function normalizeStepType(value) {
  return optionalText(value)?.toLowerCase().replace(/[^a-z0-9]/gu, '') ?? '';
}
function hasChildren(step) {
  const children = step?.children;
  if (children === null || children === undefined) return false;
  if (Array.isArray(children)) return children.length > 0;
  if (typeof children !== 'object') return true;
  const links = children.links;
  return Array.isArray(links) ? links.length > 0 : Object.keys(children).length > 0;
}
function normalizeStatus(value) {
  return optionalText(value)?.toLowerCase() ?? 'unknown';
}
function blocker(code, details = {}) {
  return freeze({ code, ...details });
}
function compareBlockers(left, right) {
  return left.code.localeCompare(right.code)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}
function requireHead(value) {
  const text = requireText(value, 'repositoryHead');
  if (!/^[a-f0-9]{40}$/u.test(text)) throw new TypeError('repositoryHead must be a full SHA');
  return text;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, field) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
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

export function workflowError(message, code, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'LarkNativeAiDisabledWorkflowsError';
  error.code = code;
  error.details = freeze({ ...details });
  return error;
}
