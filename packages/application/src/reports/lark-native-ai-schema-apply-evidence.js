import { LARK_NATIVE_AI_TARGET_TABLE, buildLarkNativeAiSchemaPreview } from '../../../config/src/lark-native-ai-schema-preview.js';
import {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_EVIDENCE_CONTRACT,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_REMOTE_COUNTS,
  LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_COUNTS,
  LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TABLE_COUNT,
  LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TARGET_FIELD_COUNT,
  LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TARGET_VIEW_COUNT,
} from '../../../config/src/lark-native-ai-schema-apply-contract.js';

export async function calculateInventorySha256(inventory) {
  const source = object(inventory, 'inventory');
  const core = {
    baseName: source.baseName ?? null,
    baseRevision: source.baseRevision ?? null,
    tables: array(source.tables, 'inventory.tables'),
  };
  if (!globalThis.crypto?.subtle) throw failure(
    'Web Crypto SHA-256 is required',
    'LARK_NATIVE_AI_SCHEMA_APPLY_CRYPTO_UNAVAILABLE',
  );
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(core)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function assertAcceptedLarkNativeAiSchemaApplyEvidence(value) {
  const evidence = object(value, 'retainedEvidence');
  equal(evidence.contractVersion, LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_EVIDENCE_CONTRACT,
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_CONTRACT_INVALID');
  if (evidence.ok !== true) throw failure(
    'Retained Lark Native AI inventory did not pass',
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_NOT_READY',
  );
  const repository = object(evidence.repository, 'retainedEvidence.repository');
  if (repository.branch !== 'main' || repository.clean !== true
    || repository.head !== LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD
    || repository.reviewedHead !== LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD) {
    throw failure(
      'Retained inventory repository authority is invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_REPOSITORY_INVALID',
    );
  }
  equal(evidence.baseIdentityHash, LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
    'LARK_NATIVE_AI_SCHEMA_APPLY_BASE_IDENTITY_INVALID');

  const inventory = object(evidence.inventory, 'retainedEvidence.inventory');
  equal(inventory.sourceSha256, LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
    'LARK_NATIVE_AI_SCHEMA_APPLY_INVENTORY_SHA_INVALID');
  equal(await calculateInventorySha256(inventory), inventory.sourceSha256,
    'LARK_NATIVE_AI_SCHEMA_APPLY_INVENTORY_HASH_MISMATCH');
  const tables = array(inventory.tables, 'retainedEvidence.inventory.tables');
  if (tables.length !== LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TABLE_COUNT) throw failure(
    'Retained inventory table count is invalid',
    'LARK_NATIVE_AI_SCHEMA_APPLY_TABLE_COUNT_INVALID',
    { observed: tables.length, expected: LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TABLE_COUNT },
  );
  const target = uniqueTarget(tables);
  if (array(target.fields, 'target.fields').length !== LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TARGET_FIELD_COUNT
    || array(target.views, 'target.views').length !== LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_TARGET_VIEW_COUNT) {
    throw failure(
      'Retained target table shape is invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_TARGET_SHAPE_INVALID',
    );
  }

  const preview = buildLarkNativeAiSchemaPreview({ inventory });
  assertAcceptedPreview(preview);
  const retainedPreview = object(evidence.preview, 'retainedEvidence.preview');
  assertAcceptedPreview(retainedPreview);
  if (canonical(preview.actions) !== canonical(retainedPreview.actions)) throw failure(
    'Retained Preview actions do not match the accepted inventory',
    'LARK_NATIVE_AI_SCHEMA_APPLY_PREVIEW_ACTIONS_INVALID',
  );

  const remote = object(evidence.remote, 'retainedEvidence.remote');
  for (const [field, expected] of Object.entries(LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_REMOTE_COUNTS)) {
    if (Number(remote[field]) !== expected) throw failure(
      'Retained Remote inventory counters are invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REMOTE_EVIDENCE_INVALID',
      { field, observed: Number(remote[field]), expected },
    );
  }
  const safety = object(evidence.safety, 'retainedEvidence.safety');
  for (const field of [
    'persistedRemoteIds', 'recordReadCount', 'remoteLarkWriteCount',
    'automationCreateCount', 'notificationSendCount', 'aiCallCount',
    'remoteD1QueueWorkerProviderCount',
  ]) {
    if (Number(safety[field]) !== 0) throw failure(
      'Retained inventory safety counters are invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_RETAINED_SAFETY_INVALID',
      { field },
    );
  }
  if (safety.applyAuthorized !== false || safety.production !== 'BLOCKED') throw failure(
    'Retained inventory safety boundary is invalid',
    'LARK_NATIVE_AI_SCHEMA_APPLY_RETAINED_SAFETY_INVALID',
  );
  return freeze({
    inventory,
    preview,
    retainedHead: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
    inventorySha256: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
    baseIdentityHash: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  });
}

function assertAcceptedPreview(preview) {
  const source = object(preview, 'preview');
  if (source.ok !== true || source.status !== 'ready_to_apply'
    || source.applyAuthorized !== false || array(source.blockers, 'preview.blockers').length !== 0
    || canonical(source.counts) !== canonical(LARK_NATIVE_AI_SCHEMA_APPLY_EXPECTED_COUNTS)) {
    throw failure(
      'Retained Preview is not the exact accepted additive plan',
      'LARK_NATIVE_AI_SCHEMA_APPLY_PREVIEW_INVALID',
    );
  }
}

function uniqueTarget(tables) {
  const matches = tables.filter(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);
  if (matches.length !== 1) throw failure(
    'Target AI table identity is invalid',
    'LARK_NATIVE_AI_SCHEMA_APPLY_TARGET_TABLE_INVALID',
    { count: matches.length },
  );
  return matches[0];
}
function equal(actual, expected, code) { if (actual !== expected) throw failure('Accepted evidence identity mismatch', code); }
function object(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`); return value; }
function array(value, field) { if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`); return value; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function failure(message, code, details = {}) { const error = new Error(message); error.name = 'LarkNativeAiSchemaApplyError'; error.code = code; error.details = Object.freeze({ ...details }); return error; }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const nested of Object.values(value)) freeze(nested); return value; }
