import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /(?:token|secret|credential|password|authorization|auth(?:entication)?[_-]?key|authkey|webhook|cookie|signature|sign)$/iu;
const IDENTITY_KEY = /(?:(?:^|_)(?:id|ids|creator|editor|member|owner|user|chat|department|base_id|dashboardid|chartid)(?:$|_))|(?:Id|Ids|Creator|Editor|Member|Owner|User|Chat|Department|TableID|FieldID|ViewID|TableId|FieldId|ViewId|DashboardID|ChartID)$/iu;
const RAW_REFERENCE = /^(?:tbl|fld|vew|rec|rol|opt)[A-Za-z0-9_-]{6,}$/u;
const EMBEDDED_RAW_REFERENCE = /\b(?:tbl|fld|vew|rec|rol|opt)[A-Za-z0-9_-]{6,}\b/gu;
const INTERNAL_ID_VALUE = /^(?:(?:act|trig|cond)[A-Za-z0-9_-]{6,}|(?:tenant|user|base)_\d{6,})$/u;
const EMBEDDED_INTERNAL_ID = /\b(?:(?:act|trig|cond)[A-Za-z0-9_-]{6,}|(?:tenant|user|base)_\d{6,})\b/gu;
const LARGE_OPAQUE_THRESHOLD = 12_000;
const MAX_DEPTH = 18;

/**
 * Builds a local-only, value-sanitized manual parity inventory for Base resources
 * whose export definitions cannot be replayed through a proven public OpenAPI
 * request contract. The output never exposes Lark tokens, auth keys, webhook
 * tokens or raw internal IDs. Current Source Table/Field/Select-option IDs are
 * replaced by stable semantic names whenever the export defines that mapping.
 */
export async function buildLarkBaseResourceManualParityManifest(input) {
  const sourceClient = requireClient(input?.sourceClient);
  const resources = requireObject(sourceClient.getExportResources(), 'export resources');
  const references = await buildReferenceMaps(sourceClient);
  const diagnostics = createDiagnostics();

  const dashboards = requireArray(resources.dashboards ?? [], 'dashboards').map((dashboard, index) => (
    sanitizeDashboard(dashboard, index, references, diagnostics)
  ));
  const workflows = requireArray(resources.workflows ?? [], 'workflows').map((workflow, index) => (
    sanitizeWorkflow(workflow, index, references, diagnostics)
  ));

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_resource_manual_parity_manifest_v2',
    mode: 'local-read-only-sensitive-values-redacted',
    dashboards,
    workflows,
    summary: {
      dashboardCount: dashboards.length,
      dashboardChartCount: dashboards.reduce((sum, dashboard) => sum + dashboard.chartCount, 0),
      workflowCount: workflows.length,
      mappedTableReferences: diagnostics.mappedTableReferences,
      mappedFieldReferences: diagnostics.mappedFieldReferences,
      mappedOptionReferences: diagnostics.mappedOptionReferences,
      parsedJsonStrings: diagnostics.parsedJsonStrings,
      opaqueStringFingerprints: diagnostics.opaqueStringFingerprints,
      redactedSensitiveValues: diagnostics.redactedSensitiveValues,
      redactedIdentityValues: diagnostics.redactedIdentityValues,
      unresolvedReferenceLikeValues: diagnostics.unresolvedReferenceLikeValues.length,
    },
    diagnostics: {
      unresolvedReferenceLikeValues: diagnostics.unresolvedReferenceLikeValues,
    },
    manualParity: {
      dashboards: 'recreate-or-copy-through-supported-UI/source-reference; never replay export snapshot/token fields as OpenAPI payload',
      workflows: 'recreate-through-supported-UI/source-reference unless a documented definition-write request contract is proven',
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function sanitizeDashboard(value, index, references, diagnostics) {
  const dashboard = requireObject(value, `dashboard[${index}]`);
  const charts = requireArray(dashboard.charts ?? [], `dashboard[${index}].charts`);
  return deepFreeze({
    sourceOrdinal: index + 1,
    identityFingerprint: fingerprint({ dashboardID: dashboard.dashboardID, token: dashboard.token }),
    isAdvancedPermEnabled: dashboard.isAdvancedPermEnabled === true,
    chartCount: charts.length,
    snapshot: sanitizeStructuredString(dashboard.snapshot, `dashboard[${index}].snapshot`, references, diagnostics),
    charts: charts.map((chart, chartIndex) => {
      const source = requireObject(chart, `dashboard[${index}].charts[${chartIndex}]`);
      return {
        sourceOrdinal: chartIndex + 1,
        identityFingerprint: fingerprint({ chartID: source.chartID, token: source.token }),
        subType: finiteNumberOrNull(source.subType),
        snapshot: sanitizeStructuredString(
          source.snapshot,
          `dashboard[${index}].charts[${chartIndex}].snapshot`,
          references,
          diagnostics,
        ),
      };
    }),
  });
}

function sanitizeWorkflow(value, index, references, diagnostics) {
  const workflow = requireObject(value, `workflow[${index}]`);
  const safe = {};
  for (const [key, nested] of Object.entries(workflow)) {
    if (key === 'nodeSchema') {
      safe.nodeSchema = sanitizeValue(nested, `workflow[${index}].nodeSchema`, key, references, diagnostics, 0);
      continue;
    }
    if (key === 'WorkflowExtra') {
      safe.WorkflowExtra = sanitizeValue(nested, `workflow[${index}].WorkflowExtra`, key, references, diagnostics, 0);
      continue;
    }
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = redacted(nested, 'sensitive', diagnostics);
      continue;
    }
    if (IDENTITY_KEY.test(key)) {
      safe[key] = sanitizeIdentityValue(nested, key, references, diagnostics);
      continue;
    }
    safe[key] = sanitizeValue(nested, `workflow[${index}].${key}`, key, references, diagnostics, 0);
  }
  return deepFreeze({
    sourceOrdinal: index + 1,
    identityFingerprint: fingerprint({ id: workflow.id, base_id: workflow.base_id }),
    ...safe,
  });
}

function sanitizeValue(value, path, key, references, diagnostics, depth) {
  if (depth > MAX_DEPTH) return opaqueSummary(value, diagnostics, 'depth_limit');
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, key, references, diagnostics, depth + 1));
  }
  if (plainObject(value)) {
    const result = {};
    for (const [rawKey, nested] of Object.entries(value)) {
      const safeKey = sanitizeObjectKey(rawKey, references, diagnostics);
      if (SENSITIVE_KEY.test(rawKey)) {
        result[safeKey] = redacted(nested, 'sensitive', diagnostics);
      } else if (IDENTITY_KEY.test(rawKey)) {
        result[safeKey] = sanitizeIdentityValue(nested, rawKey, references, diagnostics);
      } else {
        result[safeKey] = sanitizeValue(nested, `${path}.${safeKey}`, rawKey, references, diagnostics, depth + 1);
      }
    }
    return result;
  }
  if (typeof value === 'string') {
    const mapped = mapReference(value, references, diagnostics);
    if (mapped) return mapped;
    if (RAW_REFERENCE.test(value)) {
      diagnostics.unresolvedReferenceLikeValues.push({ path, fingerprint: fingerprint(value) });
      return redactedReference(value, diagnostics);
    }
    if (INTERNAL_ID_VALUE.test(value)) return redactedIdentityString(value, diagnostics);
    if (looksSensitiveString(value)) return redacted(value, 'sensitive-string', diagnostics);
    if (isStructuredStringKey(key)) return sanitizeStructuredString(value, path, references, diagnostics);
    if (value.length > LARGE_OPAQUE_THRESHOLD) return opaqueSummary(value, diagnostics, 'large-string');
    return replaceEmbeddedKnownReferences(value, path, references, diagnostics);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return opaqueSummary(value, diagnostics, typeof value);
}

function sanitizeStructuredString(value, path, references, diagnostics) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return sanitizeValue(value, path, 'structured', references, diagnostics, 0);
  const mapped = mapReference(value, references, diagnostics);
  if (mapped) return mapped;
  if (RAW_REFERENCE.test(value)) {
    diagnostics.unresolvedReferenceLikeValues.push({ path, fingerprint: fingerprint(value) });
    return redactedReference(value, diagnostics);
  }
  if (INTERNAL_ID_VALUE.test(value)) return redactedIdentityString(value, diagnostics);
  if (looksSensitiveString(value)) return redacted(value, 'sensitive-string', diagnostics);
  try {
    const parsed = JSON.parse(value);
    diagnostics.parsedJsonStrings += 1;
    return {
      encoding: 'json',
      value: sanitizeValue(parsed, `${path}.$json`, 'json', references, diagnostics, 0),
    };
  } catch {
    return opaqueSummary(value, diagnostics, 'opaque-string');
  }
}

function sanitizeIdentityValue(value, key, references, diagnostics) {
  if (typeof value === 'string') {
    const mapped = mapReference(value, references, diagnostics);
    if (mapped) return mapped;
  }
  diagnostics.redactedIdentityValues += 1;
  return {
    redacted: true,
    reason: 'internal-identity',
    key,
    fingerprint: fingerprint(value),
  };
}

function sanitizeObjectKey(key, references, diagnostics) {
  let result = key;
  for (const [tableId, tableName] of references.tableById) {
    if (!result.includes(tableId)) continue;
    diagnostics.mappedTableReferences += 1;
    result = result.replaceAll(tableId, `table:${tableName}`);
  }
  for (const [fieldId, combined] of references.fieldById) {
    if (!result.includes(fieldId)) continue;
    diagnostics.mappedFieldReferences += 1;
    const [tableName, fieldName] = combined.split('\u0000');
    result = result.replaceAll(fieldId, `field:${tableName}.${fieldName}`);
  }
  for (const [optionId, combined] of references.optionById) {
    if (!result.includes(optionId)) continue;
    diagnostics.mappedOptionReferences += 1;
    const [tableName, fieldName, optionName] = combined.split('\u0000');
    result = result.replaceAll(optionId, `option:${tableName}.${fieldName}=${optionName}`);
  }
  result = result.replace(EMBEDDED_INTERNAL_ID, (match) => {
    diagnostics.redactedIdentityValues += 1;
    return `internal:${shortFingerprint(match)}`;
  });
  result = result.replace(EMBEDDED_RAW_REFERENCE, (match) => {
    diagnostics.unresolvedReferenceLikeValues.push({ path: 'object-key', fingerprint: fingerprint(match) });
    return `unresolved:${shortFingerprint(match)}`;
  });
  return result;
}

function mapReference(value, references, diagnostics) {
  if (references.tableById.has(value)) {
    diagnostics.mappedTableReferences += 1;
    return { refType: 'table', tableName: references.tableById.get(value) };
  }
  if (references.fieldById.has(value)) {
    diagnostics.mappedFieldReferences += 1;
    const [tableName, fieldName] = references.fieldById.get(value).split('\u0000');
    return { refType: 'field', tableName, fieldName };
  }
  if (references.optionById.has(value)) {
    diagnostics.mappedOptionReferences += 1;
    const [tableName, fieldName, optionName] = references.optionById.get(value).split('\u0000');
    return { refType: 'select-option', tableName, fieldName, optionName };
  }
  return null;
}

function replaceEmbeddedKnownReferences(value, path, references, diagnostics) {
  let result = value;
  for (const [tableId, tableName] of references.tableById) {
    if (!result.includes(tableId)) continue;
    diagnostics.mappedTableReferences += 1;
    result = result.replaceAll(tableId, `[table:${tableName}]`);
  }
  for (const [fieldId, combined] of references.fieldById) {
    if (!result.includes(fieldId)) continue;
    diagnostics.mappedFieldReferences += 1;
    const [tableName, fieldName] = combined.split('\u0000');
    result = result.replaceAll(fieldId, `[field:${tableName}.${fieldName}]`);
  }
  for (const [optionId, combined] of references.optionById) {
    if (!result.includes(optionId)) continue;
    diagnostics.mappedOptionReferences += 1;
    const [tableName, fieldName, optionName] = combined.split('\u0000');
    result = result.replaceAll(optionId, `[option:${tableName}.${fieldName}=${optionName}]`);
  }
  result = result.replace(EMBEDDED_INTERNAL_ID, (match) => {
    diagnostics.redactedIdentityValues += 1;
    return `[internal:${shortFingerprint(match)}]`;
  });
  result = result.replace(EMBEDDED_RAW_REFERENCE, (match) => {
    diagnostics.unresolvedReferenceLikeValues.push({ path, fingerprint: fingerprint(match) });
    return `[unresolved:${shortFingerprint(match)}]`;
  });
  return result;
}

async function buildReferenceMaps(sourceClient) {
  const tableById = new Map();
  const fieldById = new Map();
  const optionById = new Map();
  for (const table of await sourceClient.listTables()) {
    const tableId = requireText(table?.tableId, 'tableId');
    const tableName = requireText(table?.name, `table name ${tableId}`);
    if (tableById.has(tableId)) throw new TypeError(`duplicate tableId: ${tableId}`);
    tableById.set(tableId, tableName);
    for (const field of await sourceClient.listFields({ tableId })) {
      const fieldId = requireText(field?.fieldId, `${tableName} fieldId`);
      const fieldName = requireText(field?.fieldName, `${tableName} fieldName`);
      if (fieldById.has(fieldId)) throw new TypeError(`duplicate fieldId: ${fieldId}`);
      fieldById.set(fieldId, `${tableName}\u0000${fieldName}`);
      const options = Array.isArray(field?.property?.options)
        ? field.property.options
        : (Array.isArray(field?.exportProperty?.options) ? field.exportProperty.options : []);
      for (const option of options) {
        const optionId = optionalText(option?.id);
        if (!optionId) continue;
        const optionName = requireText(option?.name, `${tableName}.${fieldName} option name`);
        const combined = `${tableName}\u0000${fieldName}\u0000${optionName}`;
        if (optionById.has(optionId) && optionById.get(optionId) !== combined) {
          throw new TypeError(`duplicate select optionId across fields: ${optionId}`);
        }
        optionById.set(optionId, combined);
      }
    }
  }
  return { tableById, fieldById, optionById };
}

function isStructuredStringKey(key) {
  return /(?:snapshot|schema|draft|flow|config|definition|payload|extra)$/iu.test(String(key));
}

function looksSensitiveString(value) {
  const text = String(value);
  return /(?:access[_-]?token|refresh[_-]?token|authorization:\s*bearer|webhook[_-]?token|client[_-]?secret|auth[_-]?key)/iu.test(text)
    || /https?:\/\/[^\s]+[?&](?:token|access_token|key|secret)=/iu.test(text);
}

function opaqueSummary(value, diagnostics, reason) {
  diagnostics.opaqueStringFingerprints += 1;
  const text = typeof value === 'string' ? value : stableJson(value);
  return {
    encoding: 'opaque-redacted',
    reason,
    bytes: Buffer.byteLength(text),
    sha256: fingerprint(text),
  };
}

function redacted(value, reason, diagnostics) {
  diagnostics.redactedSensitiveValues += 1;
  return {
    redacted: true,
    reason,
    fingerprint: fingerprint(value),
  };
}

function redactedReference(value, diagnostics) {
  diagnostics.redactedIdentityValues += 1;
  return {
    redacted: true,
    reason: 'unresolved-reference-like',
    fingerprint: fingerprint(value),
  };
}

function redactedIdentityString(value, diagnostics) {
  diagnostics.redactedIdentityValues += 1;
  return {
    redacted: true,
    reason: 'internal-identity',
    fingerprint: fingerprint(value),
  };
}

function shortFingerprint(value) {
  return fingerprint(value).slice(0, 16);
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function createDiagnostics() {
  return {
    mappedTableReferences: 0,
    mappedFieldReferences: 0,
    mappedOptionReferences: 0,
    parsedJsonStrings: 0,
    opaqueStringFingerprints: 0,
    redactedSensitiveValues: 0,
    redactedIdentityValues: 0,
    unresolvedReferenceLikeValues: [],
  };
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireClient(client) {
  for (const method of ['listTables', 'listFields', 'getExportResources']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
  }
  return client;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!plainObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}