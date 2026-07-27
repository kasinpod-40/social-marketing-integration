#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
  WOOCOMMERCE_EXPECTED_MIGRATION,
  WOOCOMMERCE_LARK_KEYS,
  WOOCOMMERCE_PREFLIGHT_CONFIRMATIONS,
  WOOCOMMERCE_PREFLIGHT_PHASES,
  assertWooCommercePreflightConfirmation,
  auditWooCommerceMigrationSource,
  buildWooCommerceCommerceReadbackSql,
  buildWooCommerceRemotePreflightSql,
  classifyWooCommerceMigrationState,
  createWooCommercePreflightTargetFingerprint,
  decideWooCommerceReadinessSummary,
  loadWooCommercePreflightTarget,
  parseWooCommercePreflightArgs,
  sha256Hex,
  validateWooCommerceCommerceReadbackRow,
  validateWooCommerceLarkInventory,
  validateWooCommerceProviderSnapshot,
  validateWooCommerceRemotePreflightRow,
} from './lib/woocommerce-customer-lark-preflight.js';
import {
  WOOCOMMERCE_LARK_TABLE_KEYS,
  readWooCommerceRuntimeConfig,
} from '../packages/config/src/woocommerce-runtime-config.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { WooCommerceRestClient } from '../packages/connectors/src/woocommerce/woocommerce-rest-client.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

const EVIDENCE_ROOT = resolve(
  process.env.MKT_WOOCOMMERCE_PREFLIGHT_EVIDENCE_DIR
    ?? 'outputs/woocommerce-customer-lark-preflight',
);
const MIGRATION_FILE = resolve('migrations/0017_woocommerce_commerce.sql');

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const mode = parseWooCommercePreflightArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }
  const env = await loadEnvironment();
  const target = loadWooCommercePreflightTarget(env);
  assertWooCommercePreflightConfirmation(mode.phase, env);
  await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const result = await runPhase(mode.phase, target, env);
  process.stdout.write(`${JSON.stringify({ ok: true, phase: mode.phase, ...result }, null, 2)}\n`);
}

function printPlan(mode) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    requestedPhase: mode.phase === 'plan' ? null : mode.phase,
    migration: WOOCOMMERCE_EXPECTED_MIGRATION,
    phases: WOOCOMMERCE_PREFLIGHT_PHASES,
    confirmations: WOOCOMMERCE_PREFLIGHT_CONFIRMATIONS,
    larkTableCount: WOOCOMMERCE_LARK_KEYS.length,
    evidenceRoot: EVIDENCE_ROOT,
    safety: {
      defaultMode: 'plan_only',
      d1Mutation: false,
      larkMutation: false,
      queueSend: false,
      workerDeployment: false,
      scheduleActivation: false,
      providerMethods: ['GET'],
      production: false,
    },
    note: 'This operator implements read-only readiness only. Backup, Migration apply, deployment and manual backfill remain separate later authorizations.',
  }, null, 2)}\n`);
}

async function runPhase(phase, target, env) {
  switch (phase) {
    case 'remote-preflight': return runRemotePreflight(target);
    case 'provider-preflight': return runProviderPreflight(target, env);
    case 'lark-preflight': return runLarkPreflight(target, env);
    case 'summary': return runSummary(target);
    default: throw new Error(`Unsupported executable phase: ${phase}`);
  }
}

async function runRemotePreflight(target) {
  assertRepositoryState(target.repositoryHead);
  const migrationText = await readFile(MIGRATION_FILE, 'utf8');
  const migration = auditWooCommerceMigrationSource(migrationText);
  runCommand('npm', ['run', 'check']);
  runCommand('node', [
    '--test',
    'tests/application/woocommerce-customer-lark-preflight-operator.test.js',
    'tests/application/woocommerce-runtime-wiring.test.js',
  ]);
  runCommand('npm', ['run', 'deploy:dry-run']);
  runCommand('npx', ['wrangler', 'whoami']);
  runCommand('npx', [
    'wrangler', 'd1', 'info', target.databaseName,
    '--config', target.wranglerConfig, '--json',
  ]);
  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote', '--config', target.wranglerConfig,
  ]);
  const migrationState = classifyWooCommerceMigrationState(migrations.stdout);
  const secrets = runCommand('npx', [
    'wrangler', 'secret', 'list', '--name', target.workerName,
    '--config', target.wranglerConfig, '--format', 'json',
  ]);
  const secretNames = parseSecretNames(secrets.stdout);
  const snapshot = extractFirstD1Row(runD1Query(target, buildWooCommerceRemotePreflightSql()).stdout);
  const remote = validateWooCommerceRemotePreflightRow(snapshot, migrationState);
  let commerce = null;
  if (migrationState.state === 'applied_or_no_pending') {
    commerce = validateWooCommerceCommerceReadbackRow(
      extractFirstD1Row(runD1Query(target, buildWooCommerceCommerceReadbackSql()).stdout),
    );
  }
  const targetFingerprint = createWooCommercePreflightTargetFingerprint(target);
  const evidence = {
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    phase: 'remote-preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint,
    repositoryHead: target.repositoryHead,
    migration,
    migrationState,
    remote,
    commerce,
    requiredSecretNamesPresent: {
      woocommerceConsumerKey: secretNames.includes('WOOCOMMERCE_CONSUMER_KEY'),
      woocommerceConsumerSecret: secretNames.includes('WOOCOMMERCE_CONSUMER_SECRET'),
      larkAppSecret: secretNames.includes('LARK_APP_SECRET'),
    },
    secretNameCount: secretNames.length,
    secretNameFingerprint: sha256Hex(JSON.stringify(secretNames)),
    remoteMutationCount: 0,
  };
  await saveEvidence('remote-preflight', evidence);
  return { evidenceFile: evidencePath('remote-preflight'), migrationState, remote, commerce };
}

async function runProviderPreflight(target, env) {
  const prior = await requireEvidence('remote-preflight', target);
  const config = readWooCommerceRuntimeConfig({
    ...env,
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
  const [store, orders, products, customers] = await Promise.all([
    client.getStoreIdentity(),
    client.listPage('orders', { page: 1, perPage: 1, params: { status: 'any', dp: 6 } }),
    client.listPage('products', { page: 1, perPage: 1 }),
    client.listPage('customers', { page: 1, perPage: 1 }),
  ]);
  const snapshot = validateWooCommerceProviderSnapshot({ store, orders, products, customers });
  const evidence = {
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    phase: 'provider-preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: prior.targetFingerprint,
    sourceOriginFingerprint: sha256Hex(config.source.baseUrl),
    snapshot,
    providerRequestCount: snapshot.providerRequestCount,
    providerMutationCount: 0,
    credentialValuesPersisted: false,
    customerPiiPersisted: false,
  };
  await saveEvidence('provider-preflight', evidence);
  return { evidenceFile: evidencePath('provider-preflight'), snapshot };
}

async function runLarkPreflight(target, env) {
  const prior = await requireEvidence('provider-preflight', target);
  const tableIds = readLarkTableIdsFromEnv(env, WOOCOMMERCE_LARK_TABLE_KEYS);
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const fieldCounts = {};
  for (const key of WOOCOMMERCE_LARK_KEYS) {
    const fields = await client.listFields({ tableId: tableIds[key] });
    fieldCounts[key] = fields.length;
  }
  const inventory = validateWooCommerceLarkInventory({ tableIds, remoteTables, fieldCounts });
  const evidence = {
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    phase: 'lark-preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: prior.targetFingerprint,
    inventory,
    fieldCounts,
    larkRequestCount: 1 + WOOCOMMERCE_LARK_KEYS.length,
    larkMutationCount: 0,
    recordReadCount: 0,
    credentialValuesPersisted: false,
  };
  await saveEvidence('lark-preflight', evidence);
  return { evidenceFile: evidencePath('lark-preflight'), inventory, fieldCounts };
}

async function runSummary(target) {
  const [remote, provider, lark] = await Promise.all([
    requireEvidence('remote-preflight', target),
    requireEvidence('provider-preflight', target),
    requireEvidence('lark-preflight', target),
  ]);
  const summary = decideWooCommerceReadinessSummary({ remote, provider, lark });
  const evidence = {
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    phase: 'summary',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: remote.targetFingerprint,
    ...summary,
  };
  await saveEvidence('summary', evidence);
  return { evidenceFile: evidencePath('summary'), ...summary };
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

function assertRepositoryState(expectedHead) {
  const head = readCommand('git', ['rev-parse', 'HEAD']).trim();
  const status = readCommand('git', ['status', '--porcelain', '--untracked-files=all']).trim();
  if (head !== expectedHead || status !== '') {
    const error = new Error('WooCommerce preflight requires exact reviewed HEAD and a clean working tree');
    error.code = 'WOOCOMMERCE_PREFLIGHT_REPOSITORY_STATE_INVALID';
    throw error;
  }
}

function runD1Query(target, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote', '--json', '--config', target.wranglerConfig,
    '--command', sql,
  ]);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed`);
    error.code = 'WOOCOMMERCE_PREFLIGHT_COMMAND_FAILED';
    error.details = {
      command,
      args,
      status: result.status,
      stderrSha256: sha256Hex(result.stderr ?? ''),
    };
    throw error;
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readCommand(command, args) {
  return runCommand(command, args).stdout;
}

function extractFirstD1Row(output) {
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])
    : (parsed?.results ?? []);
  if (!rows[0]) {
    const error = new Error('WooCommerce Remote D1 query returned no row');
    error.code = 'WOOCOMMERCE_PREFLIGHT_D1_RESULT_EMPTY';
    throw error;
  }
  return rows[0];
}

function parseSecretNames(output) {
  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed) ? parsed : (parsed?.result ?? []);
  return Object.freeze(items.map((item) => String(item?.name ?? '')).filter(Boolean).sort());
}

async function requireEvidence(phase, target) {
  const evidence = JSON.parse(await readFile(evidencePath(phase), 'utf8'));
  const fingerprint = createWooCommercePreflightTargetFingerprint(target);
  if (evidence?.status !== 'passed' || evidence?.targetFingerprint !== fingerprint) {
    const error = new Error(`WooCommerce ${phase} evidence is missing or belongs to another target`);
    error.code = 'WOOCOMMERCE_PREFLIGHT_EVIDENCE_INVALID';
    throw error;
  }
  return evidence;
}

async function saveEvidence(phase, evidence) {
  await writeFile(evidencePath(phase), `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function evidencePath(phase) {
  return resolve(EVIDENCE_ROOT, `${phase}.json`);
}
