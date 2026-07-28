#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeClassificationDictionaryRecords,
  doesRuleApplyToContext,
} from '../packages/application/src/services/classification-dictionary.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';
import { extractWranglerD1Rows } from './lib/tiktok-post-lark-rollout-operator.js';
import {
  buildTikTokClassificationSelectOptionPlan,
  buildTikTokCourseLevelIncidentReadSql,
  buildTikTokCourseLevelIncidentResetSql,
  TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION,
  TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT,
  validateTikTokCourseLevelIncidentResetRow,
  validateTikTokCourseLevelIncidentState,
} from './lib/tiktok-course-level-schema-recovery.js';

const REPOSITORY_ROOT = resolve(process.cwd());
const DATABASE_NAME = 'social-mkt-state-dev';
const DEFAULT_SAFE_CONFIG = 'wrangler.sync.tiktok-rollout-safe.jsonc';
const RECONCILIATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_TIKTOK_POST_LARK_RECONCILIATION',
  value: 'EXECUTE_TIKTOK_POST_LARK_RECONCILIATION',
});
let appliedLarkMutationCount = 0;
let admissionResetApplied = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    phase: 'tiktok-course-level-schema-recovery',
    code: error?.code ?? 'TIKTOK_COURSE_LEVEL_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    error: sanitizeOperationalError(error),
    appliedLarkMutationCount,
    admissionResetApplied,
    larkBusinessRecordWriteCount: 0,
    remoteD1BusinessWriteCount: 0,
    scheduleActivationCount: 0,
    productionActionCount: 0,
    retrySafe: true,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.execute) {
    printPlan();
    return;
  }

  const fileEnv = await readOptionalDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  requireExact(
    env[TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.envName],
    TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.value,
    TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.envName,
  );
  const repository = assertRepositoryState(env);
  const safeConfigPath = resolveRepositoryFile(
    env.MKT_TIKTOK_RECONCILIATION_WRANGLER_CONFIG ?? DEFAULT_SAFE_CONFIG,
  );
  await access(safeConfigPath, constants.R_OK);

  const incidentRows = runD1Query({
    env,
    configPath: safeConfigPath,
    sql: buildTikTokCourseLevelIncidentReadSql({ checkedAt: Date.now() }),
  });
  if (incidentRows.length !== 1) {
    throw operatorError(
      'TikTok course-level incident lookup did not return exactly one row',
      'TIKTOK_COURSE_LEVEL_INCIDENT_NOT_FOUND',
      { rowCount: incidentRows.length },
    );
  }
  const incidentState = validateTikTokCourseLevelIncidentState(incidentRows[0]);
  process.stdout.write('INCIDENT_EXACT_IDENTITY=PASS\n');

  const client = createLarkBitableClientFromEnv(normalizeLarkEnvAliases(env));
  const contentTableId = requireText(env.LARK_TABLE_MKT_CONTENT, 'LARK_TABLE_MKT_CONTENT');
  const dictionaryTableId = requireText(
    env.LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY,
    'LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY',
  );
  const [fieldsBefore, dictionaryRecords] = await Promise.all([
    client.listFields({ tableId: contentTableId }),
    client.listRecords({ tableId: dictionaryTableId }),
  ]);
  const dictionary = analyzeClassificationDictionaryRecords(dictionaryRecords);
  if (dictionary.invalidRows.length > 0) {
    throw operatorError(
      'Classification Dictionary contains enabled invalid rows',
      'TIKTOK_COURSE_LEVEL_DICTIONARY_INVALID',
      { invalidRowCount: dictionary.invalidRows.length },
    );
  }
  const activeTikTokOrganicRules = dictionary.rules.filter((rule) => (
    doesRuleApplyToContext(rule, { platform: 'tiktok', appliesTo: 'organic' })
  ));
  const schemaPlan = buildTikTokClassificationSelectOptionPlan({
    fields: fieldsBefore,
    rules: activeTikTokOrganicRules,
  });

  for (const action of schemaPlan.actions) {
    await client.updateField({
      tableId: contentTableId,
      fieldId: action.fieldId,
      field: action.field,
    });
    appliedLarkMutationCount += 1;
  }

  const fieldsAfter = await client.listFields({ tableId: contentTableId });
  verifyAdditiveFieldApply({ fieldsBefore, fieldsAfter, schemaPlan });
  const remainingSchemaPlan = buildTikTokClassificationSelectOptionPlan({
    fields: fieldsAfter,
    rules: activeTikTokOrganicRules,
  });
  if (!remainingSchemaPlan.alreadyReady) {
    throw operatorError(
      'TikTok classification Select options still have schema drift after Apply',
      'TIKTOK_COURSE_LEVEL_SCHEMA_VERIFY_FAILED',
      { remainingActionCount: remainingSchemaPlan.actionCount },
    );
  }
  process.stdout.write(`TIKTOK_SCHEMA_OPTIONS_ADDED=${schemaPlan.missingOptions.length}\n`);
  process.stdout.write('TIKTOK_SCHEMA_VERIFY=PASS\n');

  if (incidentState.resetRequired) {
    const resetRows = runD1Query({
      env,
      configPath: safeConfigPath,
      sql: buildTikTokCourseLevelIncidentResetSql({ updatedAt: Date.now() }),
    });
    if (resetRows.length !== 1) {
      throw operatorError(
        'TikTok failed-permanent Admission exact reset did not update one row',
        'TIKTOK_COURSE_LEVEL_INCIDENT_RESET_REJECTED',
        { rowCount: resetRows.length },
      );
    }
    validateTikTokCourseLevelIncidentResetRow(resetRows[0]);
    admissionResetApplied = true;
  }
  process.stdout.write('TIKTOK_FAILED_ADMISSION_REDRIVE=PASS\n');

  runReconciliation({ env });

  process.stdout.write([
    'TIKTOK_COURSE_LEVEL_RECOVERY=PASS',
    `REPOSITORY_HEAD=${repository.head}`,
    `LARK_SCHEMA_MUTATIONS=${appliedLarkMutationCount}`,
    `ADMISSION_RESET_APPLIED=${String(admissionResetApplied)}`,
    'LARK_BUSINESS_WRITE_OUTSIDE_RECONCILIATION=0',
    'REMOTE_D1_BUSINESS_WRITE_OUTSIDE_RECONCILIATION=0',
    'SCHEDULES_ACTIVATED=false',
    'PRODUCTION_ACTION=false',
  ].join('\n') + '\n');
}

function runReconciliation(input) {
  const result = spawnSync(
    process.execPath,
    ['scripts/tiktok-post-lark-gap-reconciliation.mjs', '--execute'],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...input.env,
        [RECONCILIATION_CONFIRMATION.envName]: RECONCILIATION_CONFIRMATION.value,
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      'TikTok guarded reconciliation failed after schema recovery',
      'TIKTOK_COURSE_LEVEL_RECONCILIATION_FAILED',
      { exitCode: result.status },
    );
  }
  if (!String(result.stdout).includes('FINAL_RECONCILIATION_RESULT=PASS_SAFE_CLOSED')
    || !String(result.stdout).includes('FINAL_ISSUE_COUNT=0')
    || !String(result.stdout).includes('IDEMPOTENT_REPLAY=true')
    || !String(result.stdout).includes('FINAL_ROUTE_STATUS=404')) {
    throw operatorError(
      'TikTok reconciliation output did not prove zero-gap safe-closed completion',
      'TIKTOK_COURSE_LEVEL_RECONCILIATION_PROOF_MISSING',
    );
  }
}

function runD1Query(input) {
  const result = spawnSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      DATABASE_NAME,
      '--remote',
      '--config',
      input.configPath,
      '--command',
      input.sql,
      '--json',
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: input.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      'Wrangler D1 command failed during TikTok course-level recovery',
      'TIKTOK_COURSE_LEVEL_D1_COMMAND_FAILED',
      { exitCode: result.status },
    );
  }
  return extractWranglerD1Rows(result.stdout);
}

function verifyAdditiveFieldApply(input) {
  const beforeByName = new Map(input.fieldsBefore.map((field) => [field.fieldName, field]));
  const afterByName = new Map(input.fieldsAfter.map((field) => [field.fieldName, field]));
  for (const action of input.schemaPlan.actions) {
    const before = beforeByName.get(action.fieldName);
    const after = afterByName.get(action.fieldName);
    if (!before || !after
      || before.fieldId !== after.fieldId
      || Number(before.type) !== Number(after.type)) {
      throw operatorError(
        'Lark field identity changed during additive Select option Apply',
        'TIKTOK_COURSE_LEVEL_SCHEMA_IDENTITY_CHANGED',
        { fieldName: action.fieldName },
      );
    }
    const beforeOptions = indexOptions(before.property?.options, action.fieldName);
    const afterOptions = indexOptions(after.property?.options, action.fieldName);
    for (const [name, previous] of beforeOptions) {
      const current = afterOptions.get(name);
      if (!current) {
        throw operatorError(
          'Existing Lark Select option disappeared during additive Apply',
          'TIKTOK_COURSE_LEVEL_SCHEMA_DESTRUCTIVE_DRIFT',
          { fieldName: action.fieldName, optionName: name },
        );
      }
      if (previous.id && current.id !== previous.id) {
        throw operatorError(
          'Existing Lark Select option ID changed during additive Apply',
          'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_ID_CHANGED',
          { fieldName: action.fieldName, optionName: name },
        );
      }
      if (previous.color !== undefined && current.color !== previous.color) {
        throw operatorError(
          'Existing Lark Select option color changed during additive Apply',
          'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_COLOR_CHANGED',
          { fieldName: action.fieldName, optionName: name },
        );
      }
    }
    for (const optionName of action.missingOptions) {
      if (!afterOptions.has(optionName)) {
        throw operatorError(
          'New Lark Select option was not visible after Apply',
          'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_NOT_APPLIED',
          { fieldName: action.fieldName, optionName },
        );
      }
    }
  }
}

function indexOptions(value, fieldName) {
  if (!Array.isArray(value)) {
    throw operatorError(
      'Lark Select options are unavailable during verification',
      'TIKTOK_COURSE_LEVEL_SCHEMA_OPTIONS_INVALID',
      { fieldName },
    );
  }
  const result = new Map();
  for (const option of value) {
    const name = requireText(option?.name, `${fieldName}.option.name`);
    if (result.has(name)) {
      throw operatorError(
        'Lark Select options contain duplicate names',
        'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_DUPLICATE',
        { fieldName, optionName: name },
      );
    }
    result.set(name, option);
  }
  return result;
}

function assertRepositoryState(env) {
  runGit(['fetch', 'origin', 'main'], env, { output: 'ignore' });
  const branch = runGit(['branch', '--show-current'], env).trim();
  const head = runGit(['rev-parse', 'HEAD'], env).trim();
  const originMain = runGit(['rev-parse', 'origin/main'], env).trim();
  const status = runGit(['status', '--porcelain', '--untracked-files=no'], env).trim();
  if (branch !== 'main' || head !== originMain || status !== '') {
    throw operatorError(
      'TikTok course-level recovery requires clean current main matching origin/main',
      'TIKTOK_COURSE_LEVEL_REPOSITORY_STATE_INVALID',
      {
        branch,
        headMatchesOriginMain: head === originMain,
        clean: status === '',
      },
    );
  }
  return Object.freeze({ branch, head, clean: true, headMatchesOriginMain: true });
}

function runGit(args, env, options = {}) {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    env,
    encoding: 'utf8',
    stdio: options.output === 'ignore' ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      `Git command failed: git ${args.join(' ')}`,
      'TIKTOK_COURSE_LEVEL_GIT_COMMAND_FAILED',
      { exitCode: result.status },
    );
  }
  return result.stdout ?? '';
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    phase: 'tiktok-course-level-schema-recovery',
    incident: {
      admissionKey: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.admissionKey,
      workKey: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.workKey,
      generation: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.generation,
      metricDate: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.metricDate,
      sourceRecordCount: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.sourceRecordCount,
      fieldName: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.fieldName,
      optionName: TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.optionName,
    },
    sequence: [
      'verify-clean-current-main',
      'read-and-verify-exact-failed-permanent-incident',
      'read-live-lark-content-fields-and-classification-dictionary',
      'append-only-missing-select-options-with-existing-option-identity-preserved',
      're-read-and-prove-zero-schema-dictionary-drift',
      'guarded-exact-admission-reset-to-failed-retryable',
      'delegate-to-existing-safe-closed-gap-reconciliation-operator',
    ],
    safety: {
      planOnlyByDefault: true,
      destructiveLarkSchemaMutation: false,
      newWatermarkOrWork: false,
      scheduleActivation: false,
      production: false,
      existingSafeCloseOperatorReused: true,
    },
    command: `${TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.envName}=${TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.value} node scripts/tiktok-course-level-schema-recovery.mjs --execute`,
  }, null, 2)}\n`);
}

function parseArgs(args) {
  if (args.length === 0) return Object.freeze({ execute: false });
  if (args.length === 1 && args[0] === '--execute') return Object.freeze({ execute: true });
  throw operatorError(
    'Unsupported TikTok course-level recovery arguments',
    'TIKTOK_COURSE_LEVEL_ARGUMENT_INVALID',
  );
}

async function readOptionalDevVars(path) {
  try {
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function normalizeLarkEnvAliases(source) {
  const env = { ...source };
  if (!env.LARK_APP_TOKEN && env.LARK_BASE_APP_TOKEN) env.LARK_APP_TOKEN = env.LARK_BASE_APP_TOKEN;
  return Object.freeze(env);
}

function resolveRepositoryFile(value) {
  const path = resolve(REPOSITORY_ROOT, requireText(value, 'config path'));
  if (!path.startsWith(`${REPOSITORY_ROOT}/`)) {
    throw operatorError(
      'TikTok course-level recovery config must stay inside the repository',
      'TIKTOK_COURSE_LEVEL_CONFIG_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(actual, expected, label) {
  if (actual !== expected) {
    throw operatorError(
      `${label} must equal the exact reviewed confirmation`,
      'TIKTOK_COURSE_LEVEL_CONFIRMATION_REQUIRED',
      { label },
    );
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokCourseLevelSchemaRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
