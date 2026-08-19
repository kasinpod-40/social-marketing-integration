/**
 * Adds migration-only Base parity capabilities on top of the shared Lark Bitable client.
 *
 * This is a decorator over the existing authenticated/retried request transport, not a
 * second HTTP client. Only request contracts explicitly documented by Lark/Feishu are
 * allowed here. Unsupported View UI properties and unsupported Base-resource fields
 * remain fail-closed in the parity planner.
 */
export function withLarkBaseParityCapabilities(client) {
  requireTransport(client);
  const wrapped = Object.create(client);
  let formulaTypePromise = null;
  let formulaTableNameByIdPromise = null;
  const formulaFieldNameByTableId = new Map();

  wrapped.getBaseFormulaType = async () => {
    if (!formulaTypePromise) {
      formulaTypePromise = client.requestBitableJson(appPath(client.appToken), { method: 'GET' })
        .then((response) => {
          const app = response?.data?.app ?? response?.data ?? {};
          const raw = app?.formula_type ?? app?.formulaType;
          if (raw === null || raw === undefined || raw === '') {
            throw new TypeError('Lark Base metadata formula_type must be an integer');
          }
          const formulaType = Number(raw);
          if (!Number.isInteger(formulaType)) {
            throw new TypeError('Lark Base metadata formula_type must be an integer');
          }
          return formulaType;
        })
        .catch((error) => {
          formulaTypePromise = null;
          throw error;
        });
    }
    return formulaTypePromise;
  };

  const getFormulaTableNameById = async () => {
    if (!formulaTableNameByIdPromise) {
      if (typeof client.listTables !== 'function') {
        throw new TypeError('client must implement listTables() for Base v3 Formula translation');
      }
      formulaTableNameByIdPromise = Promise.resolve(client.listTables())
        .then((tables) => new Map(requireArray(tables, 'Formula tables').map((table, index) => [
          requireText(table?.tableId, `Formula tables[${index}].tableId`),
          requireBracketSafeName(table?.name, `Formula tables[${index}].name`),
        ])))
        .catch((error) => {
          formulaTableNameByIdPromise = null;
          throw error;
        });
    }
    return formulaTableNameByIdPromise;
  };

  const getFormulaFieldNameById = async (tableId) => {
    if (!formulaFieldNameByTableId.has(tableId)) {
      if (typeof client.listFields !== 'function') {
        throw new TypeError('client must implement listFields() for Base v3 Formula translation');
      }
      formulaFieldNameByTableId.set(
        tableId,
        Promise.resolve(client.listFields({ tableId }))
          .then((fields) => new Map(requireArray(fields, `Formula fields ${tableId}`).map((field, index) => [
            requireText(field?.fieldId, `Formula fields ${tableId}[${index}].fieldId`),
            requireBracketSafeName(field?.fieldName, `Formula fields ${tableId}[${index}].fieldName`),
          ])))
          .catch((error) => {
            formulaFieldNameByTableId.delete(tableId);
            throw error;
          }),
      );
    }
    return formulaFieldNameByTableId.get(tableId);
  };

  const toBaseV3FormulaBody = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const field = requireObject(input?.field, 'field');
    if (Number(field?.type) !== 20) {
      throw new TypeError('Base v3 Formula writer requires legacy Formula field type 20');
    }
    const name = requireBracketSafeName(field?.fieldName ?? field?.field_name, 'Formula fieldName');
    const expression = requireText(field?.property?.formula_expression, 'Formula property.formula_expression');
    const references = [...expression.matchAll(/bitable::\$table\[([^\]]+)\]\.\$field\[([^\]]+)\]/gu)];
    const tableNameById = await getFormulaTableNameById();
    const replacementByToken = new Map();

    for (const match of references) {
      const referencedTableId = requireText(match[1], 'Formula referenced tableId');
      const referencedFieldId = requireText(match[2], 'Formula referenced fieldId');
      const referencedTableName = tableNameById.get(referencedTableId);
      if (!referencedTableName) {
        throw new TypeError(`Base v3 Formula references unknown table ID: ${referencedTableId}`);
      }
      const fieldNameById = await getFormulaFieldNameById(referencedTableId);
      const referencedFieldName = fieldNameById.get(referencedFieldId);
      if (!referencedFieldName) {
        throw new TypeError(`Base v3 Formula references unknown field ID: ${referencedFieldId}`);
      }
      replacementByToken.set(
        match[0],
        referencedTableId === tableId
          ? `[${referencedFieldName}]`
          : `[${referencedTableName}].[${referencedFieldName}]`,
      );
    }

    let translated = expression;
    for (const [token, replacement] of replacementByToken.entries()) {
      translated = translated.split(token).join(replacement);
    }
    if (/bitable::|\$table\[|\$field\[/u.test(translated)) {
      throw new TypeError('Base v3 Formula translation left unsupported legacy table/field references');
    }

    const description = optionalText(field?.description?.text ?? field?.description);
    return Object.freeze({
      type: 'formula',
      name,
      expression: translated,
      ...(description ? { description } : {}),
    });
  };

  const readBackFormulaLegacy = async (tableId, fieldName) => {
    if (typeof client.listFields !== 'function') {
      throw new TypeError('client must implement listFields() for Formula readback');
    }
    const fields = await client.listFields({ tableId });
    const matches = requireArray(fields, 'Formula readback fields')
      .filter((field) => optionalText(field?.fieldName) === fieldName);
    if (matches.length !== 1) {
      throw new TypeError(`Formula readback requires exactly one field named ${fieldName}; found ${matches.length}`);
    }
    formulaFieldNameByTableId.delete(tableId);
    return structuredClone(matches[0]);
  };

  const readBackFormulaV3 = async (tableId, fieldId) => {
    const response = await client.requestBitableJson(
      baseV3FieldPath(client.appToken, tableId, fieldId),
      { method: 'GET' },
    );
    return normalizeBaseV3FormulaDefinition(response?.data?.field ?? response?.data);
  };

  const verifyFormulaV3 = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const fieldId = requireText(input?.fieldId, 'fieldId');
    const expected = await toBaseV3FormulaBody({ tableId, field: input?.field });
    const actual = await readBackFormulaV3(tableId, fieldId);
    const comparison = compareBaseV3FormulaDefinitions(actual, expected);
    if (!comparison.ok) {
      const error = new Error(`Base v3 Formula definition differs after readback: ${expected.name}`);
      error.code = 'LARK_BASE_V3_FORMULA_READBACK_MISMATCH';
      error.details = {
        tableId,
        fieldId,
        fieldName: expected.name,
        differencePaths: comparison.differencePaths,
      };
      throw error;
    }
    return Object.freeze({
      ok: true,
      tableId,
      fieldId,
      fieldName: expected.name,
      definition: actual,
    });
  };

  wrapped.verifyFormulaFieldV3Definition = verifyFormulaV3;

  wrapped.createFormulaFieldV3 = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const body = await toBaseV3FormulaBody({ tableId, field: input?.field });
    const response = await client.requestBitableJson(baseV3FieldCollectionPath(client.appToken, tableId), {
      method: 'POST',
      retryMode: 'rate_limit_only',
      body,
    });
    const createdPayload = response?.data?.field ?? response?.data ?? {};
    let fieldId = optionalText(createdPayload?.id ?? createdPayload?.field_id ?? createdPayload?.fieldId);
    if (!fieldId) {
      const legacy = await readBackFormulaLegacy(tableId, body.name);
      fieldId = requireText(legacy?.fieldId, `created Formula fieldId ${body.name}`);
    }
    await verifyFormulaV3({ tableId, fieldId, field: input?.field });
    return readBackFormulaLegacy(tableId, body.name);
  };

  wrapped.updateFormulaFieldV3 = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const fieldId = requireText(input?.fieldId, 'fieldId');
    const body = await toBaseV3FormulaBody({ tableId, field: input?.field });
    await client.requestBitableJson(baseV3FieldPath(client.appToken, tableId, fieldId), {
      method: 'PUT',
      body,
    });
    await verifyFormulaV3({ tableId, fieldId, field: input?.field });
    return readBackFormulaLegacy(tableId, body.name);
  };

  wrapped.getViewHierarchy = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const response = await client.requestBitableJson(viewPath(client.appToken, tableId, viewId), {
      method: 'GET',
    });
    const view = response?.data?.view ?? response?.data ?? {};
    const property = view?.property && typeof view.property === 'object' ? view.property : {};
    const hierarchy = property?.hierarchy_config ?? property?.hierarchyConfig ?? null;
    return Object.freeze({
      fieldId: optionalText(hierarchy?.field_id ?? hierarchy?.fieldId),
    });
  };

  wrapped.updateViewHierarchy = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const fieldId = requireText(input?.fieldId, 'fieldId');
    const viewName = optionalText(input?.viewName);
    const body = {
      ...(viewName ? { view_name: viewName } : {}),
      property: {
        hierarchy_config: {
          field_id: fieldId,
        },
      },
    };
    const response = await client.requestBitableJson(viewPath(client.appToken, tableId, viewId), {
      method: 'PATCH',
      body,
    });
    return Object.freeze({
      tableId,
      viewId,
      fieldId,
      responseCode: Number(response?.code ?? 0),
    });
  };

  wrapped.listAdvancedPermissionRoles = async () => {
    const items = [];
    let pageToken = null;
    do {
      const query = new URLSearchParams({ page_size: '30' });
      if (pageToken) query.set('page_token', pageToken);
      const response = await client.requestBitableJson(
        `${legacyRolePath(client.appToken)}?${query.toString()}`,
        { method: 'GET' },
      );
      const data = response?.data ?? {};
      const pageItems = Array.isArray(data?.items) ? data.items : [];
      items.push(...pageItems.map(normalizeAdvancedPermissionRole));
      pageToken = data?.has_more === true ? optionalText(data?.page_token) : null;
    } while (pageToken);
    return Object.freeze(items);
  };

  wrapped.createAdvancedPermissionRole = async (input) => {
    const roleName = requireText(input?.roleName, 'roleName');
    const tableRoles = requireArray(input?.tableRoles, 'tableRoles').map((entry, index) => ({
      table_id: requireText(entry?.tableId, `tableRoles[${index}].tableId`),
      table_perm: requireFiniteNumber(entry?.tablePerm, `tableRoles[${index}].tablePerm`),
    }));
    const body = {
      role_name: roleName,
      table_roles: tableRoles,
    };
    const response = await client.requestBitableJson(modernRolePath(client.appToken), {
      method: 'POST',
      body,
    });
    const role = response?.data?.role ?? response?.data ?? {};
    return Object.freeze({
      roleId: optionalText(role?.role_id ?? role?.roleId),
      roleName: optionalText(role?.role_name ?? role?.roleName) ?? roleName,
      responseCode: Number(response?.code ?? 0),
    });
  };

  return wrapped;
}

function normalizeBaseV3FormulaDefinition(field) {
  const value = requireObject(field, 'Base v3 Formula field');
  const type = requireText(value?.type, 'Base v3 Formula type').toLowerCase();
  if (type !== 'formula') throw new TypeError(`Base v3 Formula readback returned type ${type}`);
  return Object.freeze({
    type,
    name: requireText(value?.name, 'Base v3 Formula name'),
    expression: requireText(value?.expression, 'Base v3 Formula expression'),
    description: optionalText(value?.description),
  });
}

function compareBaseV3FormulaDefinitions(actual, expected) {
  const left = {
    type: requireText(actual?.type, 'actual Formula type').toLowerCase(),
    name: requireText(actual?.name, 'actual Formula name'),
    expression: canonicalFormulaExpression(actual?.expression),
    description: optionalText(actual?.description),
  };
  const right = {
    type: requireText(expected?.type, 'expected Formula type').toLowerCase(),
    name: requireText(expected?.name, 'expected Formula name'),
    expression: canonicalFormulaExpression(expected?.expression),
    description: optionalText(expected?.description),
  };
  const differencePaths = [];
  for (const key of ['type', 'name', 'expression', 'description']) {
    if (left[key] !== right[key]) differencePaths.push(`$.${key}`);
  }
  return Object.freeze({ ok: differencePaths.length === 0, differencePaths: Object.freeze(differencePaths) });
}

function canonicalFormulaExpression(value) {
  const text = requireText(value, 'Formula expression');
  let result = '';
  let quote = null;
  let escaped = false;
  for (const char of text) {
    if (quote) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }
    if (/\s/u.test(char)) continue;
    result += char;
  }
  return result;
}

function normalizeAdvancedPermissionRole(role) {
  const tableRoles = Array.isArray(role?.table_roles) ? role.table_roles : [];
  return Object.freeze({
    roleId: requireText(role?.role_id ?? role?.roleId, 'roleId'),
    roleName: requireText(role?.role_name ?? role?.roleName, 'roleName'),
    tableRoles: Object.freeze(tableRoles.map((entry, index) => Object.freeze({
      tableId: requireText(entry?.table_id ?? entry?.tableId, `tableRoles[${index}].tableId`),
      tableName: optionalText(entry?.table_name ?? entry?.tableName),
      tablePerm: requireFiniteNumber(entry?.table_perm ?? entry?.tablePerm, `tableRoles[${index}].tablePerm`),
    }))),
  });
}

function appPath(appToken) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}`;
}

function baseV3FieldCollectionPath(appToken, tableId) {
  return `/open-apis/base/v3/bases/${encodeURIComponent(requireText(appToken, 'appToken'))}`
    + `/tables/${encodeURIComponent(requireText(tableId, 'tableId'))}/fields`;
}

function baseV3FieldPath(appToken, tableId, fieldId) {
  return `${baseV3FieldCollectionPath(appToken, tableId)}/${encodeURIComponent(requireText(fieldId, 'fieldId'))}`;
}

function viewPath(appToken, tableId, viewId) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}`
    + `/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`;
}

function legacyRolePath(appToken) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}/roles`;
}

function modernRolePath(appToken) {
  return `/open-apis/base/v2/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}/roles`;
}

function requireTransport(client) {
  if (!client || typeof client.requestBitableJson !== 'function') {
    throw new TypeError('client must implement requestBitableJson()');
  }
  requireText(client.appToken, 'client.appToken');
  return client;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireBracketSafeName(value, name) {
  const normalized = requireText(value, name);
  if (normalized.includes(']')) {
    throw new TypeError(`${name} contains unsupported ] for Base v3 Formula reference syntax`);
  }
  return normalized;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}
