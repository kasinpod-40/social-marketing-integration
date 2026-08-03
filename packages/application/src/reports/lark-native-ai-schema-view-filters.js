import {
  LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS,
} from '../../../config/src/lark-native-ai-schema-preview.js';
import {
  canonicalSchemaValue,
  freezeSchemaValue,
  isEmptyFilter,
  normalizeComparableFilter,
  requireUniqueRawField,
  schemaApplyFailure,
} from './lark-native-ai-schema-apply-model.js';

/**
 * Build the required View plan against current live metadata.
 * Select filters compare using Lark option IDs, while the business contract remains name-based.
 */
export async function buildLarkNativeAiSchemaViewPlans(client, raw) {
  const grouped = groupBy(raw.views, 'viewName');
  const plans = [];

  for (const contract of LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS) {
    const matches = grouped.get(contract.viewName) ?? [];
    if (matches.length > 1) {
      throw schemaApplyFailure(
        'Required View identity is duplicated',
        'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_IDENTITY_INVALID',
        { viewName: contract.viewName, count: matches.length },
      );
    }

    if (matches.length === 0) {
      plans.push(freezeSchemaValue({
        viewName: contract.viewName,
        contract,
        state: 'create',
        view: null,
      }));
      continue;
    }

    const view = matches[0];
    const hydrated = await client.getView({
      tableId: requireText(raw.table?.tableId, 'tableId'),
      viewId: requireText(view.viewId, `${contract.viewName}.viewId`),
    });
    const actual = normalizeLarkNativeAiSchemaComparableViewFilter(
      normalizeComparableFilter(hydrated?.property?.filterInfo),
    );
    const expected = buildLarkNativeAiSchemaViewFilter(contract, raw.fields);

    if (expected === null) {
      if (!isEmptyFilter(actual)) {
        throw buildLarkNativeAiSchemaViewFilterConflict(
          contract.viewName,
          actual,
          normalizeLarkNativeAiSchemaComparableViewFilter(null),
          raw.fields,
        );
      }
      plans.push(freezeSchemaValue({
        viewName: contract.viewName,
        contract,
        state: 'complete',
        view,
      }));
    } else if (canonicalSchemaValue(actual) === canonicalSchemaValue(expected.comparable)) {
      plans.push(freezeSchemaValue({
        viewName: contract.viewName,
        contract,
        state: 'complete',
        view,
      }));
    } else if (isEmptyFilter(actual)) {
      plans.push(freezeSchemaValue({
        viewName: contract.viewName,
        contract,
        state: 'configure',
        view,
      }));
    } else {
      throw buildLarkNativeAiSchemaViewFilterConflict(
        contract.viewName,
        actual,
        expected.comparable,
        raw.fields,
      );
    }
  }

  return freezeSchemaValue(plans);
}

/**
 * Resolve the logical name-based filter contract to the exact OpenAPI values.
 * SingleSelect/MultiSelect conditions must use option IDs returned by live Field metadata.
 */
export function buildLarkNativeAiSchemaViewFilter(contract, rawFields) {
  const logical = contract.logicalFilter;
  if (logical.mode === 'all_rows') return null;

  const conditions = logical.conditions.map((condition) => {
    const field = requireUniqueRawField(rawFields, condition.fieldName);
    const operator = ['equals', 'in'].includes(condition.operator) ? 'is' : null;
    if (!operator) {
      throw schemaApplyFailure(
        'Unsupported View filter operator',
        'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_UNSUPPORTED',
        { operator: condition.operator },
      );
    }

    return {
      fieldId: requireText(field.fieldId, `${condition.fieldName}.fieldId`),
      fieldType: Number(field.type),
      operator,
      values: resolveFilterValues(field, condition.values),
    };
  }).sort(compareFilterConditions);

  const conjunction = logical.mode === 'any_of' ? 'or' : 'and';
  return freezeSchemaValue({
    comparable: normalizeLarkNativeAiSchemaComparableViewFilter({ conjunction, conditions }),
    mutation: {
      conjunction,
      conditions: conditions.map((condition) => ({
        fieldId: condition.fieldId,
        fieldType: condition.fieldType,
        operator: condition.operator,
        value: condition.values,
      })),
    },
  });
}

/**
 * Compare View filters by meaning rather than unstable OpenAPI presentation details.
 * Conjunction is irrelevant for zero/one condition, and values inside one `is` condition
 * are a set whose order may be rewritten by Lark during read-back.
 */
export function normalizeLarkNativeAiSchemaComparableViewFilter(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const conditions = Array.isArray(source.conditions)
    ? source.conditions.map((condition) => ({
      fieldId: condition?.fieldId ?? null,
      fieldType: Number(condition?.fieldType),
      operator: condition?.operator ?? null,
      values: sortFilterValues(condition?.values),
    })).sort(compareFilterConditions)
    : [];
  return freezeSchemaValue({
    conjunction: conditions.length <= 1
      ? 'and'
      : (source.conjunction === 'or' ? 'or' : 'and'),
    conditions,
  });
}

/**
 * Return only safe structural diagnostics for a conflicting View filter.
 * Raw Table/Field/View/option IDs and raw filter values are intentionally excluded.
 */
export function buildLarkNativeAiSchemaViewFilterConflictDetails(actual, expected, rawFields) {
  const fieldsById = new Map(rawFields.map((field) => [
    field?.fieldId,
    field?.fieldName ?? null,
  ]));
  const actualSummary = summarizeComparableFilter(actual, fieldsById);
  const expectedSummary = summarizeComparableFilter(expected, fieldsById);

  return freezeSchemaValue({
    actual: actualSummary,
    expected: expectedSummary,
    comparison: {
      conjunctionMatches: actual.conjunction === expected.conjunction,
      conditionCountMatches: actual.conditions.length === expected.conditions.length,
      conditionCountDelta: actual.conditions.length - expected.conditions.length,
      fieldSetMatches: canonicalSchemaValue(uniqueConditionFieldIds(actual))
        === canonicalSchemaValue(uniqueConditionFieldIds(expected)),
      conditionFieldMultiplicityMatches: canonicalSchemaValue(conditionFieldMultiplicity(actual))
        === canonicalSchemaValue(conditionFieldMultiplicity(expected)),
      fieldTypeSequenceMatches: canonicalSchemaValue(conditionFieldTypes(actual))
        === canonicalSchemaValue(conditionFieldTypes(expected)),
      operatorSequenceMatches: canonicalSchemaValue(conditionOperators(actual))
        === canonicalSchemaValue(conditionOperators(expected)),
      totalValueCountMatches: countFilterValues(actual) === countFilterValues(expected),
      flattenedValueMembershipMatches: canonicalSchemaValue(flattenValuesByConditionIdentity(actual))
        === canonicalSchemaValue(flattenValuesByConditionIdentity(expected)),
      conditionGroupingMatches: canonicalSchemaValue(groupedConditionValueCounts(actual))
        === canonicalSchemaValue(groupedConditionValueCounts(expected)),
    },
  });
}

function buildLarkNativeAiSchemaViewFilterConflict(viewName, actual, expected, rawFields) {
  return schemaApplyFailure(
    'Existing required View filter conflicts with the accepted contract',
    'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT',
    {
      viewName,
      readback: buildLarkNativeAiSchemaViewFilterConflictDetails(actual, expected, rawFields),
    },
  );
}

function summarizeComparableFilter(filter, fieldsById) {
  return freezeSchemaValue({
    conjunction: filter.conjunction,
    conditionCount: filter.conditions.length,
    totalValueCount: countFilterValues(filter),
    conditions: filter.conditions.map((condition) => ({
      fieldName: fieldsById.get(condition.fieldId) ?? 'unknown_field',
      fieldType: normalizeDiagnosticFieldType(condition.fieldType),
      operator: typeof condition.operator === 'string' ? condition.operator : null,
      valueCount: Array.isArray(condition.values) ? condition.values.length : 0,
      scalarTypes: summarizeScalarTypes(condition.values),
    })),
  });
}

function uniqueConditionFieldIds(filter) {
  return [...new Set(filter.conditions.map((condition) => String(condition.fieldId)))].sort();
}

function conditionFieldMultiplicity(filter) {
  const counts = new Map();
  for (const condition of filter.conditions) {
    const key = String(condition.fieldId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function conditionFieldTypes(filter) {
  return filter.conditions.map((condition) => normalizeDiagnosticFieldType(condition.fieldType));
}

function conditionOperators(filter) {
  return filter.conditions.map((condition) => (
    typeof condition.operator === 'string' ? condition.operator : null
  ));
}

function countFilterValues(filter) {
  return filter.conditions.reduce((total, condition) => (
    total + (Array.isArray(condition.values) ? condition.values.length : 0)
  ), 0);
}

function flattenValuesByConditionIdentity(filter) {
  const grouped = new Map();
  for (const condition of filter.conditions) {
    const key = canonicalSchemaValue({
      fieldId: condition.fieldId,
      fieldType: normalizeDiagnosticFieldType(condition.fieldType),
      operator: condition.operator ?? null,
    });
    const values = grouped.get(key) ?? [];
    values.push(...sortFilterValues(condition.values));
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .map(([key, values]) => [key, sortFilterValues(values)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function groupedConditionValueCounts(filter) {
  return filter.conditions.map((condition) => ({
    fieldId: condition.fieldId,
    fieldType: normalizeDiagnosticFieldType(condition.fieldType),
    operator: condition.operator ?? null,
    valueCount: Array.isArray(condition.values) ? condition.values.length : 0,
  })).sort((left, right) => canonicalSchemaValue(left).localeCompare(canonicalSchemaValue(right)));
}

function summarizeScalarTypes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }))].sort();
}

function normalizeDiagnosticFieldType(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function resolveFilterValues(field, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw schemaApplyFailure(
      'View filter values are required',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_VALUES_INVALID',
      { fieldName: field.fieldName ?? null },
    );
  }

  const fieldType = Number(field.type);
  if ([3, 4].includes(fieldType)) {
    return values.map((value) => resolveSelectOptionId(field, value));
  }
  if (fieldType === 7) {
    return values.map((value) => {
      if (typeof value !== 'boolean') {
        throw schemaApplyFailure(
          'Checkbox View filter requires Boolean values',
          'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_VALUE_TYPE_INVALID',
          { fieldName: field.fieldName ?? null, expectedType: 'boolean' },
        );
      }
      return value;
    });
  }
  if (fieldType === 2) {
    return values.map((value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw schemaApplyFailure(
          'Number View filter requires finite values',
          'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_VALUE_TYPE_INVALID',
          { fieldName: field.fieldName ?? null, expectedType: 'number' },
        );
      }
      return String(number);
    });
  }
  if ([1, 5].includes(fieldType)) return values.map((value) => String(value));

  throw schemaApplyFailure(
    'Unsupported Field type in required View filter',
    'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_FIELD_TYPE_UNSUPPORTED',
    { fieldName: field.fieldName ?? null, fieldType },
  );
}

function resolveSelectOptionId(field, logicalValue) {
  const optionName = String(logicalValue);
  const options = field.property?.options;
  if (!Array.isArray(options)) {
    throw schemaApplyFailure(
      'Select option metadata is unavailable for View filter resolution',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_OPTION_METADATA_UNAVAILABLE',
      { fieldName: field.fieldName ?? null },
    );
  }

  const matches = options.filter((option) => option?.name === optionName);
  if (matches.length !== 1) {
    throw schemaApplyFailure(
      'Select option identity is missing or ambiguous for View filter resolution',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_OPTION_ID_INVALID',
      {
        fieldName: field.fieldName ?? null,
        optionName,
        matchCount: matches.length,
      },
    );
  }

  return requireText(matches[0].id, `${field.fieldName}.${optionName}.optionId`);
}

function sortFilterValues(value) {
  if (!Array.isArray(value)) return [];
  return [...value].sort((left, right) => (
    canonicalSchemaValue(left).localeCompare(canonicalSchemaValue(right))
  ));
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const name = requireText(item?.[key], key);
    map.set(name, [...(map.get(name) ?? []), item]);
  }
  return map;
}

function compareFilterConditions(left, right) {
  return String(left.fieldId).localeCompare(String(right.fieldId))
    || String(left.operator).localeCompare(String(right.operator))
    || canonicalSchemaValue(left.values).localeCompare(canonicalSchemaValue(right.values));
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
