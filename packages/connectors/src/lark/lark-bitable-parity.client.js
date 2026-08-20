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
  const viewFieldByIdPromise = new Map();

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

  const getViewFieldById = async (tableId) => {
    if (!viewFieldByIdPromise.has(tableId)) {
      if (typeof client.listFields !== 'function') {
        throw new TypeError('client must implement listFields() for Base v3 View filter translation');
      }
      viewFieldByIdPromise.set(
        tableId,
        Promise.resolve(client.listFields({ tableId }))
          .then((fields) => new Map(requireArray(fields, `View fields ${tableId}`).map((field, index) => [
            requireText(field?.fieldId, `View fields ${tableId}[${index}].fieldId`),
            field,
          ])))
          .catch((error) => {
            viewFieldByIdPromise.delete(tableId);
            throw error;
          }),
      );
    }
    return viewFieldByIdPromise.get(tableId);
  };

  const resolveTargetViewFilterInfo = async (tableId, value) => {
    const source = requireObject(value, 'filterInfo');
    const fields = await getViewFieldById(tableId);
    return Object.freeze({
      conjunction: source.conjunction === 'or' ? 'or' : 'and',
      conditions: Object.freeze(requireArray(source.conditions, 'filterInfo.conditions').map((condition, index) => {
        const item = requireObject(condition, `filterInfo.conditions[${index}]`);
        const fieldId = requireText(item?.fieldId ?? item?.field_id, `filterInfo.conditions[${index}].fieldId`);
        const fieldType = requirePositiveInteger(item?.fieldType ?? item?.field_type, `filterInfo.conditions[${index}].fieldType`);
        const operator = requireText(item?.operator, `filterInfo.conditions[${index}].operator`);
        if (![3, 4].includes(fieldType) || item?.value === null || item?.value === undefined) {
          return Object.freeze({ fieldId, fieldType, operator, value: structuredClone(item?.value) });
        }
        const field = fields.get(fieldId);
        if (!field) throw new TypeError(`Base v3 View filter field is not present in Target table: ${fieldId}`);
        const values = normalizeStringArray(decodeLegacyViewFilterValue(item.value), `View select filter ${fieldId}`);
        return Object.freeze({
          fieldId,
          fieldType,
          operator,
          // Base v3 filter tuples use Select option names. Validate every logical value
          // against current Target metadata, but never replay generated option IDs.
          value: Object.freeze(values.map((logicalValue) => resolveTargetSelectOptionWriteName(field, logicalValue))),
        });
      })),
    });
  };

  const normalizeTargetViewFilterInfo = async (tableId, value) => {
    if (value === null || value === undefined) return null;
    const source = requireObject(value, 'view.filterInfo');
    const fields = await getViewFieldById(tableId);
    return Object.freeze({
      conjunction: source.conjunction === 'or' ? 'or' : 'and',
      conditions: Object.freeze(requireArray(source.conditions ?? [], 'view.filterInfo.conditions').map((condition, index) => {
        const item = requireObject(condition, `view.filterInfo.conditions[${index}]`);
        const fieldId = requireText(item?.fieldId ?? item?.field_id, `view.filterInfo.conditions[${index}].fieldId`);
        const fieldType = requirePositiveInteger(item?.fieldType ?? item?.field_type, `view.filterInfo.conditions[${index}].fieldType`);
        const operator = normalizeSingleSelectViewFilterOperator(
          requireText(item?.operator, `view.filterInfo.conditions[${index}].operator`),
          fieldType,
        );
        if (item?.value === null || item?.value === undefined) {
          return Object.freeze({ fieldId, fieldType, operator, value: null });
        }
        const decoded = decodeLegacyViewFilterValue(item.value);
        if (![3, 4].includes(fieldType)) {
          return Object.freeze({ fieldId, fieldType, operator, value: structuredClone(decoded) });
        }
        const field = fields.get(fieldId);
        if (!field) throw new TypeError(`View filter readback field is not present in Target table: ${fieldId}`);
        const optionValues = normalizeStringArray(decoded, `View select readback ${fieldId}`)
          .map((remoteValue) => resolveTargetSelectOptionName(field, remoteValue));
        return Object.freeze({ fieldId, fieldType, operator, value: Object.freeze(optionValues) });
      })),
    });
  };

  const normalizeBaseV3ViewFilterForComparison = async (tableId, value) => {
    const normalized = normalizeBaseV3FilterResponse(value);
    const fields = await getViewFieldById(tableId);
    return Object.freeze({
      logic: normalized.logic,
      conditions: Object.freeze(normalized.conditions.map((condition, index) => {
        const fieldId = requireText(condition[0], `Base v3 View filter condition ${index} fieldId`);
        const operator = requireText(condition[1], `Base v3 View filter condition ${index} operator`);
        if (condition.length !== 3) return Object.freeze([fieldId, operator]);
        const field = fields.get(fieldId);
        if (!field || ![3, 4].includes(Number(field?.type))) {
          return Object.freeze([fieldId, operator, structuredClone(condition[2])]);
        }
        const values = normalizeStringArray(condition[2], `Base v3 View select readback ${fieldId}`)
          .map((remoteValue) => resolveTargetSelectOptionName(field, remoteValue));
        return Object.freeze([fieldId, operator, Object.freeze(values)]);
      })),
    });
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

  wrapped.getView = async (input) => {
    if (typeof client.getView !== 'function') throw new TypeError('client must implement getView() for View parity readback');
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const view = structuredClone(await client.getView({ tableId, viewId }));
    const property = view?.property && typeof view.property === 'object' && !Array.isArray(view.property)
      ? view.property
      : {};
    return Object.freeze({
      ...view,
      property: Object.freeze({
        ...property,
        filterInfo: await normalizeTargetViewFilterInfo(tableId, property.filterInfo),
      }),
    });
  };

  wrapped.updateView = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const viewName = optionalText(input?.viewName);
    const hasHiddenFields = input?.hiddenFields !== undefined;
    const hasFilterInfo = input?.filterInfo !== undefined && input?.filterInfo !== null;
    if (!viewName && !hasHiddenFields && !hasFilterInfo) {
      throw new TypeError('Base v3 View update requires at least one supported mutation');
    }

    if (viewName) {
      await client.requestBitableJson(baseV3ViewPath(client.appToken, tableId, viewId), {
        method: 'PATCH',
        body: { name: viewName },
      });
    }

    let visibleFields = null;
    if (hasHiddenFields) {
      if (typeof client.listFields !== 'function') {
        throw new TypeError('client must implement listFields() for Base v3 visible_fields parity');
      }
      const fields = requireArray(await client.listFields({ tableId }), 'View target fields');
      const fieldIds = fields.map((field, index) => requireText(field?.fieldId, `View target fields[${index}].fieldId`));
      const fieldIdSet = new Set(fieldIds);
      const hiddenFields = uniqueTexts(requireArray(input.hiddenFields, 'hiddenFields'), 'hiddenFields');
      const unknownHidden = hiddenFields.filter((fieldId) => !fieldIdSet.has(fieldId));
      if (unknownHidden.length > 0) {
        throw new TypeError(`Base v3 View hidden fields are not present in Target table: ${unknownHidden.join(', ')}`);
      }
      visibleFields = fieldIds.filter((fieldId) => !hiddenFields.includes(fieldId));
      const body = { visible_fields: visibleFields };
      await client.requestBitableJson(baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'visible_fields'), {
        method: 'PUT',
        body,
      });
      const response = await client.requestBitableJson(
        baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'visible_fields'),
        { method: 'GET' },
      );
      const actual = normalizeVisibleFieldsResponse(response?.data);
      // `visible_fields` is a transport representation and may omit/rewrite entries that
      // the persisted legacy View still exposes as visible. It is useful as a fast exact
      // readback, but hidden-field parity is the semantic contract the migration owns.
      const expectedComparable = [...visibleFields].sort();
      const actualComparable = [...actual].sort();
      if (stableJson(actualComparable) !== stableJson(expectedComparable)) {
        if (typeof client.getView !== 'function') {
          throw new TypeError('client must implement getView() for View hidden-field semantic readback');
        }
        const semanticView = await client.getView({ tableId, viewId });
        const semanticHiddenFields = uniqueTexts(
          requireArray(semanticView?.property?.hiddenFields ?? [], 'View hidden-field semantic readback'),
          'View hidden-field semantic readback',
        );
        const expectedHiddenComparable = [...hiddenFields].sort();
        const actualHiddenComparable = [...semanticHiddenFields].sort();
        if (stableJson(actualHiddenComparable) !== stableJson(expectedHiddenComparable)) {
          throw readbackMismatch(
            'LARK_VIEW_HIDDEN_FIELDS_SEMANTIC_READBACK_MISMATCH',
            'Persisted View hidden-field semantics differ after Base v3 visible_fields write',
            {
              tableId,
              viewId,
              verification: 'base-v3-visible-fields-mismatch-then-view-hidden-fields-semantic-readback',
              expectedVisibleFieldCount: visibleFields.length,
              baseV3ActualVisibleFieldCount: actual.length,
              expectedHiddenFieldCount: hiddenFields.length,
              actualHiddenFieldCount: semanticHiddenFields.length,
            },
          );
        }
      }
    }

    let filter = null;
    if (hasFilterInfo) {
      const resolvedFilterInfo = await resolveTargetViewFilterInfo(tableId, input.filterInfo);
      filter = toBaseV3ViewFilter(resolvedFilterInfo);
      await client.requestBitableJson(baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'filter'), {
        method: 'PUT',
        body: filter,
      });
      const response = await client.requestBitableJson(
        baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'filter'),
        { method: 'GET' },
      );
      const expectedComparable = canonicalBaseV3ViewFilter(
        await normalizeBaseV3ViewFilterForComparison(tableId, filter),
      );
      const actualComparable = canonicalBaseV3ViewFilter(
        await normalizeBaseV3ViewFilterForComparison(tableId, response?.data),
      );
      if (stableJson(actualComparable) !== stableJson(expectedComparable)) {
        // Base v3 GET may rewrite the tuple presentation after persisting a filter.
        // Do not treat that transport representation as a stronger truth than the
        // View itself: verify the persisted legacy/source-aligned filter semantics
        // before deciding whether the write actually lost meaning.
        const semanticView = await wrapped.getView({ tableId, viewId });
        const expectedSemantic = canonicalSemanticViewFilterInfo(resolvedFilterInfo);
        const actualSemantic = canonicalSemanticViewFilterInfo(semanticView?.property?.filterInfo);
        if (stableJson(actualSemantic) !== stableJson(expectedSemantic)) {
          const recoveryFilter = toBaseV3SingleSelectAnyOfRecoveryFilter(resolvedFilterInfo);
          if (recoveryFilter) {
            await client.requestBitableJson(baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'filter'), {
              method: 'PUT',
              body: recoveryFilter,
            });
            const recoveryResponse = await client.requestBitableJson(
              baseV3ViewPropertyPath(client.appToken, tableId, viewId, 'filter'),
              { method: 'GET' },
            );
            const recoveryComparable = canonicalBaseV3ViewFilter(
              await normalizeBaseV3ViewFilterForComparison(tableId, recoveryResponse?.data),
            );
            const recoveredView = await wrapped.getView({ tableId, viewId });
            const recoveredSemantic = canonicalSemanticViewFilterInfo(recoveredView?.property?.filterInfo);
            if (stableJson(recoveredSemantic) === stableJson(expectedSemantic)) {
              filter = recoveryFilter;
            } else {
              throw readbackMismatch('LARK_VIEW_FILTER_SEMANTIC_READBACK_MISMATCH', 'Persisted View filter semantics differ after Base v3 SingleSelect any-of recovery', {
                tableId,
                viewId,
                verification: 'single-select-any-of-recovery-semantic-readback',
                recoveryAttempted: true,
                expectedConditionCount: expectedSemantic.conditions.length,
                actualConditionCount: recoveredSemantic.conditions.length,
                recoveryBaseV3ConditionCount: recoveryComparable.conditions.length,
              });
            }
          } else {
            throw readbackMismatch('LARK_VIEW_FILTER_SEMANTIC_READBACK_MISMATCH', 'Persisted View filter semantics differ after Base v3 write', {
              tableId,
              viewId,
              verification: 'base-v3-presentation-mismatch-then-view-semantic-readback',
              recoveryAttempted: false,
              expectedConditionCount: expectedSemantic.conditions.length,
              actualConditionCount: actualSemantic.conditions.length,
              baseV3ExpectedConditionCount: expectedComparable.conditions.length,
              baseV3ActualConditionCount: actualComparable.conditions.length,
            });
          }
        }
      }
    }

    return Object.freeze({
      tableId,
      viewId,
      viewName,
      visibleFields: visibleFields ? Object.freeze([...visibleFields]) : null,
      filter: filter ? structuredClone(filter) : null,
    });
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

function resolveTargetSelectOptionWriteName(field, logicalValue) {
  const value = requireText(String(logicalValue), 'View Select option value');
  const options = requireArray(field?.property?.options, `View Select options ${field?.fieldName ?? field?.fieldId ?? ''}`);
  const idMatches = options.filter((option) => optionalText(option?.id) === value);
  if (idMatches.length === 1) {
    return requireText(idMatches[0]?.name, `Target View Select option name ${value}`);
  }
  const nameMatches = options.filter((option) => optionalText(option?.name) === value);
  if (nameMatches.length !== 1) {
    throw new TypeError(`View Select option name must resolve to exactly one Target option: ${value}`);
  }
  return value;
}

function resolveTargetSelectOptionName(field, remoteValue) {
  const value = requireText(String(remoteValue), 'View Select readback value');
  const options = requireArray(field?.property?.options, `View Select options ${field?.fieldName ?? field?.fieldId ?? ''}`);
  const idMatches = options.filter((option) => optionalText(option?.id) === value);
  if (idMatches.length === 1) return requireText(idMatches[0]?.name, `View Select option name ${value}`);
  const nameMatches = options.filter((option) => optionalText(option?.name) === value);
  if (nameMatches.length === 1) return value;
  throw new TypeError(`View Select readback value must resolve to exactly one Target option: ${value}`);
}

/**
 * Base v3 uses `intersects`/`disjoint` for SingleSelect membership while legacy View
 * readback can surface the same persisted predicate as `is`/`contains` or
 * `isNot`/`doesNotContain`. The source export uses `is`/`isNot`; normalize Target-only
 * aliases back to that source-aligned semantic vocabulary before parity comparison.
 */
function normalizeSingleSelectViewFilterOperator(operator, fieldType) {
  const value = requireText(operator, 'SingleSelect View filter operator');
  if (Number(fieldType) !== 3) return value;
  if (new Set(['is', 'contains', 'intersects']).has(value)) return 'is';
  if (new Set(['isNot', 'doesNotContain', 'disjoint']).has(value)) return 'isNot';
  return value;
}

function toBaseV3ViewFilter(value) {
  const source = requireObject(value, 'filterInfo');
  const conditions = requireArray(source.conditions, 'filterInfo.conditions').map((condition, index) => {
    const item = requireObject(condition, `filterInfo.conditions[${index}]`);
    const fieldId = requireText(item?.fieldId ?? item?.field_id, `filterInfo.conditions[${index}].fieldId`);
    const fieldType = requirePositiveInteger(item?.fieldType ?? item?.field_type, `filterInfo.conditions[${index}].fieldType`);
    const legacyOperator = requireText(item?.operator, `filterInfo.conditions[${index}].operator`);
    const operator = baseV3ViewFilterOperator(legacyOperator, fieldType);
    const tuple = [fieldId, operator];
    if (operator !== 'empty' && operator !== 'non_empty') {
      tuple.push(baseV3ViewFilterValue(item?.value, fieldType, legacyOperator));
    }
    return Object.freeze(tuple);
  });
  return Object.freeze({
    logic: source.conjunction === 'or' ? 'or' : 'and',
    conditions: Object.freeze(conditions),
  });
}

/**
 * Recovery for the exact live failure class where Lark accepts a documented Base v3
 * SingleSelect intersects array but persists only one semantic option. Preserve the
 * documented option-name contract and expand only multi-value SingleSelect `is` under
 * OR into one condition per option. Other filter classes are never rewritten here.
 */
function toBaseV3SingleSelectAnyOfRecoveryFilter(value) {
  const source = requireObject(value, 'filterInfo');
  if (source.conjunction !== 'or') return null;
  const conditions = [];
  let expanded = false;

  for (const [index, condition] of requireArray(source.conditions, 'filterInfo.conditions').entries()) {
    const item = requireObject(condition, `filterInfo.conditions[${index}]`);
    const fieldId = requireText(item?.fieldId ?? item?.field_id, `filterInfo.conditions[${index}].fieldId`);
    const fieldType = requirePositiveInteger(item?.fieldType ?? item?.field_type, `filterInfo.conditions[${index}].fieldType`);
    const legacyOperator = requireText(item?.operator, `filterInfo.conditions[${index}].operator`);
    const operator = baseV3ViewFilterOperator(legacyOperator, fieldType);

    if (fieldType === 3 && legacyOperator === 'is') {
      const values = baseV3ViewFilterValue(item?.value, fieldType, legacyOperator);
      if (Array.isArray(values) && values.length > 1) {
        for (const optionName of values) {
          conditions.push(Object.freeze([fieldId, operator, Object.freeze([optionName])]));
        }
        expanded = true;
        continue;
      }
    }

    const tuple = [fieldId, operator];
    if (operator !== 'empty' && operator !== 'non_empty') {
      tuple.push(baseV3ViewFilterValue(item?.value, fieldType, legacyOperator));
    }
    conditions.push(Object.freeze(tuple));
  }

  if (!expanded) return null;
  return Object.freeze({ logic: 'or', conditions: Object.freeze(conditions) });
}

function baseV3ViewFilterOperator(operator, fieldType) {
  switch (operator) {
    case 'isEmpty': return 'empty';
    case 'isNotEmpty': return 'non_empty';
    case 'isGreater': return '>';
    case 'isGreaterEqual': return '>=';
    case 'isLess': return '<';
    case 'isLessEqual': return '<=';
    case 'contains': return 'intersects';
    case 'doesNotContain': return 'disjoint';
    case 'is': return new Set([3, 4, 18]).has(fieldType) ? 'intersects' : '==';
    case 'isNot': return new Set([3, 4, 18]).has(fieldType) ? 'disjoint' : '!=';
    default: throw new TypeError(`Unsupported legacy View filter operator for Base v3: ${operator}`);
  }
}

function baseV3ViewFilterValue(value, fieldType, legacyOperator) {
  const decoded = decodeLegacyViewFilterValue(value);
  if (new Set([3, 4]).has(fieldType)) {
    return normalizeStringArray(decoded, `View select filter ${legacyOperator}`);
  }
  if (fieldType === 18) {
    return normalizeArray(decoded).map((item) => {
      if (typeof item === 'string') return { id: requireText(item, 'View relation filter record id') };
      const object = requireObject(item, 'View relation filter item');
      return { id: requireText(object?.id ?? object?.record_id ?? object?.recordId, 'View relation filter record id') };
    });
  }
  if (fieldType === 2) {
    const scalar = unwrapSingleFilterValue(decoded, 'View number filter');
    const number = Number(scalar);
    if (!Number.isFinite(number)) throw new TypeError(`View number filter must be numeric: ${String(scalar)}`);
    return number;
  }
  if (fieldType === 7) {
    const scalar = unwrapSingleFilterValue(decoded, 'View checkbox filter');
    if (typeof scalar === 'boolean') return scalar;
    if (scalar === 'true' || scalar === 1 || scalar === '1') return true;
    if (scalar === 'false' || scalar === 0 || scalar === '0') return false;
    throw new TypeError(`View checkbox filter must be boolean: ${String(scalar)}`);
  }
  if (fieldType === 20) {
    return structuredClone(decoded);
  }
  const scalar = unwrapSingleFilterValue(decoded, 'View scalar filter');
  if (typeof scalar === 'string' || typeof scalar === 'number' || typeof scalar === 'boolean') return scalar;
  throw new TypeError(`Unsupported View scalar filter value: ${JSON.stringify(scalar)}`);
}

function decodeLegacyViewFilterValue(value) {
  if (value === null || value === undefined) throw new TypeError('View filter requires value');
  if (typeof value !== 'string') return structuredClone(value);
  const text = value.trim();
  if (!text) throw new TypeError('View filter value cannot be empty');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapSingleFilterValue(value, label) {
  if (!Array.isArray(value)) return value;
  if (value.length !== 1) throw new TypeError(`${label} requires exactly one value`);
  return value[0];
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value, label) {
  return normalizeArray(value).map((item, index) => requireText(item, `${label}[${index}]`));
}

function normalizeVisibleFieldsResponse(data) {
  if (Array.isArray(data)) return data.map((item, index) => requireText(item, `visible_fields[${index}]`));
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const value = source.visible_fields ?? source.visibleFields;
  return requireArray(value, 'visible_fields readback').map((item, index) => requireText(item, `visible_fields[${index}]`));
}

function normalizeBaseV3FilterResponse(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data)
    ? (data.filter && typeof data.filter === 'object' ? data.filter : data)
    : null;
  if (!source) throw new TypeError('Base v3 View filter readback must be an object');
  const logic = source.logic === 'or' ? 'or' : 'and';
  const conditions = requireArray(source.conditions ?? [], 'View filter readback conditions').map((condition, index) => {
    if (!Array.isArray(condition) || condition.length < 2 || condition.length > 3) {
      throw new TypeError(`View filter readback condition ${index} must be a tuple`);
    }
    return structuredClone(condition);
  });
  return { logic, conditions };
}

/**
 * Canonicalize only presentation differences that Lark is proven to rewrite without
 * changing filter meaning: one-condition conjunction, condition order, and set order.
 * Cardinality is preserved, so a collapsed multi-value filter never compares equal.
 */
function canonicalBaseV3ViewFilter(value) {
  const source = requireObject(value, 'Base v3 View filter');
  const conditions = requireArray(source.conditions ?? [], 'Base v3 View filter conditions')
    .map((condition, index) => canonicalBaseV3FilterCondition(condition, index))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return Object.freeze({
    logic: conditions.length <= 1 ? 'and' : (source.logic === 'or' ? 'or' : 'and'),
    conditions: Object.freeze(conditions),
  });
}

function canonicalBaseV3FilterCondition(condition, index) {
  if (!Array.isArray(condition) || condition.length < 2 || condition.length > 3) {
    throw new TypeError(`Base v3 View filter condition ${index} must be a tuple`);
  }
  const result = [structuredClone(condition[0]), structuredClone(condition[1])];
  if (condition.length === 3) result.push(canonicalFilterSetValue(condition[2]));
  return Object.freeze(result);
}

function canonicalFilterSetValue(value) {
  if (!Array.isArray(value)) return sortCanonicalObject(value);
  return value
    .map((item) => sortCanonicalObject(item))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

/**
 * Compare persisted legacy/source-aligned View filters by meaning. This mirrors the
 * canonical clone verifier so Base v3 tuple presentation can never be a stronger gate
 * than the View semantics that the migration is required to preserve.
 */
function canonicalSemanticViewFilterInfo(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const conjunction = source.conjunction === 'or' ? 'or' : 'and';
  const rawConditions = requireArray(source.conditions ?? [], 'semantic View filter conditions').map((condition, index) => {
    const item = requireObject(condition, `semantic View filter condition ${index}`);
    const fieldType = requirePositiveInteger(item?.fieldType ?? item?.field_type, `semantic View filter condition ${index} fieldType`);
    return {
      fieldId: requireText(item?.fieldId ?? item?.field_id, `semantic View filter condition ${index} fieldId`),
      fieldType,
      operator: normalizeSingleSelectViewFilterOperator(
        requireText(item?.operator, `semantic View filter condition ${index} operator`),
        fieldType,
      ),
      value: canonicalSemanticViewFilterValue(item?.value),
    };
  });

  const groupedSingleSelect = new Map();
  const conditions = [];
  for (const condition of rawConditions) {
    if (conjunction === 'or' && condition.fieldType === 3 && condition.operator === 'is') {
      const key = `${condition.fieldId}\u0000${condition.fieldType}\u0000${condition.operator}`;
      const existing = groupedSingleSelect.get(key) ?? { ...condition, value: [] };
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      existing.value.push(...values.filter((item) => item !== null && item !== undefined));
      groupedSingleSelect.set(key, existing);
      continue;
    }
    conditions.push(condition);
  }
  for (const condition of groupedSingleSelect.values()) {
    condition.value = canonicalSemanticViewFilterValue(condition.value);
    conditions.push(condition);
  }
  conditions.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return Object.freeze({
    conjunction: conditions.length <= 1 ? 'and' : conjunction,
    conditions: Object.freeze(conditions.map((condition) => Object.freeze(condition))),
  });
}

function canonicalSemanticViewFilterValue(value) {
  if (value === undefined || value === null) return null;
  const decoded = decodeLegacyViewFilterValue(value);
  if (!Array.isArray(decoded)) return sortCanonicalObject(decoded);
  const uniqueByCanonical = new Map();
  for (const item of decoded) {
    const canonical = sortCanonicalObject(item);
    uniqueByCanonical.set(stableJson(canonical), canonical);
  }
  return [...uniqueByCanonical.values()]
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function sortCanonicalObject(value) {
  if (Array.isArray(value)) return value.map(sortCanonicalObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortCanonicalObject(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function readbackMismatch(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uniqueTexts(values, name) {
  return [...new Set(values.map((value, index) => requireText(value, `${name}[${index}]`)))];
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

function baseV3ViewPath(appToken, tableId, viewId) {
  return `/open-apis/base/v3/bases/${encodeURIComponent(requireText(appToken, 'appToken'))}`
    + `/tables/${encodeURIComponent(requireText(tableId, 'tableId'))}`
    + `/views/${encodeURIComponent(requireText(viewId, 'viewId'))}`;
}

function baseV3ViewPropertyPath(appToken, tableId, viewId, property) {
  return `${baseV3ViewPath(appToken, tableId, viewId)}/${encodeURIComponent(requireText(property, 'view property'))}`;
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

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}
