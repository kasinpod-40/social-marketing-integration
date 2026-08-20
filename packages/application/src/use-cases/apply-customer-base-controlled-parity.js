import { normalizeLarkFieldProperty } from '../../../shared/src/lark/lark-field-contract.js';
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

const FORMULA_FIELD_TYPE = 20;

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
 * verification remains GET-only. Manual Formula presentation/View/Dashboard/Workflow
 * parity is never guessed or written by this function.
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
  const consolidationTarget = withFormulaV3ParityRecovery(resumable.client);

  const consolidation = await operations.applyLarkBaseConsolidation({
    sourceClient,
    targetClient: consolidationTarget,
    expectedTableNames,
    expectedSourceTableCount: expectedTableNames.length,
    onProgress: input?.onProgress,
  });
  assertPhaseOk(consolidation, 'consolidation');

  const documentedViews = await operations.applyLarkBaseDocumentedViewParity({
    sourceClient,
    targetClient: consolidationTarget,
    expectedTableNames,
  });
  assertPhaseOk(documentedViews, 'documented-view-parity');

  const targetTables = await consolidationTarget.listTables();
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
    targetClient: consolidationTarget,
    protectedRoleNames: checkpoint.protectedRoles.map((role) => role.roleName),
  });
  assertPhaseOk(permissionApply, 'advanced-permission-apply');

  const permissionVerification = await operations.verifyLarkBaseAdvancedPermissionParity({
    plan: permissionPlan,
    targetClient: consolidationTarget,
  });
  assertPhaseOk(permissionVerification, 'advanced-permission-verify');

  const canonicalVerification = await operations.verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient: consolidationTarget,
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
      'formula-result-presentation-ui',
      'view-field-order-sort-group-width-row-height-frozen-columns',
      'dashboard-ui-source-reference',
      'workflow-ui-source-reference',
      'target-folder-placement',
    ]),
    automaticApplyComplete: true,
    finalFullParityComplete: false,
  });
}

/**
 * Bridges the legacy export model to the documented Base v3 Formula API without
 * weakening the existing checkpoint fence. Base v3 owns Formula definition
 * (name/expression/description). Formula result presentation exposed by the legacy
 * export is retained for manual parity verification because current Base v3 field
 * writes do not expose Formula style/result metadata and Bitable v1 rejects those
 * Formula PUTs. All automatic Formula writes therefore stop at v3 definition parity.
 */
function withFormulaV3ParityRecovery(client) {
  const verifiedLegacyExpressionByTableAndName = new Map();

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'listFields') {
        return async (request) => {
          const tableId = requireText(request?.tableId, 'listFields.tableId');
          const fields = await target.listFields(request);
          return fields.map((field) => {
            const fieldName = typeof field?.fieldName === 'string' ? field.fieldName.trim() : '';
            const expectedExpression = verifiedLegacyExpressionByTableAndName.get(`${tableId}:${fieldName}`);
            if (!expectedExpression || Number(field?.type) !== FORMULA_FIELD_TYPE) return field;
            const copy = structuredClone(field);
            copy.property = copy.property && typeof copy.property === 'object' && !Array.isArray(copy.property)
              ? structuredClone(copy.property)
              : {};
            copy.property.formula_expression = expectedExpression;
            return copy;
          });
        };
      }

      if (property === 'createField') {
        return async (request) => {
          const field = requireObject(request?.field, 'createField.field');
          if (Number(field?.type) !== FORMULA_FIELD_TYPE) return target.createField(request);
          const tableId = requireText(request?.tableId, 'createField.tableId');
          const fieldName = requireText(field?.fieldName, 'createField.fieldName');
          const requested = await canonicalFormulaTargetMutation(target, field);
          const fields = await target.listFields({ tableId });
          let current = fields.find((item) => item?.fieldName === fieldName) ?? null;

          if (current) {
            const fieldId = requireText(current?.fieldId, `existing Formula fieldId ${fieldName}`);
            const currentExpression = optionalText(current?.property?.formula_expression);
            if (!currentExpression) {
              current = await updateFormulaDefinitionV3(target, {
                tableId,
                fieldId,
                fieldName,
                requested,
              });
            } else {
              await verifyFormulaDefinitionV3(target, {
                tableId,
                fieldId,
                fieldName,
                requested,
              });
            }
          } else {
            current = await createFormulaDefinitionV3(target, {
              tableId,
              fieldName,
              requested,
            });
          }

          const verified = await verifyFormulaAutomaticDefinitionOnly(target, {
            tableId,
            fieldName,
            current,
            requested,
          });
          verifiedLegacyExpressionByTableAndName.set(
            `${tableId}:${fieldName}`,
            requireText(requested?.property?.formula_expression, `Formula expression ${fieldName}`),
          );
          return verified;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function canonicalFormulaTargetMutation(target, field) {
  if (typeof target.getBaseFormulaType !== 'function') {
    throw codedError(
      'CUSTOMER_BASE_FORMULA_CAPABILITY_UNAVAILABLE',
      'Target client must expose Base formula_type metadata for Formula parity',
    );
  }
  const formulaType = Number(await target.getBaseFormulaType());
  if (!Number.isInteger(formulaType)) {
    throw codedError('CUSTOMER_BASE_FORMULA_CAPABILITY_INVALID', 'Target Base formula_type must be an integer');
  }
  const requested = structuredClone(field);
  const property = normalizeLarkFieldProperty(FORMULA_FIELD_TYPE, requested?.property);
  requested.property = property ? structuredClone(property) : null;
  if (!optionalText(requested?.property?.formula_expression)) {
    throw codedError('CUSTOMER_BASE_FORMULA_EXPRESSION_REQUIRED', `Formula Source field has no expression: ${requireText(requested?.fieldName, 'Formula fieldName')}`);
  }
  if (formulaType === 2) {
    if (!requested?.property?.type || typeof requested.property.type !== 'object') {
      throw codedError(
        'CUSTOMER_BASE_FORMULA_PROPERTY_TYPE_REQUIRED',
        `Target Base formula_type=2 requires property.type: ${requireText(requested?.fieldName, 'Formula fieldName')}`,
      );
    }
  } else if (requested?.property) {
    delete requested.property.type;
  }
  return requested;
}

async function createFormulaDefinitionV3(target, input) {
  if (typeof target.createFormulaFieldV3 !== 'function') {
    throw codedError('CUSTOMER_BASE_FORMULA_V3_CREATE_UNAVAILABLE', 'Target client has no Base v3 Formula create capability');
  }
  try {
    return await target.createFormulaFieldV3({ tableId: input.tableId, field: input.requested });
  } catch (error) {
    throw formulaRemoteError(
      'CUSTOMER_BASE_FORMULA_V3_CREATE_REJECTED',
      `Lark rejected Base v3 Formula create: ${input.fieldName}`,
      error,
      { tableId: input.tableId, fieldName: input.fieldName },
    );
  }
}

async function updateFormulaDefinitionV3(target, input) {
  if (typeof target.updateFormulaFieldV3 !== 'function') {
    throw codedError('CUSTOMER_BASE_FORMULA_V3_UPDATE_UNAVAILABLE', 'Target client has no Base v3 Formula update capability');
  }
  try {
    return await target.updateFormulaFieldV3({
      tableId: input.tableId,
      fieldId: input.fieldId,
      field: input.requested,
    });
  } catch (error) {
    throw formulaRemoteError(
      'CUSTOMER_BASE_FORMULA_V3_UPDATE_REJECTED',
      `Lark rejected Base v3 Formula update: ${input.fieldName}`,
      error,
      { tableId: input.tableId, fieldId: input.fieldId, fieldName: input.fieldName },
    );
  }
}

async function verifyFormulaDefinitionV3(target, input) {
  if (typeof target.verifyFormulaFieldV3Definition !== 'function') {
    throw codedError('CUSTOMER_BASE_FORMULA_V3_VERIFY_UNAVAILABLE', 'Target client has no Base v3 Formula readback capability');
  }
  try {
    return await target.verifyFormulaFieldV3Definition({
      tableId: input.tableId,
      fieldId: input.fieldId,
      field: input.requested,
    });
  } catch (error) {
    throw formulaRemoteError(
      'CUSTOMER_BASE_FORMULA_V3_DEFINITION_MISMATCH',
      `Base v3 Formula definition differs from Source: ${input.fieldName}`,
      error,
      {
        tableId: input.tableId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        differencePaths: Array.isArray(error?.details?.differencePaths)
          ? error.details.differencePaths.slice(0, 16)
          : [],
      },
    );
  }
}

async function verifyFormulaAutomaticDefinitionOnly(target, input) {
  const fieldId = requireText(input?.current?.fieldId, `Formula fieldId ${input.fieldName}`);
  await verifyFormulaDefinitionV3(target, {
    tableId: input.tableId,
    fieldId,
    fieldName: input.fieldName,
    requested: input.requested,
  });
  return structuredClone(input.current);
}

function formulaRemoteError(code, message, error, details = {}) {
  const causeDetails = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details
    : {};
  return codedError(code, message, {
    ...details,
    causeCode: optionalText(error?.code),
    status: finiteNumberOrNull(causeDetails.status),
    larkCode: finiteNumberOrNull(causeDetails.larkCode),
    retryAfter: causeDetails.retryAfter ?? null,
  });
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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
