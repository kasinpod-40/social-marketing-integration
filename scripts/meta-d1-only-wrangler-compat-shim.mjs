#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  prepareMetaD1OnlyWranglerInvocation,
} from './lib/meta-d1-only-wrangler-compat.js';

try {
  const realNpx = requireAbsolutePath(
    process.env.MKT_META_D1_ONLY_REAL_NPX,
    'MKT_META_D1_ONLY_REAL_NPX',
  );
  const tempDirectory = requireAbsolutePath(
    process.env.MKT_META_D1_ONLY_COMPAT_TEMP_DIR,
    'MKT_META_D1_ONLY_COMPAT_TEMP_DIR',
  );
  const originalConfigPath = process.env.MKT_META_D1_ONLY_COMPAT_ORIGINAL_CONFIG
    ? resolve(process.env.MKT_META_D1_ONLY_COMPAT_ORIGINAL_CONFIG)
    : null;

  const prepared = await prepareMetaD1OnlyWranglerInvocation(
    process.argv.slice(2),
    {
      cwd: process.cwd(),
      tempDirectory,
      originalConfigPath,
    },
  );

  const child = spawn(realNpx, prepared.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  const result = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = result.code ?? 1;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_D1_WRANGLER_COMPAT_SHIM_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function requireAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'META_D1_WRANGLER_COMPAT_SHIM_INPUT_REQUIRED';
    throw error;
  }
  const absolute = resolve(value.trim());
  if (absolute !== value.trim()) {
    const error = new Error(`${fieldName} must be an absolute path`);
    error.code = 'META_D1_WRANGLER_COMPAT_SHIM_INPUT_INVALID';
    throw error;
  }
  return absolute;
}
