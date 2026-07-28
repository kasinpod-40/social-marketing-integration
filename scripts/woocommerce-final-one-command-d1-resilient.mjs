#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const repositoryRoot = resolve(process.cwd());
const realNpx = findExecutable('npx');
const shimDirectory = await mkdtemp(join(tmpdir(), 'woocommerce-d1-read-retry-'));
const shimPath = join(shimDirectory, 'npx');
const shimModule = resolve(repositoryRoot, 'scripts/woocommerce-d1-read-retry-npx-shim.mjs');

try {
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec "${escapeShell(process.execPath)}" "${escapeShell(shimModule)}" "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(shimPath, 0o700);

  const result = spawnSync(
    process.execPath,
    ['scripts/woocommerce-final-one-command-active-scope.mjs', ...process.argv.slice(2)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${shimDirectory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_WOOCOMMERCE_D1_RETRY_REAL_NPX_PATH: realNpx,
      },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_D1_RESILIENT_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await rm(shimDirectory, { recursive: true, force: true }).catch(() => {});
}

function findExecutable(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  const path = String(result.stdout ?? '').trim();
  if (result.status !== 0 || !path) {
    const error = new Error(`${name} executable was not found`);
    error.code = 'WOOCOMMERCE_D1_RESILIENT_NPX_NOT_FOUND';
    throw error;
  }
  return path;
}

function escapeShell(value) {
  return String(value).replaceAll('"', '\\"');
}
