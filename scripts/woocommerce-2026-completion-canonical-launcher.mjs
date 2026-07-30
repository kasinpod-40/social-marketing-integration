#!/usr/bin/env node

import { canonicalizeTemporaryDirectoryEnvironment } from './lib/canonical-temporary-directory.js';

canonicalizeTemporaryDirectoryEnvironment(process.env);

await import('./woocommerce-2026-completion-safe-launcher.mjs');
