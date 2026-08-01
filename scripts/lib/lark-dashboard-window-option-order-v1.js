export const LARK_DASHBOARD_WINDOW_OPTION_ORDER_VERSION =
  'lark_dashboard_window_option_order_v1';

export const LARK_DASHBOARD_WINDOW_OPTION_ORDER_CONFIRMATION =
  'REORDER_WINDOW_OPTIONS_PRESERVE_IDS_1_3_7_30';

export const LARK_DASHBOARD_WINDOW_FIELD = Object.freeze({
  tableName: '📊 MKT_Report_Metric_Values',
  fieldId: 'fldMlTUP3Z',
  fieldName: '__mkt_legacy_window_days_single_select_v1',
  type: 3,
  uiType: 'SingleSelect',
});

export const LARK_DASHBOARD_WINDOW_OPTIONS = deepFreeze([
  { id: 'opt38OJLF0', name: '1', color: 2 },
  { id: 'optGqbHePA', name: '3', color: 0 },
  { id: 'optaGcj0mG', name: '7', color: 1 },
  { id: 'optmG5Z7M0', name: '30', color: 3 },
]);

export const LARK_DASHBOARD_WINDOW_PRE_APPLY_ORDER = Object.freeze(['3', '7', '1', '30']);
export const LARK_DASHBOARD_WINDOW_DESIRED_ORDER = Object.freeze(['1', '3', '7', '30']);

const EXPECTED_BY_ID = new Map(
  LARK_DASHBOARD_WINDOW_OPTIONS.map((option) => [option.id, option]),
);
const EXPECTED_BY_NAME = new Map(
  LARK_DASHBOARD_WINDOW_OPTIONS.map((option) => [option.name, option]),
);

export function assertLarkDashboardWindowOptionOrderConfirmation(value) {
  if (value !== LARK_DASHBOARD_WINDOW_OPTION_ORDER_CONFIRMATION) {
    throw contractError(
      'Explicit confirmation of the bounded Window SingleSelect option reorder is required',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_CONFIRMATION_REQUIRED',
      {
        envName: 'CONFIRM_LARK_DASHBOARD_WINDOW_OPTION_ORDER',
        requiredValue: LARK_DASHBOARD_WINDOW_OPTION_ORDER_CONFIRMATION,
        recordMutationCount: 0,
        dashboardPatchCount: 0,
      },
    );
  }
  return true;
}

export function planLarkDashboardWindowOptionOrder(field) {
  const normalized = normalizeTargetField(field);
  const options = normalized.property.options.map(normalizeOption);
  assertExactOptionSet(options);

  const currentOrder = Object.freeze(options.map((option) => option.name));
  const currentOptionIds = Object.freeze(options.map((option) => option.id));
  const desiredOptions = Object.freeze(
    LARK_DASHBOARD_WINDOW_DESIRED_ORDER.map((name) => {
      const current = options.find((option) => option.name === name);
      return Object.freeze({ ...current });
    }),
  );
  const desiredOptionIds = Object.freeze(desiredOptions.map((option) => option.id));

  const isPreApply = arraysEqual(currentOrder, LARK_DASHBOARD_WINDOW_PRE_APPLY_ORDER);
  const isConverged = arraysEqual(currentOrder, LARK_DASHBOARD_WINDOW_DESIRED_ORDER);
  if (!isPreApply && !isConverged) {
    throw contractError(
      'Window SingleSelect option order is neither the reviewed pre-apply state nor the converged state',
      'LARK_DASHBOARD_WINDOW_OPTION_ORDER_STATE_DRIFT',
      {
        currentOrder,
        expectedPreApplyOrder: LARK_DASHBOARD_WINDOW_PRE_APPLY_ORDER,
        expectedConvergedOrder: LARK_DASHBOARD_WINDOW_DESIRED_ORDER,
      },
    );
  }

  return deepFreeze({
    field: normalized,
    currentOrder,
    currentOptionIds,
    desiredOrder: LARK_DASHBOARD_WINDOW_DESIRED_ORDER,
    desiredOptionIds,
    desiredOptions,
    reorderRequired: isPreApply,
    converged: isConverged,
  });
}

export function buildLarkDashboardWindowFieldMutation(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('Window option order mutation requires plan');
  }
  return deepFreeze({
    fieldName: plan.field.fieldName,
    type: plan.field.type,
    uiType: plan.field.uiType,
    description: plan.field.description,
    property: {
      ...structuredClone(plan.field.property),
      options: plan.desiredOptions.map((option) => ({ ...option })),
    },
  });
}

export function normalizeTargetField(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw new TypeError('Window option order requires target field');
  }
  const normalized = {
    fieldId: requireText(field.fieldId ?? field.field_id, 'fieldId'),
    fieldName: requireText(field.fieldName ?? field.field_name ?? field.name, 'fieldName'),
    type: Number(field.type),
    uiType: requireText(field.uiType ?? field.ui_type, 'uiType'),
    description: typeof field.description === 'string' ? field.description.trim() : '',
    property: field.property && typeof field.property === 'object' && !Array.isArray(field.property)
      ? structuredClone(field.property)
      : {},
  };
  if (normalized.fieldId !== LARK_DASHBOARD_WINDOW_FIELD.fieldId
    || normalized.fieldName !== LARK_DASHBOARD_WINDOW_FIELD.fieldName
    || normalized.type !== LARK_DASHBOARD_WINDOW_FIELD.type
    || normalized.uiType !== LARK_DASHBOARD_WINDOW_FIELD.uiType) {
    throw contractError(
      'Window SingleSelect physical Field identity changed from the reviewed contract',
      'LARK_DASHBOARD_WINDOW_FIELD_IDENTITY_INVALID',
      {
        expected: LARK_DASHBOARD_WINDOW_FIELD,
        actual: {
          fieldId: normalized.fieldId,
          fieldName: normalized.fieldName,
          type: normalized.type,
          uiType: normalized.uiType,
        },
      },
    );
  }
  if (!Array.isArray(normalized.property.options)) {
    throw contractError(
      'Window SingleSelect options are missing',
      'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
    );
  }
  return deepFreeze(normalized);
}

function assertExactOptionSet(options) {
  if (options.length !== LARK_DASHBOARD_WINDOW_OPTIONS.length) {
    throw contractError(
      'Window SingleSelect must contain exactly four reviewed options',
      'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
      { observedOptionCount: options.length },
    );
  }
  const ids = options.map((option) => option.id);
  const names = options.map((option) => option.name);
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
    throw contractError(
      'Window SingleSelect contains duplicate option IDs or names',
      'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
      { ids, names },
    );
  }

  for (const option of options) {
    const expectedById = EXPECTED_BY_ID.get(option.id);
    const expectedByName = EXPECTED_BY_NAME.get(option.name);
    if (!expectedById || !expectedByName || expectedById.id !== expectedByName.id
      || option.color !== expectedById.color) {
      throw contractError(
        'Window SingleSelect option ID/name/color changed from the reviewed contract',
        'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
        { option },
      );
    }
  }
}

function normalizeOption(option) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    throw contractError(
      'Window SingleSelect contains an invalid option',
      'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
    );
  }
  const color = Number(option.color);
  if (!Number.isInteger(color) || color < 0) {
    throw contractError(
      'Window SingleSelect option color is invalid',
      'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
      { option },
    );
  }
  return Object.freeze({
    id: requireText(option.id, 'option.id'),
    name: requireText(option.name, 'option.name'),
    color,
  });
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Window option order requires ${fieldName}`);
  }
  return value.trim();
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardWindowOptionOrderError';
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
