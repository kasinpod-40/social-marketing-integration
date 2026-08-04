#!/usr/bin/env node

import {
  META_K3_PREVIEW_ALIAS_READINESS,
  META_K3_SAFE_PREVIEW_PROBE_TOKEN,
  resolveMetaK3PreviewAliasExpectation,
  shouldGuardMetaK3PreviewFetch,
  waitForAttestedMetaK3PreviewAlias,
  waitForMetaK3SafePreviewRoute,
} from './lib/meta-k3-preview-alias-readiness.js';

const INSTALL_KEY = Symbol.for('mkt.metaK3PreviewAliasReadinessInstalled');

if (process.env[META_K3_PREVIEW_ALIAS_READINESS.envName]
  === META_K3_PREVIEW_ALIAS_READINESS.value
  && typeof globalThis.fetch === 'function'
  && globalThis[INSTALL_KEY] !== true) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis[INSTALL_KEY] = true;
  globalThis.fetch = async function guardedMetaK3PreviewFetch(input, init = {}) {
    if (!shouldGuardMetaK3PreviewFetch(input, init, process.env)) {
      return originalFetch(input, init);
    }

    const token = readBearerToken(input, init);
    if (token === META_K3_SAFE_PREVIEW_PROBE_TOKEN) {
      const ready = await waitForMetaK3SafePreviewRoute({
        fetchImpl: originalFetch,
        requestInput: input,
        requestInit: init,
      });
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'preview-safe-route-ready',
        attemptCount: ready.result.attemptCount,
        status: ready.result.status,
        responseStage: ready.result.responseStage,
        responseCode: ready.result.responseCode,
        directUseCaseInvocationCount: 0,
        queueMessageCount: 0,
        remoteMutationCount: 0,
        productionTrafficChange: false,
        scheduleEnabled: false,
        production: 'BLOCKED',
      }, null, 2)}\n`);
      return ready.response;
    }

    const url = typeof input === 'string' || input instanceof URL
      ? String(input)
      : input.url;
    const expectation = await resolveMetaK3PreviewAliasExpectation({
      requestInput: input,
      requestInit: init,
      repositoryRoot: process.cwd(),
    });
    const readiness = await waitForAttestedMetaK3PreviewAlias({
      fetchImpl: originalFetch,
      url,
      token: expectation.token,
      expectedAttestation: expectation.expectedAttestation,
      expectedVersionId: expectation.expectedVersionId,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'preview-alias-attested-active',
      phase: expectation.phase,
      attemptCount: readiness.attemptCount,
      status: readiness.status,
      attestationFingerprint: readiness.attestationFingerprint,
      workerVersionFingerprint: readiness.workerVersionFingerprint,
      expectedAttestationFingerprint:
        expectation.expectedAttestationFingerprint,
      expectedVersionFingerprint: expectation.expectedVersionFingerprint,
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

function readBearerToken(input, init) {
  const headers = new Headers(input?.headers ?? undefined);
  const overrides = new Headers(init?.headers ?? undefined);
  for (const [name, value] of overrides) headers.set(name, value);
  const authorization = headers.get('authorization') ?? '';
  return /^Bearer[ \t]+(.+)$/iu.exec(authorization)?.[1]?.trim() ?? '';
}
