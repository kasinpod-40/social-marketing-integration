#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const repositoryRoot = resolve(process.cwd());
const realNpx = resolveExecutable('npx');
const shimRoot = await mkdtemp(join(tmpdir(), 'woocommerce-queue-contract-'));
const shimPath = join(shimRoot, 'npx');
const compatScript = resolve(
  repositoryRoot,
  'scripts/woocommerce-wrangler-queue-compat.mjs',
);

try {
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(compatScript)} "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(shimPath, 0o700);

  const result = spawnSync(
    process.execPath,
    [
      'scripts/woocommerce-final-one-command-rest-queue.mjs',
      ...process.argv.slice(2),
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MKT_WOOCOMMERCE_REAL_NPX: realNpx,
        PATH: `${shimRoot}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(shimRoot, { recursive: true, force: true });
}

function resolveExecutable(name) {
  const result = spawnSync('which', [name], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const path = result.stdout?.trim();
  if (result.error || result.status !== 0 || !path) {
    throw new Error(`Unable to resolve executable: ${name}`);
  }
  return path;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
