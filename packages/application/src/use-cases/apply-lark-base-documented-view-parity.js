const HIERARCHY_FIELD_KEYS = Object.freeze(['fieldId', 'field_id']);

export const CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION = 'APPLY_CUSTOMER_BASE_VISIBLE_FIELD_ORDER_V1';

/**
 * Applies only View parity properties with an explicit documented Lark OpenAPI write contract.
 *
 * Current coverage: grid-view `hierarchy_config.field_id`.
 * Unsupported exported View properties are intentionally not sent. The caller must pass the
 * protected Target client so all pre-existing customer tables remain fenced before requests.
 * This phase is not wired into the customer operator until every parity gate is ready.
 */
export async function applyLarkBaseDocumentedViewParity(input) {
  const sourceClient = requireSourceClient(input?.sourceClient);
  const targetClient = requireTargetClient(input?.targetClient);
  const expectedTableNames = normalizeNames(input?.expectedTableNames);

  const [sourceTables, targetTables] = await Promise.all([
    sourceClient.listTables(),
    targetClient.listTables(),
  ]);
  const sourceByName = uniqueByName(sourceTables, 'source table');
  const targetByName = uniqueByName(targetTables, 'target table');
  const blockers = [];
  let representedHierarchyViews = 0;
  let updatedHierarchyViews = 0;
  let verifiedHierarchyViews = 0;

  for (const tableName of expectedTableNames) {
    const sourceTable = sourceByName.get(tableName);
    const targetTable = targetByName.get(tableName);
    if (!sourceTable || !targetTable) {
      blockers.push(problem(
        'DOCUMENTED_VIEW_PARITY_TABLE_MISSING',
        `Documented View parity requires both Source and Target table: ${tableName}`,
        { tableName, sourcePresent: Boolean(sourceTable), targetPresent: Boolean(targetTable) },
      ));
      continue;
    }

    const sourceTableId = requireText(sourceTable.tableId, `source tableId ${tableName}`);
    const targetTableId = requireText(targetTable.tableId, `target tableId ${tableName}`);
    const [sourceFields, targetFields, sourceViews, targetViews] = await Promise.all([
      sourceClient.listFields({ tableId: sourceTableId }),
      targetClient.listFields({ tableId: targetTableId }),
      sourceClient.listViews({ tableId: sourceTableId }),
      targetClient.listViews({ tableId: targetTableId }),
    ]);
    const sourceFieldById = new Map(sourceFields.map((field) => [requireText(field.fieldId, 'source fieldId'), field]));
    const targetFieldByName = uniqueByFieldName(targetFields, tableName);
    const targetViewByName = uniqueByViewName(targetViews, tableName);

    for (const sourceViewSummary of sourceViews) {
      const sourceView = typeof sourceClient.getView === 'function'
        ? await sourceClient.getView({
            tableId: sourceTableId,
            viewId: requireText(sourceViewSummary.viewId, `source viewId ${tableName}`),
          })
        : sourceViewSummary;
      const hierarchy = sourceView?.property?.hierarchyConfig ?? null;
      const sourceHierarchyFieldId = readHierarchyFieldId(hierarchy);
      if (!sourceHierarchyFieldId) continue;
      representedHierarchyViews += 1;

      const sourceField = sourceFieldById.get(sourceHierarchyFieldId);
      if (!sourceField) {
        blockers.push(problem(
          'DOCUMENTED_VIEW_PARITY_HIERARCHY_SOURCE_FIELD_MISSING',
          `Hierarchy View references an unknown Source field: ${tableName}.${sourceView.viewName}`,
          { tableName, viewName: sourceView.viewName, sourceHierarchyFieldId },
        ));
        continue;
      }
      const targetField = targetFieldByName.get(requireText(sourceField.fieldName, 'source hierarchy fieldName'));
      const targetView = targetViewByName.get(requireText(sourceView.viewName, 'source viewName'));
      if (!targetField || !targetView) {
        blockers.push(problem(
          'DOCUMENTED_VIEW_PARITY_TARGET_REFERENCE_MISSING',
          `Hierarchy View cannot be remapped in Target: ${tableName}.${sourceView.viewName}`,
          {
            tableName,
            viewName: sourceView.viewName,
            targetFieldPresent: Boolean(targetField),
            targetViewPresent: Boolean(targetView),
          },
        ));
        continue;
      }

      const targetFieldId = requireText(targetField.fieldId, 'target hierarchy fieldId');
      const targetViewId = requireText(targetView.viewId, 'target hierarchy viewId');
      const before = await targetClient.getViewHierarchy({ tableId: targetTableId, viewId: targetViewId });
      if (before?.fieldId !== targetFieldId) {
        await targetClient.updateViewHierarchy({
          tableId: targetTableId,
          viewId: targetViewId,
          viewName: sourceView.viewName,
          fieldId: targetFieldId,
        });
        updatedHierarchyViews += 1;
      }
      const after = await targetClient.getViewHierarchy({ tableId: targetTableId, viewId: targetViewId });
      if (after?.fieldId !== targetFieldId) {
        blockers.push(problem(
          'DOCUMENTED_VIEW_PARITY_HIERARCHY_READBACK_MISMATCH',
          `Hierarchy View read-back does not match Source mapping: ${tableName}.${sourceView.viewName}`,
          { tableName, viewName: sourceView.viewName, expectedFieldId: targetFieldId, actualFieldId: after?.fieldId ?? null },
        ));
        continue;
      }
      verifiedHierarchyViews += 1;
    }
  }

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: 'customer_base_documented_view_parity_v1',
    phase: 'post-consolidation-documented-view-parity',
    coverage: {
      hierarchyConfig: 'documented-write-and-readback',
      unsupportedPropertiesNotSent: true,
    },
    representedHierarchyViews,
    updatedHierarchyViews,
    verifiedHierarchyViews,
    blockers,
  });
}

/**
 * Read-only plan for exact displayed-field order using the documented Base v3
 * `visible_fields` View property. Hidden membership must already match Source;
 * this lane is allowed to change order only.
 */
export async function planLarkBaseDocumentedVisibleFieldOrderParity(input) {
  const sourceClient = requireVisibleOrderSourceClient(input?.sourceClient);
  const targetClient = requireVisibleOrderTargetClient(input?.targetClient);
  const expectedTableNames = normalizeNames(input?.expectedTableNames);
  const [sourceTables, targetTables] = await Promise.all([
    sourceClient.listTables(),
    targetClient.listTables(),
  ]);
  const sourceByName = uniqueByName(sourceTables, 'source table');
  const targetByName = uniqueByName(targetTables, 'target table');
  const blockers = [];
  const steps = [];
  let representedViews = 0;
  let exactViews = 0;
  let mismatchedViews = 0;

  for (const tableName of expectedTableNames) {
    const sourceTable = sourceByName.get(tableName);
    const targetTable = targetByName.get(tableName);
    if (!sourceTable || !targetTable) {
      blockers.push(problem(
        'VISIBLE_FIELD_ORDER_TABLE_MISSING',
        `Visible-field order parity requires both Source and Target table: ${tableName}`,
        { tableName, sourcePresent: Boolean(sourceTable), targetPresent: Boolean(targetTable) },
      ));
      continue;
    }

    const sourceTableId = requireText(sourceTable.tableId, `source tableId ${tableName}`);
    const targetTableId = requireText(targetTable.tableId, `target tableId ${tableName}`);
    const [sourceFields, targetFields, sourceViews, targetViews] = await Promise.all([
      sourceClient.listFields({ tableId: sourceTableId }),
      targetClient.listFields({ tableId: targetTableId }),
      sourceClient.listViews({ tableId: sourceTableId }),
      targetClient.listViews({ tableId: targetTableId }),
    ]);
    const sourceFieldById = new Map(sourceFields.map((field) => [requireText(field?.fieldId, `source fieldId ${tableName}`), field]));
    const targetFieldByName = uniqueByFieldName(targetFields, tableName);
    const targetFieldById = new Map(targetFields.map((field) => [requireText(field?.fieldId, `target fieldId ${tableName}`), field]));
    const targetViewByName = uniqueByViewName(targetViews, tableName);
    const sourceViewNames = sourceViews.map((view) => requireText(view?.viewName, `source viewName ${tableName}`)).sort();
    const targetViewNames = targetViews.map((view) => requireText(view?.viewName, `target viewName ${tableName}`)).sort();
    if (stableJson(sourceViewNames) !== stableJson(targetViewNames)) {
      blockers.push(problem(
        'VISIBLE_FIELD_ORDER_VIEW_SET_MISMATCH',
        `Target View set differs from Source before order mutation: ${tableName}`,
        { tableName, sourceViewNames, targetViewNames },
      ));
      continue;
    }
    const sourceFieldNames = sourceFields.map((field) => requireText(field?.fieldName, `source fieldName ${tableName}`)).sort();
    const targetFieldNames = targetFields.map((field) => requireText(field?.fieldName, `target fieldName ${tableName}`)).sort();
    if (stableJson(sourceFieldNames) !== stableJson(targetFieldNames)) {
      blockers.push(problem(
        'VISIBLE_FIELD_ORDER_FIELD_SET_MISMATCH',
        `Target Field set differs from Source before order mutation: ${tableName}`,
        { tableName, sourceFieldNames, targetFieldNames },
      ));
      continue;
    }

    for (const sourceViewSummary of sourceViews) {
      const sourceView = typeof sourceClient.getView === 'function'
        ? await sourceClient.getView({
            tableId: sourceTableId,
            viewId: requireText(sourceViewSummary?.viewId, `source viewId ${tableName}`),
          })
        : sourceViewSummary;
      const viewName = requireText(sourceView?.viewName, `source viewName ${tableName}`);
      const targetView = targetViewByName.get(viewName);
      if (!targetView) {
        blockers.push(problem('VISIBLE_FIELD_ORDER_TARGET_VIEW_MISSING', `Target View is missing: ${tableName}.${viewName}`, { tableName, viewName }));
        continue;
      }
      if ((sourceView?.viewType ?? sourceViewSummary?.viewType ?? 'grid') !== 'grid') {
        blockers.push(problem('VISIBLE_FIELD_ORDER_VIEW_TYPE_UNSUPPORTED', `Visible-field order closeout supports cloned grid Views only: ${tableName}.${viewName}`, { tableName, viewName }));
        continue;
      }

      const sourceOrder = requireArray(sourceView?.property?.fieldOrder, `Source fieldOrder ${tableName}.${viewName}`)
        .map((fieldId, index) => requireText(fieldId, `Source fieldOrder ${tableName}.${viewName}[${index}]`));
      const sourceOrderSet = new Set(sourceOrder);
      const sourceFieldIdSet = new Set(sourceFieldById.keys());
      if (sourceOrder.length !== sourceFieldById.size || sourceOrderSet.size !== sourceOrder.length || !sameSet(sourceOrderSet, sourceFieldIdSet)) {
        blockers.push(problem(
          'VISIBLE_FIELD_ORDER_SOURCE_AUTHORITY_INVALID',
          `Source View fieldOrder is not an exact permutation of the Source table fields: ${tableName}.${viewName}`,
          { tableName, viewName, fieldOrderCount: sourceOrder.length, tableFieldCount: sourceFieldById.size },
        ));
        continue;
      }
      const hiddenSourceIds = uniqueTexts(sourceView?.property?.hiddenFields ?? [], `Source hiddenFields ${tableName}.${viewName}`);
      const unknownHidden = hiddenSourceIds.filter((fieldId) => !sourceFieldById.has(fieldId));
      if (unknownHidden.length > 0) {
        blockers.push(problem('VISIBLE_FIELD_ORDER_SOURCE_HIDDEN_FIELD_UNKNOWN', `Source hidden field is outside its table: ${tableName}.${viewName}`, { tableName, viewName, unknownHidden }));
        continue;
      }
      const hiddenSet = new Set(hiddenSourceIds);
      const desiredVisibleSourceIds = sourceOrder.filter((fieldId) => !hiddenSet.has(fieldId));
      const desiredVisibleTargetIds = [];
      const desiredVisibleNames = [];
      for (const sourceFieldId of desiredVisibleSourceIds) {
        const sourceField = sourceFieldById.get(sourceFieldId);
        const fieldName = requireText(sourceField?.fieldName, `Source fieldName ${tableName}.${viewName}`);
        const targetField = targetFieldByName.get(fieldName);
        if (!targetField) {
          blockers.push(problem('VISIBLE_FIELD_ORDER_TARGET_FIELD_MISSING', `Target field is missing for Source order: ${tableName}.${viewName}.${fieldName}`, { tableName, viewName, fieldName }));
          continue;
        }
        desiredVisibleNames.push(fieldName);
        desiredVisibleTargetIds.push(requireText(targetField?.fieldId, `Target fieldId ${tableName}.${fieldName}`));
      }
      if (desiredVisibleTargetIds.length !== desiredVisibleSourceIds.length) continue;

      const targetViewId = requireText(targetView?.viewId, `target viewId ${tableName}.${viewName}`);
      const currentVisibleTargetIds = await readVisibleFields(targetClient, targetTableId, targetViewId);
      const currentVisibleNames = [];
      let unknownCurrent = false;
      for (const targetFieldId of currentVisibleTargetIds) {
        const targetField = targetFieldById.get(targetFieldId);
        if (!targetField) {
          blockers.push(problem('VISIBLE_FIELD_ORDER_TARGET_READBACK_FIELD_UNKNOWN', `Target visible_fields readback references an unknown field: ${tableName}.${viewName}`, { tableName, viewName, targetFieldId }));
          unknownCurrent = true;
          continue;
        }
        currentVisibleNames.push(requireText(targetField?.fieldName, `target readback fieldName ${tableName}.${viewName}`));
      }
      if (unknownCurrent) continue;

      const currentMembership = new Set(currentVisibleTargetIds);
      const desiredMembership = new Set(desiredVisibleTargetIds);
      if (currentVisibleTargetIds.length !== currentMembership.size || desiredVisibleTargetIds.length !== desiredMembership.size || !sameSet(currentMembership, desiredMembership)) {
        blockers.push(problem(
          'VISIBLE_FIELD_ORDER_MEMBERSHIP_DRIFT',
          `Visible-field membership differs from Source; order-only mutation is blocked: ${tableName}.${viewName}`,
          {
            tableName,
            viewName,
            expectedVisibleFields: desiredVisibleNames,
            actualVisibleFields: currentVisibleNames,
          },
        ));
        continue;
      }

      representedViews += 1;
      const needsUpdate = stableJson(currentVisibleTargetIds) !== stableJson(desiredVisibleTargetIds);
      if (needsUpdate) mismatchedViews += 1;
      else exactViews += 1;
      steps.push(deepFreeze({
        tableName,
        viewName,
        targetTableId,
        targetViewId,
        beforeVisibleFieldIds: [...currentVisibleTargetIds],
        beforeVisibleFields: currentVisibleNames,
        desiredVisibleFieldIds: [...desiredVisibleTargetIds],
        desiredVisibleFields: desiredVisibleNames,
        needsUpdate,
      }));
    }
  }

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: 'customer_base_documented_visible_field_order_parity_v1',
    phase: 'documented-base-v3-visible-fields-order-plan',
    mode: 'remote-read-only',
    representedViews,
    exactViews,
    mismatchedViews,
    blockers,
    steps,
    remoteMutationCount: 0,
  });
}

/**
 * Applies exact visible column order only. It performs a full read-only plan first,
 * writes only Views whose visible membership already matches Source, verifies exact
 * ordered readback after each PUT, and rolls back every changed View on failure.
 */
export async function applyLarkBaseDocumentedVisibleFieldOrderParity(input) {
  if (input?.confirmation !== CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION) {
    throw codedError('VISIBLE_FIELD_ORDER_CONFIRMATION_REQUIRED', 'Exact visible-field order confirmation is required', {
      expected: CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
    });
  }
  const targetClient = requireVisibleOrderTargetClient(input?.targetClient);
  const onProgress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const plan = await planLarkBaseDocumentedVisibleFieldOrderParity(input);
  if (!plan.ok) {
    throw codedError('VISIBLE_FIELD_ORDER_PREFLIGHT_BLOCKED', 'Visible-field order preflight found blockers; no writes executed', { blockers: plan.blockers });
  }

  const changed = [];
  try {
    for (const step of plan.steps.filter((item) => item.needsUpdate)) {
      await writeVisibleFields(targetClient, step.targetTableId, step.targetViewId, step.desiredVisibleFieldIds);
      changed.push(step);
      const actual = await readVisibleFields(targetClient, step.targetTableId, step.targetViewId);
      if (stableJson(actual) !== stableJson(step.desiredVisibleFieldIds)) {
        throw codedError('VISIBLE_FIELD_ORDER_READBACK_MISMATCH', `Visible-field order differs after documented Base v3 write: ${step.tableName}.${step.viewName}`, {
          tableName: step.tableName,
          viewName: step.viewName,
          expectedVisibleFieldIds: step.desiredVisibleFieldIds,
          actualVisibleFieldIds: actual,
        });
      }
      onProgress(deepFreeze({ event: 'visible_field_order_updated', tableName: step.tableName, viewName: step.viewName }));
    }

    const verification = await planLarkBaseDocumentedVisibleFieldOrderParity(input);
    if (!verification.ok || verification.mismatchedViews !== 0) {
      throw codedError('VISIBLE_FIELD_ORDER_FINAL_VERIFY_FAILED', 'Visible-field order final live readback is not exact', {
        blockers: verification.blockers,
        mismatchedViews: verification.mismatchedViews,
      });
    }
    return deepFreeze({
      ok: true,
      contractVersion: 'customer_base_documented_visible_field_order_parity_v1',
      phase: 'documented-base-v3-visible-fields-order-apply',
      representedViews: verification.representedViews,
      updatedViews: changed.length,
      exactViewsBefore: plan.exactViews,
      verifiedExactViews: verification.exactViews,
      remoteMutationCount: changed.length,
      rollbackMutationCount: 0,
      blockers: [],
    });
  } catch (error) {
    const rollbackFailures = [];
    let rollbackMutationCount = 0;
    for (const step of [...changed].reverse()) {
      try {
        await writeVisibleFields(targetClient, step.targetTableId, step.targetViewId, step.beforeVisibleFieldIds);
        rollbackMutationCount += 1;
        const restored = await readVisibleFields(targetClient, step.targetTableId, step.targetViewId);
        if (stableJson(restored) !== stableJson(step.beforeVisibleFieldIds)) {
          throw new Error(`rollback readback mismatch for ${step.tableName}.${step.viewName}`);
        }
      } catch (rollbackError) {
        rollbackFailures.push({
          tableName: step.tableName,
          viewName: step.viewName,
          message: rollbackError?.message ?? String(rollbackError),
        });
      }
    }
    throw codedError(
      rollbackFailures.length === 0
        ? 'VISIBLE_FIELD_ORDER_APPLY_FAILED_ROLLED_BACK'
        : 'VISIBLE_FIELD_ORDER_APPLY_FAILED_ROLLBACK_INCOMPLETE',
      rollbackFailures.length === 0
        ? 'Visible-field order apply failed and all changed Views were restored'
        : 'Visible-field order apply failed and rollback was incomplete',
      {
        causeCode: error?.code ?? null,
        causeMessage: error?.message ?? String(error),
        changedViewCount: changed.length,
        rollbackMutationCount,
        rollbackFailures,
      },
    );
  }
}

function readHierarchyFieldId(hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object' || Array.isArray(hierarchy)) return null;
  for (const key of HIERARCHY_FIELD_KEYS) {
    const value = optionalText(hierarchy[key]);
    if (value) return value;
  }
  return null;
}

async function readVisibleFields(targetClient, tableId, viewId) {
  const response = await targetClient.requestBitableJson(
    baseV3ViewVisibleFieldsPath(targetClient.appToken, tableId, viewId),
    { method: 'GET' },
  );
  return normalizeVisibleFieldsResponse(response?.data);
}

async function writeVisibleFields(targetClient, tableId, viewId, visibleFields) {
  await targetClient.requestBitableJson(
    baseV3ViewVisibleFieldsPath(targetClient.appToken, tableId, viewId),
    {
      method: 'PUT',
      retryMode: 'rate_limit_only',
      body: { visible_fields: [...visibleFields] },
    },
  );
}

function normalizeVisibleFieldsResponse(value) {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(value?.visible_fields)
      ? value.visible_fields
      : Array.isArray(value?.visibleFields)
        ? value.visibleFields
        : null;
  if (!raw) throw new TypeError('Base v3 visible_fields response must contain an array');
  return uniqueTexts(raw, 'Base v3 visible_fields');
}

function baseV3ViewVisibleFieldsPath(appToken, tableId, viewId) {
  return `/open-apis/base/v3/bases/${encodeURIComponent(requireText(appToken, 'target appToken'))}/tables/${encodeURIComponent(requireText(tableId, 'target tableId'))}/views/${encodeURIComponent(requireText(viewId, 'target viewId'))}/visible_fields`;
}

function uniqueByName(items, label) {
  const result = new Map();
  for (const item of items) {
    const name = requireText(item?.name, `${label} name`);
    if (result.has(name)) throw new TypeError(`duplicate ${label}: ${name}`);
    result.set(name, item);
  }
  return result;
}

function uniqueByFieldName(fields, tableName) {
  const result = new Map();
  for (const field of fields) {
    const name = requireText(field?.fieldName, `field name ${tableName}`);
    if (result.has(name)) throw new TypeError(`duplicate field name: ${tableName}.${name}`);
    result.set(name, field);
  }
  return result;
}

function uniqueByViewName(views, tableName) {
  const result = new Map();
  for (const view of views) {
    const name = requireText(view?.viewName, `view name ${tableName}`);
    if (result.has(name)) throw new TypeError(`duplicate View name: ${tableName}.${name}`);
    result.set(name, view);
  }
  return result;
}

function normalizeNames(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expectedTableNames must be a non-empty array');
  const names = value.map((item) => requireText(item, 'expectedTableName'));
  if (new Set(names).size !== names.length) throw new TypeError('expectedTableNames must be unique');
  return names;
}

function requireSourceClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
  }
  return client;
}

function requireTargetClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews', 'getViewHierarchy', 'updateViewHierarchy']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`targetClient must implement ${method}()`);
  }
  return client;
}

function requireVisibleOrderSourceClient(client) {
  return requireSourceClient(client);
}

function requireVisibleOrderTargetClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews', 'requestBitableJson']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`targetClient must implement ${method}()`);
  }
  requireText(client?.appToken, 'targetClient.appToken');
  return client;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function uniqueTexts(value, name) {
  const items = requireArray(value, name).map((item, index) => requireText(item, `${name}[${index}]`));
  if (new Set(items).size !== items.length) throw new TypeError(`${name} must not contain duplicates`);
  return items;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function problem(code, message, details = {}) {
  return deepFreeze({ code, message, details: structuredClone(details) });
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
