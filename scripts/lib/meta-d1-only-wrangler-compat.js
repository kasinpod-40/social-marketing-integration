import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  normalizeCloudflareQueueConsumerPayload,
} from './cloudflare-queue-consumer-contract.js';
import {
  rebaseGeneratedWranglerConfigPaths,
} from './rebase-generated-wrangler-config-paths.js';

const GENERATED_OPERATOR_CONFIG = /^\.meta-(?:d1-only|lark)-/u;

export async function prepareMetaD1OnlyWranglerInvocation(args = [], options = {}) {
  if (!Array.isArray(args)) {
    throw compatError(
      'Meta D1 Wrangler compatibility arguments must be an array',
      'META_D1_WRANGLER_COMPAT_ARGUMENTS_INVALID',
    );
  }

  const cwd = resolve(requiredText(options.cwd ?? process.cwd(), 'cwd'));
  const tempDirectory = resolve(requiredText(options.tempDirectory, 'tempDirectory'));
  const originalConfigPath = optionalText(options.originalConfigPath)
    ? resolve(cwd, options.originalConfigPath)
    : null;
  const rewritten = args.map((value) => String(value));

  await mkdir(tempDirectory, { recursive: true, mode: 0o700 });

  let normalizedConfigPath = null;
  const configIndex = rewritten.indexOf('--config');
  if (configIndex >= 0) {
    const requestedValue = rewritten[configIndex + 1];
    if (!requestedValue || requestedValue.startsWith('--')) {
      throw compatError(
        'Wrangler --config requires a file path',
        'META_D1_WRANGLER_COMPAT_CONFIG_PATH_INVALID',
      );
    }

    const requestedConfigPath = resolve(cwd, requestedValue);
    const generatedByOperator = GENERATED_OPERATOR_CONFIG.test(
      basename(requestedConfigPath),
    );
    if (generatedByOperator && !originalConfigPath) {
      throw compatError(
        'Operator-generated Wrangler config requires the reviewed original config path',
        'META_D1_WRANGLER_COMPAT_ORIGINAL_CONFIG_REQUIRED',
      );
    }

    const logicalSourceDirectory = generatedByOperator
      ? dirname(originalConfigPath)
      : dirname(requestedConfigPath);
    const configText = await readFile(requestedConfigPath, 'utf8');
    const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
      sourceDirectory: logicalSourceDirectory,
      outputDirectory: tempDirectory,
    });

    normalizedConfigPath = join(
      tempDirectory,
      `wrangler-normalized-${process.pid}-${Date.now()}.jsonc`,
    );
    await writeFile(normalizedConfigPath, rebased.text, {
      encoding: 'utf8',
      mode: 0o600,
    });
    rewritten[configIndex + 1] = normalizedConfigPath;
  }

  let dryRunOutputPath = null;
  const isWranglerDeploy = rewritten[0] === 'wrangler'
    && rewritten[1] === 'deploy';
  const isDryRun = rewritten.includes('--dry-run');
  const outdirIndex = rewritten.indexOf('--outdir');
  const outfileIndex = rewritten.indexOf('--outfile');

  if (isWranglerDeploy && isDryRun && outdirIndex >= 0) {
    if (outfileIndex >= 0) {
      throw compatError(
        'Wrangler dry-run invocation must not contain both --outdir and --outfile',
        'META_D1_WRANGLER_COMPAT_OUTPUT_ARGUMENT_INVALID',
      );
    }
    const outputDirectoryValue = rewritten[outdirIndex + 1];
    if (!outputDirectoryValue || outputDirectoryValue.startsWith('--')) {
      throw compatError(
        'Wrangler --outdir requires a directory path',
        'META_D1_WRANGLER_COMPAT_OUTPUT_ARGUMENT_INVALID',
      );
    }
    dryRunOutputPath = join(resolve(cwd, outputDirectoryValue), 'worker.js');
    rewritten.splice(outdirIndex, 2, '--outfile', dryRunOutputPath);
  }

  return Object.freeze({
    args: Object.freeze(rewritten),
    normalizedConfigPath,
    dryRunOutputPath,
    configNormalized: normalizedConfigPath !== null,
    dryRunOutfileNormalized: dryRunOutputPath !== null,
  });
}

export function isMetaD1QueueConsumerListInvocation(args = []) {
  if (!Array.isArray(args)) {
    throw compatError(
      'Meta D1 Wrangler compatibility arguments must be an array',
      'META_D1_WRANGLER_COMPAT_ARGUMENTS_INVALID',
    );
  }
  const values = args.map((value) => String(value));
  return values[0] === 'wrangler'
    && values[1] === 'queues'
    && values[2] === 'consumer'
    && values[3] === 'list'
    && values.includes('--json');
}

export function normalizeMetaD1QueueConsumerListOutput(value) {
  const text = requiredText(value, 'Queue consumer output');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw compatError(
      'Wrangler Queue consumer output is not valid JSON',
      'META_D1_WRANGLER_COMPAT_QUEUE_OUTPUT_INVALID',
    );
  }
  const normalized = normalizeCloudflareQueueConsumerPayload(parsed);
  return `${JSON.stringify(normalized)}\n`;
}

function requiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw compatError(
      `Meta D1 Wrangler compatibility requires ${fieldName}`,
      'META_D1_WRANGLER_COMPAT_VALUE_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

function compatError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaD1WranglerCompatibilityError';
  error.code = code;
  error.details = details;
  return error;
}
