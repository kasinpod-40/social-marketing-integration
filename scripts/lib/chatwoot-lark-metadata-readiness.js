import { createHash } from 'node:crypto';
import {
  CHATWOOT_LARK_BLUEPRINT,
  CHATWOOT_LARK_BLUEPRINT_VERSION,
  CHATWOOT_REQUIRED_LARK_TABLE_KEYS,
  validateChatwootLarkBlueprint,
} from '../../packages/config/src/chatwoot-lark-blueprint.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const CHATWOOT_LARK_METADATA_CONTRACT_VERSION = 'chatwoot-lark-metadata-readiness-v1';
export const CHATWOOT_LARK_METADATA_PHASES = Object.freeze(['plan', 'lark-preflight']);
export const CHATWOOT_LARK_METADATA_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_LARK_METADATA',
  value: 'READ_ONLY_CHATWOOT_LARK_METADATA',
});

const DECISION = Object.freeze({
  READY: 'PASS_CHATWOOT_LARK_METADATA_READY',
  ADDITIVE: 'CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED',
  TYPE_BLOCKED: 'CHATWOOT_LARK_TYPE_MISMATCH_BLOCKED',
  AMBIGUOUS_BLOCKED: 'CHATWOOT_LARK_TABLE_AMBIGUOUS_BLOCKED',
});

export function parseChatwootLarkMetadataArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else throw operatorError(
      `Unknown Chatwoot Lark metadata argument: ${arg}`,
      'CHATWOOT_LARK_METADATA_ARGUMENT_INVALID',
    );
  }
  if (!CHATWOOT_LARK_METADATA_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported Chatwoot Lark metadata phase: ${phase}`,
      'CHATWOOT_LARK_METADATA_PHASE_INVALID',
      { phase },
    );
  }
  if (phase === 'plan' && execute) {
    throw operatorError(
      'Chatwoot Lark metadata plan does not accept --execute',
      'CHATWOOT_LARK_METADATA_PLAN_EXECUTE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertChatwootLarkMetadataConfirmation(env = {}) {
  const expected = CHATWOOT_LARK_METADATA_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw operatorError(
      `Chatwoot Lark metadata preflight requires ${expected.envName}=${expected.value}`,
      'CHATWOOT_LARK_METADATA_CONFIRMATION_REQUIRED',
      { envName: expected.envName },
    );
  }
  return true;
}

export function loadChatwootLarkMetadataTarget(env = {}) {
  validateChatwootLarkBlueprint();
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const tableRefs = {};
  for (const tableKey of CHATWOOT_REQUIRED_LARK_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[tableKey];
    const value = optionalText(env?.[envName]);
    tableRefs[tableKey] = Object.freeze({ envName, configuredTableId: value });
  }

  const safe = Object.freeze({
    contractVersion: CHATWOOT_LARK_METADATA_CONTRACT_VERSION,
    blueprintVersion: CHATWOOT_LARK_BLUEPRINT_VERSION,
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    tableCount: CHATWOOT_REQUIRED_LARK_TABLE_KEYS.length,
  });

  return deepFreeze({
    ...safe,
    tableRefs,
    targetFingerprint: sha256(stableJson(safe)),
  });
}

/** Resolve exact table IDs for runtime use while keeping evidence output fingerprint-only. */
export function discoverChatwootLarkTables(input = {}) {
  const remoteTables = requireArray(input.remoteTables, 'remoteTables').map(normalizeRemoteTable);
  const tableRefs = requireObject(input.tableRefs, 'tableRefs');
  const bindings = {};
  const ambiguousTables = [];
  const missingTables = [];
  const identityMismatches = [];
  const bindTableEnv = [];

  for (const table of CHATWOOT_LARK_BLUEPRINT) {
    const ref = requireObject(tableRefs[table.key], `tableRefs.${table.key}`);
    const configuredId = optionalText(ref.configuredTableId);
    const aliases = new Set(table.aliases.map(normalizeName));
    const byId = configuredId
      ? remoteTables.filter((remote) => remote.tableId === configuredId)
      : [];
    const byAlias = remoteTables.filter((remote) => aliases.has(normalizeName(remote.name)));

    if (byId.length > 1 || byAlias.length > 1) {
      ambiguousTables.push(table.key);
      continue;
    }

    if (byId.length === 1) {
      const remote = byId[0];
      if (!aliases.has(normalizeName(remote.name))) {
        identityMismatches.push(table.key);
        continue;
      }
      bindings[table.key] = freezeBinding(table, remote, 'configured_id');
      continue;
    }

    if (byAlias.length === 1) {
      const remote = byAlias[0];
      bindings[table.key] = freezeBinding(table, remote, configuredId ? 'repair_stale_env' : 'alias_discovery');
      bindTableEnv.push(Object.freeze({
        action: 'bind_table_env',
        tableKey: table.key,
        envName: ref.envName,
        reason: configuredId ? 'configured_table_id_not_found' : 'mapping_missing',
      }));
      continue;
    }

    missingTables.push(table.key);
  }

  return deepFreeze({
    bindings,
    missingTables,
    ambiguousTables,
    identityMismatches,
    bindTableEnv,
    remoteTableCount: remoteTables.length,
  });
}

export function analyzeChatwootLarkMetadata(input = {}) {
  const discovery = requireObject(input.discovery, 'discovery');
  const fieldsByKey = requireObject(input.fieldsByKey ?? {}, 'fieldsByKey');
  const missingFields = [];
  const typeMismatches = [];
  const primaryKeyMismatches = [];
  const fieldCounts = {};
  const additiveActions = [...requireArray(discovery.bindTableEnv ?? [], 'discovery.bindTableEnv')];

  for (const tableKey of requireArray(discovery.missingTables ?? [], 'discovery.missingTables')) {
    const table = requireBlueprintTable(tableKey);
    additiveActions.push(Object.freeze({
      action: 'create_table',
      tableKey,
      createName: table.createName,
      primaryField: table.primaryField,
      fieldCount: table.fields.length,
    }));
  }

  for (const table of CHATWOOT_LARK_BLUEPRINT) {
    if (!discovery.bindings?.[table.key]) continue;
    const remoteFields = requireArray(fieldsByKey[table.key] ?? [], `fieldsByKey.${table.key}`)
      .map(normalizeRemoteField);
    fieldCounts[table.key] = remoteFields.length;
    const byName = new Map();
    for (const remote of remoteFields) {
      const normalized = normalizeName(remote.fieldName);
      if (!normalized) continue;
      if (byName.has(normalized)) {
        throw operatorError(
          `Duplicate Lark field name in ${table.key}: ${remote.fieldName}`,
          'CHATWOOT_LARK_METADATA_DUPLICATE_FIELD',
          { tableKey: table.key, fieldName: remote.fieldName },
        );
      }
      byName.set(normalized, remote);
    }

    for (const field of table.fields) {
      const remote = byName.get(normalizeName(field.fieldName));
      if (!remote) {
        if (field.primary) {
          primaryKeyMismatches.push(`${table.key}.${field.fieldName}:missing`);
        } else {
          missingFields.push(`${table.key}.${field.fieldName}`);
          additiveActions.push(Object.freeze({
            action: 'create_field',
            tableKey: table.key,
            fieldName: field.fieldName,
            type: field.type,
            uiType: field.uiType,
            required: field.required,
          }));
        }
        continue;
      }

      if (!field.compatibleTypes.includes(remote.type)) {
        typeMismatches.push(Object.freeze({
          tableKey: table.key,
          fieldName: field.fieldName,
          expectedTypes: field.compatibleTypes,
          actualType: remote.type,
        }));
      }
      if (field.primary && remote.isPrimary !== true) {
        primaryKeyMismatches.push(`${table.key}.${field.fieldName}:not_primary`);
      }
    }
  }

  const ambiguousTables = [...(discovery.ambiguousTables ?? [])].sort();
  const identityMismatches = [...(discovery.identityMismatches ?? [])].sort();
  const destructiveBlockers = typeMismatches.length + primaryKeyMismatches.length + identityMismatches.length;
  let decision = DECISION.READY;
  if (ambiguousTables.length > 0) decision = DECISION.AMBIGUOUS_BLOCKED;
  else if (destructiveBlockers > 0) decision = DECISION.TYPE_BLOCKED;
  else if (additiveActions.length > 0) decision = DECISION.ADDITIVE;

  const status = decision === DECISION.READY
    ? 'ready'
    : decision === DECISION.ADDITIVE
      ? 'action_required'
      : 'blocked';

  return deepFreeze({
    status,
    decision,
    accepted: decision === DECISION.READY,
    inventory: {
      expectedTableCount: CHATWOOT_LARK_BLUEPRINT.length,
      resolvedTableCount: Object.keys(discovery.bindings ?? {}).length,
      missingTableCount: (discovery.missingTables ?? []).length,
      remoteTableCount: Number(discovery.remoteTableCount ?? 0),
      fieldCounts,
      fieldCountFingerprint: sha256(stableJson(fieldCounts)),
      tableBindingFingerprint: sha256(stableJson(Object.fromEntries(
        Object.entries(discovery.bindings ?? {}).map(([key, binding]) => [key, sha256(binding.tableId)]),
      ))),
    },
    additivePlan: {
      actionCount: additiveActions.length,
      actions: additiveActions,
      destructiveActions: 0,
      renameTableCount: 0,
      deleteTableCount: 0,
      deleteFieldCount: 0,
      changeFieldTypeCount: 0,
    },
    blockers: {
      ambiguousTables,
      identityMismatches,
      missingPrimaryKeys: primaryKeyMismatches.sort(),
      typeMismatches,
    },
    missingFields: missingFields.sort(),
    nextGate: decision === DECISION.READY
      ? 'chatwoot_provider_admin_permission_then_runtime_all_false_wiring'
      : decision === DECISION.ADDITIVE
        ? 'separate_additive_lark_schema_apply_review'
        : 'manual_lark_schema_resolution',
  });
}

export function buildChatwootLarkMetadataEvidence(input = {}) {
  const target = requireObject(input.target, 'target');
  const analysis = requireObject(input.analysis, 'analysis');
  const capturedAt = requireText(input.capturedAt, 'capturedAt');
  const larkRequestCount = nonNegativeInteger(input.larkRequestCount, 'larkRequestCount');

  return deepFreeze({
    phase: 'lark-preflight',
    contractVersion: CHATWOOT_LARK_METADATA_CONTRACT_VERSION,
    blueprintVersion: CHATWOOT_LARK_BLUEPRINT_VERSION,
    capturedAt,
    status: analysis.status,
    accepted: analysis.accepted,
    decision: analysis.decision,
    target: {
      environment: target.environment,
      customerProfile: target.customerProfile,
      customerKey: target.customerKey,
      targetFingerprint: target.targetFingerprint,
      tableCount: target.tableCount,
    },
    inventory: analysis.inventory,
    additivePlan: analysis.additivePlan,
    blockers: analysis.blockers,
    missingFields: analysis.missingFields,
    nextGate: analysis.nextGate,
    boundaries: {
      metadataReadOnly: true,
      larkRequestCount,
      larkRecordReadCount: 0,
      larkMutationCount: 0,
      providerRequestCount: 0,
      d1MutationCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleWebhookActionCount: 0,
      credentialValuesPersisted: false,
      rawMetadataPayloadPersisted: false,
      destructivePlanActionCount: 0,
    },
  });
}

export function safeChatwootLarkMetadataPlan() {
  return deepFreeze({
    contractVersion: CHATWOOT_LARK_METADATA_CONTRACT_VERSION,
    blueprintVersion: CHATWOOT_LARK_BLUEPRINT_VERSION,
    planOnly: true,
    phases: CHATWOOT_LARK_METADATA_PHASES,
    confirmation: `${CHATWOOT_LARK_METADATA_CONFIRMATION.envName}=${CHATWOOT_LARK_METADATA_CONFIRMATION.value}`,
    tableCount: CHATWOOT_LARK_BLUEPRINT.length,
    tableKeys: CHATWOOT_REQUIRED_LARK_TABLE_KEYS,
    decisions: Object.values(DECISION),
    execution: {
      metadataReadOnly: true,
      listTables: true,
      listFields: true,
      recordReads: false,
      mutations: false,
      additivePlanOnly: true,
      renameDeleteOrTypeChange: false,
    },
  });
}

function freezeBinding(table, remote, source) {
  return Object.freeze({
    tableKey: table.key,
    tableId: remote.tableId,
    source,
  });
}

function requireBlueprintTable(tableKey) {
  const table = CHATWOOT_LARK_BLUEPRINT.find((entry) => entry.key === tableKey);
  if (!table) throw operatorError(
    `Unknown Chatwoot Lark table key: ${tableKey}`,
    'CHATWOOT_LARK_METADATA_TABLE_KEY_INVALID',
    { tableKey },
  );
  return table;
}

function normalizeRemoteTable(value) {
  const source = requireObject(value, 'remote table');
  return Object.freeze({
    tableId: requireText(source.tableId ?? source.table_id ?? source.id, 'remote table ID'),
    name: requireText(source.name, 'remote table name'),
  });
}

function normalizeRemoteField(value) {
  const source = requireObject(value, 'remote field');
  const type = Number(source.type);
  if (!Number.isSafeInteger(type) || type <= 0) {
    throw operatorError('Lark field type must be a positive integer', 'CHATWOOT_LARK_METADATA_FIELD_INVALID');
  }
  return Object.freeze({
    fieldName: requireText(source.fieldName ?? source.field_name ?? source.name, 'remote field name'),
    type,
    isPrimary: source.isPrimary === true || source.is_primary === true || source.primary === true,
  });
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function requireExact(actual, expected, fieldName) {
  if (actual !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'CHATWOOT_LARK_METADATA_TARGET_INVALID',
      { fieldName, expected, actual: actual ?? null },
    );
  }
  return actual;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
