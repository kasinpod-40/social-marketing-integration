#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildMetaFastTrackSafeWranglerConfig,
  buildMetaFastTrackWranglerDryRunArgs,
} from './lib/meta-fasttrack-safe-wrangler-config.js';
import {
  rebaseGeneratedWranglerConfigPaths,
} from './lib/rebase-generated-wrangler-config-paths.js';

const execFileAsync = promisify(execFile);
const DEFAULT_SOURCE = 'wrangler.sync.jsonc';
const DEFAULT_OUTPUT =
  'outputs/meta-fasttrack-config/wrangler.meta-fasttrack.safe.jsonc';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_FASTTRACK_SAFE_CONFIG_PREPARATION_FAILED',
    message: error?.message ?? String(error),
    details: sanitizeDetails(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = resolve(args.source ?? DEFAULT_SOURCE);
  const outputPath = resolve(args.output ?? DEFAULT_OUTPUT);
  const devVarsPath = resolve(
    args.devVars
      ?? process.env.DEV_VARS_FILE
      ?? '.dev.vars',
  );
  assertOutputPath(sourcePath, outputPath);

  const [sourceText, fileEnv] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readDevVars(devVarsPath),
  ]);
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const result = buildMetaFastTrackSafeWranglerConfig(sourceText, env);
  const rebased = rebaseGeneratedWranglerConfigPaths(result.text, {
    sourceDirectory: dirname(sourcePath),
    outputDirectory: dirname(outputPath),
  });

  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, rebased.text, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);

  const dryRun = await runWranglerDryRun(outputPath);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: result.contractVersion,
    sourcePath,
    outputPath,
    configSha256: rebased.sha256,
    workerBundleSha256: dryRun.workerBundleSha256,
    workerName: result.workerName,
    databaseName: result.databaseName,
    mainQueueName: result.mainQueueName,
    dlqName: result.dlqName,
    falseFlagCount: result.falseFlagCount,
    sourceEnabledFlagNames: result.sourceEnabledFlagNames,
    tableMappingCount: result.tableMappingCount,
    changedTableMappingNames: result.changedTableMappingNames,
    tableMappingFingerprint: result.tableMappingFingerprint,
    secretValuesCopied: result.secretValuesCopied,
    configRelativePaths: {
      main: rebased.main,
      migrationsDirectory: rebased.migrationsDirectory,
      schemaPath: rebased.schemaPath,
    },
    wranglerDryRun: 'passed',
    remoteCommandsRun: 0,
    remoteMutations: 0,
    nextCommandEnvironment: {
      MKT_META_D1_ONLY_WRANGLER_CONFIG: outputPath,
      MKT_META_LARK_WRANGLER_CONFIG: outputPath,
    },
  }, null, 2)}\n`);
}

async function runWranglerDryRun(configPath) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'meta-fasttrack-config-'));
  const outputFile = join(outputDirectory, 'worker.bundle.js');
  try {
    await execFileAsync(
      'npx',
      buildMetaFastTrackWranglerDryRunArgs(configPath, outputFile),
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
      },
    );
    const bundle = await readFile(outputFile);
    return { workerBundleSha256: createHash('sha256').update(bundle).digest('hex') };
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
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
    if (arg.startsWith('--dev-vars=')) {
      result.devVars = requiredArgument(arg.slice('--dev-vars='.length), 'dev-vars');
      continue;
    }
    throw cliError(
      `Unknown Meta fast-track safe config argument: ${arg}`,
      'META_FASTTRACK_SAFE_CONFIG_ARGUMENT_INVALID',
      { argument: arg },
    );
  }
  return Object.freeze(result);
}

function assertOutputPath(sourcePath, outputPath) {
  const outputsRoot = resolve('outputs');
  const outputRelative = relative(outputsRoot, outputPath);
  if (outputRelative === ''
      || outputRelative.startsWith('..')
      || outputPath === sourcePath) {
    throw cliError(
      'Meta fast-track safe config output must be a generated file under outputs/',
      'META_FASTTRACK_SAFE_CONFIG_OUTPUT_PATH_UNSAFE',
      { outputPath },
    );
  }
}

function requiredArgument(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw cliError(
      `Meta fast-track safe config ${fieldName} argument is required`,
      'META_FASTTRACK_SAFE_CONFIG_ARGUMENT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sanitizeDetails(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => (
    !/token|secret|password|tableId|tableIds/iu.test(key)
  )));
}

function cliError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaFastTrackSafeWranglerConfigCliError';
  error.code = code;
  error.details = details;
  return error;
}
