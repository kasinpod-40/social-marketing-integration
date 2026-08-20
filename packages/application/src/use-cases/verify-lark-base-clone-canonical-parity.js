import { verifyLarkBaseCloneCanonicalParity as verifyCore } from './verify-lark-base-clone-canonical-parity-core.js';
import {
  LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
  projectLarkBaseSourceForAutomaticViewFilterParity,
} from './lark-base-view-filter-parity.js';

const FORMULA_FIELD_TYPE = 20;

/**
 * Canonical automatic parity verifier with explicit manual ownership for Source View
 * date predicates that the Base v3 View filter contract cannot persist semantically.
 *
 * Formula definition verification is also made standalone/read-only here. Lark's
 * legacy field readback can omit Formula expression even after a correct Base v3
 * write, so the verifier confirms the definition through the existing Base v3 GET
 * capability and projects only that verified expression into comparison memory.
 */
export async function verifyLarkBaseCloneCanonicalParity(input) {
  const sourceProjection = projectLarkBaseSourceForAutomaticViewFilterParity(input?.sourceClient);
  const targetProjection = await projectTargetFormulaReadbackForCanonicalParity({
    sourceClient: sourceProjection.client,
    targetClient: input?.targetClient,
  });
  const result = await verifyCore({
    ...input,
    sourceClient: sourceProjection.client,
    targetClient: targetProjection.client,
  });
  const requirements = sourceProjection.getRequirements();
  if (requirements.length === 0) return result;
  return deepFreeze({
    ...result,
    summary: {
      ...result.summary,
      manualViewFilterRequirements: requirements.length,
    },
    coverage: {
      ...result.coverage,
      views: 'name-type-public-hidden-and-supported-filter-parity-with-field-id-remap; unsupported-dynamic-date-token-filter-is-ui-manual',
    },
    manualParity: {
      ...(result.manualParity ?? {}),
      viewFilters: {
        ownership: LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
        required: true,
        requirements,
      },
    },
  });
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
