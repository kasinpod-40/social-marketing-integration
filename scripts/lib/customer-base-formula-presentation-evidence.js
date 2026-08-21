import { normalizeLarkFieldProperty } from '../../packages/shared/src/lark/lark-field-contract.js';

const FORMULA_FIELD_TYPE = 20;
const EXPECTED_FORMULAS = Object.freeze([
  Object.freeze({ tableName: '📣 MKT_Ads_Campaigns', fieldName: 'budget' }),
  Object.freeze({ tableName: '📈 MKT_Ads_Daily', fieldName: 'all_conversion_value' }),
  Object.freeze({ tableName: '📈 MKT_Ads_Daily', fieldName: 'cost_per_conversion' }),
  Object.freeze({ tableName: '📈 MKT_Ads_Daily', fieldName: 'conversion_rate' }),
]);

export async function collectCustomerBaseFormulaPresentationEvidence(sourceClient) {
  requireMethod(sourceClient, 'listTables');
  requireMethod(sourceClient, 'listFields');

  const formulas = [];
  for (const table of await sourceClient.listTables()) {
    const tableName = requireText(table?.name, 'table.name');
    const tableId = requireText(table?.tableId, `${tableName}.tableId`);
    for (const field of await sourceClient.listFields({ tableId })) {
      if (Number(field?.type) !== FORMULA_FIELD_TYPE) continue;
      const fieldName = requireText(field?.fieldName, `${tableName}.Formula.fieldName`);
      const presentation = canonicalFormulaPresentation(field?.property);
      const uiProperty = presentation?.type?.ui_property ?? null;
      formulas.push(deepFreeze({
        tableName,
        fieldName,
        presentation,
        ui: {
          dataType: integerOrNull(presentation?.type?.data_type),
          uiType: optionalText(presentation?.type?.ui_type),
          formatter: optionalText(uiProperty?.formatter),
          currencyCode: optionalText(uiProperty?.currency_code),
          dateFormatter: optionalText(uiProperty?.date_formatter),
        },
      }));
    }
  }

  formulas.sort(compareIdentity);
  assertExactFormulaIdentitySet(formulas);

  return deepFreeze({
    ok: true,
    contractVersion: 'customer_base_formula_presentation_source_evidence_v1',
    mode: 'local-source-read-only',
    formulaCount: formulas.length,
    formulas,
    sourceMutationCount: 0,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

export function canonicalFormulaPresentation(property) {
  const normalized = normalizeLarkFieldProperty(FORMULA_FIELD_TYPE, property);
  const result = normalized ? structuredClone(normalized) : {};
  delete result.formula_expression;
  delete result.table_name;
  return Object.keys(result).length > 0 ? deepSort(result) : null;
}

export const CUSTOMER_BASE_EXPECTED_FORMULA_PRESENTATIONS = EXPECTED_FORMULAS;

function assertExactFormulaIdentitySet(actual) {
  const expectedKeys = EXPECTED_FORMULAS.map(identityKey).sort();
  const actualKeys = actual.map(identityKey).sort();
  if (JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)) return;

  const expectedSet = new Set(expectedKeys);
  const actualSet = new Set(actualKeys);
  throw codedError(
    'CUSTOMER_BASE_FORMULA_PRESENTATION_IDENTITY_MISMATCH',
    'Source Formula identity set must contain exactly the four approved Formula fields',
    {
      missing: expectedKeys.filter((key) => !actualSet.has(key)).map(parseIdentityKey),
      unexpected: actualKeys.filter((key) => !expectedSet.has(key)).map(parseIdentityKey),
    },
  );
}

function identityKey(value) {
  return `${value.tableName}\u0000${value.fieldName}`;
}

function parseIdentityKey(value) {
  const [tableName, fieldName] = value.split('\u0000');
  return { tableName, fieldName };
}

function compareIdentity(left, right) {
  return identityKey(left).localeCompare(identityKey(right));
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSort(value[key])]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
}

function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
