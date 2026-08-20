const SPECIAL_FIELD_TYPES = new Set([18, 20]);
const RELATION_FIELD_TYPE = 18;
const FORMULA_FIELD_TYPE = 20;
const DEFAULT_EXPECTED_SOURCE_TABLE_COUNT = 33;
const TABLE_LIMIT = 100;

/**
 * Read-only preflight for copying every table from one Lark Base into another Base.
 * The source Base remains untouched. Existing target tables are reused only when
 * their schema and record payload are already an exact copy (special fields excluded).
 */
export async function previewLarkBaseConsolidation(input) {
  const sourceClient = requireClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeExpectedNames(input?.expectedTableNames);
  const expectedSourceTableCount = input?.expectedSourceTableCount
    ?? expectedTableNames?.length
    ?? DEFAULT_EXPECTED_SOURCE_TABLE_COUNT;

  const sourceTables = await sourceClient.listTables();
  const targetTables = await targetClient.listTables();
  const conflicts = [];
  const warnings = [];
  const tablePlans = [];

  const sourceByName = uniqueTableIndex(sourceTables, 'source', conflicts);
  const targetByName = uniqueTableIndex(targetTables, 'target', conflicts);

  if (sourceTables.length !== expectedSourceTableCount) {
    conflicts.push(problem(
      'SOURCE_TABLE_COUNT_MISMATCH',
      `Source Base must contain exactly ${expectedSourceTableCount} tables; found ${sourceTables.length}`,
      { expected: expectedSourceTableCount, actual: sourceTables.length },
    ));
  }

  if (expectedTableNames) {
    for (const name of expectedTableNames) {
      if (!sourceByName.has(name)) {
        conflicts.push(problem('SOURCE_TABLE_MISSING', `Source Base is missing required table: ${name}`, { name }));
      }
    }
    for (const table of sourceTables) {
      if (!expectedTableNames.includes(table.name)) {
        conflicts.push(problem('SOURCE_TABLE_UNEXPECTED', `Source Base contains unexpected table: ${table.name}`, { name: table.name }));
      }
    }
  }

  let sourceRecordCount = 0;
  let sourceFieldCount = 0;
  let sourceViewCount = 0;
  let createTableCount = 0;
  let reuseTableCount = 0;

  for (const sourceTable of sourceTables) {
    const sourceSnapshot = await loadTableSnapshot(sourceClient, sourceTable);
    sourceRecordCount += sourceSnapshot.records.length;
    sourceFieldCount += sourceSnapshot.fields.length;
    sourceViewCount += sourceSnapshot.views.length;

    const primary = validatePrimary(sourceSnapshot, conflicts);
    validateFormulaDependencies(sourceSnapshot, conflicts);
    validateRelationTargets(sourceSnapshot, sourceByName, conflicts);

    const targetTable = targetByName.get(sourceTable.name) ?? null;
    if (!targetTable) {
      createTableCount += 1;
      tablePlans.push(freezePlan({
        name: sourceTable.name,
        sourceTableId: sourceTable.tableId,
        targetTableId: null,
        action: 'create',
        primaryFieldName: primary?.fieldName ?? null,
        fieldCount: sourceSnapshot.fields.length,
        recordCount: sourceSnapshot.records.length,
        viewCount: sourceSnapshot.views.length,
        relationFieldCount: countFieldType(sourceSnapshot.fields, RELATION_FIELD_TYPE),
        formulaFieldCount: countFieldType(sourceSnapshot.fields, FORMULA_FIELD_TYPE),
      }));
      continue;
    }

    const reuse = await inspectExistingTargetTable({
      sourceSnapshot,
      targetClient,
      targetTable,
      primary,
    });
    if (!reuse.ok) {
      conflicts.push(problem(
        'TARGET_TABLE_CONFLICT',
        `Target Base already contains non-identical table: ${sourceTable.name}`,
        { name: sourceTable.name, reasons: reuse.reasons, diagnostics: reuse.diagnostics },
      ));
      continue;
    }

    reuseTableCount += 1;
    warnings.push(problem(
      'TARGET_TABLE_REUSED',
      `Target table already matches source and will be reused without record writes: ${sourceTable.name}`,
      { name: sourceTable.name, targetTableId: targetTable.tableId },
    ));
    tablePlans.push(freezePlan({
      name: sourceTable.name,
      sourceTableId: sourceTable.tableId,
      targetTableId: targetTable.tableId,
      action: 'reuse_exact',
      primaryFieldName: primary?.fieldName ?? null,
      fieldCount: sourceSnapshot.fields.length,
      recordCount: sourceSnapshot.records.length,
      viewCount: sourceSnapshot.views.length,
      relationFieldCount: countFieldType(sourceSnapshot.fields, RELATION_FIELD_TYPE),
      formulaFieldCount: countFieldType(sourceSnapshot.fields, FORMULA_FIELD_TYPE),
    }));
  }

  if (targetTables.length + createTableCount > TABLE_LIMIT) {
    conflicts.push(problem(
      'TARGET_TABLE_LIMIT_EXCEEDED',
      `Target Base would exceed the ${TABLE_LIMIT}-table API safety boundary`,
      { currentTargetTables: targetTables.length, createTableCount, resultingTables: targetTables.length + createTableCount },
    ));
  }

  const manualActions = Object.freeze([
    problem(
      'BASE_FOLDER_PLACEMENT_MANUAL',
      'OpenAPI does not expose the internal Base navigation-folder placement used by Setup Phase | Social MKT Data Hub; move the cloned tables into that folder in the Lark UI after verification.',
    ),
    problem(
      'DASHBOARD_AUTOMATION_PERMISSION_PARITY_SEPARATE',
      'This operator consolidates tables, fields, records and supported view properties only. Keep the standalone full Base copy as the fidelity source for dashboards, automations/workflows and advanced-permission configuration until those are closed separately.',
    ),
    ...(reuseTableCount > 0 ? [problem(
      'PREEXISTING_TABLE_REVIEW',
      'One or more exact target tables are reused. If a reused table is a cross-Base sync table, remove its sync configuration in the Lark UI only after final parity verification.',
    )] : []),
  ]);

  return deepFreeze({
    ok: conflicts.length === 0,
    mode: 'preview',
    contractVersion: 'customer_base_consolidation_v1',
    readyToApply: conflicts.length === 0,
    summary: {
      sourceTables: sourceTables.length,
      sourceFields: sourceFieldCount,
      sourceRecords: sourceRecordCount,
      sourceViews: sourceViewCount,
      targetTablesBefore: targetTables.length,
      createTables: createTableCount,
      reuseExactTables: reuseTableCount,
      targetTablesAfter: targetTables.length + createTableCount,
      conflicts: conflicts.length,
      warnings: warnings.length,
      manualActions: manualActions.length,
    },
    tables: tablePlans,
    conflicts: Object.freeze(conflicts),
    warnings: Object.freeze(warnings),
    manualActions,
  });
}

/**
 * Applies a preflight-clean consolidation. No deletes are performed.
 * Missing tables are created with primary fields first, then ordinary fields,
 * relations, formulas, records, relation cells, and supported view properties.
 */
export async function applyLarkBaseConsolidation(input) {
  const sourceClient = requireClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const onProgress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const preview = await previewLarkBaseConsolidation(input);
  if (!preview.readyToApply) {
    throw codedError('CUSTOMER_BASE_CONSOLIDATION_PREFLIGHT_BLOCKED', 'Customer Base consolidation preflight has conflicts', {
      conflicts: preview.conflicts,
    });
  }

  const sourceTables = await sourceClient.listTables();
  const sourceSnapshots = new Map();
  for (const sourceTable of sourceTables) {
    sourceSnapshots.set(sourceTable.tableId, await loadTableSnapshot(sourceClient, sourceTable));
  }

  const targetTablesBefore = await targetClient.listTables();
  const targetByName = new Map(targetTablesBefore.map((table) => [table.name, table]));
  const targetTableIdBySourceId = new Map();
  const createdTargetTableIds = new Set();
  const fieldIdMaps = new Map();
  const applied = {
    createdTables: 0,
    createdFields: 0,
    createdRecords: 0,
    updatedRelationRecords: 0,
    createdViews: 0,
    updatedViews: 0,
  };

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const primary = requirePrimary(snapshot);
    const existing = targetByName.get(sourceTable.name) ?? null;
    if (existing) {
      targetTableIdBySourceId.set(sourceTable.tableId, existing.tableId);
      onProgress(event('reuse_table', sourceTable.name, { targetTableId: existing.tableId }));
      continue;
    }

    onProgress(event('create_table_start', sourceTable.name));
    const created = await targetClient.createTable({
      name: sourceTable.name,
      defaultViewName: snapshot.views[0]?.viewName ?? 'Grid',
      fields: [fieldMutation(primary)],
    });
    const targetTableId = requireText(created?.tableId, 'created target tableId');
    targetTableIdBySourceId.set(sourceTable.tableId, targetTableId);
    createdTargetTableIds.add(targetTableId);
    targetByName.set(sourceTable.name, created);
    applied.createdTables += 1;
    onProgress(event('create_table_complete', sourceTable.name, { targetTableId }));
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    const targetFields = await targetClient.listFields({ tableId: targetTableId });
    const byName = uniqueFieldIndex(targetFields, sourceTable.name);
    const map = new Map();
    for (const sourceField of snapshot.fields) {
      const targetField = byName.get(sourceField.fieldName);
      if (targetField) map.set(sourceField.fieldId, targetField.fieldId);
    }
    fieldIdMaps.set(sourceTable.tableId, map);
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const fieldMap = fieldIdMaps.get(sourceTable.tableId);
    for (const sourceField of snapshot.fields) {
      if (sourceField.isPrimary || SPECIAL_FIELD_TYPES.has(Number(sourceField.type))) continue;
      const created = await targetClient.createField({ tableId: targetTableId, field: fieldMutation(sourceField) });
      fieldMap.set(sourceField.fieldId, requireText(created?.fieldId, 'created target fieldId'));
      applied.createdFields += 1;
    }
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const fieldMap = fieldIdMaps.get(sourceTable.tableId);
    for (const sourceField of snapshot.fields.filter((field) => Number(field.type) === RELATION_FIELD_TYPE)) {
      const property = remapRelationProperty(sourceField.property, targetTableIdBySourceId);
      const created = await targetClient.createField({
        tableId: targetTableId,
        field: fieldMutation(sourceField, property),
      });
      fieldMap.set(sourceField.fieldId, requireText(created?.fieldId, 'created target relation fieldId'));
      applied.createdFields += 1;
    }
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const fieldMap = fieldIdMaps.get(sourceTable.tableId);
    for (const sourceField of snapshot.fields.filter((field) => Number(field.type) === FORMULA_FIELD_TYPE)) {
      const property = remapFormulaProperty(sourceField.property, targetTableIdBySourceId, fieldIdMaps);
      const created = await targetClient.createField({
        tableId: targetTableId,
        field: fieldMutation(sourceField, property),
      });
      fieldMap.set(sourceField.fieldId, requireText(created?.fieldId, 'created target formula fieldId'));
      applied.createdFields += 1;
    }
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const specialNames = new Set(snapshot.fields
      .filter((field) => SPECIAL_FIELD_TYPES.has(Number(field.type)))
      .map((field) => field.fieldName));
    const payload = snapshot.records.map((record) => {
      const fields = {};
      for (const [fieldName, value] of Object.entries(record.fields ?? {})) {
        if (specialNames.has(fieldName)) continue;
        fields[fieldName] = structuredClone(value);
      }
      return fields;
    });
    const result = await targetClient.batchCreateRecords({ tableId: targetTableId, records: payload });
    applied.createdRecords += Number(result?.created ?? 0);
  }

  const recordIdMaps = new Map();
  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const primary = requirePrimary(snapshot);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    const targetRecords = await targetClient.listRecords({ tableId: targetTableId });
    const targetByPrimary = indexRecordsByPrimary(targetRecords, primary.fieldName, `target ${sourceTable.name}`);
    const sourceToTarget = new Map();
    for (const sourceRecord of snapshot.records) {
      const key = canonicalPrimaryValue(sourceRecord.fields?.[primary.fieldName]);
      const targetRecord = targetByPrimary.get(key);
      if (!targetRecord) {
        throw codedError('CUSTOMER_BASE_CONSOLIDATION_RECORD_MAP_MISSING', `Target record missing after copy: ${sourceTable.name} ${key}`);
      }
      sourceToTarget.set(sourceRecord.recordId, targetRecord.recordId);
    }
    if (sourceToTarget.size !== snapshot.records.length || targetRecords.length !== snapshot.records.length) {
      throw codedError('CUSTOMER_BASE_CONSOLIDATION_RECORD_COUNT_MISMATCH', `Record mapping mismatch for ${sourceTable.name}`, {
        sourceRecords: snapshot.records.length,
        targetRecords: targetRecords.length,
        mappedRecords: sourceToTarget.size,
      });
    }
    recordIdMaps.set(sourceTable.tableId, sourceToTarget);
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const sourceRecordMap = recordIdMaps.get(sourceTable.tableId);
    const relationFields = snapshot.fields.filter((field) => Number(field.type) === RELATION_FIELD_TYPE);
    if (relationFields.length === 0) continue;
    const updates = [];
    for (const sourceRecord of snapshot.records) {
      const fields = {};
      for (const relationField of relationFields) {
        const sourceLinkedIds = extractRelationRecordIds(sourceRecord.fields?.[relationField.fieldName]);
        if (sourceLinkedIds.length === 0) continue;
        const relatedSourceTableId = requireText(relationField.property?.table_id, 'relation property.table_id');
        const relatedRecordMap = recordIdMaps.get(relatedSourceTableId);
        if (!relatedRecordMap) {
          throw codedError('CUSTOMER_BASE_CONSOLIDATION_RELATION_TABLE_UNMAPPED', `Relation target table is not mapped for ${sourceTable.name}.${relationField.fieldName}`);
        }
        fields[relationField.fieldName] = sourceLinkedIds.map((recordId) => {
          const mapped = relatedRecordMap.get(recordId);
          if (!mapped) {
            throw codedError('CUSTOMER_BASE_CONSOLIDATION_RELATION_RECORD_UNMAPPED', `Relation target record is not mapped for ${sourceTable.name}.${relationField.fieldName}`, { recordId });
          }
          return mapped;
        });
      }
      if (Object.keys(fields).length > 0) {
        updates.push({
          recordId: requireText(sourceRecordMap.get(sourceRecord.recordId), 'mapped target recordId'),
          fields,
        });
      }
    }
    if (updates.length > 0) {
      const result = await targetClient.batchUpdateRecords({ tableId: targetTableId, records: updates });
      applied.updatedRelationRecords += Number(result?.updated ?? 0);
    }
  }

  for (const sourceTable of sourceTables) {
    const snapshot = sourceSnapshots.get(sourceTable.tableId);
    const targetTableId = targetTableIdBySourceId.get(sourceTable.tableId);
    if (!createdTargetTableIds.has(targetTableId)) continue;
    const targetFieldMap = fieldIdMaps.get(sourceTable.tableId);
    const targetViews = await targetClient.listViews({ tableId: targetTableId });
    const targetViewsByName = new Map(targetViews.map((view) => [view.viewName, view]));

    for (const sourceView of snapshot.views) {
      let targetView = targetViewsByName.get(sourceView.viewName) ?? null;
      if (!targetView) {
        targetView = await targetClient.createView({
          tableId: targetTableId,
          viewName: sourceView.viewName,
          viewType: sourceView.viewType ?? 'grid',
        });
        targetViewsByName.set(sourceView.viewName, targetView);
        applied.createdViews += 1;
      }
      const mutation = remapViewMutation(sourceView, targetFieldMap);
      if (mutation) {
        await targetClient.updateView({ tableId: targetTableId, viewId: targetView.viewId, ...mutation });
        applied.updatedViews += 1;
      }
    }
  }

  const verification = await verifyLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: input?.expectedTableNames,
    expectedSourceTableCount: input?.expectedSourceTableCount,
  });
  if (!verification.ok) {
    throw codedError('CUSTOMER_BASE_CONSOLIDATION_VERIFICATION_FAILED', 'Customer Base consolidation writes completed but verification is not clean', {
      verification,
      applied,
    });
  }

  return deepFreeze({
    ok: true,
    mode: 'apply',
    contractVersion: 'customer_base_consolidation_v1',
    applied,
    verification,
    manualActions: preview.manualActions,
  });
}

/** Verify table/field/record/view parity without mutating either Base. */
export async function verifyLarkBaseConsolidation(input) {
  const sourceClient = requireClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireClient(input?.targetClient, 'targetClient');
  const sourceTables = await sourceClient.listTables();
  const targetTables = await targetClient.listTables();
  const targetByName = new Map(targetTables.map((table) => [table.name, table]));
  const mismatches = [];
  let sourceFields = 0;
  let sourceRecords = 0;
  let sourceViews = 0;

  for (const sourceTable of sourceTables) {
    const targetTable = targetByName.get(sourceTable.name);
    if (!targetTable) {
      mismatches.push(problem('VERIFY_TABLE_MISSING', `Target table missing: ${sourceTable.name}`));
      continue;
    }
    const source = await loadTableSnapshot(sourceClient, sourceTable);
    const target = await loadTableSnapshot(targetClient, targetTable);
    sourceFields += source.fields.length;
    sourceRecords += source.records.length;
    sourceViews += source.views.length;

    const fieldMismatch = compareFieldShape(source.fields, target.fields);
    if (fieldMismatch.length > 0) {
      mismatches.push(problem('VERIFY_FIELD_MISMATCH', `Field mismatch: ${sourceTable.name}`, { reasons: fieldMismatch }));
    }
    const primary = requirePrimary(source);
    const sourcePrimary = indexRecordsByPrimary(source.records, primary.fieldName, `source ${sourceTable.name}`);
    const targetPrimary = indexRecordsByPrimary(target.records, primary.fieldName, `target ${sourceTable.name}`);
    if (!sameKeySet(sourcePrimary, targetPrimary)) {
      mismatches.push(problem('VERIFY_RECORD_PRIMARY_SET_MISMATCH', `Record primary-key set mismatch: ${sourceTable.name}`, {
        sourceRecords: source.records.length,
        targetRecords: target.records.length,
      }));
    }

    const sourceViewNames = source.views.map((view) => view.viewName).sort();
    const targetViewNames = target.views.map((view) => view.viewName).sort();
    if (JSON.stringify(sourceViewNames) !== JSON.stringify(targetViewNames)) {
      mismatches.push(problem('VERIFY_VIEW_NAME_MISMATCH', `View-name mismatch: ${sourceTable.name}`, {
        sourceViewNames,
        targetViewNames,
      }));
    }
  }

  return deepFreeze({
    ok: mismatches.length === 0,
    mode: 'verify',
    summary: {
      sourceTables: sourceTables.length,
      sourceFields,
      sourceRecords,
      sourceViews,
      targetTables: targetTables.length,
      mismatches: mismatches.length,
    },
    mismatches: Object.freeze(mismatches),
  });
}

async function loadTableSnapshot(client, table) {
  const fields = await client.listFields({ tableId: table.tableId });
  const records = await client.listRecords({ tableId: table.tableId });
  const listedViews = await client.listViews({ tableId: table.tableId });
  const views = [];
  for (const listedView of listedViews) {
    if (typeof client.getView !== 'function') {
      views.push(listedView);
      continue;
    }
    const detailedView = await client.getView({ tableId: table.tableId, viewId: listedView.viewId });
    views.push(mergeListedAndDetailedView(listedView, detailedView));
  }
  return deepFreeze({ table, fields, records, views });
}

function mergeListedAndDetailedView(listedView, detailedView) {
  const listed = structuredClone(listedView ?? {});
  const detailed = structuredClone(detailedView ?? {});
  return {
    ...listed,
    ...detailed,
    viewId: detailed.viewId ?? listed.viewId ?? null,
    viewName: detailed.viewName ?? listed.viewName ?? null,
    viewType: detailed.viewType ?? listed.viewType ?? null,
    publicLevel: detailed.publicLevel ?? listed.publicLevel ?? null,
    property: {
      ...(listed.property && typeof listed.property === 'object' ? listed.property : {}),
      ...(detailed.property && typeof detailed.property === 'object' ? detailed.property : {}),
    },
  };
}

async function inspectExistingTargetTable(input) {
  const targetSnapshot = await loadTableSnapshot(input.targetClient, input.targetTable);
  const diagnostics = [];
  const reasons = [
    ...compareFieldShape(input.sourceSnapshot.fields, targetSnapshot.fields),
    ...compareReusableFieldConfig(input.sourceSnapshot.fields, targetSnapshot.fields, diagnostics),
    ...compareReusableViewConfig(input.sourceSnapshot, targetSnapshot, diagnostics),
  ];
  const sourceHasSpecial = input.sourceSnapshot.fields.some((field) => SPECIAL_FIELD_TYPES.has(Number(field.type)));
  if (sourceHasSpecial) reasons.push('pre-existing target table contains relation/formula fields and is not eligible for automatic reuse');
  if (input.primary) {
    try {
      const sourceByPrimary = indexRecordsByPrimary(input.sourceSnapshot.records, input.primary.fieldName, `source ${input.sourceSnapshot.table.name}`);
      const targetByPrimary = indexRecordsByPrimary(targetSnapshot.records, input.primary.fieldName, `target ${input.targetTable.name}`);
      if (!sameKeySet(sourceByPrimary, targetByPrimary)) reasons.push('primary-key record set differs');
      if (reasons.length === 0) {
        for (const key of sourceByPrimary.keys()) {
          const sourceRecord = sourceByPrimary.get(key);
          const targetRecord = targetByPrimary.get(key);
          if (canonicalRecordPayload(sourceRecord.fields) !== canonicalRecordPayload(targetRecord.fields)) {
            reasons.push(`record payload differs for primary key ${key}`);
            break;
          }
        }
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  return { ok: reasons.length === 0, reasons, diagnostics };
}

function validatePrimary(snapshot, conflicts) {
  const primaries = snapshot.fields.filter((field) => field.isPrimary === true);
  if (primaries.length !== 1) {
    conflicts.push(problem('PRIMARY_FIELD_INVALID', `Table ${snapshot.table.name} must have exactly one primary field`, { count: primaries.length }));
    return null;
  }
  const primary = primaries[0];
  if (Number(primary.type) !== 1) {
    conflicts.push(problem('PRIMARY_FIELD_NOT_TEXT', `Table ${snapshot.table.name} primary field must be Text for deterministic record mapping`, { type: primary.type }));
    return primary;
  }
  try {
    indexRecordsByPrimary(snapshot.records, primary.fieldName, `source ${snapshot.table.name}`);
  } catch (error) {
    conflicts.push(problem('PRIMARY_FIELD_NOT_UNIQUE', error.message));
  }
  return primary;
}

function validateFormulaDependencies(snapshot, conflicts) {
  const formulaIds = new Set(snapshot.fields.filter((field) => Number(field.type) === FORMULA_FIELD_TYPE).map((field) => field.fieldId));
  for (const field of snapshot.fields.filter((item) => Number(item.type) === FORMULA_FIELD_TYPE)) {
    const expression = field.property?.formula_expression;
    if (typeof expression !== 'string') {
      conflicts.push(problem('FORMULA_EXPRESSION_MISSING', `Formula field missing formula_expression: ${snapshot.table.name}.${field.fieldName}`));
      continue;
    }
    for (const dependency of extractFormulaFieldIds(expression)) {
      if (formulaIds.has(dependency)) {
        conflicts.push(problem('FORMULA_CHAIN_UNSUPPORTED', `Formula-to-formula dependency requires an explicit dependency order: ${snapshot.table.name}.${field.fieldName}`, { dependency }));
      }
    }
  }
}

function validateRelationTargets(snapshot, sourceByName, conflicts) {
  const sourceIds = new Set([...sourceByName.values()].map((table) => table.tableId));
  for (const field of snapshot.fields.filter((item) => Number(item.type) === RELATION_FIELD_TYPE)) {
    const tableId = field.property?.table_id;
    if (!tableId || !sourceIds.has(tableId)) {
      conflicts.push(problem('RELATION_TARGET_OUTSIDE_SOURCE', `Relation target is outside the source Base: ${snapshot.table.name}.${field.fieldName}`, { tableId: tableId ?? null }));
    }
  }
}

function fieldMutation(field, propertyOverride = undefined) {
  return {
    fieldName: requireText(field?.fieldName, 'fieldName'),
    type: Number(field?.type),
    ...(field?.uiType ? { uiType: field.uiType } : {}),
    ...(field?.description ? { description: field.description } : {}),
    ...(propertyOverride !== undefined
      ? (propertyOverride ? { property: structuredClone(propertyOverride) } : {})
      : (field?.property ? { property: structuredClone(field.property) } : {})),
  };
}

function remapRelationProperty(property, targetTableIdBySourceId) {
  const result = structuredClone(property ?? {});
  const sourceTargetId = requireText(result.table_id, 'relation property.table_id');
  const targetTableId = targetTableIdBySourceId.get(sourceTargetId);
  if (!targetTableId) throw codedError('CUSTOMER_BASE_CONSOLIDATION_RELATION_TABLE_UNMAPPED', `Relation table is not mapped: ${sourceTargetId}`);
  result.table_id = targetTableId;
  delete result.table_name;
  return result;
}

function remapFormulaProperty(property, targetTableIdBySourceId, fieldIdMaps) {
  const result = structuredClone(property ?? {});
  let expression = requireText(result.formula_expression, 'formula property.formula_expression');
  for (const [sourceTableId, targetTableId] of targetTableIdBySourceId.entries()) {
    expression = replaceAllLiteral(expression, sourceTableId, targetTableId);
  }
  for (const fieldMap of fieldIdMaps.values()) {
    for (const [sourceFieldId, targetFieldId] of fieldMap.entries()) {
      expression = replaceAllLiteral(expression, sourceFieldId, targetFieldId);
    }
  }
  const unresolvedTables = extractFormulaTableIds(expression).filter((id) => targetTableIdBySourceId.has(id));
  const unresolvedFields = extractFormulaFieldIds(expression).filter((id) => {
    for (const fieldMap of fieldIdMaps.values()) if (fieldMap.has(id)) return true;
    return false;
  });
  if (unresolvedTables.length > 0 || unresolvedFields.length > 0) {
    throw codedError('CUSTOMER_BASE_CONSOLIDATION_FORMULA_REMAP_INCOMPLETE', 'Formula remap left source IDs behind', { unresolvedTables, unresolvedFields });
  }
  result.formula_expression = expression;
  return result;
}

function remapViewMutation(sourceView, targetFieldMap) {
  const property = sourceView?.property ?? {};
  const hiddenFields = (property.hiddenFields ?? []).map((sourceFieldId) => targetFieldMap.get(sourceFieldId)).filter(Boolean);
  const filterInfo = property.filterInfo
    ? {
        conjunction: property.filterInfo.conjunction,
        conditions: (property.filterInfo.conditions ?? []).map((condition) => ({
          fieldId: requireText(targetFieldMap.get(condition.fieldId), 'mapped view filter fieldId'),
          fieldType: condition.fieldType,
          operator: condition.operator,
          value: condition.value,
        })),
      }
    : null;
  if (hiddenFields.length === 0 && !filterInfo) return null;
  return {
    ...(hiddenFields.length > 0 ? { hiddenFields } : {}),
    ...(filterInfo ? { filterInfo } : {}),
  };
}

function extractRelationRecordIds(value) {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  for (const item of values) {
    if (typeof item === 'string') {
      if (item.trim()) result.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object') {
      const id = item.record_id ?? item.recordId ?? item.id;
      if (typeof id === 'string' && id.trim()) result.push(id.trim());
    }
  }
  return [...new Set(result)];
}

function compareFieldShape(sourceFields, targetFields) {
  const reasons = [];
  if (sourceFields.length !== targetFields.length) reasons.push(`field count ${targetFields.length} != ${sourceFields.length}`);
  const targetByName = new Map(targetFields.map((field) => [field.fieldName, field]));
  for (const source of sourceFields) {
    const target = targetByName.get(source.fieldName);
    if (!target) {
      reasons.push(`missing field ${source.fieldName}`);
      continue;
    }
    if (Number(target.type) !== Number(source.type)) reasons.push(`field type mismatch ${source.fieldName}: ${target.type} != ${source.type}`);
    if (Boolean(target.isPrimary) !== Boolean(source.isPrimary)) reasons.push(`primary flag mismatch ${source.fieldName}`);
  }
  return reasons;
}

function compareReusableFieldConfig(sourceFields, targetFields, diagnostics = []) {
  const reasons = [];
  const targetByName = new Map(targetFields.map((field) => [field.fieldName, field]));
  for (const source of sourceFields) {
    const target = targetByName.get(source.fieldName);
    if (!target) continue;
    if (normalizeOptionalText(target.uiType) !== normalizeOptionalText(source.uiType)) {
      reasons.push(`field uiType mismatch ${source.fieldName}: ${String(target.uiType)} != ${String(source.uiType)}`);
    }
    if (normalizeDescription(target.description) !== normalizeDescription(source.description)) {
      reasons.push(`field description mismatch ${source.fieldName}`);
    }
    const sourceProperty = comparableReusableFieldProperty(source.property, source.type);
    const targetProperty = comparableReusableFieldProperty(target.property, target.type);
    if (stableJson(targetProperty) !== stableJson(sourceProperty)) {
      reasons.push(`field property mismatch ${source.fieldName}`);
      diagnostics.push({
        kind: 'field_property',
        fieldName: source.fieldName,
        differencePaths: collectDifferencePaths(sourceProperty, targetProperty).slice(0, 24),
      });
    }
  }
  return reasons;
}

function compareReusableViewConfig(sourceSnapshot, targetSnapshot, diagnostics = []) {
  const reasons = [];
  const sourceViews = sourceSnapshot.views ?? [];
  const targetViews = targetSnapshot.views ?? [];
  if (sourceViews.length !== targetViews.length) {
    reasons.push(`view count ${targetViews.length} != ${sourceViews.length}`);
  }

  const targetByName = new Map();
  for (const view of targetViews) {
    if (targetByName.has(view.viewName)) {
      reasons.push(`duplicate target view ${view.viewName}`);
      continue;
    }
    targetByName.set(view.viewName, view);
  }

  const sourceFieldIdToTargetFieldId = sourceToTargetFieldIdMap(sourceSnapshot.fields, targetSnapshot.fields);
  for (const sourceView of sourceViews) {
    const targetView = targetByName.get(sourceView.viewName);
    if (!targetView) {
      reasons.push(`missing view ${sourceView.viewName}`);
      continue;
    }
    const sourceComparable = canonicalReusableView(sourceView, sourceFieldIdToTargetFieldId);
    const targetComparable = canonicalReusableView(targetView);
    if (stableJson(sourceComparable) !== stableJson(targetComparable)) {
      reasons.push(`view configuration mismatch ${sourceView.viewName}`);
      diagnostics.push({
        kind: 'view_configuration',
        viewName: sourceView.viewName,
        differencePaths: collectDifferencePaths(sourceComparable, targetComparable).slice(0, 24),
      });
    }
  }
  return reasons;
}

function sourceToTargetFieldIdMap(sourceFields, targetFields) {
  const targetByName = new Map(targetFields.map((field) => [field.fieldName, field]));
  const result = new Map();
  for (const sourceField of sourceFields) {
    const targetField = targetByName.get(sourceField.fieldName);
    if (targetField?.fieldId) result.set(sourceField.fieldId, targetField.fieldId);
  }
  return result;
}

function comparableReusableFieldProperty(property, type = null) {
  const result = property && typeof property === 'object' && !Array.isArray(property)
    ? structuredClone(property)
    : {};
  if (Number(type) === 5) {
    result.date_formatter = normalizeOptionalText(result.date_formatter) ?? 'yyyy/MM/dd';
    result.auto_fill = result.auto_fill === true;
  }
  if (Array.isArray(result.options)) {
    result.options = result.options.map((option) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
      const clone = { ...option };
      delete clone.id;
      return clone;
    });
  }
  return Object.keys(result).length > 0 ? sortObject(result) : null;
}

function canonicalReusableFieldProperty(property, type = null) {
  return stableJson(comparableReusableFieldProperty(property, type));
}

function canonicalReusableView(view, sourceFieldIdToTargetFieldId = null) {
  const mapFieldId = (fieldId) => sourceFieldIdToTargetFieldId
    ? (sourceFieldIdToTargetFieldId.get(fieldId) ?? `__unmapped__:${fieldId}`)
    : fieldId;
  const property = view?.property ?? {};
  const hiddenFields = (Array.isArray(property.hiddenFields) ? property.hiddenFields : [])
    .map(mapFieldId)
    .sort();
  const filterInfo = property.filterInfo
    ? {
        conjunction: property.filterInfo.conjunction === 'or' ? 'or' : 'and',
        conditions: (Array.isArray(property.filterInfo.conditions) ? property.filterInfo.conditions : []).map((condition) => ({
          fieldId: mapFieldId(condition.fieldId),
          fieldType: Number(condition.fieldType),
          operator: condition.operator,
          value: condition.value === undefined ? null : structuredClone(condition.value),
        })),
      }
    : null;
  return sortObject({
    viewType: normalizeOptionalText(view?.viewType),
    publicLevel: normalizeReusablePublicLevel(view?.publicLevel),
    hiddenFields,
    filterInfo,
  });
}

function normalizeReusablePublicLevel(value) {
  if (value === 0 || value === '0') return 'Public';
  const normalized = normalizeOptionalText(value);
  if (normalized === null) return null;
  const lower = normalized.toLowerCase();
  if (lower === 'public') return 'Public';
  if (lower === 'locked') return 'Locked';
  if (lower === 'private') return 'Private';
  return normalized;
}

function normalizeDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function indexRecordsByPrimary(records, fieldName, label) {
  const result = new Map();
  for (const record of records) {
    const key = canonicalPrimaryValue(record?.fields?.[fieldName]);
    if (!key) throw codedError('CUSTOMER_BASE_CONSOLIDATION_PRIMARY_EMPTY', `${label} contains an empty primary value in field ${fieldName}`);
    if (result.has(key)) throw codedError('CUSTOMER_BASE_CONSOLIDATION_PRIMARY_DUPLICATE', `${label} contains duplicate primary value ${key} in field ${fieldName}`);
    result.set(key, record);
  }
  return result;
}

function canonicalPrimaryValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.text ?? item.name ?? '';
      return '';
    }).join('').trim();
  }
  if (value && typeof value === 'object') return String(value.text ?? value.name ?? '').trim();
  return '';
}

function canonicalRecordPayload(fields) {
  return JSON.stringify(sortObject(fields ?? {}));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function collectDifferencePaths(left, right, path = '$', result = []) {
  if (Object.is(left, right)) return result;
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!(leftArray && rightArray)) {
      result.push(path);
      return result;
    }
    if (left.length !== right.length) result.push(`${path}.length`);
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferencePaths(left[index], right[index], `${path}[${index}]`, result);
    }
    return result;
  }
  const leftObject = left !== null && typeof left === 'object';
  const rightObject = right !== null && typeof right === 'object';
  if (leftObject || rightObject) {
    if (!(leftObject && rightObject)) {
      result.push(path);
      return result;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) {
        result.push(`${path}.${key}`);
        continue;
      }
      collectDifferencePaths(left[key], right[key], `${path}.${key}`, result);
    }
    return result;
  }
  result.push(path);
  return result;
}

function extractFormulaTableIds(expression) {
  return [...String(expression).matchAll(/\$table\[([^\]]+)\]/gu)].map((match) => match[1]);
}

function extractFormulaFieldIds(expression) {
  return [...String(expression).matchAll(/\$field\[([^\]]+)\]/gu)].map((match) => match[1]);
}

function replaceAllLiteral(text, source, target) {
  return String(text).split(source).join(target);
}

function uniqueTableIndex(tables, label, conflicts) {
  const result = new Map();
  for (const table of tables) {
    if (!table?.name) {
      conflicts.push(problem('TABLE_NAME_MISSING', `${label} Base contains a table without a name`));
      continue;
    }
    if (result.has(table.name)) {
      conflicts.push(problem('TABLE_NAME_DUPLICATE', `${label} Base contains duplicate table name: ${table.name}`));
      continue;
    }
    result.set(table.name, table);
  }
  return result;
}

function uniqueFieldIndex(fields, tableName) {
  const result = new Map();
  for (const field of fields) {
    if (result.has(field.fieldName)) throw codedError('CUSTOMER_BASE_CONSOLIDATION_DUPLICATE_FIELD', `Duplicate field name in target ${tableName}: ${field.fieldName}`);
    result.set(field.fieldName, field);
  }
  return result;
}

function sameKeySet(left, right) {
  if (left.size !== right.size) return false;
  for (const key of left.keys()) if (!right.has(key)) return false;
  return true;
}

function requirePrimary(snapshot) {
  const primaries = snapshot.fields.filter((field) => field.isPrimary === true);
  if (primaries.length !== 1) throw codedError('CUSTOMER_BASE_CONSOLIDATION_PRIMARY_INVALID', `Expected one primary field in ${snapshot.table.name}`);
  return primaries[0];
}

function normalizeExpectedNames(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expectedTableNames must be a non-empty array');
  return [...new Set(value.map((name) => requireText(name, 'expectedTableName')))];
}

function requireClient(client, name) {
  if (!client || typeof client.listTables !== 'function') throw new TypeError(`${name} must be a Lark Bitable-compatible client`);
  return client;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function countFieldType(fields, type) {
  return fields.filter((field) => Number(field.type) === type).length;
}

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: deepFreeze(structuredClone(details)) });
}

function freezePlan(value) {
  return Object.freeze(value);
}

function event(stage, tableName, details = {}) {
  return Object.freeze({ stage, tableName, ...details });
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
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
