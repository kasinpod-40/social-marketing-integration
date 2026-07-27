#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHATWOOT_LARK_BLUEPRINT } from '../packages/config/src/chatwoot-lark-blueprint.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  analyzeChatwootLarkMetadata,
  discoverChatwootLarkTables,
  loadChatwootLarkMetadataTarget,
} from './lib/chatwoot-lark-metadata-readiness.js';
import {
  assertChatwootLarkSchemaApplyConfirmation,
  buildChatwootLarkEnvironmentUpdates,
  buildChatwootLarkSchemaApplyEvidence,
  buildChatwootLarkSchemaApplyPlan,
  parseChatwootLarkSchemaApplyArgs,
  safeChatwootLarkSchemaApplyPlan,
  validateChatwootLarkMetadataEvidence,
} from './lib/chatwoot-lark-schema-apply.js';

const OUTPUT_ROOT = resolve(
  process.env.MKT_CHATWOOT_LARK_SCHEMA_OUTPUT_DIR
    ?? 'outputs/chatwoot-lark-schema-apply',
);
const SUMMARY_FILE = resolve(OUTPUT_ROOT, 'summary.json');
const ENVIRONMENT_FILE = resolve(OUTPUT_ROOT, 'environment-updates.env');
const METADATA_EVIDENCE_FILE = resolve(
  process.env.MKT_CHATWOOT_LARK_METADATA_EVIDENCE_FILE
    ?? 'outputs/chatwoot-lark-metadata-readiness/summary.json',
);
let appliedMutationCount = 0;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    phase: 'chatwoot-lark-additive-schema-apply',
    partialMutationPossible: appliedMutationCount > 0,
    appliedMutationCount,
    larkRecordReadCount: 0,
    providerRequestCount: 0,
    d1MutationCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleWebhookActionCount: 0,
    retrySafe: true,
    retryCommand: 'CONFIRM_CHATWOOT_LARK_SCHEMA=APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA node scripts/chatwoot-lark-schema-apply.mjs --phase=apply --execute',
    error: sanitizeOperationalError(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseChatwootLarkSchemaApplyArgs(process.argv.slice(2));
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      executed: false,
      phase: options.phase,
      metadataEvidenceFile: METADATA_EVIDENCE_FILE,
      summaryFile: SUMMARY_FILE,
      environmentFile: ENVIRONMENT_FILE,
      ...safeChatwootLarkSchemaApplyPlan(),
      nextCommand: 'CONFIRM_CHATWOOT_LARK_SCHEMA=APPLY_CHATWOOT_LARK_ADDITIVE_SCHEMA node scripts/chatwoot-lark-schema-apply.mjs --phase=apply --execute',
    }, null, 2)}\n`);
    return;
  }

  if (options.phase !== 'apply') {
    throw operatorError(
      'Only the apply phase is executable',
      'CHATWOOT_LARK_SCHEMA_EXECUTE_PHASE_INVALID',
    );
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootLarkSchemaApplyConfirmation(env);
  const repository = assertRepositoryState();
  const target = loadChatwootLarkMetadataTarget(env);
  const reviewedEvidence = validateChatwootLarkMetadataEvidence(
    JSON.parse(await readFile(METADATA_EVIDENCE_FILE, 'utf8')),
  );

  const client = createLarkBitableClientFromEnv(normalizeLarkEnvAliases(env));
  const before = await readMetadata(client, target.tableRefs);
  const plan = buildChatwootLarkSchemaApplyPlan({
    analysis: before.analysis,
    reviewedEvidence,
    bindings: before.discovery.bindings,
  });

  const appliedActions = [];
  const createdTableIds = new Map();
  if (!plan.alreadyReady) {
    for (const action of plan.actions) {
      if (action.action === 'bind_table_env') {
        appliedActions.push(Object.freeze({
          action: action.action,
          tableKey: action.tableKey,
          status: 'environment_output_pending',
        }));
        continue;
      }
      if (action.action === 'create_table') {
        const result = await client.createTable({
          name: action.name,
          defaultViewName: action.defaultViewName,
          fields: action.fields,
        });
        const tableId = requireText(result?.tableId, `created table ID for ${action.tableKey}`);
        createdTableIds.set(action.tableKey, tableId);
        appliedMutationCount += 1;
        appliedActions.push(Object.freeze({
          action: action.action,
          tableKey: action.tableKey,
          status: 'created',
        }));
        continue;
      }
      if (action.action === 'create_field') {
        await client.createField({ tableId: action.tableId, field: action.field });
        appliedMutationCount += 1;
        appliedActions.push(Object.freeze({
          action: action.action,
          tableKey: action.tableKey,
          fieldName: action.field.fieldName,
          status: 'created',
        }));
        continue;
      }
      throw operatorError(
        `Unsupported Chatwoot Lark schema action: ${action.action}`,
        'CHATWOOT_LARK_SCHEMA_ACTION_INVALID',
      );
    }
  }

  const postRefs = buildPostApplyTableRefs(target.tableRefs, before.discovery.bindings, createdTableIds);
  const after = await readMetadata(client, postRefs);
  const environmentUpdates = buildChatwootLarkEnvironmentUpdates(after.discovery.bindings);
  const evidence = buildChatwootLarkSchemaApplyEvidence({
    plan,
    verification: after.analysis,
    environmentUpdates,
    appliedActions,
    capturedAt: new Date().toISOString(),
  });

  await mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  await writeFile(SUMMARY_FILE, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await writeFile(ENVIRONMENT_FILE, environmentUpdates.text, {
    encoding: 'utf8',
    mode: 0o600,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: true,
    phase: evidence.phase,
    contractVersion: evidence.contractVersion,
    repository,
    metadataEvidenceFile: METADATA_EVIDENCE_FILE,
    summaryFile: SUMMARY_FILE,
    environmentFile: ENVIRONMENT_FILE,
    status: evidence.status,
    accepted: evidence.accepted,
    decision: evidence.decision,
    plan: evidence.plan,
    result: evidence.result,
    boundaries: {
      ...evidence.boundaries,
      larkMetadataReadCount: before.requestCount + after.requestCount,
      larkMutationCount: appliedMutationCount,
    },
    nextGate: 'copy_environment_updates_to_local_ignored_config_then_rerun_metadata_preflight',
  }, null, 2)}\n`);
}

async function readMetadata(client, tableRefs) {
  const remoteTables = await client.listTables();
  const discovery = discoverChatwootLarkTables({ remoteTables, tableRefs });
  const fieldsByKey = {};
  for (const [tableKey, binding] of Object.entries(discovery.bindings)) {
    fieldsByKey[tableKey] = await client.listFields({ tableId: binding.tableId });
  }
  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey });
  return Object.freeze({
    discovery,
    analysis,
    requestCount: 1 + Object.keys(discovery.bindings).length,
  });
}

function buildPostApplyTableRefs(originalRefs, bindings, createdTableIds) {
  const result = {};
  for (const table of CHATWOOT_LARK_BLUEPRINT) {
    const original = originalRefs[table.key] ?? {};
    const tableId = createdTableIds.get(table.key)
      ?? bindings[table.key]?.tableId
      ?? original.configuredTableId
      ?? null;
    result[table.key] = Object.freeze({
      envName: table.envName,
      configuredTableId: tableId,
    });
  }
  return Object.freeze(result);
}

function assertRepositoryState() {
  const branch = readGit(['branch', '--show-current']);
  const head = readGit(['rev-parse', 'HEAD']);
  const originMain = readGit(['rev-parse', 'origin/main']);
  const status = readGit(['status', '--porcelain', '--untracked-files=no']);
  if (branch !== 'main' || head !== originMain || status !== '') {
    throw operatorError(
      'Chatwoot Lark schema apply requires a clean current main matching origin/main',
      'CHATWOOT_LARK_SCHEMA_REPOSITORY_STATE_INVALID',
      { branch, headMatchesOriginMain: head === originMain, clean: status === '' },
    );
  }
  return Object.freeze({ branch: 'main', head, clean: true, matchesOriginMain: true });
}

function readGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(
      `Git command failed: git ${args.join(' ')}`,
      'CHATWOOT_LARK_SCHEMA_GIT_COMMAND_FAILED',
      { command: `git ${args.join(' ')}`, exitCode: result.status },
    );
  }
  return result.stdout.trim();
}

function normalizeLarkEnvAliases(source) {
  const env = { ...source };
  if (!env.LARK_APP_TOKEN && env.LARK_BASE_APP_TOKEN) env.LARK_APP_TOKEN = env.LARK_BASE_APP_TOKEN;
  return Object.freeze(env);
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootLarkSchemaApplyError';
  error.code = code;
  error.details = details;
  return error;
}
