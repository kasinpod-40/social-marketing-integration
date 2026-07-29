#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { extractWooCommerceFinalNetworkDiagnostics } from './lib/woocommerce-final-operation-inspector.js';
import {
  listWooCommerceProviderDiagnosticSourceFields,
  materializeWooCommerceProviderDiagnosticSource,
} from './lib/woocommerce-provider-diagnostics-source.js';
import { readWooCommerceRuntimeConfig } from '../packages/config/src/woocommerce-runtime-config.js';
import { WooCommerceRestClient } from '../packages/connectors/src/woocommerce/woocommerce-rest-client.js';

const repositoryRoot = resolve(process.cwd());
const CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS',
  value: 'RUN_WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS',
});

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-provider-response-diagnostics',
    code: error?.code ?? 'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_FAILED',
    message: error instanceof Error ? error.message : String(error),
    failureDiagnostics: extractWooCommerceFinalNetworkDiagnostics({
      errorDetails: error?.details ?? {},
    }),
    providerRequestCount: error?.details?.resource ? 1 : 0,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
    return;
  }

  const loadedEnv = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  requireExact(loadedEnv.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(loadedEnv.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(loadedEnv.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  requireExact(loadedEnv[CONFIRMATION.envName], CONFIRMATION.value, CONFIRMATION.envName);
  const repository = assertRepositoryState();
  const sourceEnv = materializeWooCommerceProviderDiagnosticSource(loadedEnv);

  const config = readWooCommerceRuntimeConfig({
    ...sourceEnv,
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'false',
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'false',
    MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
    MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED: 'false',
    MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'false',
  });
  const client = new WooCommerceRestClient({
    baseUrl: config.source.baseUrl,
    consumerKey: config.source.consumerKey,
    consumerSecret: config.source.consumerSecret,
    apiVersion: config.source.apiVersion,
    pageSize: 1,
    timeoutMs: config.source.timeoutMs,
  });
  const store = await client.getStoreIdentity();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-provider-response-diagnostics',
    repositoryHead: repository.head,
    sourceContractMaterialized: true,
    sourceContractFields: listWooCommerceProviderDiagnosticSourceFields(),
    sourceOriginFingerprint: sha256(config.source.baseUrl),
    apiVersion: config.source.apiVersion,
    timeoutMs: config.source.timeoutMs,
    store: {
      wcVersion: store.wcVersion,
      wpVersion: store.wpVersion,
      timezone: store.timezone,
      currency: store.currency,
      numberOfDecimals: store.numberOfDecimals,
    },
    providerRequestCount: 1,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw diagnosticsError(
      `Unsupported WooCommerce Provider diagnostics arguments: ${unknown.join(', ')}`,
      'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_ARGUMENT_INVALID',
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-provider-response-diagnostics-plan',
    confirmation: `${CONFIRMATION.envName}=${CONFIRMATION.value}`,
    sourceContract: {
      materializedFromRepository: true,
      nonSecretFields: listWooCommerceProviderDiagnosticSourceFields(),
      conflictingExplicitValues: 'fail_closed_before_provider_request',
    },
    providerRequests: ['GET /wp-json/wc/v3/system_status'],
    responseEvidence: [
      'status',
      'content-type',
      'content-encoding',
      'content-length',
      'body byte length',
      'body SHA-256',
      'body structural shape',
      'BOM normalization',
    ],
    responseBodyPersisted: false,
    credentialValuesPersisted: false,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
}

function assertRepositoryState() {
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const status = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || status.trim() !== '') {
    throw diagnosticsError(
      'WooCommerce Provider diagnostics requires a clean main checkout',
      'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_REPOSITORY_INVALID',
      { branch, clean: status.trim() === '' },
    );
  }
  return Object.freeze({ branch, head });
}

function gitText(args, check = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || (check && result.status !== 0)) {
    throw diagnosticsError(
      `git ${args.join(' ')} failed`,
      'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_GIT_FAILED',
      { status: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw diagnosticsError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS_TARGET_INVALID',
      { fieldName, expected },
    );
  }
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function diagnosticsError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceProviderResponseDiagnosticsError';
  error.code = code;
  error.details = details;
  return error;
}
