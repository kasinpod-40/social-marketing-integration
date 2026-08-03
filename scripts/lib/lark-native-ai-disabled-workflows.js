import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS,
  LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
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
        state: 'create_disabled_shell',
        count: 0,
        expectedStepCount: 0,
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
        expectedStepCount: 0,
      }));
      continue;
    }

    const hydrated = await client.getWorkflow({
      workflowId: requireText(matches[0].workflowId, `${definition.title}.workflowId`),
    });
    const status = normalizeStatus(hydrated?.status ?? matches[0].status);
    const steps = requireArray(hydrated?.steps ?? [], `${definition.title}.steps`);
    if (ENABLED_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_ALREADY_ENABLED',
      { title: definition.title, status },
    ));
    if (!DISABLED_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_STATUS_UNSUPPORTED',
      { title: definition.title, status },
    ));
    if (steps.length !== 0) blockers.push(blocker(
      'TARGET_WORKFLOW_SHELL_DRIFT',
      { title: definition.title, observedStepCount: steps.length },
    ));
    items.push(freeze({
      title: definition.title,
      intent: definition.intent,
      state: 'existing_disabled_shell',
      status,
      count: 1,
      expectedStepCount: 0,
      observedStepCount: steps.length,
    }));
  }

  blockers.sort(compareBlockers);
  const createCount = items.filter(({ state }) => state === 'create_disabled_shell').length;
  return freeze({
    ok: blockers.length === 0,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    status: blockers.length > 0
      ? 'blocked'
      : (createCount === 0 ? 'zero_drift' : 'ready_to_create_disabled_shells'),
    workflowCount: definitions.length,
    plannedCreateCount: createCount,
    existingDisabledShellCount: items.filter(({ state }) => (
      state === 'existing_disabled_shell'
    )).length,
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
    'Disabled Lark Workflow creation is blocked by live inventory drift',
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
    .filter(({ state }) => state === 'create_disabled_shell')
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
        steps: [],
      });
      createdWorkflowCount += 1;
      createdTitles.push(definition.title);
    } catch (cause) {
      throw workflowError(
        'Lark Workflow create stopped; no automatic retry was attempted',
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
    || after.existingDisabledShellCount !== definitions.length) throw workflowError(
    'Created Lark Workflows did not reach exact disabled-shell zero drift',
    'LARK_NATIVE_AI_DISABLED_WORKFLOW_READBACK_INVALID',
    {
      createdWorkflowCount,
      status: after.status,
      blockerCount: after.blockerCount,
      blockers: after.blockers,
      existingDisabledShellCount: after.existingDisabledShellCount,
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
    steps: requireArray(item?.steps ?? [], `definitions[${index}].steps`),
  }));
  if (definitions.length !== 2 || definitions.some(({ steps }) => steps.length !== 0)) {
    throw new TypeError('Exactly two empty disabled Workflow shell definitions are required');
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
