#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  createWooCommerceDiagnosticsExactVersionFetch,
} from './lib/woocommerce-diagnostics-exact-version-fetch.js';

const TOKEN_ENV = 'MKT_CONNECTION_OPERATOR_TOKEN';
const TOKEN_SHA256_ENV = 'MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256';

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = createWooCommerceDiagnosticsExactVersionFetch(globalThis.fetch.bind(globalThis));
}

if (process.argv.slice(2).includes('--execute')) {
  const token = randomBytes(32).toString('base64url');
  process.env[TOKEN_ENV] = token;
  process.env[TOKEN_SHA256_ENV] = createHash('sha256').update(token).digest('hex');
}

await import('./woocommerce-worker-provider-diagnostics.mjs');
