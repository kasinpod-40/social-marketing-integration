import { verifyLarkBaseCloneCanonicalParity as verifyCore } from './verify-lark-base-clone-canonical-parity-core.js';
import {
  LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
  projectLarkBaseSourceForAutomaticViewFilterParity,
} from './lark-base-view-filter-parity.js';

const RELATION_FIELD_TYPE = 18;
const FORMULA_FIELD_TYPE = 20;

/**
 * Canonical automatic parity verifier with explicit manual ownership for Source View
 * date predicates that the Base v3 View filter contract cannot persist semantically.
 *
 * Formula definition verification is also made standalone/read-only here. Lark's
 * legacy field readback can omit Formula expression even after a correct Base v3
 * write, so the verifier confirms the definition through the existing Base v3 GET
 * capability and projects only that verified expression into comparison memory.
 *
 * Record comparison normalizes two transport-only representations:
 * - empty relations may be omitted/null in the export but [] in the Lark API;
 * - Formula cell values are derived outputs, so after the Formula definition hard
 *   gate succeeds they are excluded from record-state parity on both sides. Formula
 *   input fields remain strict record hard gates.
 */
export async function verifyLarkBaseCloneCanonicalParity(input) {
  const sourceViewProjection = projectLarkBaseSourceForAutomaticViewFilterParity(input?.sourceClient);
  const sourceProjection = projectRecordReadbackForCanonicalParity(sourceViewProjection.client);
  const targetFormulaProjection = await projectTargetFormulaReadbackForCanonicalParity({
    sourceClient: sourceProjection.client,
    targetClient: input?.targetClient,
  });
  const targetProjection = projectRecordReadbackForCanonicalParity(targetFormulaProjection.client);
  const result = await verifyCore({
    ...input,
    sourceClient: sourceProjection.client,
    targetClient: targetProjection.client,
  });
  const requirements = sourceViewProjection.getRequirements();
  const coveredResult = {
    ...result,
    coverage: {
      ...result.coverage,
      records: 'all-readable-non-formula-field-values-with-relation-record-id-remap; Formula cell outputs are derived and excluded after Formula definition hard gate',
    },
  };
  if (requirements.length === 0) return deepFreeze(coveredResult);
  return deepFreeze({
    ...coveredResult,
    summary: {
      ...coveredResult.summary,
      manualViewFilterRequirements: requirements.length,
    },
    coverage: {
      ...coveredResult.coverage,
      views: 'name-type-public-hidden-and-supported-filter-parity-with-field-id-remap; unsupported-dynamic-date-token-filter-is-ui-manual',
    },
    manualParity: {
      ...(coveredResult.manualParity ?? {}),
      viewFilters: {
        ownership: LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
        required: true,
        requirements,
      },
    },
  });
}

function projectRecordReadbackForCanonicalParity(clientValue) {
  const client = requireReadClient(clientValue, 'record readback client');
  const fieldsPromiseByTableId = new Map();

  const readFields = async (tableIdValue) => {
    const tableId = requireText(tableIdValue, 'record readback tableId');
    if (!fieldsPromiseByTableId.has(tableId)) {
      fieldsPromiseByTableId.set(
        tableId,
        Promise.resolve(client.listFields({ tableId })).then((fields) => structuredClone(fields)),
      );
    }
    return structuredClone(await fieldsPromiseByTableId.get(tableId));
  };

  return Object.freeze({
    client: Object.freeze({
      listTables: bindRequired(client, 'listTables'),
      listFields: async ({ tableId }) => readFields(tableId),
      listRecords: async ({ tableId }) => {
        const [fields, records] = await Promise.all([
          readFields(tableId),
          client.listRecords({ tableId }),
        ]);
        const relationFieldNames = fields
          .filter((field) => Number(field?.type) === RELATION_FIELD_TYPE)
          .map((field) => requireText(field?.fieldName, 'relation fieldName'));
        const formulaFieldNames = fields
          .filter((field) => Number(field?.type) === FORMULA_FIELD_TYPE)
          .map((field) => requireText(field?.fieldName, 'Formula fieldName'));
        if (relationFieldNames.length === 0 && formulaFieldNames.length === 0) {
          return structuredClone(records);
        }
        return structuredClone(records).map((record) => {
          const copy = structuredClone(record ?? {});
          copy.fields = copy?.fields && typeof copy.fields === 'object' && !Array.isArray(copy.fields)
            ? structuredClone(copy.fields)
            : {};
          for (const fieldName of relationFieldNames) {
            if (isEmptyRelationValue(copy.fields[fieldName])) copy.fields[fieldName] = [];
          }
          for (const fieldName of formulaFieldNames) copy.fields[fieldName] = null;
          return copy;
        });
      },
      listViews: bindRequired(client, 'listViews'),
      ...(typeof client.getView === 'function' ? { getView: client.getView.bind(client) } : {}),
      ...(typeof client.getBaseFormulaType === 'function'
        ? { getBaseFormulaType: client.getBaseFormulaType.bind(client) }
        : {}),
    }),
    remoteMutationCount: 0,
  });
}

function isEmptyRelationValue(value) {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

async function projectTargetFormulaReadbackForCanonicalParity(input) {
  const sourceClient = requireClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const [sourceTables, targetTables] = await Promise.all([
    sourceClient.listTables(),
    targetClient.listTables(),
  ]);
  const targetTableByName = uniqueBy(targetTables, (table) => requireText(table?.name, 'target table name'), 'target table');
  const targetTableIdBySourceId = new Map();
  const sourceFieldsByTableId = new Map();
  const targetFieldsByTableId = new Map();
  const targetFieldIdBySourceId = new Map();

  for (const sourceTable of sourceTables) {
    const sourceTableId = requireText(sourceTable?.tableId, 'source tableId');
    const tableName = requireText(sourceTable?.name, 'source table name');
    const targetTable = targetTableByName.get(tableName);
    if (!targetTable) continue;
    const targetTableId = requireText(targetTable?.tableId, `target tableId ${tableName}`);
    targetTableIdBySourceId.set(sourceTableId, targetTableId);

    const [sourceFields, targetFields] = await Promise.all([
      sourceClient.listFields({ tableId: sourceTableId }),
      targetClient.listFields({ tableId: targetTableId }),
    ]);
    sourceFieldsByTableId.set(sourceTableId, structuredClone(sourceFields));
    targetFieldsByTableId.set(targetTableId, structuredClone(targetFields));
    const targetFieldByName = uniqueBy(
      targetFields,
      (field) => requireText(field?.fieldName, `target field name ${tableName}`),
      `target field ${tableName}`,
    );
    for (const sourceField of sourceFields) {
      const targetField = targetFieldByName.get(requireText(sourceField?.fieldName, `source field name ${tableName}`));
      if (!targetField) continue;
      targetFieldIdBySourceId.set(
        requireText(sourceField?.fieldId, `source fieldId ${tableName}`),
        requireText(targetField?.fieldId, `target fieldId ${tableName}`),
      );
    }
  }

  const verifiedExpressionByTargetTableAndField = new Map();
  for (const sourceTable of sourceTables) {
    const sourceTableId = requireText(sourceTable?.tableId, 'source tableId');
    const targetTableId = targetTableIdBySourceId.get(sourceTableId);
    if (!targetTableId) continue;
    const sourceFields = sourceFieldsByTableId.get(sourceTableId) ?? [];
    const targetFields = targetFieldsByTableId.get(targetTableId) ?? [];
    const targetFieldByName = uniqueBy(
      targetFields,
      (field) => requireText(field?.fieldName, 'target field name'),
      `target field ${targetTableId}`,
    );

    for (const sourceField of sourceFields) {
      if (Number(sourceField?.type) !== FORMULA_FIELD_TYPE) continue;
      const fieldName = requireText(sourceField?.fieldName, 'Formula fieldName');
      const sourceExpression = optionalText(sourceField?.property?.formula_expression);
      if (!sourceExpression) continue;
      const targetField = targetFieldByName.get(fieldName);
      if (!targetField) continue;
      const targetFieldId = requireText(targetField?.fieldId, `target Formula fieldId ${fieldName}`);
      const mappedExpression = remapFormulaExpression(
        sourceExpression,
        targetTableIdBySourceId,
        targetFieldIdBySourceId,
      );
      const legacyTargetExpression = optionalText(targetField?.property?.formula_expression);

      if (typeof targetClient.verifyFormulaFieldV3Definition === 'function') {
        const expected = structuredClone(sourceField);
        expected.property = {
          ...(expected?.property && typeof expected.property === 'object' && !Array.isArray(expected.property)
            ? structuredClone(expected.property)
            : {}),
          formula_expression: mappedExpression,
        };
        await targetClient.verifyFormulaFieldV3Definition({
          tableId: targetTableId,
          fieldId: targetFieldId,
          field: expected,
        });
        verifiedExpressionByTargetTableAndField.set(`${targetTableId}:${fieldName}`, mappedExpression);
        continue;
      }

      if (legacyTargetExpression) {
        verifiedExpressionByTargetTableAndField.set(`${targetTableId}:${fieldName}`, legacyTargetExpression);
        continue;
      }

      throw new TypeError(`targetClient must implement verifyFormulaFieldV3Definition() when legacy Formula expression is omitted: ${fieldName}`);
    }
  }

  const projectedFieldsByTableId = new Map();
  for (const [targetTableId, fields] of targetFieldsByTableId.entries()) {
    projectedFieldsByTableId.set(targetTableId, fields.map((field) => {
      if (Number(field?.type) !== FORMULA_FIELD_TYPE) return structuredClone(field);
      const fieldName = requireText(field?.fieldName, 'target Formula fieldName');
      const expression = verifiedExpressionByTargetTableAndField.get(`${targetTableId}:${fieldName}`);
      if (!expression) return structuredClone(field);
      const copy = structuredClone(field);
      copy.property = copy?.property && typeof copy.property === 'object' && !Array.isArray(copy.property)
        ? structuredClone(copy.property)
        : {};
      copy.property.formula_expression = expression;
      return copy;
    }));
  }

  return Object.freeze({
    client: Object.freeze({
      listTables: async () => structuredClone(targetTables),
      listFields: async ({ tableId }) => {
        if (projectedFieldsByTableId.has(tableId)) return structuredClone(projectedFieldsByTableId.get(tableId));
        return structuredClone(await targetClient.listFields({ tableId }));
      },
      listRecords: bindRequired(targetClient, 'listRecords'),
      listViews: bindRequired(targetClient, 'listViews'),
      ...(typeof targetClient.getView === 'function' ? { getView: targetClient.getView.bind(targetClient) } : {}),
      ...(typeof targetClient.getBaseFormulaType === 'function'
        ? { getBaseFormulaType: targetClient.getBaseFormulaType.bind(targetClient) }
        : {}),
    }),
    formulaDefinitionReadback: Object.freeze({
      verifiedCount: verifiedExpressionByTargetTableAndField.size,
      remoteMutationCount: 0,
    }),
  });
}

function remapFormulaExpression(expressionValue, tableIdMap, fieldIdMap) {
  let expression = String(expressionValue);
  for (const [sourceTableId, targetTableId] of tableIdMap.entries()) {
    expression = replaceAllLiteral(expression, sourceTableId, targetTableId);
  }
  for (const [sourceFieldId, targetFieldId] of fieldIdMap.entries()) {
    expression = replaceAllLiteral(expression, sourceFieldId, targetFieldId);
  }
  return expression;
}

function replaceAllLiteral(text, source, target) {
  return String(text).split(source).join(target);
}

function uniqueBy(items, keyOf, label) {
  if (!Array.isArray(items)) throw new TypeError(`${label} collection must be an array`);
  const result = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (result.has(key)) throw new TypeError(`duplicate ${label}: ${key}`);
    result.set(key, item);
  }
  return result;
}

function bindRequired(client, method) {
  if (typeof client?.[method] !== 'function') throw new TypeError(`targetClient must implement ${method}()`);
  return client[method].bind(client);
}

function requireReadClient(client, name) {
  const value = requireClient(client, name);
  for (const method of ['listTables', 'listFields', 'listRecords', 'listViews']) {
    if (typeof value[method] !== 'function') throw new TypeError(`${name} must implement ${method}()`);
  }
  return value;
}

function requireClient(client, name) {
  if (!client || typeof client !== 'object') throw new TypeError(`${name} is required`);
  for (const method of ['listTables', 'listFields']) {
    if (typeof client[method] !== 'function') throw new TypeError(`${name} must implement ${method}()`);
  }
  return client;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
