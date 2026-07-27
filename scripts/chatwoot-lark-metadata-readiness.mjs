#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  analyzeChatwootLarkMetadata,
  assertChatwootLarkMetadataConfirmation,
  buildChatwootLarkMetadataEvidence,
  discoverChatwootLarkTables,
  loadChatwootLarkMetadataTarget,
  parseChatwootLarkMetadataArgs,
  safeChatwootLarkMetadataPlan,
} from './lib/chatwoot-lark-metadata-readiness.js';

const EVIDENCE_ROOT = resolve(
  process.env.MKT_CHATWOOT_LARK_METADATA_EVIDENCE_DIR
    ?? 'outputs/chatwoot-lark-metadata-readiness',
);
const EVIDENCE_FILE = resolve(EVIDENCE_ROOT, 'summary.json');

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    phase: 'chatwoot-lark-metadata-readiness',
    larkMutationCount: 0,
    larkRecordReadCount: 0,
    providerRequestCount: 0,
    d1MutationCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleWebhookActionCount: 0,
    error: sanitizeOperationalError(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseChatwootLarkMetadataArgs(process.argv.slice(2));
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      executed: false,
      phase: options.phase,
      evidenceFile: EVIDENCE_FILE,
      ...safeChatwootLarkMetadataPlan(),
    }, null, 2)}\n`);
    return;
  }

  if (options.phase !== 'lark-preflight') {
    throw operatorError(
      'Only the lark-preflight phase is executable',
      'CHATWOOT_LARK_METADATA_EXECUTE_PHASE_INVALID',
    );
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootLarkMetadataConfirmation(env);
  const target = loadChatwootLarkMetadataTarget(env);
  const repository = assertRepositoryState();

  const client = createLarkBitableClientFromEnv(normalizeLarkEnvAliases(env));
  const remoteTables = await client.listTables();
  const discovery = discoverChatwootLarkTables({
    remoteTables,
    tableRefs: target.tableRefs,
  });

  const fieldsByKey = {};
  for (const [tableKey, binding] of Object.entries(discovery.bindings)) {
    fieldsByKey[tableKey] = await client.listFields({ tableId: binding.tableId });
  }

  const analysis = analyzeChatwootLarkMetadata({ discovery, fieldsByKey });
  const evidence = buildChatwootLarkMetadataEvidence({
    target,
    analysis,
    capturedAt: new Date().toISOString(),
    larkRequestCount: 1 + Object.keys(discovery.bindings).length,
  });

  await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: true,
    phase: evidence.phase,
    contractVersion: evidence.contractVersion,
    evidenceFile: EVIDENCE_FILE,
    repository,
    status: evidence.status,
    accepted: evidence.accepted,
    decision: evidence.decision,
    inventory: evidence.inventory,
    additivePlan: evidence.additivePlan,
    blockers: evidence.blockers,
    missingFields: evidence.missingFields,
    nextGate: evidence.nextGate,
    boundaries: evidence.boundaries,
  }, null, 2)}\n`);
}

function assertRepositoryState() {
  const branch = readGit(['branch', '--show-current']);
  const head = readGit(['rev-parse', 'HEAD']);
  const originMain = readGit(['rev-parse', 'origin/main']);
  const status = readGit(['status', '--porcelain', '--untracked-files=no']);
  if (branch !== 'main' || head !== originMain || status !== '') {
    throw operatorError(
      'Chatwoot Lark metadata preflight requires a clean current main matching origin/main',
      'CHATWOOT_LARK_METADATA_REPOSITORY_STATE_INVALID',
      {
        branch,
        headMatchesOriginMain: head === originMain,
        clean: status === '',
      },
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
      'CHATWOOT_LARK_METADATA_GIT_COMMAND_FAILED',
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

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootLarkMetadataReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
