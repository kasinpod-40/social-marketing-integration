export const LARK_WINDOW_OPTION_ORDER_VERSION = 'lark_window_option_order_v1';

export const TARGET_FIELD = Object.freeze({
  fieldId: 'fldMlTUP3Z',
  fieldName: '__mkt_legacy_window_days_single_select_v1',
  type: 3,
});

export const REVIEWED_OPTIONS = Object.freeze([
  Object.freeze({ id: 'optGqbHePA', name: '3' }),
  Object.freeze({ id: 'optaGcj0mG', name: '7' }),
  Object.freeze({ id: 'opt38OJLF0', name: '1' }),
  Object.freeze({ id: 'optmG5Z7M0', name: '30' }),
]);

export const DESIRED_OPTION_NAMES = Object.freeze(['1', '3', '7', '30']);
export const CONFIRMATION = 'REORDER_WINDOW_OPTIONS_WITHOUT_RECORD_OR_DASHBOARD_MUTATION';

export function planWindowOptionOrder(field) {
  assertTargetField(field);
  const options = normalizeOptions(field?.property?.options);
  assertReviewedOptionIdentity(options);

  const currentOrder = options.map((option) => option.name);
  const desiredOptions = DESIRED_OPTION_NAMES.map((name) => {
    const option = options.find((item) => item.name === name);
    if (!option) throw orderError('Reviewed option is missing', 'LARK_WINDOW_OPTION_MISSING', { name });
    return option;
  });

  const desiredOrder = desiredOptions.map((option) => option.name);
  const alreadyConverged = currentOrder.join('|') === desiredOrder.join('|');

  return deepFreeze({
    fieldId: TARGET_FIELD.fieldId,
    fieldName: TARGET_FIELD.fieldName,
    currentOrder,
    desiredOrder,
    currentOptionIds: options.map((option) => option.id),
    desiredOptionIds: desiredOptions.map((option) => option.id),
    optionIdentityPreserved: sameSet(
      options.map((option) => option.id),
      desiredOptions.map((option) => option.id),
    ),
    pendingFieldMetadataUpdateCount: alreadyConverged ? 0 : 1,
    alreadyConverged,
    desiredField: Object.freeze({
      fieldName: field.fieldName,
      type: field.type,
      property: Object.freeze({
        ...(field.property ?? {}),
        options: desiredOptions.map((option) => structuredClone(option)),
      }),
    }),
  });
}

export function assertConfirmation(value) {
  if (value !== CONFIRMATION) {
    throw orderError('Explicit confirmation is required', 'LARK_WINDOW_OPTION_ORDER_CONFIRMATION_REQUIRED', {
      envName: 'CONFIRM_LARK_WINDOW_OPTION_ORDER',
      requiredValue: CONFIRMATION,
    });
  }
}

function assertTargetField(field) {
  if (field?.fieldId !== TARGET_FIELD.fieldId
    || field?.fieldName !== TARGET_FIELD.fieldName
    || Number(field?.type) !== TARGET_FIELD.type) {
    throw orderError('Target Field identity changed', 'LARK_WINDOW_OPTION_FIELD_IDENTITY_INVALID', {
      expected: TARGET_FIELD,
      actual: {
        fieldId: field?.fieldId ?? null,
        fieldName: field?.fieldName ?? null,
        type: field?.type ?? null,
      },
    });
  }
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) {
    throw orderError('SingleSelect options are missing', 'LARK_WINDOW_OPTION_PROPERTY_INVALID');
  }
  return value.map((option) => {
    const id = typeof option?.id === 'string' ? option.id.trim() : '';
    const name = typeof option?.name === 'string' ? option.name.trim() : '';
    if (!id || !name) {
      throw orderError('SingleSelect option identity is invalid', 'LARK_WINDOW_OPTION_IDENTITY_INVALID');
    }
    return Object.freeze({ ...structuredClone(option), id, name });
  });
}

function assertReviewedOptionIdentity(options) {
  if (options.length !== REVIEWED_OPTIONS.length) {
    throw orderError('Unexpected option count', 'LARK_WINDOW_OPTION_SET_DRIFT', {
      expectedCount: REVIEWED_OPTIONS.length,
      actualCount: options.length,
    });
  }
  for (const reviewed of REVIEWED_OPTIONS) {
    const match = options.find((option) => option.id === reviewed.id);
    if (!match || match.name !== reviewed.name) {
      throw orderError('Reviewed option ID/name mapping changed', 'LARK_WINDOW_OPTION_SET_DRIFT', {
        reviewed,
        observed: match ?? null,
      });
    }
  }
}

function sameSet(left, right) {
  return left.length === right.length
    && [...left].sort().join('|') === [...right].sort().join('|');
}

function orderError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWindowOptionOrderError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
