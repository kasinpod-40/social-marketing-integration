import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseViewManualParityManifest } from './lib/lark-base-view-manual-parity-manifest.js';
import {
  assessLarkBaseViewUiRefreshSourceAuthority,
  buildLarkBaseViewJsSdkParityPlan,
} from './lib/lark-base-view-js-sdk-parity.js';

const CHECKPOINT_SHA256 = '7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053';
const BASELINE_SOURCE_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const RETAINED_VIEW_MANIFEST_SHA256 = '7dabe74dd30291623e1620127f49f31fb2bb5d8131b36fcffe1884b5b089dc10';
const RETAINED_VIEW_MANIFEST_FILENAME = 'customer-base-view-manual-parity.json';
const DEFAULT_CHECKPOINT_FILE = join(homedir(), 'Downloads', 'customer-base-controlled-apply-checkpoint.json');
const SOURCE_NAME_PATTERN = /^Social MKT Data Hub.*\.base$/u;
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const EXPECTED_PLAN_SUMMARY = Object.freeze({
  tableCount: 32,
  viewCount: 110,
  fieldOrderAuditViews: 110,
  sortViews: 41,
  groupViews: 4,
  columnWidthViews: 70,
  columnWidthAssignments: 898,
  rowHeightViews: 110,
  frozenColumnManualViews: 110,
});
const EXPECTED_SORT_PROFILES = Object.freeze({
  'metric_date DESC': 18,
  'generated_at DESC': 13,
  'rank ASC': 5,
  'last_order_at DESC': 1,
  'last_activity_at DESC': 1,
  'rank DESC': 1,
  'source_created_at DESC': 1,
  'source_modified_at DESC': 1,
});

try {
  const checkpointFile = process.env.CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_FILE
    ?? DEFAULT_CHECKPOINT_FILE;
  const checkpoint = await readVerifiedCheckpoint(checkpointFile);
  const expectedTableNames = requireExpectedTableNames(checkpoint?.expectedTableNames);
  const sourcePaths = optionalText(process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ? [process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE.trim()]
    : await discoverSourceCandidates();

  const currentSources = [];
  for (const sourceFile of [...new Set(sourcePaths)]) {
    currentSources.push(await diagnoseSource(sourceFile, expectedTableNames));
  }

  const retainedLayoutAuthority = await diagnoseRetainedLayoutAuthority(expectedTableNames);
  const usableSources = currentSources.filter((item) => item.structuralOk && item.cloneScopeOk);
  const exactCurrentPlans = usableSources.filter((item) => item.planOk);

  console.log('\n=== COPY THIS SUMMARY JSON ===');
  console.log(JSON.stringify({
    ok: true,
    contractVersion: 'customer_base_view_ui_source_diagnostic_v2',
    stage: 'customer-base-view-ui-source-diagnostic',
    status: 'DIAGNOSTIC_COMPLETE',
    checkpoint: {
      verified: true,
      sourceAuthoritySha256: checkpoint.sourceAuthoritySha256,
      cloneTableCount: expectedTableNames.length,
    },
    retainedSortProfiles: EXPECTED_SORT_PROFILES,
    currentSources,
    retainedLayoutAuthority,
    diagnosis: {
      refreshCompatibleSourceCount: usableSources.length,
      exactRetainedCountSourceCount: exactCurrentPlans.length,
      retainedLayoutAuthorityAvailable: retainedLayoutAuthority.exactAuthorityFound,
      nextSafeResolverMode: retainedLayoutAuthority.exactAuthorityFound && usableSources.length > 0
        ? 'RETAINED_LAYOUT_AUTHORITY_PLUS_REFRESH_COMPATIBLE_CURRENT_SOURCE'
        : exactCurrentPlans.length > 0
          ? 'CURRENT_SOURCE_LAYOUT_MATCHES_RETAINED_COUNTS'
          : 'BLOCKED_NEEDS_LAYOUT_AUTHORITY_DECISION',
    },
    sourceMutationCount: 0,
    targetReadCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
} catch (error) {
  console.error('\n=== COPY THIS SUMMARY JSON ===');
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_view_ui_source_diagnostic_v2',
    stage: 'customer-base-view-ui-source-diagnostic',
    status: 'ERROR',
    code: error?.code ?? 'CUSTOMER_BASE_VIEW_UI_SOURCE_DIAGNOSTIC_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    sourceMutationCount: 0,
    targetReadCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

async function diagnoseSource(sourceFile, expectedTableNames) {
  let inspection = null;
  try {
    inspection = await inspectLarkBaseExport(sourceFile);
    const structure = assessLarkBaseViewUiRefreshSourceAuthority(inspection);
    const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
      excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
    });
    const tables = await sourceClient.listTables();
    const actualTableNames = tables.map((table) => requireText(table?.name, 'source table name'));
    const cloneScopeOk = sameUniqueNameSet(actualTableNames, expectedTableNames);
    const manifest = await buildLarkBaseViewManualParityManifest({ sourceClient });
    const plan = buildLarkBaseViewJsSdkParityPlan(manifest);
    const planMismatches = comparePlanSummary(plan?.summary);
    const sortAuthority = diagnoseSortAuthority(plan);
    const metadata = await stat(sourceFile);

    return Object.freeze({
      fileName: basename(sourceFile),
      sha256: inspection.file.sha256,
      sizeBytes: inspection.file.sizeBytes,
      mtimeMs: Number(metadata.mtimeMs),
      records: inspection.counts.records,
      structuralOk: structure.ok,
      structuralMismatches: structure.mismatches,
      cloneScopeOk,
      cloneTableCount: actualTableNames.length,
      planOk: planMismatches.length === 0,
      planSummary: plan.summary,
      planMismatches,
      sortAuthority,
    });
  } catch (error) {
    return Object.freeze({
      fileName: basename(sourceFile),
      sha256: inspection?.file?.sha256 ?? null,
      structuralOk: false,
      cloneScopeOk: false,
      planOk: false,
      code: error?.code ?? 'SOURCE_DIAGNOSTIC_FAILED',
      message: error?.message ?? String(error),
      details: error?.details ?? {},
    });
  }
}

function diagnoseSortAuthority(plan) {
  const inventory = [];
  const profileViews = new Map();

  for (const table of plan?.tables ?? []) {
    for (const view of table?.views ?? []) {
      const sort = Array.isArray(view?.mutate?.sort) ? view.mutate.sort : [];
      if (sort.length === 0) continue;
      const normalized = sort.map((rule) => ({
        fieldName: requireText(rule?.fieldName, 'sort fieldName'),
        direction: rule?.desc === true ? 'DESC' : 'ASC',
      }));
      const profile = normalized.map((rule) => `${rule.fieldName} ${rule.direction}`).join(' + ');
      const identity = `${table.tableName} → ${view.viewName}`;
      inventory.push(Object.freeze({
        tableName: table.tableName,
        viewName: view.viewName,
        profile,
        sort: Object.freeze(normalized),
      }));
      const views = profileViews.get(profile) ?? [];
      views.push(identity);
      profileViews.set(profile, views);
    }
  }

  inventory.sort((left, right) => left.tableName.localeCompare(right.tableName)
    || left.viewName.localeCompare(right.viewName));

  const profiles = [...profileViews.entries()]
    .map(([profile, views]) => Object.freeze({
      profile,
      count: views.length,
      expectedCount: EXPECTED_SORT_PROFILES[profile] ?? 0,
      delta: views.length - (EXPECTED_SORT_PROFILES[profile] ?? 0),
      views: Object.freeze([...views].sort()),
    }))
    .sort((left, right) => left.profile.localeCompare(right.profile));

  const profileMismatches = [];
  const profileNames = new Set([...Object.keys(EXPECTED_SORT_PROFILES), ...profileViews.keys()]);
  for (const profile of [...profileNames].sort()) {
    const expected = EXPECTED_SORT_PROFILES[profile] ?? 0;
    const actual = profileViews.get(profile)?.length ?? 0;
    if (expected !== actual) profileMismatches.push(Object.freeze({ profile, expected, actual, delta: actual - expected }));
  }

  return Object.freeze({
    expectedTotal: Object.values(EXPECTED_SORT_PROFILES).reduce((sum, value) => sum + value, 0),
    actualTotal: inventory.length,
    profileMismatches: Object.freeze(profileMismatches),
    profiles: Object.freeze(profiles),
    inventory: Object.freeze(inventory),
  });
}

async function diagnoseRetainedLayoutAuthority(expectedTableNames) {
  const configured = optionalText(process.env.CUSTOMER_BASE_VIEW_UI_RETAINED_MANIFEST_FILE);
  const candidates = configured
    ? [resolve(configured)]
    : [...new Set([
      resolve(RETAINED_VIEW_MANIFEST_FILENAME),
      join(homedir(), 'Desktop', RETAINED_VIEW_MANIFEST_FILENAME),
      join(homedir(), 'Downloads', RETAINED_VIEW_MANIFEST_FILENAME),
    ])];
  const checked = [];
  let exactAuthority = null;

  for (const filePath of candidates) {
    try {
      const bytes = await readFile(filePath);
      const sha256 = fingerprint(bytes);
      if (sha256 !== RETAINED_VIEW_MANIFEST_SHA256) {
        checked.push(Object.freeze({ fileName: basename(filePath), sha256, status: 'sha-mismatch' }));
        continue;
      }
      const parsed = JSON.parse(bytes.toString('utf8'));
      const manifest = extractManifest(parsed);
      const plan = buildLarkBaseViewJsSdkParityPlan(manifest);
      const tableNames = plan.tables.map((table) => table.tableName);
      const planMismatches = comparePlanSummary(plan.summary);
      const cloneScopeOk = sameUniqueNameSet(tableNames, expectedTableNames);
      checked.push(Object.freeze({
        fileName: basename(filePath),
        sha256,
        status: planMismatches.length === 0 && cloneScopeOk ? 'exact-authority' : 'exact-sha-invalid-layout',
        cloneScopeOk,
        planMismatches,
      }));
      if (planMismatches.length === 0 && cloneScopeOk) {
        exactAuthority = Object.freeze({
          fileName: basename(filePath),
          sha256,
          planSummary: plan.summary,
          sortAuthority: diagnoseSortAuthority(plan),
        });
      }
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      checked.push(Object.freeze({
        fileName: basename(filePath),
        status: 'invalid',
        code: error?.code ?? 'RETAINED_MANIFEST_INVALID',
        message: error?.message ?? String(error),
      }));
    }
  }

  return Object.freeze({
    expectedSha256: RETAINED_VIEW_MANIFEST_SHA256,
    exactAuthorityFound: Boolean(exactAuthority),
    exactAuthority,
    checked,
  });
}

function extractManifest(value) {
  if (value?.contractVersion === 'customer_base_view_manual_parity_manifest_v1') return value;
  if (value?.manifest?.contractVersion === 'customer_base_view_manual_parity_manifest_v1') return value.manifest;
  throw codedError(
    'CUSTOMER_BASE_VIEW_UI_RETAINED_MANIFEST_SHAPE_INVALID',
    'Retained View manifest file has the expected SHA but not the expected manifest contract',
  );
}

function comparePlanSummary(summary) {
  const mismatches = [];
  for (const [dimension, expected] of Object.entries(EXPECTED_PLAN_SUMMARY)) {
    const actual = summary?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  return mismatches;
}

async function discoverSourceCandidates() {
  const result = [];
  for (const directory of [join(homedir(), 'Desktop'), join(homedir(), 'Downloads')]) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && SOURCE_NAME_PATTERN.test(entry.name)) result.push(join(directory, entry.name));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return result;
}

async function readVerifiedCheckpoint(filePath) {
  const bytes = await readFile(filePath);
  const actualSha256 = fingerprint(bytes);
  if (actualSha256 !== CHECKPOINT_SHA256) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SHA_MISMATCH', 'Original controlled-Apply checkpoint changed', {
      expectedSha256: CHECKPOINT_SHA256,
      actualSha256,
    });
  }
  const checkpoint = JSON.parse(bytes.toString('utf8'));
  if (checkpoint?.sourceAuthoritySha256 !== BASELINE_SOURCE_SHA256) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_BASELINE_MISMATCH', 'Checkpoint no longer belongs to the approved Source baseline');
  }
  return checkpoint;
}

function requireExpectedTableNames(value) {
  if (!Array.isArray(value) || value.length !== 32 || value.some((item) => !optionalText(item))) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SCOPE_INVALID', 'Checkpoint must retain exactly 32 clone-scope Table names');
  }
  if (new Set(value).size !== value.length) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SCOPE_INVALID', 'Checkpoint clone-scope Table names must be unique');
  }
  return value.map((item) => item.trim());
}

function sameUniqueNameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftValues = left.map(optionalText);
  const rightValues = right.map(optionalText);
  if (leftValues.some((item) => item === null) || rightValues.some((item) => item === null)) return false;
  const leftSet = new Set(leftValues);
  const rightSet = new Set(rightValues);
  if (leftSet.size !== leftValues.length || rightSet.size !== rightValues.length) return false;
  for (const value of leftSet) if (!rightSet.has(value)) return false;
  return true;
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
