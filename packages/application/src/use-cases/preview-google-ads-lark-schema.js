import {
  GOOGLE_ADS_LARK_SCHEMA,
  GOOGLE_ADS_LARK_SCHEMA_VERSION,
  GOOGLE_ADS_RELATIONS,
  GOOGLE_ADS_VIEW_CONTRACT,
  validateGoogleAdsLarkSchema,
  validateGoogleAdsRelationTargets,
} from '../../../config/src/google-ads-lark-schema.js';
import { planLarkSchema } from './install-lark-report-schema.js';
import {
  checkGoogleAdsMetaDependency,
  checkGoogleAdsProtectedTables,
  dedupeGoogleAdsActions,
  dedupeGoogleAdsObjects,
  googleAdsNonBlockingManualActions,
  planGoogleAdsRelations,
  planGoogleAdsStandaloneSelectOptions,
  planGoogleAdsViews,
  summarizeGoogleAdsPreview,
} from './google-ads-schema-planning.js';

/**
 * วางแผน Google Ads Schema แบบ Read-only:
 * - Meta/shared dependency ต้องเสร็จก่อน
 * - Canonical Ads เดิมห้ามถูกสร้างซ้ำ
 * - Existing fields เปลี่ยนได้เฉพาะเติม Select options แบบ Add-only
 * - Link และ View ที่อ้าง Table ใหม่ถูก Deferred จนรู้ Table ID จริง
 */
export async function previewGoogleAdsLarkSchema(input = {}) {
  const client = requirePreviewClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema ?? GOOGLE_ADS_LARK_SCHEMA;
  const relations = input.relations ?? GOOGLE_ADS_RELATIONS;
  const viewContract = input.viewContract ?? GOOGLE_ADS_VIEW_CONTRACT;
  const schemaVersion = input.schemaVersion ?? GOOGLE_ADS_LARK_SCHEMA_VERSION;
  const validateSchema = input.validateSchema ?? validateGoogleAdsLarkSchema;

  validateSchema(schema);
  validateGoogleAdsRelationTargets(schema);

  const liveTables = await client.listTables();
  const fieldsCache = new Map();
  const planningClient = {
    async listTables() { return liveTables; },
    async listFields({ tableId }) {
      if (!fieldsCache.has(tableId)) {
        fieldsCache.set(tableId, await client.listFields({ tableId }));
      }
      return fieldsCache.get(tableId);
    },
  };

  const basePlan = await planLarkSchema({
    client: planningClient,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });
  const schemaByKey = new Map(schema.map((table) => [table.key, table]));
  const resolvedByKey = new Map(
    basePlan.resolvedTables.map((table) => [table.tableKey, table]),
  );
  const conflicts = [...basePlan.conflicts];
  const warnings = [...basePlan.warnings];
  const blockingManualActions = [...basePlan.manualActions];
  const skippedExistingFieldMutations = [];
  const actions = [];

  const metaChecks = checkGoogleAdsMetaDependency(liveTables);
  conflicts.push(...metaChecks.conflicts);

  const protectedChecks = checkGoogleAdsProtectedTables(liveTables);
  for (const check of protectedChecks) {
    if (check.ambiguous) {
      conflicts.push({
        code: 'PROTECTED_TABLE_AMBIGUOUS',
        tableName: check.logicalName,
        message: `พบ Protected table ${check.logicalName} มากกว่าหนึ่งตาราง`,
      });
    } else if (!check.found) {
      warnings.push({
        code: 'PROTECTED_TABLE_NOT_FOUND',
        tableName: check.logicalName,
        message: `ไม่พบ Protected table ${check.logicalName} ใน Base ที่ Preview`,
      });
    }
  }

  for (const action of basePlan.actions) {
    const tableContract = schemaByKey.get(action.tableKey);
    if (!tableContract) {
      conflicts.push({
        code: 'GOOGLE_ADS_UNKNOWN_TABLE_ACTION',
        tableKey: action.tableKey,
        message: `พบ Action ที่ไม่อยู่ใน Google Ads schema: ${action.tableKey}`,
      });
      continue;
    }
    if (tableContract.googleAds?.role === 'existing_canonical_extension') {
      if (action.kind === 'create_table') {
        conflicts.push({
          code: 'GOOGLE_ADS_CANONICAL_TABLE_MISSING',
          tableKey: tableContract.key,
          tableName: tableContract.logicalName,
          message: `ไม่พบ Canonical table ${tableContract.logicalName}; Google Apply ห้ามสร้างตารางนี้ซ้ำ`,
        });
        continue;
      }
      if (
        action.kind === 'update_field'
        && !String(action.reason ?? '').includes('add_select_options')
      ) {
        skippedExistingFieldMutations.push({
          tableKey: tableContract.key,
          tableName: tableContract.logicalName,
          fieldName: action.field?.fieldName ?? null,
          reason: action.reason ?? 'existing_field_metadata_preserved',
        });
        continue;
      }
    }
    if (!new Set(['create_table', 'create_field', 'update_field']).has(action.kind)) {
      conflicts.push({
        code: 'GOOGLE_ADS_BASE_ACTION_NOT_ALLOWED',
        kind: action.kind,
        tableKey: action.tableKey,
        message: `Google Ads base schema ไม่อนุญาต Action ${action.kind}`,
      });
      continue;
    }
    actions.push(action);
  }

  const createTableKeys = new Set(
    actions.filter((action) => action.kind === 'create_table')
      .map((action) => action.tableKey),
  );

  const planningInput = {
    schema,
    resolvedByKey,
    createTableKeys,
    fieldsCache,
    planningClient,
  };
  const standaloneOptions = await planGoogleAdsStandaloneSelectOptions(planningInput);
  actions.push(...standaloneOptions.actions);
  conflicts.push(...standaloneOptions.conflicts);

  const relationPlan = await planGoogleAdsRelations({
    ...planningInput,
    relations,
  });
  actions.push(...relationPlan.actions);
  conflicts.push(...relationPlan.conflicts);

  const viewPlan = await planGoogleAdsViews({
    client,
    env: { ...env, ...basePlan.environmentUpdates },
    contract: viewContract,
    resolvedByKey,
    createTableKeys,
  });
  actions.push(...viewPlan.actions);
  conflicts.push(...viewPlan.conflicts);
  warnings.push(...viewPlan.warnings);
  blockingManualActions.push(...viewPlan.manualActions);

  const uniqueActions = dedupeGoogleAdsActions(actions);
  const uniqueConflicts = dedupeGoogleAdsObjects(conflicts);
  const uniqueWarnings = dedupeGoogleAdsObjects(warnings);
  const uniqueBlockingManualActions = dedupeGoogleAdsObjects(blockingManualActions);
  const nonBlockingManualActions = googleAdsNonBlockingManualActions();
  const ready = (
    uniqueConflicts.length === 0
    && uniqueWarnings.length === 0
    && uniqueBlockingManualActions.length === 0
    && protectedChecks.every((check) => check.found && !check.ambiguous)
    && metaChecks.ready
  );

  return deepFreeze({
    mode: 'read_only_preview',
    schemaVersion,
    readyForApplyAuthorization: ready,
    applyImplemented: true,
    metaDependencyReady: metaChecks.ready,
    summary: summarizeGoogleAdsPreview({
      liveTables,
      schema,
      actions: uniqueActions,
      conflicts: uniqueConflicts,
      warnings: uniqueWarnings,
      blockingManualActions: uniqueBlockingManualActions,
      protectedChecks,
    }),
    metaChecks: metaChecks.checks,
    protectedChecks,
    resolvedTables: basePlan.resolvedTables,
    actions: uniqueActions,
    conflicts: uniqueConflicts,
    warnings: uniqueWarnings,
    blockingManualActions: uniqueBlockingManualActions,
    nonBlockingManualActions,
    skippedExistingFieldMutations,
    environmentUpdates: basePlan.environmentUpdates,
    safety: {
      liveMutationPerformed: false,
      sourceApiCalled: false,
      businessRecordRead: false,
      businessRecordWrite: false,
      renameAction: false,
      deleteAction: false,
      fieldTypeMutation: false,
      protectedTableMutation: false,
      connectorChanged: false,
      scheduleChanged: false,
    },
  });
}

function requirePreviewClient(client) {
  for (const method of ['listTables', 'listFields', 'listViews', 'getView']) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Google Ads schema Preview requires client.${method}`);
    }
  }
  return client;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
