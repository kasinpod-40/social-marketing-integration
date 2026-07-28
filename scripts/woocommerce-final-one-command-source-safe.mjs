#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  assertWooCommerceFinalConfirmation,
  parseWooCommerceFinalArgs,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  buildWooCommerceActiveWorkVerificationSql,
  buildWooCommerceFailedWorkDiscoverySql,
  buildWooCommerceFailedWorkRecoverySql,
  normalizeWooCommerceFailedWorkRows,
  parseWranglerD1Rows,
  verifyWooCommerceActiveWorkCleared,
  verifyWooCommerceFailedWorkRecovery,
} from './lib/woocommerce-final-failed-work-recovery.js';
import {
  buildWooCommerceFinalSourceConfig,
} from './lib/woocommerce-final-source-contract.js';

const repositoryRoot = resolve(process.cwd());
const canonicalConfigPath = resolve(
  repositoryRoot,
  process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const generatedConfigPath = resolve(
  repositoryRoot,
  'outputs/woocommerce-final-rollout/source-safe-wrangler.sync.jsonc',
);
const databaseName = process.env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
  ?? 'social-mkt-state-dev';

try {
  const options = parseWooCommerceFinalArgs(process.argv.slice(2));
  if (options.execute) assertWooCommerceFinalConfirmation(process.env);

  const sourceText = await readFile(canonicalConfigPath, 'utf8');
  const source = buildWooCommerceFinalSourceConfig(sourceText, {
    repositoryRoot,
    sourceConfigPath: relative(repositoryRoot, canonicalConfigPath),
  });

  await mkdir(dirname(generatedConfigPath), { recursive: true, mode: 0o700 });
  await writeFile(generatedConfigPath, source.text, { mode: 0o600 });
  await chmod(generatedConfigPath, 0o600);

  process.stderr.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-final-source-contract-materialized',
    hostname: source.hostname,
    apiVersion: source.apiVersion,
    timeoutMs: source.timeoutMs,
    currency: source.currency,
    publicFetchCompatibilityFlag: source.publicFetchCompatibilityFlag,
    configSha256: source.sha256,
    secretValuesCopied: source.secretValuesCopied,
  })}\n`);

  if (options.execute) {
    const recovery = recoverFailedWooCommerceWork();
    process.stderr.write(`${JSON.stringify({
      ok: true,
      stage: 'woocommerce-final-failed-work-recovery',
      recoveredWorkCount: recovery.recovered.length,
      recoveredWorkFingerprints: recovery.recovered.map((item) => item.workKeyFingerprint),
      activeWorkCount: recovery.activeWorkCount,
      activeLockCount: recovery.activeLockCount,
      businessRowMutationCount: 0,
      phaseDeletionCount: 0,
      generationFenceMutationCount: 0,
    })}\n`);
  }

  const result = spawnSync(
    process.execPath,
    [
      'scripts/woocommerce-final-one-command-propagation-safe.mjs',
      ...process.argv.slice(2),
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: generatedConfigPath,
      },
      stdio: 'inherit',
    },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_FINAL_SOURCE_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await rm(generatedConfigPath, { force: true }).catch(() => {});
}

function recoverFailedWooCommerceWork() {
  const repositoryHead = runText('git', ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/u.test(repositoryHead)) {
    throw launcherError(
      'Repository HEAD is invalid for failed-work audit',
      'WOOCOMMERCE_FINAL_FAILED_WORK_AUDIT_INVALID',
    );
  }
  const auditReference = `woocommerce-final-recovery:${repositoryHead}`;
  const discoveredRows = runD1Rows(buildWooCommerceFailedWorkDiscoverySql());
  const recoverable = normalizeWooCommerceFailedWorkRows(discoveredRows);
  const recovered = [];

  for (const work of recoverable) {
    const rows = runD1Rows(buildWooCommerceFailedWorkRecoverySql({
      workKey: work.workKey,
      auditReference,
    }));
    const verification = rows.at(-1);
    recovered.push(verifyWooCommerceFailedWorkRecovery({
      expectedWorkKey: work.workKey,
      row: verification,
    }));
  }

  const activeRows = runD1Rows(buildWooCommerceActiveWorkVerificationSql());
  const active = verifyWooCommerceActiveWorkCleared(activeRows.at(-1));
  return Object.freeze({ recovered: Object.freeze(recovered), ...active });
}

function runD1Rows(sql) {
  const output = runText('npx', [
    'wrangler',
    'd1',
    'execute',
    databaseName,
    '--remote',
    '--config',
    generatedConfigPath,
    '--json',
    '--command',
    sql,
  ]);
  return parseWranglerD1Rows(output);
}

function runText(file, args) {
  const result = spawnSync(file, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw launcherError(
      `${file} command failed during WooCommerce failed-work recovery`,
      'WOOCOMMERCE_FINAL_FAILED_WORK_COMMAND_FAILED',
      {
        command: `${file} ${args.slice(0, 4).join(' ')}`,
        status: result.status,
        stderrSha256: createHash('sha256').update(String(result.stderr ?? '')).digest('hex'),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function launcherError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalSourceLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
