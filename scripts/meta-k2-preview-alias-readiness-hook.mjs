#!/usr/bin/env node

import {
  META_K2_PREVIEW_ALIAS_READINESS,
  shouldGuardMetaK2ContinuationFetch,
  waitForAttestedMetaK2PreviewAlias,
} from './lib/meta-k2-preview-alias-readiness.js';

const INSTALL_KEY = Symbol.for('mkt.metaK2PreviewAliasReadinessInstalled');

if (process.env[META_K2_PREVIEW_ALIAS_READINESS.envName]
  === META_K2_PREVIEW_ALIAS_READINESS.value
  && typeof globalThis.fetch === 'function'
  && globalThis[INSTALL_KEY] !== true) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis[INSTALL_KEY] = true;
  globalThis.fetch = async function guardedMetaK2PreviewFetch(input, init = {}) {
    if (!shouldGuardMetaK2ContinuationFetch(input, init, process.env)) {
      return originalFetch(input, init);
    }
    const url = typeof input === 'string' || input instanceof URL
      ? String(input)
      : input.url;
    const readiness = await waitForAttestedMetaK2PreviewAlias({
      fetchImpl: originalFetch,
      url,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'preview-alias-attested-active',
      attemptCount: readiness.attemptCount,
      status: readiness.status,
      code: readiness.code,
      attestationFingerprint: readiness.attestationFingerprint,
      workerVersionFingerprint: readiness.workerVersionFingerprint,
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      remoteMutationCount: 0,
      productionTrafficChange: false,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
    return originalFetch(input, init);
  };
}
