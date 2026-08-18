const HIERARCHY_FIELD_KEYS = Object.freeze(['fieldId', 'field_id']);

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

function readHierarchyFieldId(hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object' || Array.isArray(hierarchy)) return null;
  for (const key of HIERARCHY_FIELD_KEYS) {
    const value = optionalText(hierarchy[key]);
    if (value) return value;
  }
  return null;
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
