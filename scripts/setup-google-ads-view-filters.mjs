import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveConfirmedApplyMode } from './lib/confirmed-apply-mode.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { assertSharedTableSchemaDevTarget } from '../packages/config/src/shared-table-schema-runtime-config.js';
import {
  GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS,
  GOOGLE_ADS_VIEW_FILTER_VERSION,
  GOOGLE_ADS_VIEW_FILTERS,
} from '../packages/config/src/google-ads-view-filters.js';
import {
  applyLarkReportViews,
  planLarkReportViews,
} from '../packages/application/src/use-cases/install-lark-report-views.js';
import {
  assertGoogleAdsViewFilterPlanSafe,
  createNoCreateLarkViewClient,
} from '../packages/application/src/use-cases/guard-google-ads-view-filter-plan.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'UNEXPECTED_ERROR',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const baseEnv = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtime = assertSharedTableSchemaDevTarget(baseEnv, {
    operation: 'Google Ads View filter operation',
    errorCode: 'GOOGLE_ADS_VIEW_FILTER_TARGET_FORBIDDEN',
  });
  const mode = resolveConfirmedApplyMode({
    argv: process.argv.slice(2),
    env: process.env,
    operationName: 'Google Ads View filter apply',
    confirmationErrorCode: 'GOOGLE_ADS_VIEW_FILTER_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: 'CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply',
  });
  const rawClient = createLarkBitableClientFromEnv(baseEnv, {
    onRequest: process.env.MKT_VIEW_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });
  // Defense in depth: even if a View disappears between Preview and Apply,
  // this task can never call the generic createView path.
  const client = createNoCreateLarkViewClient(rawClient);
  const env = await resolveLiveTableEnvironment(client, baseEnv);

  const preview = await planLarkReportViews({
    client,
    env,
    contract: GOOGLE_ADS_VIEW_FILTERS,
    includePermissionManualAction: false,
  });
  assertGoogleAdsViewFilterPlanSafe(preview);

  if (!mode.apply) {
    printJson({
      ok: true,
      mode: preview.mode,
      viewVersion: GOOGLE_ADS_VIEW_FILTER_VERSION,
      target: { environment: runtime.environment, profileKey: runtime.profileKey },
      summary: preview.summary,
      actions: preview.actions.map(sanitizeAction),
      conflicts: preview.conflicts.map(sanitizeDiagnostic),
      warnings: preview.warnings.map(sanitizeDiagnostic),
      manualActions: GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS,
      nextCommand: preview.actions.length > 0
        ? 'CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply'
        : null,
      note: preview.actions.length === 0
        ? 'Google Ads View filters ตรง managed OpenAPI contract แล้ว'
        : 'Preview เท่านั้น: อนุญาตเฉพาะ update_view; missing View จะ Block และไม่มี create/delete/rename/record write',
    });
    return;
  }

  const result = await applyLarkReportViews({
    client,
    env,
    contract: GOOGLE_ADS_VIEW_FILTERS,
    includePermissionManualAction: false,
    onProgress: (event) => console.error(JSON.stringify({
      stage: event.stage,
      action: sanitizeAction(event.action),
    })),
  });
  printJson({
    ok: result.ok,
    mode: result.mode,
    summary: result.summary,
    verification: { summary: result.verification.summary },
    viewVersion: GOOGLE_ADS_VIEW_FILTER_VERSION,
    target: { environment: runtime.environment, profileKey: runtime.profileKey },
    manualActions: GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS,
    note: 'Apply เฉพาะ Filter ของ 19 Google Views; missing View fail-closed และห้าม create/sort/table/field/record mutation',
  });
}

async function resolveLiveTableEnvironment(client, baseEnv) {
  const liveTables = await client.listTables();
  const byName = new Map();
  for (const table of liveTables) {
    const key = normalizeName(table.name);
    const group = byName.get(key) ?? [];
    group.push(table);
    byName.set(key, group);
  }
  const env = { ...baseEnv };
  for (const table of GOOGLE_ADS_VIEW_FILTERS) {
    const matches = byName.get(normalizeName(table.tableName)) ?? [];
    if (matches.length !== 1 || typeof matches[0].tableId !== 'string' || matches[0].tableId.trim() === '') {
      const error = new Error(`Expected one exact Live table for ${table.tableKey}`);
      error.code = 'GOOGLE_ADS_VIEW_FILTER_TABLE_RESOLUTION_FAILED';
      error.details = { tableKey: table.tableKey, tableName: table.tableName, matchCount: matches.length };
      throw error;
    }
    env[table.envName] = matches[0].tableId.trim();
  }
  return Object.freeze(env);
}

function sanitizeAction(action = {}) {
  return {
    kind: action.kind ?? null,
    tableKey: action.tableKey ?? null,
    viewKey: action.viewKey ?? null,
    viewName: action.viewName ?? null,
    filterConjunction: action.property?.filterInfo?.conjunction ?? null,
    filterConditionCount: action.property?.filterInfo?.conditions?.length ?? null,
    hiddenFieldCount: action.property?.hiddenFields?.length ?? null,
  };
}

function sanitizeDiagnostic(item = {}) {
  return {
    code: item.code ?? null,
    tableKey: item.tableKey ?? null,
    fieldName: item.fieldName ?? null,
    viewName: item.viewName ?? null,
    message: item.message ?? null,
  };
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}_]+/u, '')
    .trim()
    .toLowerCase();
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
