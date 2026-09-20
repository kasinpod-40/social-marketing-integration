#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildDashboardPresetJob } from '../packages/application/src/reports/dashboard-report-request.js';
import { getReportPlatformContract } from '../packages/application/src/reports/report-platform-adapter-registry.js';
import { createReportId } from '../packages/application/src/storage/marketing-history-contract.js';
import { resolveReportPeriod } from '../packages/application/src/reports/report-period.js';
import { createStableQueueOperationBody } from '../packages/application/src/jobs/queue-operation.js';
import { JOB_TRIGGERS } from '../packages/application/src/jobs/job-catalog.js';
import { createDashboardReportSettingKey } from '../packages/config/src/report-settings.seed.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { createCommandRunner, sleep } from './lib/report-runtime-closeout-reviewed-process.js';
import {
  resolveReviewedCloudflareSession,
  sendReviewedQueueMessage,
} from './lib/report-runtime-closeout-reviewed-remote.js';
import { createReviewedStateRuntime } from './lib/report-runtime-closeout-reviewed-state.js';

const CONFIRMATION = 'MATERIALIZE_EXACT_PRODUCTION_PAID_DAILY_TREND_8';
const ACTIVE_VERSION = '54ba99cb-9fab-4624-83d9-52fdccf2a814';
const PERIOD_END = '2026-09-20';
const ALL_PLATFORMS = Object.freeze([
  'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads',
]);
const PLATFORMS = requestedPlatforms(process.env.MKT_REPORT_REFRESH_PLATFORMS);
const WINDOWS = Object.freeze([1, 3, 7, 30]);
const CONFIG_PATH = resolve('.customer-youtube-uat.wrangler.jsonc');
const WORKER_NAME = 'social-mkt-sync-worker';
const QUEUE_NAME = 'social-mkt-sync-jobs';
const DLQ_NAME = 'social-mkt-sync-dlq';
const execFileAsync = promisify(execFile);

if (process.env.CONFIRM_PRODUCTION_REPORT_REFRESH !== CONFIRMATION) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    confirmation: `CONFIRM_PRODUCTION_REPORT_REFRESH=${CONFIRMATION}`,
    activeVersion: ACTIVE_VERSION,
    periodEnd: PERIOD_END,
    jobs: PLATFORMS.length * WINDOWS.length,
    platforms: PLATFORMS,
    windows: WINDOWS,
  }, null, 2)}\n`);
  process.exit(0);
}

const startedAt = Date.now();
const sourceText = await readFile(CONFIG_PATH, 'utf8');
const config = parseJsoncObject(sourceText);
const devVars = await readDevVars();
const baseEnv = {
  ...config.vars,
  ...devVars,
  ...process.env,
  WRANGLER_LOG_PATH: '/tmp/customer-production-report-refresh.log',
};
const initialRunner = createCommandRunner({ execFileAsync, cwd: process.cwd(), baseEnv });
const auth = await resolveReviewedCloudflareSession({
  env: baseEnv,
  sourceText,
  runText: initialRunner.runText,
});
const env = {
  ...baseEnv,
  CLOUDFLARE_ACCOUNT_ID: auth.accountId,
  CLOUDFLARE_API_TOKEN: auth.token,
};
const runner = createCommandRunner({ execFileAsync, cwd: process.cwd(), baseEnv: env });

await assertActiveDeployment(runner);
const queue = await resolveExactQueue(auth);
await assertQueueConsumer(auth, queue.queueId);

const states = new Map(PLATFORMS.map((platformScope) => {
  const contract = getReportPlatformContract(platformScope);
  return [platformScope, createReviewedStateRuntime({
    ...runner,
    repositoryRoot: process.cwd(),
    outputRoot: resolve('/tmp/customer-production-report-refresh'),
    configPath: CONFIG_PATH,
    env,
    target: {
      platformScope,
      accountKey: 'chemistry_k',
      formulaVersion: contract.formulaVersion,
    },
  })];
}));

const candidates = buildCandidates(startedAt);
const results = [];

for (const platformScope of PLATFORMS) {
  const state = states.get(platformScope);
  let completedForPlatform = 0;
  for (const candidate of candidates.filter((item) => item.platformScope === platformScope)) {
    const job = createStableQueueOperationBody({
      ...candidate.job,
      scheduleCadence: 'manual_refresh',
    }, {
      operationId: `report-refresh-${platformScope}-${candidate.windowDays}d-20260920-organic-metric-v1`,
      originalRequestedAt: startedAt,
    });
    await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job });
    completedForPlatform += 1;
    const d1 = await state.pollD1Completion(candidate, startedAt, completedForPlatform);
    const validation = validatePayload({ d1, candidate });
    results.push(Object.freeze({
      platformScope,
      windowDays: candidate.windowDays,
      reportId: candidate.reportId,
      generatedAt: d1.generated_at,
      dataStatus: d1.data_status,
      larkWrite: 'worker_sync_success_after_lark_commit',
      validation,
    }));
    process.stdout.write(`${platformScope} ${candidate.windowDays}D complete\n`);
  }
}

const health = await states.get(PLATFORMS[0]).readD1Row(`
  SELECT
    (SELECT COUNT(*) FROM sync_locks WHERE expires_at > (unixepoch() * 1000)) AS active_locks,
    (SELECT COUNT(*) FROM sync_runs
      WHERE sync_type = 'dashboard_performance_report' AND status = 'failed'
        AND started_at >= ${startedAt}) AS new_failed_runs,
    (SELECT COUNT(*) FROM dead_letter_jobs
      WHERE job_type = 'report.materialization.generate'
        AND created_at >= ${startedAt}) AS new_dlq,
    (SELECT COUNT(*) FROM system_alerts
      WHERE created_at >= ${startedAt}) AS new_alerts;
`);
if (Number(health.active_locks) !== 0
  || Number(health.new_failed_runs) !== 0
  || Number(health.new_dlq) !== 0
  || Number(health.new_alerts) !== 0) {
  throw new Error(`Production report refresh health failed: ${JSON.stringify(health)}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  activeVersion: ACTIVE_VERSION,
  periodEnd: PERIOD_END,
  jobCount: results.length,
  health,
  results,
}, null, 2)}\n`);

function buildCandidates(requestedAt) {
  return Object.freeze(PLATFORMS.flatMap((platformScope) => WINDOWS.map((windowDays) => {
    const contract = getReportPlatformContract(platformScope);
    const period = resolveReportPeriod({
      periodKind: 'rolling_days',
      windowDays,
      periodEnd: PERIOD_END,
      comparisonMode: 'previous_period',
      timeZone: 'Asia/Bangkok',
      now: new Date(requestedAt),
    });
    const reportSettingKey = createDashboardReportSettingKey({
      profileKey: 'chemistry_k',
      platformScope,
      windowDays,
    });
    const job = buildDashboardPresetJob({
      trigger: JOB_TRIGGERS.DASHBOARD_SCHEDULED,
      requestedAt,
      reportSettingKey,
      platformScope,
      windowDays,
      periodEnd: PERIOD_END,
      comparisonMode: 'previous_period',
      timeZone: 'Asia/Bangkok',
    });
    const reportId = createReportId({
      report_setting_key: reportSettingKey,
      account_key: 'chemistry_k',
      period_kind: 'rolling_days',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      formula_version: contract.formulaVersion,
    });
    return Object.freeze({ platformScope, windowDays, period, reportId, job });
  })));
}

function requestedPlatforms(value) {
  if (!value) return ALL_PLATFORMS;
  const requested = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (requested.length === 0 || requested.some((item) => !ALL_PLATFORMS.includes(item))) {
    throw new TypeError('MKT_REPORT_REFRESH_PLATFORMS contains an unsupported platform');
  }
  return Object.freeze(requested);
}

async function assertActiveDeployment(commandRunner) {
  const raw = await commandRunner.runText('npx', [
    'wrangler', 'deployments', 'status', '--name', WORKER_NAME,
    '--config', CONFIG_PATH, '--json',
  ]);
  const status = JSON.parse(raw);
  const versions = Array.isArray(status.versions) ? status.versions : [];
  if (versions.length !== 1
    || versions[0].version_id !== ACTIVE_VERSION
    || Number(versions[0].percentage) !== 100) {
    throw new Error('Active Worker version changed before report refresh');
  }
}

async function resolveExactQueue(session) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(session.accountId)}/queues?per_page=100`,
    { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json();
  const matches = (body.result ?? []).filter((item) => (item.queue_name ?? item.name) === QUEUE_NAME);
  if (!response.ok || body.success !== true || matches.length !== 1) {
    throw new Error('Expected exactly one production report Queue');
  }
  return Object.freeze({ queueId: required(matches[0].queue_id ?? matches[0].id, 'queueId') });
}

async function assertQueueConsumer(session, queueId) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(session.accountId)}/queues/${encodeURIComponent(queueId)}/consumers`,
    { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json();
  if (!response.ok || body.success !== true || !Array.isArray(body.result) || body.result.length !== 1) {
    throw new Error('Production report Queue must have exactly one consumer');
  }
  const listed = body.result[0];
  const consumerId = required(listed.consumer_id ?? listed.consumerId, 'consumerId');
  const detailResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(session.accountId)}/queues/${encodeURIComponent(queueId)}/consumers/${encodeURIComponent(consumerId)}`,
    { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const detailBody = await detailResponse.json();
  if (!detailResponse.ok || detailBody.success !== true || !detailBody.result) {
    throw new Error('Production report Queue consumer detail is unavailable');
  }
  const consumer = detailBody.result;
  const settings = consumer.settings ?? listed.settings ?? {};
  const normalized = {
    batchSize: Number(settings.batch_size ?? settings.batchSize),
    maxConcurrency: Number(settings.max_concurrency ?? settings.maxConcurrency),
    maxRetries: Number(settings.max_retries ?? settings.maxRetries),
    maxWaitTimeMs: Number(settings.max_wait_time_ms ?? settings.maxWaitTimeMs),
    deadLetterQueue: consumer.dead_letter_queue ?? consumer.deadLetterQueue
      ?? listed.dead_letter_queue ?? listed.deadLetterQueue,
  };
  if (normalized.batchSize !== 1
    || normalized.maxConcurrency !== 1
    || normalized.maxRetries !== 5
    || normalized.maxWaitTimeMs !== 1_000
    || normalized.deadLetterQueue !== DLQ_NAME) {
    throw new Error(`Production Queue topology changed: ${JSON.stringify(normalized)}`);
  }
}

function validatePayload({ d1, candidate }) {
  const payload = JSON.parse(d1.payload_json);
  const topContent = Array.isArray(payload.topContent) ? payload.topContent : [];
  const topAds = Array.isArray(payload.topAds) ? payload.topAds : [];
  const contract = getReportPlatformContract(candidate.platformScope);
  if (contract.capability === 'organic') {
    for (const row of topContent) {
      const publishedDate = bangkokDate(row.published_at);
      if (publishedDate < candidate.period.periodStart || publishedDate > candidate.period.periodEnd) {
        throw new Error(`Organic Top Content is outside selected period: ${candidate.reportId}`);
      }
      if (!String(row.caption ?? '').trim()) {
        throw new Error(`Organic Top Content caption is missing: ${candidate.reportId}`);
      }
    }
    validateOrganicEngagement(payload.metricPayload, candidate.platformScope);
  } else if (contract.capability === 'paid_ads') {
    if (topAds.some((row) => !String(row.ad_name ?? '').trim())) {
      throw new Error(`Paid Ads ranked entity name is missing: ${candidate.reportId}`);
    }
  } else {
    throw new Error(`Unsupported refresh capability: ${contract.capability}`);
  }
  return Object.freeze({
    topContentCount: topContent.length,
    topAdsCount: topAds.length,
    workerCompletedAfterLarkWrite: true,
  });
}

function validateOrganicEngagement(metricPayload, platform) {
  const current = (suffix) => metricPayload?.[`${platform}:${suffix}`]?.current ?? null;
  const likes = current('period_likes');
  const comments = current('period_comments');
  const shares = current('period_shares');
  const engagement = current('period_engagement');
  if (platform === 'youtube' && shares !== null) throw new Error('YouTube Shares must be null/N/A');
  if (likes !== null && comments !== null) {
    const expected = Number(likes) + Number(comments) + (shares === null ? 0 : Number(shares));
    if (Number(engagement) !== expected) throw new Error(`${platform} Engagement formula mismatch`);
  }
}

function bangkokDate(value) {
  const epoch = Number(value);
  if (!Number.isFinite(epoch)) throw new Error('Top Content published_at is invalid');
  return new Date(epoch + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function required(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} is required`);
  return value.trim();
}
