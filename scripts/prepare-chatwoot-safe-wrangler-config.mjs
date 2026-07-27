#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  buildChatwootSafeWranglerConfig,
} from './lib/chatwoot-safe-wrangler-config.js';

const DEFAULT_SOURCE = 'wrangler.sync.jsonc';
const DEFAULT_OUTPUT =
  'outputs/chatwoot-remote-readiness/wrangler.chatwoot-preflight.safe.jsonc';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_SAFE_CONFIG_PREPARATION_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = resolve(
    args.source
      ?? process.env.MKT_CHATWOOT_SOURCE_WRANGLER_CONFIG
      ?? DEFAULT_SOURCE,
  );
  const outputPath = resolve(
    args.output
      ?? process.env.MKT_CHATWOOT_SAFE_WRANGLER_CONFIG
      ?? DEFAULT_OUTPUT,
  );
  assertSafeOutputPath(sourcePath, outputPath);

  const sourceText = await readFile(sourcePath, 'utf8');
  const result = buildChatwootSafeWranglerConfig(sourceText);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });

  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, result.text, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, outputPath);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: result.contractVersion,
    sourcePath,
    outputPath,
    sha256: result.sha256,
    workerName: result.workerName,
    databaseName: result.databaseName,
    databaseIdFingerprint: result.databaseIdFingerprint,
    mainQueueName: result.mainQueueName,
    dlqName: result.dlqName,
    falseFlagCount: result.falseFlagCount,
    sourceValuesCopied: result.sourceValuesCopied,
    secretValuesCopied: result.secretValuesCopied,
    providerValuesCopied: result.providerValuesCopied,
    scheduleValuesCopied: result.scheduleValuesCopied,
    routeValuesCopied: result.routeValuesCopied,
    remoteCommandsRun: 0,
    remoteMutations: 0,
    nextCommandEnvironment: {
      MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG: outputPath,
    },
  }, null, 2)}\n`);
}

function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      result.source = requiredArgument(arg.slice('--source='.length), 'source');
      continue;
    }
    if (arg.startsWith('--output=')) {
      result.output = requiredArgument(arg.slice('--output='.length), 'output');
      continue;
    }
    throw cliError(
      `Unknown Chatwoot safe config argument: ${arg}`,
      'CHATWOOT_SAFE_CONFIG_ARGUMENT_INVALID',
      { argument: arg },
    );
  }
  return Object.freeze(result);
}

function assertSafeOutputPath(sourcePath, outputPath) {
  const outputsRoot = resolve('outputs');
  const outputRelative = relative(outputsRoot, outputPath);
  if (outputRelative === ''
      || outputRelative.startsWith('..')
      || outputRelative.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || outputPath === sourcePath) {
    throw cliError(
      'Chatwoot safe config output must be a generated file under outputs/',
      'CHATWOOT_SAFE_CONFIG_OUTPUT_PATH_UNSAFE',
      { outputPath },
    );
  }
}

function requiredArgument(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw cliError(
      `Chatwoot safe config ${fieldName} argument is required`,
      'CHATWOOT_SAFE_CONFIG_ARGUMENT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function cliError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeWranglerConfigCliError';
  error.code = code;
  error.details = details;
  return error;
}
