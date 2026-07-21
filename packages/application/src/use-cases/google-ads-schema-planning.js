import { normalizeLarkFieldProperty } from '../../../shared/src/lark/lark-field-contract.js';
import {
  PROTECTED_LARK_TABLES,
  canonicalTableName,
} from '../../../config/src/lark-table-governance.js';
import {
  GOOGLE_ADS_NON_BLOCKING_MANUAL_ACTIONS,
  GOOGLE_ADS_SELECT_OPTION_RULES,
} from '../../../config/src/google-ads-lark-schema.js';
import { planLarkReportViews } from './install-lark-report-views.js';

const META_REQUIRED_TABLES = Object.freeze([
  'RAW_Meta_Organic_Accounts',
  'RAW_Meta_Organic_Content',
  'RAW_Meta_Organic_Metrics',
  'RAW_Ads_Entities',
  'RAW_Ads_Daily',
  'MKT_Account_Daily',
  'MKT_Ads_Ads',
]);

const META_LEGACY_TABLES = Object.freeze([
  'RAW_TikTok_Business_Campaigns',
  'RAW_TikTok_Business_AdGroups',
  'RAW_TikTok_Business_Ads',
  'RAW_Google_Campaigns',
  'RAW_Google_Customer_Lists',
]);

export function checkGoogleAdsMetaDependency(liveTables) {
  const byName = groupTablesByName(liveTables);
  const checks = [];
  const conflicts = [];
  for (const logicalName of META_REQUIRED_TABLES) {
    const matches = byName.get(canonicalTableName(logicalName)) ?? [];
    const check = {
      logicalName,
      found: matches.length === 1,
      ambiguous: matches.length > 1,
      tableId: matches.length === 1 ? matches[0].tableId : null,
    };
    checks.push(check);
    if (!check.found) {
      conflicts.push({
        code: check.ambiguous
          ? 'GOOGLE_ADS_META_DEPENDENCY_AMBIGUOUS'
          : 'GOOGLE_ADS_META_DEPENDENCY_NOT_READY',
        tableName: logicalName,
        message: check.ambiguous
          ? `พบ Meta/shared dependency ${logicalName} มากกว่าหนึ่งตาราง`
          : `ยังไม่พบ Meta/shared dependency ${logicalName}; ต้อง Apply Meta และ Zero-drift ก่อน Google`,
      });
    }
  }
  for (const legacyName of META_LEGACY_TABLES) {
    const matches = byName.get(canonicalTableName(legacyName)) ?? [];
    checks.push({
      logicalName: legacyName,
      legacy: true,
      found: matches.length > 0,
      ambiguous: matches.length > 1,
      tableId: matches.length === 1 ? matches[0].tableId : null,
    });
    if (matches.length > 0) {
      conflicts.push({
        code: 'GOOGLE_ADS_META_LEGACY_TABLE_REMAINS',
        tableName: legacyName,
        message: `ยังพบตารางก่อน Meta cutover ${legacyName}; ห้ามเริ่ม Google Apply`,
      });
    }
  }
  return {
    ready: conflicts.length === 0,
    checks: deepFreeze(checks),
    conflicts,
  };
}

export function checkGoogleAdsProtectedTables(liveTables) {
  const byName = groupTablesByName(liveTables);
  return PROTECTED_LARK_TABLES.map((table) => {
    const matches = byName.get(canonicalTableName(table.logicalName)) ?? [];
    return {
      ...table,
      found: matches.length === 1,
      ambiguous: matches.length > 1,
      tableId: matches.length === 1 ? matches[0].tableId : null,
      plannedActions: 0,
    };
  });
}

export async function planGoogleAdsStandaloneSelectOptions(input) {
  const actions = [];
  const conflicts = [];
  const schemaFieldNames = new Map(input.schema.map((table) => [
    table.key,
    new Set(table.fields.map((field) => normalizeName(field.fieldName))),
  ]));

  for (const tableContract of input.schema) {
    if (!new Set(['existing_canonical_extension', 'new_canonical'])
      .has(tableContract.googleAds?.role)) continue;
    const resolved = input.resolvedByKey.get(tableContract.key);
    if (!resolved?.tableId) continue;
    const liveFields = await readFields(input, resolved.tableId);
    const desiredByField = new Map();

    for (const rule of GOOGLE_ADS_SELECT_OPTION_RULES) {
      if (!optionRuleTargetsTable(rule, tableContract.logicalName)) continue;
      const key = normalizeName(rule.field);
      const options = desiredByField.get(key) ?? [];
      options.push(rule.option);
      desiredByField.set(key, options);
    }

    for (const [normalizedFieldName, desiredOptions] of desiredByField) {
      if (schemaFieldNames.get(tableContract.key)?.has(normalizedFieldName)) continue;
      const live = liveFields.find((field) => normalizeName(field.fieldName) === normalizedFieldName);
      if (!live) continue;
      if (!new Set([3, 4]).has(Number(live.type))) {
        conflicts.push({
          code: 'GOOGLE_ADS_SELECT_FIELD_TYPE_MISMATCH',
          tableKey: tableContract.key,
          tableId: resolved.tableId,
          fieldName: live.fieldName,
          actualType: live.type,
          message: `Field ${tableContract.logicalName}.${live.fieldName} ไม่ใช่ Select จึงเติม Option ไม่ได้`,
        });
        continue;
      }

      const liveProperty = normalizeLarkFieldProperty(live.type, live.property) ?? {};
      const existingOptions = Array.isArray(liveProperty.options) ? liveProperty.options : [];
      const existingNames = new Set(
        existingOptions.map((option) => normalizeName(option?.name)).filter(Boolean),
      );
      if (desiredOptions.includes('google_other_ads') && existingNames.has('google_other')) {
        conflicts.push({
          code: 'GOOGLE_ADS_OTHER_CHANNEL_OPTION_DECISION_REQUIRED',
          tableKey: tableContract.key,
          tableId: resolved.tableId,
          fieldName: live.fieldName,
          existingOption: 'google_other',
          requestedOption: 'google_other_ads',
          message: `พบ google_other อยู่แล้วใน ${tableContract.logicalName}.${live.fieldName}; ห้ามเพิ่ม google_other_ads ซ้ำความหมายโดยไม่มี Decision`,
        });
        continue;
      }
      const missing = [...new Set(desiredOptions)]
        .filter((name) => !existingNames.has(normalizeName(name)));
      if (missing.length === 0) continue;
      actions.push({
        kind: 'update_field',
        tableKey: tableContract.key,
        logicalName: tableContract.logicalName,
        tableId: resolved.tableId,
        tableName: resolved.name,
        fieldId: live.fieldId,
        field: {
          fieldName: live.fieldName,
          type: live.type,
          uiType: live.uiType,
          description: live.description,
          property: {
            ...liveProperty,
            options: [
              ...existingOptions,
              ...missing.map((name, index) => ({
                name,
                color: (existingOptions.length + index) % 8,
              })),
            ],
          },
        },
        reason: `add_select_options:${missing.join(',')}`,
      });
    }
  }
  return { actions, conflicts };
}

export async function planGoogleAdsRelations(input) {
  const actions = [];
  const conflicts = [];
  for (const relation of input.relations) {
    const source = input.resolvedByKey.get(relation.sourceTableKey);
    const target = input.resolvedByKey.get(relation.targetTableKey);
    const sourceWillExist = Boolean(source?.tableId)
      || input.createTableKeys.has(relation.sourceTableKey);
    const targetWillExist = Boolean(target?.tableId)
      || input.createTableKeys.has(relation.targetTableKey);

    if (!sourceWillExist || !targetWillExist) {
      conflicts.push({
        code: 'GOOGLE_ADS_RELATION_TABLE_NOT_RESOLVED',
        sourceTableKey: relation.sourceTableKey,
        targetTableKey: relation.targetTableKey,
        fieldName: relation.field.fieldName,
        message: `Resolve Relation ไม่ได้ ${relation.sourceTableName}.${relation.field.fieldName} → ${relation.targetTableName}`,
      });
      continue;
    }

    if (!source?.tableId || !target?.tableId) {
      actions.push({
        kind: 'create_relation_field',
        tableKey: relation.sourceTableKey,
        tableId: source?.tableId ?? null,
        tableName: relation.sourceTableName,
        targetTableKey: relation.targetTableKey,
        targetTableId: target?.tableId ?? null,
        targetTableName: relation.targetTableName,
        field: relation.field,
        deferredUntilTablesExist: true,
      });
      continue;
    }

    const liveFields = await readFields(input, source.tableId);
    const live = liveFields.find((field) => (
      normalizeName(field.fieldName) === normalizeName(relation.field.fieldName)
    ));
    const desiredMultiple = relation.field.property?.multiple === true;
    if (!live) {
      actions.push({
        kind: 'create_relation_field',
        tableKey: relation.sourceTableKey,
        tableId: source.tableId,
        tableName: source.name,
        targetTableKey: relation.targetTableKey,
        targetTableId: target.tableId,
        targetTableName: target.name,
        field: {
          ...relation.field,
          property: {
            ...(relation.field.property ?? {}),
            table_id: target.tableId,
            multiple: desiredMultiple,
          },
        },
      });
      continue;
    }

    if (Number(live.type) !== 18) {
      conflicts.push({
        code: 'GOOGLE_ADS_RELATION_FIELD_TYPE_MISMATCH',
        tableKey: relation.sourceTableKey,
        tableId: source.tableId,
        fieldName: relation.field.fieldName,
        expectedType: 18,
        actualType: live.type,
        message: `Relation field type ไม่ตรง ${relation.sourceTableName}.${relation.field.fieldName}`,
      });
      continue;
    }
    const property = normalizeLarkFieldProperty(live.type, live.property) ?? {};
    if (property.table_id !== target.tableId || Boolean(property.multiple) !== desiredMultiple) {
      conflicts.push({
        code: 'GOOGLE_ADS_RELATION_TARGET_MISMATCH',
        tableKey: relation.sourceTableKey,
        tableId: source.tableId,
        fieldName: relation.field.fieldName,
        expectedTargetTableId: target.tableId,
        actualTargetTableId: property.table_id ?? null,
        expectedMultiple: desiredMultiple,
        actualMultiple: Boolean(property.multiple),
        message: `Relation เดิมของ ${relation.sourceTableName}.${relation.field.fieldName} ไม่ตรง Contract และห้ามเปลี่ยนอัตโนมัติ`,
      });
    }
  }
  return { actions, conflicts };
}

export async function planGoogleAdsViews(input) {
  const resolvedContract = [];
  const deferredActions = [];
  const conflicts = [];
  const physicalContract = mergeGoogleAdsViewContract(input.contract);
  for (const tableContract of physicalContract) {
    const resolved = input.resolvedByKey.get(tableContract.tableKey);
    if (resolved?.tableId) {
      input.env[tableContract.envName] = resolved.tableId;
      resolvedContract.push(tableContract);
      continue;
    }
    if (input.createTableKeys.has(tableContract.tableKey)) {
      for (const view of tableContract.views) {
        deferredActions.push({
          kind: 'create_view',
          tableKey: tableContract.tableKey,
          tableId: null,
          viewName: view.name,
          deferredUntilTableExists: true,
        });
      }
      continue;
    }
    conflicts.push({
      code: 'GOOGLE_ADS_VIEW_TABLE_NOT_RESOLVED',
      tableKey: tableContract.tableKey,
      message: `Resolve Table สำหรับ Google Ads View ไม่ได้: ${tableContract.tableKey}`,
    });
  }

  if (resolvedContract.length === 0) {
    return { actions: deferredActions, conflicts, warnings: [], manualActions: [] };
  }
  const planned = await planLarkReportViews({
    client: readOnlyViewPlanningClient(input.client),
    env: input.env,
    contract: resolvedContract,
    includePermissionManualAction: false,
  });
  return {
    actions: [...planned.actions, ...deferredActions],
    conflicts: [...conflicts, ...planned.conflicts],
    warnings: planned.warnings,
    manualActions: planned.manualActions,
  };
}

export function dedupeGoogleAdsActions(actions) {
  const bySignature = new Map();
  for (const action of actions) {
    const signature = actionSignature(action);
    const current = bySignature.get(signature);
    if (!current) {
      bySignature.set(signature, action);
      continue;
    }
    if (action.kind === 'update_field' && current.kind === 'update_field') {
      const currentOptions = current.field?.property?.options ?? [];
      const nextOptions = action.field?.property?.options ?? [];
      const optionByName = new Map([...currentOptions, ...nextOptions]
        .filter((option) => option?.name)
        .map((option) => [normalizeName(option.name), option]));
      bySignature.set(signature, {
        ...current,
        field: {
          ...current.field,
          property: {
            ...(current.field?.property ?? {}),
            ...(action.field?.property ?? {}),
            options: [...optionByName.values()],
          },
        },
        reason: [...new Set([current.reason, action.reason].filter(Boolean))].join('+'),
      });
    }
  }
  return [...bySignature.values()];
}

export function dedupeGoogleAdsObjects(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const signature = JSON.stringify(value);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(value);
  }
  return result;
}

export function summarizeGoogleAdsPreview(input) {
  const count = (kind) => input.actions.filter((action) => action.kind === kind).length;
  return {
    liveTables: input.liveTables.length,
    tablesInScope: input.schema.length,
    rawTables: input.schema.filter((table) => table.googleAds?.role === 'raw').length,
    createTables: count('create_table'),
    createFields: count('create_field'),
    updateFields: count('update_field'),
    createRelationFields: count('create_relation_field'),
    deferredRelationFields: input.actions.filter((action) => (
      action.kind === 'create_relation_field' && action.deferredUntilTablesExist === true
    )).length,
    createViews: count('create_view'),
    updateViews: count('update_view'),
    conflicts: input.conflicts.length,
    warnings: input.warnings.length,
    blockingManualActions: input.blockingManualActions.length,
    protectedTables: input.protectedChecks.length,
    protectedActions: 0,
    renameActions: 0,
    deleteActions: 0,
    recordWrites: 0,
  };
}

export function googleAdsNonBlockingManualActions() {
  return GOOGLE_ADS_NON_BLOCKING_MANUAL_ACTIONS;
}

async function readFields(input, tableId) {
  if (!input.fieldsCache.has(tableId)) {
    input.fieldsCache.set(tableId, await input.planningClient.listFields({ tableId }));
  }
  return input.fieldsCache.get(tableId);
}

function optionRuleTargetsTable(rule, tableName) {
  if (rule.scope === 'RAW/MKT') return tableName.startsWith('MKT_Ads_');
  if (rule.scope === 'MKT_Ads_*') return tableName.startsWith('MKT_Ads_');
  if (rule.scope === 'Canonical status') return tableName.startsWith('MKT_Ads_');
  return rule.scope === tableName;
}

function mergeGoogleAdsViewContract(contract) {
  const byTableKey = new Map();
  for (const table of contract ?? []) {
    const current = byTableKey.get(table.tableKey);
    if (!current) {
      byTableKey.set(table.tableKey, {
        tableKey: table.tableKey,
        envName: table.envName,
        views: [...table.views],
      });
      continue;
    }
    if (current.envName !== table.envName) {
      throw new TypeError(`Google Ads View envName mismatch for ${table.tableKey}`);
    }
    current.views.push(...table.views);
  }
  return [...byTableKey.values()];
}

function readOnlyViewPlanningClient(client) {
  return {
    async listFields(input) { return client.listFields(input); },
    async listViews(input) { return client.listViews(input); },
    async getView(input) { return client.getView(input); },
    async createView() {
      throw new Error('Google Ads View Preview attempted createView');
    },
    async updateView() {
      throw new Error('Google Ads View Preview attempted updateView');
    },
  };
}

function groupTablesByName(tables) {
  const groups = new Map();
  for (const table of tables) {
    const name = canonicalTableName(table?.name);
    if (!name) continue;
    const group = groups.get(name) ?? [];
    group.push(table);
    groups.set(name, group);
  }
  return groups;
}

function actionSignature(action) {
  return [
    action.kind,
    action.tableKey ?? '',
    action.tableId ?? '',
    action.fieldId ?? action.field?.fieldName ?? '',
    action.viewName ?? '',
    action.targetTableKey ?? '',
  ].join('\u0000');
}

function normalizeName(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    : '';
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
