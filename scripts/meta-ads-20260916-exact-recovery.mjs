import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { resolveCloudflareBearerAuth } from './lib/woocommerce-final-one-command.js';
import { buildCloudflareQueuePushUrl, extractWranglerD1Rows } from './lib/tiktok-durable-recovery-operator.js';
import {
  META_ADS_EXACT_RECOVERY as authority,
  readMetaRecoveryTarget,
  buildMetaRecoveryEvidenceSql,
  assertMetaRecoveryEvidence,
  buildMetaRecoveryClaimSql,
  buildMetaRecoveryReactivateSql,
  buildMetaRecoveryMarkSql,
} from './lib/meta-ads-20260916-exact-recovery.js';

const configPath = process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc';
const args = process.argv.slice(2);
let sent = false;

try {
  if (args.length < 1 || args.length > 2 || !['k2', 'k3'].includes(args[0])
    || (args[1] && args[1] !== '--execute')) throw new Error('Usage: <k2|k3> [--execute]');
  const target = readMetaRecoveryTarget(args[0]);
  const execute = args[1] === '--execute';
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  assertConfig(config);
  assertDeployedVersion();
  if (execute) assertExecuteAuthority(target);
  const identity = assertMetaRecoveryEvidence(
    exactlyOne(readD1(buildMetaRecoveryEvidenceSql(target, Date.now())), 'preflight'), target,
  );
  if (!execute) {
    console.log(JSON.stringify({ ok: true, execute: false, target: target.key,
      operationId: target.operationId, generation: target.generation,
      queueSendCount: 0, note: 'Read-only exact plan passed' }));
  } else {
    const auth = resolveCloudflareBearerAuth({
      explicitApiToken: process.env.CLOUDFLARE_API_TOKEN,
      authOutput: process.env.CLOUDFLARE_API_TOKEN ? null : wrangler([
        'auth', 'token', '--json', '--profile', 'chemistry-k-prod',
      ]),
    });
    const inventory = await listCloudflareQueuesViaApi({
      accountId: authority.accountId, bearerToken: auth.token,
    });
    const queue = exactlyOne(inventory.result.filter((item) => item.queue_name === authority.queue), 'main Queue');
    if (!queue.queue_id) throw new Error('Queue ID missing');
    // Claim and reactivation are compare-and-set: an uncertain send forbids rerun.
    const claimed = exactlyOne(readD1(buildMetaRecoveryClaimSql(target, Date.now())), 'claim');
    if (claimed.dlq_id !== target.dlqId || claimed.recovery_status !== 'in_progress'
      || claimed.recovery_reference !== target.reference) throw new Error('Claim mismatch');
    const revived = exactlyOne(readD1(buildMetaRecoveryReactivateSql(target, Date.now())), 'reactivation');
    if (revived.work_key !== target.workKey || revived.lifecycle_status !== 'active'
      || revived.audit_reference !== target.reference) throw new Error('Work reactivation mismatch');
    // Never print the bearer token, source account key, or replay payload.
    const response = await fetch(buildCloudflareQueuePushUrl({
      accountId: authority.accountId, queueId: queue.queue_id,
    }), {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: identity.payload, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) throw new Error(`Queue send unconfirmed: HTTP ${response.status}; do not rerun`);
    sent = true;
    for (const [index, sql] of buildMetaRecoveryMarkSql(target, Date.now()).entries()) {
      const marked = exactlyOne(readD1(sql), `mark ${index + 1}`);
      if (marked.dlq_id !== target.dlqId
        || (marked.redrive_reference ?? marked.recovery_reference) !== target.reference) {
        throw new Error('Recovery mark mismatch');
      }
    }
    console.log(JSON.stringify({ ok: true, execute: true, target: target.key,
      operationId: target.operationId, generation: target.generation,
      queueSendCount: 1, dlqStatus: 'redriven', messageId: body?.result?.message_id ?? null }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: 'META_ADS_EXACT_RECOVERY_FAILED',
    message: error?.message ?? String(error), causeCode: error?.code ?? null,
    httpStatus: error?.details?.status ?? null, sent,
    note: 'After a claim or uncertain Queue send, do not rerun; inspect exact D1 state first' }));
  process.exitCode = 1;
}

function assertConfig(config) {
  if (config.account_id !== authority.accountId || config.name !== authority.worker
    || config.d1_databases?.find((item) => item.binding === 'MKT_STATE_DB')?.database_name !== authority.database
    || config.queues?.producers?.find((item) => item.binding === 'MKT_SYNC_QUEUE')?.queue !== authority.queue
    || config.vars?.MKT_ENV !== 'production' || config.vars?.MKT_CUSTOMER_PROFILE !== 'chemistry_k'
    || config.vars?.MKT_META_DEFERRED_RETRY_ENABLED !== 'true'
    || config.vars?.MKT_DLQ_REDRIVE_ENABLED !== 'false'
    || config.vars?.MKT_QUEUE_AUTO_RECOVERY_ENABLED !== 'false'
    || config.queues?.consumers?.find((item) => item.queue === authority.queue)?.max_batch_size !== 1
    || config.queues?.consumers?.find((item) => item.queue === authority.queue)?.max_concurrency !== 1) {
    throw new Error('Customer PROD authority or Queue topology changed');
  }
}

function assertExecuteAuthority(target) {
  if (process.env.CONFIRM_META_ADS_EXACT_RECOVERY !== `EXACT_20260916_${target.key.toUpperCase()}_ONCE`) {
    throw new Error('Exact recovery confirmation missing');
  }
  if (git(['branch', '--show-current']).trim() !== 'main'
    || git(['rev-parse', 'HEAD']).trim() !== git(['rev-parse', 'origin/main']).trim()
    || git(['status', '--porcelain', '--untracked-files=no']).trim()) {
    throw new Error('Execute requires clean reviewed main');
  }
}

function assertDeployedVersion() {
  const status = wrangler(['deployments', 'status', '--name', authority.worker,
    '--config', configPath, '--profile', 'chemistry-k-prod']);
  if (!status.includes(`(100%) ${authority.workerVersion}`)) throw new Error('Reviewed Worker version is not at 100%');
}

function readD1(sql) {
  const output = wrangler(['d1', 'execute', authority.database, '--remote', '--json',
    '--config', configPath, '--profile', 'chemistry-k-prod', '--command', sql]);
  return extractWranglerD1Rows(output);
}

function wrangler(commands) {
  return execFileSync('npx', ['wrangler', ...commands], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WRANGLER_LOG_PATH: '/tmp/meta-ads-exact-recovery-wrangler.log' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function git(commands) {
  return execFileSync('git', commands, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function exactlyOne(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`${label} must resolve exactly once`);
  return rows[0];
}
