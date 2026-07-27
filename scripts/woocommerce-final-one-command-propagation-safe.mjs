#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readWooCommerceInitialDeliveryDelaySeconds } from './lib/woocommerce-queue-delivery-delay.js';

const repositoryRoot = resolve(process.cwd());
const preloadUrl = pathToFileURL(
  resolve(repositoryRoot, 'scripts/woocommerce-queue-delivery-delay-preload.mjs'),
).href;
const delaySeconds = readWooCommerceInitialDeliveryDelaySeconds(
  process.env.MKT_WOOCOMMERCE_FINAL_INITIAL_DELIVERY_DELAY_SECONDS,
);
const existingNodeOptions = String(process.env.NODE_OPTIONS ?? '').trim();
const preloadOption = `--import=${preloadUrl}`;
const nodeOptions = [existingNodeOptions, preloadOption].filter(Boolean).join(' ');

const result = spawnSync(
  process.execPath,
  [
    'scripts/woocommerce-final-one-command-queue-contract.mjs',
    ...process.argv.slice(2),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      MKT_WOOCOMMERCE_FINAL_INITIAL_DELIVERY_DELAY_SECONDS: String(delaySeconds),
      MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS:
        process.env.MKT_WOOCOMMERCE_FINAL_VERIFY_MAX_POLLS ?? '480',
    },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
