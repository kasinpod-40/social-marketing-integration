import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { resolveCloudflareBearerAuth } from './lib/woocommerce-final-one-command.js';
import { buildCloudflareQueuePushUrl, extractWranglerD1Rows } from './lib/tiktok-durable-recovery-operator.js';
import {
  YOUTUBE_ACCOUNT_DAILY_RECOVERY as target,
  assertYouTubeRecoveryEvidence,
  buildYouTubeRecoveryClaimSql,
  buildYouTubeRecoveryEvidenceSql,
  buildYouTubeRecoveryMarkSql,
} from './lib/youtube-account-daily-exact-recovery.js';

const configPath = process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc';
const execute = process.argv.slice(2).includes('--execute');

try {
  if (process.argv.slice(2).some((arg) => arg !== '--execute')) throw new Error('Only --execute is supported');
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  assertConfig(config);
  if (execute) assertExecuteAuthority();
  assertDeployedVersion();
  const evidence = readD1(buildYouTubeRecoveryEvidenceSql(Date.now()));
  const identity = assertYouTubeRecoveryEvidence(exactlyOne(evidence, 'preflight'));
  if (!execute) {
    console.log(JSON.stringify({ ok: true, execute: false, operationId: identity.operationId,
      metricDate: identity.metricDate, queueSendCount: 0, note: 'Exact read-only plan passed' }));
  } else {
    const auth = resolveCloudflareBearerAuth({
      explicitApiToken: process.env.CLOUDFLARE_API_TOKEN,
      authOutput: process.env.CLOUDFLARE_API_TOKEN ? null : wrangler(['auth', 'token', '--json']),
    });
    const inventory = await listCloudflareQueuesViaApi({
      accountId: target.accountId, bearerToken: auth.token,
    });
    const queue = exactlyOne(inventory.result.filter((item) => item.queue_name === target.queue), 'main Queue');
    if (typeof queue.queue_id !== 'string' || !queue.queue_id) throw new Error('Queue ID missing');
    // Compare-and-set must succeed once. A later failure leaves in_progress and forbids blind resend.
    const claim = readD1(buildYouTubeRecoveryClaimSql(Date.now()));
    const claimed = exactlyOne(claim, 'recovery claim');
    if (claimed.recovery_status !== 'in_progress'
      || claimed.recovery_reference !== target.recoveryReference) throw new Error('Recovery claim changed');
    const response = await fetch(buildCloudflareQueuePushUrl({ accountId: target.accountId, queueId: queue.queue_id }), {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: identity.payload, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) throw new Error(`Queue send unconfirmed: HTTP ${response.status}; do not rerun`);
    for (const [index, sql] of buildYouTubeRecoveryMarkSql(Date.now()).entries()) {
      const marked = exactlyOne(readD1(sql), `mark ${index + 1}`);
      if (marked.dlq_id !== target.dlqId || marked.redrive_reference !== target.recoveryReference
        && marked.recovery_reference !== target.recoveryReference) throw new Error('Recovery mark mismatch');
    }
    console.log(JSON.stringify({ ok: true, execute: true, operationId: identity.operationId,
      metricDate: identity.metricDate, queueSendCount: 1, dlqStatus: 'redriven',
      messageId: body?.result?.message_id ?? null }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'YOUTUBE_EXACT_RECOVERY_FAILED',
    message: error?.message ?? String(error), note: 'Never rerun after an uncertain Queue send' }));
  process.exitCode = 1;
}

function assertConfig(config) {
  if (config.account_id !== target.accountId || config.name !== target.worker
    || config.d1_databases?.find((item) => item.binding === 'MKT_STATE_DB')?.database_name !== target.database
    || config.queues?.producers?.find((item) => item.binding === 'MKT_SYNC_QUEUE')?.queue !== target.queue
    || config.vars?.LARK_TABLE_MKT_ACCOUNT_DAILY !== target.tableId
    || config.vars?.MKT_DLQ_REDRIVE_ENABLED !== 'false'
    || config.vars?.MKT_QUEUE_AUTO_RECOVERY_ENABLED !== 'false'
    || config.queues?.consumers?.find((item) => item.queue === target.queue)?.max_batch_size !== 1
    || config.queues?.consumers?.find((item) => item.queue === target.queue)?.max_concurrency !== 1) {
    throw new Error('Customer PROD authority or Queue topology changed');
  }
}

function assertExecuteAuthority() {
  if (process.env.CONFIRM_YOUTUBE_ACCOUNT_DAILY_RECOVERY !== 'EXACT_20260917_ONCE') {
    throw new Error('Exact recovery confirmation missing');
  }
  const branch = git(['branch', '--show-current']).trim();
  const head = git(['rev-parse', 'HEAD']).trim();
  const originMain = git(['rev-parse', 'origin/main']).trim();
  if (branch !== 'main' || head !== originMain) throw new Error('Execute requires current reviewed main');
  git(['merge-base', '--is-ancestor', '55567f83fa8b44d220ca439fe730c9f3090b543d', 'HEAD']);
}

function assertDeployedVersion() {
  const status = wrangler(['deployments', 'status', '--name', target.worker,
    '--config', configPath, '--profile', 'chemistry-k-prod']);
  if (!status.includes(`(100%) ${target.workerVersion}`)) throw new Error('Reviewed Worker version is not at 100%');
}

function readD1(sql) {
  const output = wrangler(['d1', 'execute', target.database, '--remote', '--json',
    '--config', configPath, '--profile', 'chemistry-k-prod', '--command', sql]);
  return extractWranglerD1Rows(output);
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WRANGLER_LOG_PATH: '/tmp/youtube-account-daily-exact-recovery-wrangler.log' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function exactlyOne(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`${label} must resolve exactly once`);
  return rows[0];
}
