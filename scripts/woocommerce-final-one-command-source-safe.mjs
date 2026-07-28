#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
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

try {
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
    configSha256: source.sha256,
    secretValuesCopied: source.secretValuesCopied,
  })}\n`);

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
