import { applyLarkBaseConsolidation } from './consolidate-lark-base.js';
import { applyLarkBaseDocumentedViewParity } from './apply-lark-base-documented-view-parity.js';
import { applyLarkBaseAdvancedPermissionParity } from './apply-lark-base-advanced-permission-parity.js';
import { planLarkBaseAdvancedPermissionParity } from './plan-lark-base-advanced-permission-parity.js';
import { prepareLarkBaseResumableTarget } from './prepare-lark-base-resumable-target.js';
import { protectCustomerLarkBaseResources } from './protect-customer-lark-base-resources.js';
import { protectCustomerLarkTarget } from './protect-customer-lark-target.js';
import { verifyLarkBaseAdvancedPermissionParity } from './verify-lark-base-advanced-permission-parity.js';
import { verifyLarkBaseCloneCanonicalParity } from './verify-lark-base-clone-canonical-parity.js';

export const CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION = 'CUSTOMER_BASE_CONTROLLED_APPLY_V1';
export const CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_VERSION = 'customer_base_controlled_apply_checkpoint_v1';

const DEFAULT_OPERATIONS = Object.freeze({
  applyLarkBaseConsolidation,
  applyLarkBaseDocumentedViewParity,
  applyLarkBaseAdvancedPermissionParity,
  planLarkBaseAdvancedPermissionParity,
  prepareLarkBaseResumableTarget,
  protectCustomerLarkBaseResources,
  protectCustomerLarkTarget,
  verifyLarkBaseAdvancedPermissionParity,
  verifyLarkBaseCloneCanonicalParity,
});

/**
 * Captures the immutable customer baseline before the first controlled write.
 * The checkpoint contains only Target resource identities needed for write fences;
 * it contains no credentials, record values, or Source internal identifiers.
 */
export async function prepareCustomerBaseControlledApplyCheckpoint(input) {
  const targetClient = requireObjectLike(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeNames(input?.expectedTableNames, 'expectedTableNames');
  const requiredProtectedTableNames = normalizeNames(input?.requiredProtectedTableNames, 'requiredProtectedTableNames');
  const protectedExternalTableNames = normalizeNames(input?.protectedExternalTableNames, 'protectedExternalTableNames');
  const sourceAuthoritySha256 = requireSha256(input?.sourceAuthoritySha256, 'sourceAuthoritySha256');
  const operations = resolveOperations(input?.operations);

  const tableProtection = await operations.protectCustomerLarkTarget({
    client: targetClient,
    requiredProtectedTableNames,
    protectedExternalTableNames,
  });
  const resourceProtection = await operations.protectCustomerLarkBaseResources({ client: targetClient });
  const protectedTables = requireArray(tableProtection?.policy?.existingTablesProtected, 'existingTablesProtected')
    .map((table) => Object.freeze({
      name: requireText(table?.name, 'protected table name'),
      tableId: requireText(table?.tableId, 'protected tableId'),
    }));
  const expectedSet = new Set(expectedTableNames);
  const collisions = protectedTables.filter((table) => expectedSet.has(table.name));
  if (collisions.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_BASELINE_COLLISION',
      'Clone-scope table already existed before controlled Apply; checkpoint creation stopped',
      { collisions },
    );
  }
  const protectedRoles = requireArray(
    resourceProtection?.policy?.existingAdvancedPermissionRolesProtected ?? [],
    'existingAdvancedPermissionRolesProtected',
  ).map((role) => Object.freeze({
    roleName: requireText(role?.roleName, 'protected roleName'),
    roleId: requireText(role?.roleId, 'protected roleId'),
  }));

  return deepFreeze({
    ok: true,
    contractVersion: CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_VERSION,
    mode: 'read-only-baseline-checkpoint',
    sourceAuthoritySha256,
    expectedTableNames,
    requiredProtectedTableNames,
    protectedExternalTableNames,
    protectedTables,
    protectedRoles,
    manualOwnershipFrozen: true,
    remoteMutationCount: 0,
  });
}

/**
 * Executes the only automated mutation sequence for Customer Base Full Parity.
 *
 * A caller must provide the exact read-only baseline checkpoint plus an explicit
 * confirmation token. Every retry replays the same phases: the resumable target
 * adapter claims exact partial clone tables, hierarchy writes are idempotent,
 * Advanced Permission creation reuses exact migration-owned roles, and canonical
 * verification remains GET-only. Manual View/Dashboard/Workflow parity is never
 * guessed or written by this function.
 */
export async function applyCustomerBaseControlledParity(input) {
  if (input?.confirmation !== CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION_REQUIRED',
      'Controlled customer Apply requires the exact explicit confirmation token',
      { expected: CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION },
    );
  }
  const sourceClient = requireObjectLike(input?.sourceClient, 'sourceClient');
  const targetClient = requireObjectLike(input?.targetClient, 'targetClient');
  const permissionSemantics = requireObject(input?.permissionSemantics, 'permissionSemantics');
  const checkpoint = validateCheckpoint(input?.checkpoint);
  const expectedTableNames = normalizeNames(input?.expectedTableNames, 'expectedTableNames');
  const sourceAuthoritySha256 = requireSha256(input?.sourceAuthoritySha256, 'sourceAuthoritySha256');
  const operations = resolveOperations(input?.operations);

  if (checkpoint.sourceAuthoritySha256 !== sourceAuthoritySha256) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_MISMATCH', 'Checkpoint Source authority does not match this Apply', {
      checkpointSha256: checkpoint.sourceAuthoritySha256,
      requestedSha256: sourceAuthoritySha256,
    });
  }
  if (JSON.stringify(checkpoint.expectedTableNames) !== JSON.stringify(expectedTableNames)) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_SCOPE_MISMATCH', 'Checkpoint clone-scope Table names do not match this Apply');
  }
  if (checkpoint.manualOwnershipFrozen !== true) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_OWNERSHIP_NOT_FROZEN', 'Automatic/manual parity ownership must be frozen before mutation');
  }

  const resumable = await operations.prepareLarkBaseResumableTarget({
    targetClient,
    expectedTableNames,
    protectedTables: checkpoint.protectedTables,
  });

  const consolidation = await operations.applyLarkBaseConsolidation({
    sourceClient,
    targetClient: resumable.client,
    expectedTableNames,
    expectedSourceTableCount: expectedTableNames.length,
    onProgress: input?.onProgress,
  });
  assertPhaseOk(consolidation, 'consolidation');

  const documentedViews = await operations.applyLarkBaseDocumentedViewParity({
    sourceClient,
    targetClient: resumable.client,
    expectedTableNames,
  });
  assertPhaseOk(documentedViews, 'documented-view-parity');

  const targetTables = await resumable.client.listTables();
  const permissionPlan = operations.planLarkBaseAdvancedPermissionParity({
    permissionSemantics,
    targetTables,
  });
  if (permissionPlan?.readyToWrite !== true || permissionPlan?.ok !== true) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_PERMISSION_PLAN_BLOCKED', 'Advanced Permission plan is not ready after consolidation', {
      blockers: permissionPlan?.blockers ?? [],
    });
  }

  const permissionApply = await operations.applyLarkBaseAdvancedPermissionParity({
    plan: permissionPlan,
    targetClient: resumable.client,
    protectedRoleNames: checkpoint.protectedRoles.map((role) => role.roleName),
  });
  assertPhaseOk(permissionApply, 'advanced-permission-apply');

  const permissionVerification = await operations.verifyLarkBaseAdvancedPermissionParity({
    plan: permissionPlan,
    targetClient: resumable.client,
  });
  assertPhaseOk(permissionVerification, 'advanced-permission-verify');

  const canonicalVerification = await operations.verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient: resumable.client,
    expectedTableNames,
  });
  assertPhaseOk(canonicalVerification, 'canonical-clone-verify');

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_controlled_apply_v1',
    mode: 'controlled-resumable-apply',
    sourceAuthoritySha256,
    checkpointContractVersion: checkpoint.contractVersion,
    phases: {
      consolidation,
      documentedViews,
      permissionPlan,
      permissionApply,
      permissionVerification,
      canonicalVerification,
    },
    manualParityRequired: Object.freeze([
      'view-field-order-sort-group-width-row-height-frozen-columns',
      'dashboard-ui-source-reference',
      'workflow-ui-source-reference',
      'target-folder-placement',
    ]),
    automaticApplyComplete: true,
    finalFullParityComplete: false,
  });
}

function validateCheckpoint(value) {
  const checkpoint = requireObject(value, 'checkpoint');
  if (checkpoint.contractVersion !== CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_VERSION) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_VERSION_MISMATCH', 'Controlled Apply checkpoint contract version is unsupported', {
      actual: checkpoint.contractVersion ?? null,
      expected: CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_VERSION,
    });
  }
  return deepFreeze({
    contractVersion: checkpoint.contractVersion,
    sourceAuthoritySha256: requireSha256(checkpoint.sourceAuthoritySha256, 'checkpoint.sourceAuthoritySha256'),
    expectedTableNames: normalizeNames(checkpoint.expectedTableNames, 'checkpoint.expectedTableNames'),
    requiredProtectedTableNames: normalizeNames(checkpoint.requiredProtectedTableNames, 'checkpoint.requiredProtectedTableNames'),
    protectedExternalTableNames: normalizeNames(checkpoint.protectedExternalTableNames, 'checkpoint.protectedExternalTableNames'),
    protectedTables: requireArray(checkpoint.protectedTables, 'checkpoint.protectedTables').map((table) => ({
      name: requireText(table?.name, 'checkpoint protected table name'),
      tableId: requireText(table?.tableId, 'checkpoint protected tableId'),
    })),
    protectedRoles: requireArray(checkpoint.protectedRoles ?? [], 'checkpoint.protectedRoles').map((role) => ({
      roleName: requireText(role?.roleName, 'checkpoint protected roleName'),
      roleId: requireText(role?.roleId, 'checkpoint protected roleId'),
    })),
    manualOwnershipFrozen: checkpoint.manualOwnershipFrozen === true,
  });
}

function resolveOperations(value) {
  if (value === undefined || value === null) return DEFAULT_OPERATIONS;
  const overrides = requireObject(value, 'operations');
  return Object.freeze({ ...DEFAULT_OPERATIONS, ...overrides });
}

function assertPhaseOk(value, phase) {
  if (value?.ok === true) return;
  throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_PHASE_FAILED', `Controlled Apply phase failed: ${phase}`, { phase, result: value ?? null });
}

function requireSha256(value, name) {
  const text = requireText(value, name);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError(`${name} must be a lowercase SHA-256 hex string`);
  return text;
}

function normalizeNames(value, name) {
  const names = requireArray(value, name).map((item) => requireText(item, name));
  if (names.length === 0 || new Set(names).size !== names.length) throw new TypeError(`${name} must be a non-empty unique array`);
  return Object.freeze(names);
}

function requireObjectLike(value, name) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new TypeError(`${name} is required`);
  return value;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
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
