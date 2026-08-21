const WORKFLOW_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const EXPECTED_STEP_TYPES = Object.freeze([
  'SetRecordTrigger',
  'GenerateAiTextWithSkyLarkAction',
  'GenerateAiTextWithSkyLarkAction',
  'GenerateAiTextWithSkyLarkAction',
  'GenerateAiTextWithSkyLarkAction',
  'SetRecordAction',
]);
const CANONICAL_WORKFLOW_TITLE = canonicalWorkflowTitle(WORKFLOW_TITLE);

export async function buildCustomerBaseAiMaterializationWorkflowReadiness({ sourceClient }) {
  requireSourceClient(sourceClient);
  const resources = requireObject(sourceClient.getExportResources(), 'export resources');
  const workflows = requireArray(resources.workflows ?? [], 'export workflows');
  if (workflows.length !== 2) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_COUNT_MISMATCH',
      'Current Source must contain exactly two workflows',
      { expected: 2, actual: workflows.length },
    );
  }

  const references = await buildSourceReferenceMaps(sourceClient);
  const matches = [];
  const resolutionCandidates = [];
  for (const [index, rawWorkflow] of workflows.entries()) {
    const draft = parseMaybeJson(rawWorkflow?.Draft ?? rawWorkflow?.draft, 'workflow Draft');
    const sourceTitle = optionalText(draft?.title);
    const stepTypes = Array.isArray(draft?.steps)
      ? draft.steps.map((step) => optionalText(step?.type) ?? '')
      : [];
    const titleMatch = canonicalWorkflowTitle(sourceTitle) === CANONICAL_WORKFLOW_TITLE;
    const reviewedStepSignatureMatch = sameArray(stepTypes, EXPECTED_STEP_TYPES);
    resolutionCandidates.push({
      sourceOrdinal: index + 1,
      hasDraft: Boolean(draft),
      titleMatch,
      reviewedStepSignatureMatch,
      stepTypes,
    });
    if (titleMatch || reviewedStepSignatureMatch) {
      matches.push({
        rawWorkflow,
        draft,
        sourceResolutionMode: titleMatch
          ? 'canonical-title'
          : 'unique-reviewed-step-signature',
      });
    }
  }
  if (matches.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_RESOLUTION_FAILED',
      'AI Materialization workflow must resolve exactly once in Source',
      { matches: matches.length, candidates: resolutionCandidates },
    );
  }

  const { rawWorkflow, draft, sourceResolutionMode } = matches[0];
  const sourceStatus = normalizeSourceWorkflowStatus(rawWorkflow);
  const steps = requireArray(draft.steps, 'AI Materialization workflow steps');
  const stepTypes = steps.map((step) => optionalText(step?.type) ?? '');
  if (!sameArray(stepTypes, EXPECTED_STEP_TYPES)) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_STEPS_MISMATCH',
      'AI Materialization workflow step chain drifted from reviewed Source',
      { expected: [...EXPECTED_STEP_TYPES], actual: stepTypes },
    );
  }

  const unresolvedFieldReferences = [];
  const mappedFieldReferences = [];
  walk(steps, (key, value, path) => {
    if (!/fieldId$/iu.test(key) || typeof value !== 'string') return;
    const mapped = references.fieldById.get(value);
    if (mapped) {
      mappedFieldReferences.push({ path, tableName: mapped.tableName, fieldName: mapped.fieldName });
    } else {
      unresolvedFieldReferences.push({ path, fingerprint: shortFingerprint(value) });
    }
  });
  if (unresolvedFieldReferences.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_FIELD_REFERENCE_UNRESOLVED',
      'AI Materialization workflow contains Source field references that cannot be mapped',
      { unresolvedFieldReferences },
    );
  }

  const finalStep = requireObject(steps.at(-1), 'final SetRecordAction');
  const assignments = collectFieldAssignments(finalStep.data ?? finalStep, references);
  if (assignments.length === 0) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_FINAL_ASSIGNMENTS_MISSING',
      'Final SetRecordAction assignments could not be resolved from Source',
    );
  }

  const nullAssignments = assignments.filter((item) => item.valueKind === 'literal-null');
  const failureCodeClear = nullAssignments.filter((item) => item.fieldName === 'failure_code');
  if (failureCodeClear.length !== 1 || nullAssignments.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_NULL_CLEAR_SHAPE_DRIFT',
      'Current Source must contain exactly one null clear assignment on failure_code',
      { nullAssignments },
    );
  }

  const generatedStatus = assignments.find((item) => (
    item.fieldName === 'generation_status' && item.optionName === 'generated'
  ));
  const generatedAt = assignments.find((item) => (
    item.fieldName === 'generated_at' && item.refAttribute === 'startTime'
  ));
  if (!generatedStatus || !generatedAt) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_FINAL_ASSIGNMENT_DRIFT',
      'Final SetRecordAction no longer contains reviewed generation_status/generated_at semantics',
      {
        generationStatusGenerated: Boolean(generatedStatus),
        generatedAtStartTime: Boolean(generatedAt),
      },
    );
  }

  const blockers = [
    {
      code: 'SET_RECORD_TEXT_NULL_CLEAR_UNDOCUMENTED',
      stepType: 'SetRecordAction',
      tableName: failureCodeClear[0].tableName,
      fieldName: 'failure_code',
      sourceSemantic: 'clear-to-null',
      publicSchemaEvidence: 'RecordFieldValue requires ValueInfo[]; documented ValueInfo types do not define null/clear semantics',
      mutationAllowed: false,
    },
  ];

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_ai_materialization_workflow_readiness_v1',
    mode: 'local-source-read-only',
    title: WORKFLOW_TITLE,
    sourceResolutionMode,
    sourceStatus,
    sourceWorkflowCount: workflows.length,
    stepCount: steps.length,
    sourceStepTypes: stepTypes,
    publicStepTypeMapping: [
      { source: 'SetRecordTrigger', public: 'SetRecordTrigger', documented: true },
      { source: 'GenerateAiTextWithSkyLarkAction', public: 'GenerateAiTextAction', documented: true, count: 4 },
      { source: 'SetRecordAction', public: 'SetRecordAction', documented: true },
    ],
    mappedFieldReferenceCount: mappedFieldReferences.length,
    unresolvedFieldReferenceCount: 0,
    finalAssignments: assignments.map((item) => ({
      tableName: item.tableName,
      fieldName: item.fieldName,
      valueKind: item.valueKind,
      ...(item.optionName ? { optionName: item.optionName } : {}),
      ...(item.refAttribute ? { refAttribute: item.refAttribute } : {}),
    })),
    blockers,
    blockerCount: blockers.length,
    applyAllowed: false,
    status: 'CUSTOMER_BASE_AI_WORKFLOW_DOCUMENTED_TYPES_READY_NULL_CLEAR_BLOCKED',
    remoteRequestCount: 0,
    remoteMutationCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    aiCallCount: 0,
    recordMutationCount: 0,
  });
}

function collectFieldAssignments(root, references) {
  const candidates = [];
  walk(root, (key, value, path, parent) => {
    if (!/fieldId$/iu.test(key) || typeof value !== 'string' || !parent || typeof parent !== 'object') return;
    const field = references.fieldById.get(value);
    if (!field) return;
    const rawValue = parent.value;
    const valueType = optionalText(parent.valueType ?? parent.value_type);
    const assignment = {
      path,
      tableName: field.tableName,
      fieldName: field.fieldName,
      valueKind: classifyValueKind(valueType, rawValue),
      optionName: null,
      refAttribute: null,
    };
    if (typeof rawValue === 'string' && references.optionById.has(rawValue)) {
      assignment.optionName = references.optionById.get(rawValue).optionName;
    }
    assignment.refAttribute = findRefAttribute(rawValue);
    candidates.push(assignment);
  });

  const deduped = new Map();
  for (const item of candidates) {
    const key = `${item.tableName}\u0000${item.fieldName}\u0000${item.path}`;
    deduped.set(key, item);
  }
  return [...deduped.values()];
}

function classifyValueKind(valueType, value) {
  if (value === null) return 'literal-null';
  if (valueType && /ref/iu.test(valueType)) return 'ref';
  if (valueType && /value/iu.test(valueType)) return 'literal';
  if (Array.isArray(value) && findRefAttribute(value)) return 'ref';
  return 'literal';
}

function findRefAttribute(value) {
  let found = null;
  walk(value, (key, nested) => {
    if (found) return;
    if (/stepAttr$/iu.test(key) && typeof nested === 'string' && nested.trim() !== '') found = nested.trim();
  });
  return found;
}

async function buildSourceReferenceMaps(sourceClient) {
  const tableById = new Map();
  const fieldById = new Map();
  const optionById = new Map();
  for (const table of await sourceClient.listTables()) {
    const tableId = requireText(table?.tableId, 'Source tableId');
    const tableName = requireText(table?.name, `Source table name ${tableId}`);
    tableById.set(tableId, tableName);
    for (const field of await sourceClient.listFields({ tableId })) {
      const fieldId = requireText(field?.fieldId, `${tableName} fieldId`);
      const fieldName = requireText(field?.fieldName, `${tableName} fieldName`);
      fieldById.set(fieldId, { tableName, fieldName });
      const options = Array.isArray(field?.property?.options)
        ? field.property.options
        : (Array.isArray(field?.exportProperty?.options) ? field.exportProperty.options : []);
      for (const option of options) {
        const optionId = optionalText(option?.id);
        const optionName = optionalText(option?.name);
        if (optionId && optionName) optionById.set(optionId, { tableName, fieldName, optionName });
      }
    }
  }
  return { tableById, fieldById, optionById };
}

function normalizeSourceWorkflowStatus(raw) {
  const value = raw?.Status ?? raw?.status;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'enabled' || String(value).toLowerCase() === 'enable') return 'enabled';
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'disabled' || String(value).toLowerCase() === 'disable') return 'disabled';
  return value ?? null;
}

function parseMaybeJson(value, label, depth = 0) {
  if (depth > 4) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_JSON_NESTING_INVALID',
      `${label} exceeded supported JSON wrapper depth`,
    );
  }
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.encoding === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      return parseMaybeJson(value.value, label, depth + 1);
    }
    return value;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string'
      ? parseMaybeJson(parsed, label, depth + 1)
      : parsed;
  } catch (error) {
    throw codedError('CUSTOMER_BASE_AI_WORKFLOW_SOURCE_JSON_INVALID', `${label} is not valid JSON`, {
      cause: error?.message ?? String(error),
    });
  }
}

function canonicalWorkflowTitle(value) {
  const text = optionalText(value);
  if (!text) return null;
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function walk(value, visitor, path = '$', parent = null) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${path}[${index}]`, value));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    visitor(key, nested, childPath, value);
    walk(nested, visitor, childPath, value);
  }
}

function requireSourceClient(client) {
  if (!client || typeof client.getExportResources !== 'function' || typeof client.listTables !== 'function' || typeof client.listFields !== 'function') {
    throw new TypeError('sourceClient must expose export resources, tables and fields');
  }
}
function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}
function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}
function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function shortFingerprint(value) {
  let hash = 2166136261;
  for (const ch of String(value)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
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
