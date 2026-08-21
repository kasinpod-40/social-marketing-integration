import { createHash } from 'node:crypto';

export const CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION =
  'APPLY_CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PARITY_V1';

export const CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE =
  'Eligible AI Run → Lark Group Notification';

const REQUIRED_TRIGGER_CONTROLS = Object.freeze([
  'pasteUpdate',
  'automationBatchUpdate',
  'openAPIBatchUpdate',
]);

const REQUIRED_TARGET_ANCHORS = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);

export async function buildCustomerBaseNotificationWorkflowPlan({ sourceClient }) {
  requireSourceClient(sourceClient);
  const resources = requireObject(sourceClient.getExportResources(), 'export resources');
  const workflows = requireArray(resources.workflows ?? [], 'export workflows');
  if (workflows.length !== 2) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_COUNT_MISMATCH',
      'Current Source must contain exactly two workflows',
      { actual: workflows.length, expected: 2 },
    );
  }

  const refs = await buildSourceReferenceMaps(sourceClient);
  const matches = [];
  for (const rawWorkflow of workflows) {
    const draft = parseMaybeJson(rawWorkflow?.Draft ?? rawWorkflow?.draft, 'workflow Draft');
    if (optionalText(draft?.title) === CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE) {
      matches.push({ rawWorkflow, draft });
    }
  }
  if (matches.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_RESOLUTION_FAILED',
      'Notification workflow must resolve exactly once in Source',
      { matches: matches.length },
    );
  }

  const { rawWorkflow, draft } = matches[0];
  const sourceStatus = normalizeSourceWorkflowStatus(rawWorkflow);
  if (sourceStatus !== 'disabled') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_STATUS_MISMATCH',
      'Notification workflow must remain disabled in current Source',
      { sourceStatus },
    );
  }

  const steps = requireArray(draft.steps, 'notification workflow steps');
  if (steps.length !== 2 || steps[0]?.type !== 'AddRecordTrigger' || steps[1]?.type !== 'Delay') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_STEPS_MISMATCH',
      'Notification workflow must be exactly AddRecordTrigger → Delay',
      { stepTypes: steps.map((step) => step?.type ?? null) },
    );
  }

  const triggerData = requireObject(steps[0]?.data, 'AddRecordTrigger.data');
  const tableId = requireText(triggerData.tableId ?? triggerData.table_id, 'Source trigger tableId');
  const watchedFieldId = requireText(
    triggerData.watchedFieldId ?? triggerData.watched_field_id,
    'Source trigger watchedFieldId',
  );
  const tableName = requireMapped(refs.tableById, tableId, 'Source trigger table');
  const fieldRef = requireMapped(refs.fieldById, watchedFieldId, 'Source trigger watched field');
  if (fieldRef.tableName !== tableName) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_FIELD_TABLE_MISMATCH',
      'Source watched field does not belong to trigger table',
      { tableName, fieldName: fieldRef.fieldName },
    );
  }
  if (tableName !== '🧠 MKT_AI_Report_Runs' || fieldRef.fieldName !== 'ai_run_key') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_TRIGGER_MISMATCH',
      'Current Source notification trigger identity drifted',
      { actualTable: tableName, actualField: fieldRef.fieldName },
    );
  }

  const controls = findTriggerControls(triggerData);
  if (!sameStringSet(controls, REQUIRED_TRIGGER_CONTROLS)) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_CONTROLS_MISMATCH',
      'Current Source trigger controls drifted',
      { controls },
    );
  }

  const delayData = requireObject(steps[1]?.data, 'Delay.data');
  if (Number(delayData.duration) !== 1 || String(delayData.unit ?? '').toLowerCase() !== 'minute') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_DELAY_MISMATCH',
      'Current Source notification delay must remain exactly one minute',
      { duration: delayData.duration ?? null, unit: delayData.unit ?? null },
    );
  }

  const body = deepFreeze({
    client_token: deterministicClientToken(CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE),
    title: CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE,
    steps: [
      {
        id: 'step_trigger',
        type: 'AddRecordTrigger',
        title: 'Eligible AI Run created',
        next: 'step_delay',
        data: {
          table_name: tableName,
          watched_field_name: fieldRef.fieldName,
          trigger_control_list: [...REQUIRED_TRIGGER_CONTROLS],
          condition_list: null,
        },
      },
      {
        id: 'step_delay',
        type: 'Delay',
        title: 'Delay',
        next: null,
        data: { duration: 1 },
      },
    ],
  });

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_notification_workflow_plan_v1',
    sourceWorkflowCount: workflows.length,
    sourceStatus,
    title: CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE,
    trigger: {
      tableName,
      fieldName: fieldRef.fieldName,
      triggerControls: [...REQUIRED_TRIGGER_CONTROLS],
    },
    delayMinutes: 1,
    expectedTargetStatus: 'disabled',
    body,
  });
}

export async function applyCustomerBaseNotificationWorkflowParity({
  plan,
  targetClient,
  mode = 'preview',
  confirmation = null,
  requiredTargetAnchorTableNames = REQUIRED_TARGET_ANCHORS,
  onProgress = () => undefined,
}) {
  requirePlan(plan);
  requireTargetClient(targetClient);
  if (!['preview', 'apply'].includes(mode)) throw new TypeError('mode must be preview or apply');
  if (mode === 'apply' && confirmation !== CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION_REQUIRED',
      'Exact notification workflow apply confirmation is required',
    );
  }

  const targetTables = await stage('verify_target_tables', () => targetClient.listTables());
  const byName = new Map(targetTables.map((table) => [table?.name, table]));
  for (const name of requiredTargetAnchorTableNames) {
    if (!byName.has(name)) {
      throw codedError(
        'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_ANCHOR_MISSING',
        'Required protected Target anchor is missing',
        { name },
      );
    }
  }
  const aiTable = byName.get(plan.trigger.tableName);
  if (!aiTable?.tableId) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_TABLE_MISSING',
      'Target AI table is missing',
      { tableName: plan.trigger.tableName },
    );
  }
  const targetFields = await stage(
    'verify_target_fields',
    () => targetClient.listFields({ tableId: aiTable.tableId }),
  );
  const watchedMatches = targetFields.filter((field) => field?.fieldName === plan.trigger.fieldName);
  if (watchedMatches.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_FIELD_RESOLUTION_FAILED',
      'Target watched field must resolve exactly once',
      { fieldName: plan.trigger.fieldName, matches: watchedMatches.length },
    );
  }

  const workflows = await stage('list_workflows', () => listWorkflows(targetClient));
  const matches = workflows.filter((workflow) => workflowTitle(workflow) === plan.title);
  if (matches.length > 1) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_DUPLICATE',
      'Target contains duplicate notification workflows',
      { matches: matches.length },
    );
  }

  if (matches.length === 1) {
    const workflowId = requireWorkflowId(matches[0]);
    const current = await stage(
      'get_existing_workflow',
      () => getWorkflow(targetClient, workflowId),
    );
    verifyTargetWorkflowDefinition(current, plan);
    verifyDisabled(current, matches[0]);
    return resultEnvelope({
      action: mode,
      status: 'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PASS_REUSED_DISABLED',
      workflowId,
      workflowCreateCount: 0,
      existing: true,
    });
  }

  if (mode === 'preview') {
    return resultEnvelope({
      action: 'preview',
      status: 'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PREVIEW_CREATE_DISABLED_READY',
      workflowId: null,
      workflowCreateCount: 0,
      existing: false,
    });
  }

  onProgress({ stage: 'create_notification_workflow_disabled_start', title: plan.title });
  await stage(
    'create_notification_workflow_disabled',
    () => targetClient.requestBitableJson(
      `/open-apis/base/v3/bases/${encodeURIComponent(targetClient.appToken)}/workflows`,
      {
        method: 'POST',
        retryMode: 'rate_limit_only',
        body: plan.body,
      },
    ),
  );

  const after = await stage('list_workflows_after_create', () => listWorkflows(targetClient));
  const createdMatches = after.filter((workflow) => workflowTitle(workflow) === plan.title);
  if (createdMatches.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CREATE_READBACK_MISMATCH',
      'Created notification workflow did not resolve exactly once on readback',
      { matches: createdMatches.length },
    );
  }
  const workflowId = requireWorkflowId(createdMatches[0]);
  const current = await stage(
    'get_created_workflow',
    () => getWorkflow(targetClient, workflowId),
  );
  verifyTargetWorkflowDefinition(current, plan);
  verifyDisabled(current, createdMatches[0]);
  onProgress({ stage: 'create_notification_workflow_disabled_pass', title: plan.title, workflowId });

  return resultEnvelope({
    action: 'apply',
    status: 'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PASS_CREATED_DISABLED',
    workflowId,
    workflowCreateCount: 1,
    existing: false,
  });
}

function resultEnvelope({ action, status, workflowId, workflowCreateCount, existing }) {
  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_notification_workflow_parity_v1',
    action,
    status,
    title: CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE,
    workflowId,
    targetStatus: 'disabled',
    existing,
    workflowCreateCount,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    workflowEnableCount: 0,
    recordMutationCount: 0,
    tableMutationCount: 0,
    fieldMutationCount: 0,
    viewMutationCount: 0,
    dashboardMutationCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
  });
}

async function listWorkflows(client) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= 100; page += 1) {
    const body = { page_size: 100 };
    if (pageToken) body.page_token = pageToken;
    const response = await client.requestBitableJson(
      `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/workflows/list`,
      { method: 'POST', body },
    );
    const data = response?.data ?? response ?? {};
    items.push(...collection(data, ['items', 'workflows']));
    if (data.has_more !== true) return items;
    const next = optionalText(data.page_token);
    if (!next || next === pageToken) {
      throw codedError(
        'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PAGINATION_INVALID',
        'Workflow pagination returned invalid page_token',
      );
    }
    pageToken = next;
  }
  throw codedError(
    'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PAGINATION_LIMIT',
    'Workflow pagination exceeded 100 pages',
  );
}

async function getWorkflow(client, workflowId) {
  const response = await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/workflows/${encodeURIComponent(workflowId)}`,
    { method: 'GET' },
  );
  return response?.data?.workflow ?? response?.data ?? response?.workflow ?? response;
}

function verifyTargetWorkflowDefinition(value, plan) {
  const workflow = requireObject(value, 'Target workflow');
  if (workflowTitle(workflow) !== plan.title) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_TITLE_MISMATCH',
      'Target workflow title mismatch',
    );
  }
  const steps = requireArray(workflow.steps ?? [], 'Target workflow steps');
  if (steps.length !== 2) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_STEPS_MISMATCH',
      'Target workflow must contain exactly two steps',
      { actual: steps.length },
    );
  }
  const [trigger, delay] = steps;
  if (trigger?.type !== 'AddRecordTrigger' || delay?.type !== 'Delay') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_TYPES_MISMATCH',
      'Target workflow step types mismatch',
      { stepTypes: steps.map((step) => step?.type ?? null) },
    );
  }
  const triggerData = requireObject(trigger.data, 'Target AddRecordTrigger.data');
  if (
    triggerData.table_name !== plan.trigger.tableName
    || triggerData.watched_field_name !== plan.trigger.fieldName
  ) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_TRIGGER_MISMATCH',
      'Target notification trigger mismatch',
      {
        tableName: triggerData.table_name ?? null,
        fieldName: triggerData.watched_field_name ?? null,
      },
    );
  }
  const controls = Array.isArray(triggerData.trigger_control_list)
    ? triggerData.trigger_control_list
    : [];
  if (!sameStringSet(controls, plan.trigger.triggerControls)) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_CONTROLS_MISMATCH',
      'Target trigger controls mismatch',
      { controls },
    );
  }
  if (Number(delay?.data?.duration) !== 1) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_DELAY_MISMATCH',
      'Target delay must be exactly one minute',
      { duration: delay?.data?.duration ?? null },
    );
  }
}

function verifyDisabled(detail, listItem) {
  const raw = detail?.status
    ?? detail?.workflow_status
    ?? listItem?.status
    ?? listItem?.workflow_status;
  const normalized = normalizeApiWorkflowStatus(raw);
  if (normalized !== 'disabled') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TARGET_STATUS_MISMATCH',
      'Target notification workflow must remain disabled',
      { status: normalized ?? raw ?? null },
    );
  }
}

async function buildSourceReferenceMaps(sourceClient) {
  const tableById = new Map();
  const fieldById = new Map();
  for (const table of await sourceClient.listTables()) {
    const tableId = requireText(table?.tableId, 'Source tableId');
    const tableName = requireText(table?.name, `Source table name ${tableId}`);
    tableById.set(tableId, tableName);
    for (const field of await sourceClient.listFields({ tableId })) {
      const fieldId = requireText(field?.fieldId, `${tableName} fieldId`);
      fieldById.set(fieldId, {
        tableName,
        fieldName: requireText(field?.fieldName, `${tableName} fieldName`),
      });
    }
  }
  return { tableById, fieldById };
}

function normalizeSourceWorkflowStatus(rawWorkflow) {
  const candidates = [
    rawWorkflow?.status,
    rawWorkflow?.Status,
    rawWorkflow?.workflowStatus,
    rawWorkflow?.workflow_status,
    rawWorkflow?.WorkflowInfo?.status,
    rawWorkflow?.WorkflowInfo?.Status,
  ];
  for (const value of candidates) {
    const normalized = normalizeApiWorkflowStatus(value);
    if (normalized) return normalized;
  }
  throw codedError(
    'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_STATUS_UNRESOLVED',
    'Could not resolve Source workflow status',
  );
}

function normalizeApiWorkflowStatus(value) {
  if (value === false || value === 0) return 'disabled';
  if (value === true || value === 1) return 'enabled';
  const text = optionalText(value)?.toLowerCase();
  if (!text) return null;
  if (['disable', 'disabled', 'inactive', 'off'].includes(text)) return 'disabled';
  if (['enable', 'enabled', 'active', 'on'].includes(text)) return 'enabled';
  return null;
}

function findTriggerControls(data) {
  const direct = data.triggerControlList ?? data.trigger_control_list;
  if (Array.isArray(direct)) return direct.map(String);
  const allowed = new Set([
    'pasteUpdate',
    'automationBatchUpdate',
    'openAPIBatchUpdate',
    'syncUpdate',
    'appendImport',
  ]);
  const candidate = Object.values(data).find((value) => (
    Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && allowed.has(item))
  ));
  return Array.isArray(candidate) ? candidate.map(String) : [];
}

function deterministicClientToken(title) {
  return `cbwf_${createHash('sha256')
    .update(`customer-base-workflow-v1\0${title}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function requireMapped(map, id, label) {
  if (!map.has(id)) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_REFERENCE_UNMAPPED',
      `${label} is not mapped`,
      { referenceKind: label },
    );
  }
  return map.get(id);
}

function requireWorkflowId(value) {
  const id = requireText(
    value?.workflow_id ?? value?.workflowId ?? value?.id ?? value?.block_id,
    'workflow_id',
  );
  if (!id.startsWith('wkf')) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_ID_INVALID',
      'Workflow ID must use wkf prefix',
      { prefix: id.slice(0, 3) },
    );
  }
  return id;
}

function workflowTitle(value) {
  return optionalText(value?.title ?? value?.name) ?? '';
}

function sameStringSet(a, b) {
  return [...new Set(a)].sort().join('\0') === [...new Set(b)].sort().join('\0');
}

function parseMaybeJson(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_DRAFT_MISSING',
      `${label} is missing`,
    );
  }
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_DRAFT_INVALID',
      `${label} is not valid JSON`,
      { cause: cause?.message ?? String(cause) },
    );
  }
}

async function stage(name, fn) {
  try {
    return await fn();
  } catch (error) {
    if (String(error?.code ?? '').startsWith('CUSTOMER_BASE_NOTIFICATION_WORKFLOW_')) {
      throw error;
    }
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_REQUEST_FAILED',
      'Notification workflow request failed',
      {
        stage: name,
        causeCode: error?.code ?? null,
        causeMessage: error?.message ?? String(error),
      },
    );
  }
}

function collection(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function requirePlan(plan) {
  requireObject(plan, 'plan');
  if (plan.title !== CUSTOMER_BASE_NOTIFICATION_WORKFLOW_TITLE) {
    throw new TypeError('notification workflow plan title mismatch');
  }
}

function requireSourceClient(client) {
  if (
    !client
    || typeof client.getExportResources !== 'function'
    || typeof client.listTables !== 'function'
    || typeof client.listFields !== 'function'
  ) {
    throw new TypeError('sourceClient must be the local Base export source client');
  }
}

function requireTargetClient(client) {
  if (
    !client
    || typeof client.requestBitableJson !== 'function'
    || typeof client.listTables !== 'function'
    || typeof client.listFields !== 'function'
  ) {
    throw new TypeError('targetClient must be shared LarkBitableClient');
  }
  requireText(client.appToken, 'targetClient.appToken');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const text = optionalText(String(value ?? ''));
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
