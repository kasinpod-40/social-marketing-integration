#!/usr/bin/env node

const REPLACEMENT = Object.freeze({
  confirmation: 'CONFIRM_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS=RUN_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS',
  command: 'node scripts/woocommerce-worker-provider-diagnostics.mjs --execute',
});

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    throw unsupportedError();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-provider-response-diagnostics',
    code: error?.code ?? 'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_FAILED',
    message: error instanceof Error ? error.message : String(error),
    replacement: REPLACEMENT,
    providerRequestCount: 0,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error(`Unsupported WooCommerce local diagnostics arguments: ${unknown.join(', ')}`);
    error.code = 'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_ARGUMENT_INVALID';
    throw error;
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-provider-response-diagnostics-retired',
    supported: false,
    reason: 'WooCommerce credentials are Worker-only Secrets and are not readable into a local process',
    replacement: REPLACEMENT,
    providerRequestCount: 0,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
}

function unsupportedError() {
  const error = new Error(
    'Local WooCommerce Provider diagnostics is unsupported because deployed Worker Secret values cannot be read back into the local process; use the guarded Worker-side diagnostic operator',
  );
  error.code = 'WOOCOMMERCE_LOCAL_PROVIDER_DIAGNOSTICS_UNSUPPORTED';
  return error;
}
