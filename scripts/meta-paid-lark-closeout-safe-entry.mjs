#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  META_PAID_LARK_SAFE_CONFIG_CONTRACT_VERSION,
  materializeMetaPaidLarkSafeConfig,
} from './lib/meta-paid-lark-safe-config.js';

const repositoryRoot = resolve(process.cwd());

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      contractVersion: META_PAID_LARK_SAFE_CONFIG_CONTRACT_VERSION,
      action: 'materialize_private_all_false_config_then_run_existing_closeout',
      remoteMutationPerformed: false,
    }, null, 2)}\n`);
  } else {
    await executeSafeEntry();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_PAID_LARK_SAFE_ENTRY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeSafeEntry() {
  const sourcePath = resolve(
    process.env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceInfo = await stat(sourcePath).catch(() => null);
  if (!sourceInfo?.isFile()) {
    throw entryError(
      'Paid Meta closeout source Wrangler config must be a regular file',
      'META_PAID_LARK_SAFE_ENTRY_SOURCE_CONFIG_INVALID',
      { sourcePath },
    );
  }
  const sourceText = await readFile(sourcePath, 'utf8');
  const safe = materializeMetaPaidLarkSafeConfig(sourceText);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'meta-paid-lark-safe-'));
  const safePath = join(temporaryRoot, 'wrangler.meta-paid-lark.safe-source.jsonc');
  try {
    await writeFile(safePath, safe.text, { mode: 0o600 });
    await chmod(safePath, 0o600);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'private-safe-config-materialized',
      contractVersion: safe.contractVersion,
      declaredFlagCount: safe.declaredFlags.length,
      changedFlagCount: safe.changedFlags.length,
      remainingTrueFlagCount: safe.remainingTrueFlags.length,
      remoteMutationPerformed: false,
    }, null, 2)}\n`);
    const child = spawnSync(process.execPath, [
      'scripts/meta-paid-lark-closeout.mjs',
      '--execute',
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MKT_META_D1_ONLY_WRANGLER_CONFIG: safePath,
      },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: 'inherit',
    });
    if (child.error || child.status !== 0) {
      throw entryError(
        'Existing paid Meta closeout command failed',
        'META_PAID_LARK_SAFE_ENTRY_CLOSEOUT_FAILED',
        { exitCode: child.status ?? 1 },
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw entryError(
      'Unsupported paid Meta safe-entry arguments',
      'META_PAID_LARK_SAFE_ENTRY_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function entryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkSafeEntryError';
  error.code = code;
  error.details = details;
  return error;
}
