#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import {
  META_HISTORY_EXACT_CONTINUATION_TARGET,
} from './lib/meta-history-exact-plan-continuation.js';

const repositoryRoot = resolve(process.cwd());
const childPath = join(
  repositoryRoot,
  'scripts',
  'meta-history-2026-exact-plan-continuation.mjs',
);
const retainedSafeConfig = join(
  repositoryRoot,
  'outputs',
  'meta-history-2026',
  META_HISTORY_EXACT_CONTINUATION_TARGET.repositoryHead,
  'wrangler.meta-history.safe.jsonc',
);

const child = spawnSync(
  process.execPath,
  [childPath, ...process.argv.slice(2)],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MKT_META_D1_ONLY_WRANGLER_CONFIG: retainedSafeConfig,
      MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: retainedSafeConfig,
    },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: 'inherit',
  },
);

if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
