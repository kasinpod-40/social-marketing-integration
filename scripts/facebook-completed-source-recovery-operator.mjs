import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  parseJsoncObject,
} from './lib/chatwoot-safe-wrangler-config.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  FACEBOOK_COMPLETED_SOURCE_INCIDENT,
  buildFacebookRecoveryWranglerConfig,
  evaluateFacebookCompletedSourceCompletion,
  evaluateFacebookCompletedSourcePreflight,
  validateFacebookRecoveryWranglerConfig,
} from './lib/facebook-completed-source-recovery.js';

const CONFIG_PATH = resolve(process.env.MKT_SYNC_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const DEV_VARS_PATH = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const CONFIRMATION = 'RECOVER_FACEBOOK_COMPLETED_SOURCE_ONCE';
const POLL_MS = 15_000;
const MAX_POLLS = 240;
const AUTH_REFRESH_MS = 4 * 60 * 1000;
const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
const CONTENT_COVERAGE_RUN_ID = `${incident.operationId}:facebook:content`;
const ACCOUNT_COVERAGE_RUN_ID = `${incident.operationId}:facebook:account_daily`;

let restoreOutcome = Object.freeze({ attempted: false, status: 'not_required' });

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    status: error?.code ?? 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    restore: restoreOutcome,
    production: 'BLOCKED',
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const recover = args.includes('--recover');
  const unknown = args.filter((arg) => !['--execute', '--recover'].includes(arg));
  if (unknown.length > 0 || (execute && recover)) {
    throw operatorError(
      'Facebook recovery operator accepts exactly one of --execute or --recover',
      'FACEBOOK_COMPLETED_SOURCE_RECOVERY_ARGUMENT_INVALID',
      { unknown },
    );
  }
  if (!execute && !recover) {
    printPlan();
    return;
  }
  requireConfirmation();
  assertRepositoryState();

  const sourceConfigText = await readFile(CONFIG_PATH, 'utf8');
  const config = validateFacebookRecoveryWranglerConfig(sourceConfigText);
  const fileEnv = await readDevVars(DEV_VARS_PATH);
  const runtime = await createCloudflareRuntime({ configText: sourceConfigText, fileEnv, config });
  const evidenceRoot = await createEvidenceRoot();

  if (recover) {
    await closeoutRecoveredIncident({ runtime, config, evidenceRoot });
    return;
  }

  const tempConfigPath = resolve(`.facebook-completed-source-recovery-${process.pid}.json`);

  const preflightSnapshot = await readPreflightSnapshot(runtime);
  const preflight = evaluateFacebookCompletedSourcePreflight(preflightSnapshot);
  const syncGate = evaluateSyncFailureGate(preflightSnapshot.sync);
  const gate = {
    ...preflight,
    ok: preflight.ok && syncGate.ok,
    status: preflight.ok && syncGate.ok
      ? preflight.status
      : 'FACEBOOK_COMPLETED_SOURCE_REDRIVE_PREFLIGHT_BLOCKED',
    syncGate,
  };
  await saveEvidence(evidenceRoot, '01-preflight.json', sanitizePreflight(preflightSnapshot, gate, config));
  console.log(JSON.stringify({
    event: 'facebook_completed_source_recovery_preflight',
    status: gate.status,
    deadLetterId: gate.deadLetterId,
    generation: gate.generation,
    scopedRows: gate.scopedRows,
    missingScopedSequences: gate.missingScopedSequences,
    syncGate,
  }));
  if (!gate.ok) {
    throw operatorError(
      'Facebook completed-source recovery preflight failed closed',
      'FACEBOOK_COMPLETED_SOURCE_REDRIVE_PREFLIGHT_BLOCKED',
      { errors: [...gate.errors, ...syncGate.errors] },
    );
  }

  const queue = await resolveMainQueue(runtime);
  await saveEvidence(evidenceRoot, '02-queue-readback.json', {
    queueName: queue.queue_name,
    queueIdFingerprint: fingerprint(queue.queue_id),
    deliveryPaused: queue.settings?.delivery_paused ?? null,
  });
  if (queue.settings?.delivery_paused === true) {
    throw operatorError(
      'Main Queue delivery is paused',
      'FACEBOOK_COMPLETED_SOURCE_MAIN_QUEUE_PAUSED',
    );
  }

  let recoveryConfigWritten = false;
  let redriveDeployCompleted = false;
  let finalResult = null;
  try {
    const recoveryConfig = buildFacebookRecoveryWranglerConfig(sourceConfigText, true);
    await writeFile(tempConfigPath, recoveryConfig.text, { encoding: 'utf8', mode: 0o600 });
    recoveryConfigWritten = true;

    const dryRun = runCommand('npx', [
      'wrangler', 'deploy', '--dry-run', '--config', tempConfigPath, '--keep-vars',
    ], runtime.commandEnv);
    await saveCommandEvidence(evidenceRoot, '03-redrive-deploy-dry-run.json', dryRun);

    const deploy = runCommand('npx', [
      'wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars',
    ], runtime.commandEnv);
    redriveDeployCompleted = true;
    await saveCommandEvidence(evidenceRoot, '04-redrive-deploy.json', deploy);
    console.log(JSON.stringify({
      event: 'facebook_completed_source_recovery_gate',
      status: 'REDRIVE_GATE_ENABLED',
      changed: recoveryConfig.changed,
      schedulesChanged: 0,
    }));

    const beforeSend = await readPreflightSnapshot(runtime);
    const beforeSendGate = evaluateFacebookCompletedSourcePreflight(beforeSend);
    const beforeSendSync = evaluateSyncFailureGate(beforeSend.sync);
    if (!beforeSendGate.ok || !beforeSendSync.ok) {
      throw operatorError(
        'Remote state drifted after deploy and before Queue admission',
        'FACEBOOK_COMPLETED_SOURCE_RECOVERY_POST_DEPLOY_DRIFT',
        { errors: [...beforeSendGate.errors, ...beforeSendSync.errors] },
      );
    }

    const pushResult = await pushRedriveCommand(runtime, queue.queue_id, beforeSendGate.deadLetterId);
    await saveEvidence(evidenceRoot, '05-redrive-admission.json', {
      success: pushResult.success === true,
      deadLetterId: beforeSendGate.deadLetterId,
      commandType: 'system.dead-letter.redrive',
      queueName: incident.mainQueueName,
      queueIdFingerprint: fingerprint(queue.queue_id),
      providerPayloadIncluded: false,
      originalFacebookPayloadIncluded: false,
    });
    console.log(JSON.stringify({
      event: 'facebook_completed_source_recovery_admission',
      status: 'ONE_REDRIVE_COMMAND_SENT',
      deadLetterId: beforeSendGate.deadLetterId,
      queueMessagesByOperator: 1,
    }));

    finalResult = await pollForCompletion(runtime, {
      initialQueueAttempts: Number(beforeSend.queueOperation.main_queue_attempts),
      evidenceRoot,
    });
    await saveEvidence(evidenceRoot, '06-completion.json', finalResult);
    if (!finalResult.ok) {
      throw operatorError(
        'Facebook completed-source recovery did not reach durable completion',
        finalResult.status,
        { completion: finalResult },
      );
    }
  } finally {
    if (redriveDeployCompleted) {
      restoreOutcome = Object.freeze({ attempted: true, status: 'in_progress' });
      let restoreDryRunError = null;
      try {
        const restoreDryRun = runCommand('npx', [
          'wrangler', 'deploy', '--dry-run', '--config', CONFIG_PATH, '--keep-vars',
        ], runtime.commandEnv);
        await saveCommandEvidence(evidenceRoot, '07-restore-dry-run.json', restoreDryRun);
      } catch (error) {
        restoreDryRunError = error;
        await saveEvidence(evidenceRoot, '07-restore-dry-run.json', {
          status: 'failed_but_restore_will_still_be_attempted',
          message: error?.message ?? String(error),
        });
      }

      try {
        const restore = runCommand('npx', [
          'wrangler', 'deploy', '--config', CONFIG_PATH, '--keep-vars',
        ], runtime.commandEnv);
        await saveCommandEvidence(evidenceRoot, '08-restore.json', restore);
        restoreOutcome = Object.freeze({
          attempted: true,
          status: 'restored',
          redriveEnabled: false,
          scheduleChanges: 0,
          restoreDryRunPassed: restoreDryRunError === null,
        });
        console.log(JSON.stringify({
          event: 'facebook_completed_source_recovery_restore',
          status: 'REDRIVE_GATE_RESTORED_FALSE',
          scheduleChanges: 0,
          restoreDryRunPassed: restoreDryRunError === null,
        }));
      } catch (error) {
        restoreOutcome = Object.freeze({
          attempted: true,
          status: 'restore_failed',
          message: error?.message ?? String(error),
          restoreDryRunMessage: restoreDryRunError?.message ?? null,
        });
        throw operatorError(
          'Facebook recovery completed/failed but redrive gate restore failed',
          'FACEBOOK_COMPLETED_SOURCE_RECOVERY_RESTORE_FAILED',
          { restore: restoreOutcome },
        );
      }
    }
    if (recoveryConfigWritten) await rm(tempConfigPath, { force: true });
  }

  const finalReadback = await readCompletionSnapshot(runtime);
  const finalCompletion = evaluateFacebookCompletedSourceCompletion({ latest: finalReadback });
  const deadLetter = await readExactDeadLetter(runtime);
  const summary = finalCompletion.summary ?? {};
  const final = {
    ok: finalResult?.ok === true && finalCompletion.ok && restoreOutcome.status === 'restored',
    status: finalResult?.ok === true && finalCompletion.ok && restoreOutcome.status === 'restored'
      ? 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_CLOSED'
      : 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_FINAL_READBACK_BLOCKED',
    mode: 'EXECUTE_ONCE',
    contractVersion: incident.contractVersion,
    repository: repositorySummary(),
    source: {
      stage: finalCompletion.ok ? 'complete' : finalReadback.source_stage,
      complete: finalCompletion.ok ? 1 : Number(finalReadback.source_complete ?? 0),
      unitCount: finalCompletion.ok ? incident.expectedUnits : Number(finalReadback.source_units ?? 0),
      contentIndex: finalCompletion.ok ? incident.expectedContentCount : Number(finalReadback.content_index ?? 0),
      contentCount: finalCompletion.ok ? incident.expectedContentCount : Number(finalReadback.content_count ?? 0),
      sourceContentRows: Number(summary.sourceContentRows ?? 0),
      contentDailyRows: Number(summary.contentDailyRows ?? 0),
      providerReplayPreventedByCompletedSourceGate: true,
    },
    business: {
      d1Complete: finalCompletion.ok ? 1 : Number(finalReadback.d1_complete ?? 0),
      larkComplete: finalCompletion.ok ? 1 : Number(finalReadback.lark_complete ?? 0),
      completionComplete: finalCompletion.ok ? 1 : Number(finalReadback.completion_complete ?? 0),
      d1ExpectedOperations: Number(summary.d1ExpectedOperations ?? 0),
      d1ProcessedOperations: Number(summary.d1ProcessedOperations ?? 0),
      larkTableCount: Number(summary.larkTableCount ?? 0),
      operationObservations: Number(finalReadback.operation_observations ?? 0),
      accountDailyRows: Number(summary.accountDailyRows ?? 0),
      targetDayAccountDailyRows: Number(summary.targetDayAccountDailyRows ?? 0),
    },
    deadLetter: {
      dlqId: deadLetter?.dlq_id ?? null,
      status: deadLetter?.status ?? null,
      redriven: deadLetter?.status === 'redriven',
    },
    restore: restoreOutcome,
    operatorMutations: {
      workerDeployments: 2,
      adminQueueMessages: 1,
      providerRequests: 0,
      directD1BusinessWrites: 0,
      directLarkWrites: 0,
      scheduleChanges: 0,
    },
    evidenceRoot,
    production: 'BLOCKED',
  };
  await saveEvidence(evidenceRoot, '09-final.json', final);
  console.log(JSON.stringify(final, null, 2));
  if (!final.ok) process.exitCode = 1;
}

async function closeoutRecoveredIncident({ runtime, config, evidenceRoot }) {
  const finalReadback = await readCompletionSnapshot(runtime);
  const finalCompletion = evaluateFacebookCompletedSourceCompletion({ latest: finalReadback });
  const deadLetter = await readExactDeadLetter(runtime);
  const summary = finalCompletion.summary ?? {};
  const final = {
    ok: finalCompletion.ok,
    status: finalCompletion.ok
      ? 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_CLOSED'
      : 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_FINAL_READBACK_BLOCKED',
    mode: 'READ_ONLY_CLOSEOUT',
    contractVersion: incident.contractVersion,
    repository: repositorySummary(),
    source: {
      stage: finalCompletion.ok ? 'complete' : null,
      complete: finalCompletion.ok ? 1 : 0,
      unitCount: finalCompletion.ok ? incident.expectedUnits : 0,
      contentIndex: finalCompletion.ok ? incident.expectedContentCount : 0,
      contentCount: finalCompletion.ok ? incident.expectedContentCount : 0,
      sourceContentRows: Number(summary.sourceContentRows ?? 0),
      contentDailyRows: Number(summary.contentDailyRows ?? 0),
      providerReplayPreventedByCompletedSourceGate: true,
    },
    business: {
      d1Complete: finalCompletion.ok ? 1 : 0,
      larkComplete: finalCompletion.ok ? 1 : 0,
      completionComplete: finalCompletion.ok ? 1 : 0,
      d1ExpectedOperations: Number(summary.d1ExpectedOperations ?? 0),
      d1ProcessedOperations: Number(summary.d1ProcessedOperations ?? 0),
      organicHistoryContentRows: Number(summary.organicHistoryContentRows ?? 0),
      larkTableCount: Number(summary.larkTableCount ?? 0),
      operationObservations: Number(summary.operationObservations ?? 0),
      accountDailyRows: Number(summary.accountDailyRows ?? 0),
      targetDayAccountDailyRows: Number(summary.targetDayAccountDailyRows ?? 0),
      queueAttempts: Number(summary.queueAttempts ?? 0),
    },
    deadLetter: {
      dlqId: deadLetter?.dlq_id ?? null,
      status: deadLetter?.status ?? null,
      redriven: deadLetter?.status === 'redriven',
    },
    runtimeBaseline: {
      redriveEnabled: config.executionFlags.redrive,
      facebookSchedule: config.executionFlags.facebookSchedule,
      instagramSchedule: config.executionFlags.instagramSchedule,
    },
    restore: {
      attempted: false,
      status: 'not_required',
      redriveEnabled: false,
      scheduleChanges: 0,
    },
    operatorMutations: {
      workerDeployments: 0,
      adminQueueMessages: 0,
      providerRequests: 0,
      directD1BusinessWrites: 0,
      directLarkWrites: 0,
      scheduleChanges: 0,
    },
    errors: finalCompletion.errors,
    evidenceRoot,
    production: 'BLOCKED',
  };
  await saveEvidence(evidenceRoot, '10-read-only-closeout.json', final);
  console.log(JSON.stringify(final, null, 2));
  if (!final.ok) process.exitCode = 1;
}

function repositorySummary() {
  return {
    requiredMergeSha: incident.requiredMainSha,
    head: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    branch: readCommand('git', ['branch', '--show-current']).trim(),
    clean: readCommand('git', ['status', '--porcelain']).trim() === '',
  };
}

function printPlan() {
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    status: 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_PLAN_ONLY',
    contractVersion: incident.contractVersion,
    operationId: incident.operationId,
    requiredMainSha: incident.requiredMainSha,
    steps: [
      'verify clean main contains the required merged recovery code',
      'read exact terminal Work, Source phase, physical scoped staging, Queue attempt and dead-letter evidence',
      'fail closed unless the 91 scoped rows from sequence 82 through 172 are complete and Business writes are still zero',
      'deploy the same Worker config with only MKT_DLQ_REDRIVE_ENABLED=true',
      're-read the incident before admission',
      'push exactly one system.dead-letter.redrive command for the discovered terminal DLQ',
      'poll the same Work until durable completion_json, exact D1 coverage and Lark reconciliation are complete',
      'restore the original config with MKT_DLQ_REDRIVE_ENABLED=false in finally',
      'perform final D1/dead-letter readback',
    ],
    recoveryAfterAdmission: {
      mode: '--recover',
      behavior: 'read_only_closeout_without_deploy_or_queue_resend',
      authority: 'retained completion_json plus exact D1 coverage and redriven DLQ',
    },
    safety: {
      providerReplay: 'blocked_by_completed_source_gate',
      directD1BusinessWrites: 0,
      directLarkWrites: 0,
      scheduleChanges: 0,
      production: 'BLOCKED',
    },
    confirmationVariable: 'CONFIRM_FACEBOOK_COMPLETED_SOURCE_RECOVERY',
    confirmationValue: CONFIRMATION,
  }, null, 2));
}

function requireConfirmation() {
  if (process.env.CONFIRM_FACEBOOK_COMPLETED_SOURCE_RECOVERY !== CONFIRMATION) {
    throw operatorError(
      'Exact Facebook completed-source recovery confirmation is required',
      'FACEBOOK_COMPLETED_SOURCE_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError('Recovery operator must run from main', 'FACEBOOK_RECOVERY_REPOSITORY_BLOCKED', {
      branch,
    });
  }
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty !== '') {
    throw operatorError('Recovery operator requires a clean repository', 'FACEBOOK_RECOVERY_REPOSITORY_BLOCKED', {
      dirty: dirty.split('\n').slice(0, 20),
    });
  }
  const ancestor = spawnSync('git', [
    'merge-base', '--is-ancestor', incident.requiredMainSha, 'HEAD',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (ancestor.status !== 0) {
    throw operatorError(
      'Current main does not contain the required Facebook recovery merge',
      'FACEBOOK_RECOVERY_REPOSITORY_BLOCKED',
      { requiredMainSha: incident.requiredMainSha },
    );
  }
}

async function createCloudflareRuntime({ configText, fileEnv, config }) {
  const parsedConfig = parseJsoncObject(configText);
  const baseEnv = { ...fileEnv, ...process.env };
  const wrangler = (args, env = baseEnv) => execFileSync('npx', ['wrangler', ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const whoami = wrangler(['whoami', '--json']);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: baseEnv.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput: whoami,
  });
  const runtimeEnv = { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  let auth = null;
  let authLoadedAt = 0;

  function loadAuth(force = false) {
    const now = Date.now();
    if (!force && auth && now - authLoadedAt < AUTH_REFRESH_MS) return auth;
    auth = resolveCloudflareBearerAuth({
      explicitApiToken: runtimeEnv.CLOUDFLARE_API_TOKEN,
      authOutput: runtimeEnv.CLOUDFLARE_API_TOKEN
        ? null
        : wrangler(['auth', 'token', '--json'], runtimeEnv),
    });
    authLoadedAt = now;
    return auth;
  }

  async function api(path, options = {}, retry = true) {
    const token = loadAuth(false);
    let response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (retry && (response.status === 401 || response.status === 403)) {
      const refreshed = loadAuth(true);
      response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${refreshed.token}`,
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });
    }
    const body = await response.json();
    if (!response.ok || body?.success !== true) {
      throw operatorError(
        `Cloudflare API request failed HTTP ${response.status}`,
        'FACEBOOK_RECOVERY_CLOUDFLARE_API_FAILED',
        { error: body?.errors?.[0]?.message ?? 'unknown' },
      );
    }
    return body;
  }

  async function query(sqlText) {
    const body = await api(
      `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: sqlText }) },
    );
    const blocks = Array.isArray(body.result) ? body.result : [body.result];
    return blocks.flatMap((block) => block?.results ?? []);
  }

  return Object.freeze({
    accountId,
    config: parsedConfig,
    query,
    api,
    commandEnv: runtimeEnv,
  });
}

async function readPreflightSnapshot(runtime) {
  const workRows = await runtime.query(`
    SELECT work_key, cursor_key, generation, requested_at, lifecycle_status,
           terminal_reason, audit_reference, completed_at
    FROM sync_work_runs
    WHERE work_key=${sql(incident.workKey)}
    LIMIT 1
  `);
  const work = workRows[0] ?? {};
  const sourceRows = await runtime.query(`
    SELECT complete,
           json_extract(state_json,'$.stage') AS stage,
           json_extract(state_json,'$.unitCount') AS unit_count,
           json_extract(state_json,'$.contentIndex') AS content_index,
           json_array_length(json_extract(state_json,'$.contentIds')) AS content_count,
           json_extract(state_json,'$.contentInventoryScope') AS scope,
           json_extract(state_json,'$.contentInventoryStartSequence') AS scope_start_sequence
    FROM sync_work_phases
    WHERE work_key=${sql(incident.workKey)}
      AND phase=${sql(incident.sourcePhase)}
    LIMIT 1
  `);
  const phaseRows = await runtime.query(`
    SELECT
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.d1Phase)}) AS d1_complete,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.larkPhase)}) AS lark_complete,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.completionPhase)}) AS completion_complete
  `);
  const observationRows = await runtime.query(`
    SELECT COUNT(*) AS operation_observations,
           SUM(CASE WHEN metric_date=${sql(incident.periodEnd)} THEN 1 ELSE 0 END) AS target_day_observations
    FROM organic_content_observations
    WHERE sync_run_id=${sql(incident.syncRunId)}
  `);
  const queueRows = await runtime.query(`
    SELECT operation_id, work_key, generation, original_requested_at,
           main_queue_attempts, last_main_message_id
    FROM queue_operation_attempts
    WHERE operation_id=${sql(incident.operationId)}
    LIMIT 1
  `);
  const deadLetters = await runtime.query(`
    SELECT d.dlq_id, d.message_id, d.job_type, d.status, d.error_code,
           m.operation_id AS metadata_operation_id,
           m.original_work_key AS metadata_work_key,
           m.generation AS metadata_generation,
           m.original_requested_at AS metadata_original_requested_at,
           m.main_queue_attempts AS metadata_main_queue_attempts,
           json_extract(d.replay_payload_json,'$.type') AS replay_type,
           json_extract(d.replay_payload_json,'$.operationId') AS replay_operation_id,
           json_extract(d.replay_payload_json,'$.workKey') AS replay_work_key,
           json_extract(d.replay_payload_json,'$.generation') AS replay_generation,
           json_extract(d.replay_payload_json,'$.originalRequestedAt') AS replay_original_requested_at,
           json_extract(d.replay_payload_json,'$.periodStart') AS replay_period_start,
           json_extract(d.replay_payload_json,'$.periodEnd') AS replay_period_end,
           json_extract(d.replay_payload_json,'$.trigger') AS replay_trigger
    FROM dead_letter_jobs AS d
    LEFT JOIN dead_letter_operation_metadata AS m ON m.dlq_id=d.dlq_id
    WHERE json_extract(d.replay_payload_json,'$.operationId')=${sql(incident.operationId)}
      AND json_extract(d.replay_payload_json,'$.workKey')=${sql(incident.workKey)}
    ORDER BY d.created_at DESC
  `);
  const sequenceRows = await runtime.query(`
    SELECT sequence
    FROM sync_work_units
    WHERE work_key=${sql(incident.workKey)}
      AND phase=${sql(incident.sourcePhase)}
      AND sequence >= ${incident.scopeStartSequence}
      AND sequence < ${incident.expectedUnits}
    ORDER BY sequence
  `);
  const lockRows = work.cursor_key
    ? await runtime.query(`
        SELECT COUNT(*) AS active_locks
        FROM sync_locks
        WHERE lock_key=${sql(work.cursor_key)}
          AND expires_at > (unixepoch() * 1000)
      `)
    : [{ active_locks: 0 }];
  const syncRows = await runtime.query(`
    SELECT status, error_code
    FROM sync_runs
    WHERE sync_run_id=${sql(incident.syncRunId)}
    LIMIT 1
  `);

  return Object.freeze({
    work,
    source: sourceRows[0] ?? {},
    phases: phaseRows[0] ?? {},
    observations: observationRows[0] ?? {},
    queueOperation: queueRows[0] ?? {},
    deadLetters,
    scopedSequences: sequenceRows.map((row) => row.sequence),
    activeLockCount: Number(lockRows[0]?.active_locks ?? 0),
    sync: syncRows[0] ?? {},
  });
}

function evaluateSyncFailureGate(sync) {
  const errors = [];
  if (sync?.status !== 'failed') {
    errors.push({ field: 'sync status before recovery', expected: 'failed', actual: sync?.status ?? null });
  }
  if (sync?.error_code !== incident.expectedFailureCode) {
    errors.push({
      field: 'sync error before recovery',
      expected: incident.expectedFailureCode,
      actual: sync?.error_code ?? null,
    });
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

async function readCompletionSnapshot(runtime) {
  const rows = await runtime.query(`
    SELECT
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key=${sql(incident.workKey)}) AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key=${sql(incident.workKey)}) AS work_completed_at,
      (SELECT completion_json FROM sync_work_runs WHERE work_key=${sql(incident.workKey)}) AS completion_json,
      (SELECT status FROM sync_runs WHERE sync_run_id=${sql(incident.syncRunId)}) AS sync_status,
      (SELECT error_code FROM sync_runs WHERE sync_run_id=${sql(incident.syncRunId)}) AS sync_error_code,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.sourcePhase)}) AS source_complete,
      (SELECT json_extract(state_json,'$.stage') FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.sourcePhase)}) AS source_stage,
      (SELECT json_extract(state_json,'$.unitCount') FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.sourcePhase)}) AS source_units,
      (SELECT json_extract(state_json,'$.contentIndex') FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.sourcePhase)}) AS content_index,
      (SELECT json_array_length(json_extract(state_json,'$.contentIds')) FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.sourcePhase)}) AS content_count,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.d1Phase)}) AS d1_complete,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.larkPhase)}) AS lark_complete,
      (SELECT complete FROM sync_work_phases WHERE work_key=${sql(incident.workKey)} AND phase=${sql(incident.completionPhase)}) AS completion_complete,
      (SELECT COUNT(*) FROM organic_content_observations WHERE sync_run_id=${sql(incident.syncRunId)}) AS operation_observations,
      (SELECT COUNT(*) FROM organic_content_observations WHERE sync_run_id=${sql(incident.syncRunId)} AND metric_date=${sql(incident.periodEnd)}) AS target_day_observations,
      (SELECT COALESCE(MAX(main_queue_attempts),0) FROM queue_operation_attempts WHERE operation_id=${sql(incident.operationId)}) AS queue_attempts,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id=${sql(incident.syncRunId)} AND expires_at > (unixepoch() * 1000)) AS active_locks,
      (SELECT status FROM dead_letter_jobs WHERE json_extract(replay_payload_json,'$.operationId')=${sql(incident.operationId)} AND json_extract(replay_payload_json,'$.workKey')=${sql(incident.workKey)} ORDER BY created_at DESC LIMIT 1) AS dead_letter_status,
      (SELECT status FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_status,
      (SELECT sync_run_id FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_sync_run_id,
      (SELECT expected_entities FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_observed_rows,
      (SELECT written_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_written_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(CONTENT_COVERAGE_RUN_ID)}) AS content_coverage_failed_rows,
      (SELECT status FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_status,
      (SELECT sync_run_id FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_sync_run_id,
      (SELECT expected_entities FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_observed_rows,
      (SELECT written_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_written_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE coverage_run_id=${sql(ACCOUNT_COVERAGE_RUN_ID)}) AS account_coverage_failed_rows,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE sync_run_id=${sql(incident.syncRunId)}) AS account_daily_rows,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE sync_run_id=${sql(incident.syncRunId)} AND metric_date=${sql(incident.periodEnd)}) AS target_day_account_daily_rows
  `);
  return rows[0] ?? {};
}

async function pollForCompletion(runtime, { initialQueueAttempts, evidenceRoot }) {
  let latest = null;
  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    latest = await readCompletionSnapshot(runtime);
    const evaluation = evaluateFacebookCompletedSourceCompletion({ latest });
    const queueAttempts = Number(latest.queue_attempts ?? 0);
    const terminalAfterAdmission = queueAttempts > initialQueueAttempts
      && latest.work_lifecycle_status === 'terminal'
      && latest.sync_status === 'failed';

    if (poll === 1 || poll % 5 === 0 || evaluation.ok || terminalAfterAdmission) {
      const progress = {
        event: 'facebook_completed_source_recovery_progress',
        poll,
        lifecycleStatus: latest.work_lifecycle_status ?? null,
        syncStatus: latest.sync_status ?? null,
        syncErrorCode: latest.sync_error_code ?? null,
        sourceStage: latest.source_stage ?? null,
        sourceUnits: Number(latest.source_units ?? 0),
        contentIndex: Number(latest.content_index ?? 0),
        contentCount: Number(latest.content_count ?? 0),
        durableCompletionRetained: typeof latest.completion_json === 'string' && latest.completion_json.length > 0,
        d1Complete: latest.d1_complete ?? null,
        larkComplete: latest.lark_complete ?? null,
        completionComplete: latest.completion_complete ?? null,
        contentCoverageStatus: latest.content_coverage_status ?? null,
        accountCoverageStatus: latest.account_coverage_status ?? null,
        observations: Number(latest.operation_observations ?? 0),
        targetDayAccountDailyRows: Number(latest.target_day_account_daily_rows ?? 0),
        deadLetterStatus: latest.dead_letter_status ?? null,
        queueAttempts,
        activeLocks: Number(latest.active_locks ?? 0),
      };
      console.log(JSON.stringify(progress));
      await saveEvidence(evidenceRoot, `progress-${String(poll).padStart(3, '0')}.json`, progress);
    }

    if (evaluation.ok) {
      return Object.freeze({ ok: true, status: evaluation.status, latest, summary: evaluation.summary });
    }
    if (terminalAfterAdmission) {
      return Object.freeze({
        ok: false,
        status: 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_TERMINAL_AFTER_ADMISSION',
        latest,
      });
    }
    await sleep(POLL_MS);
  }
  return Object.freeze({
    ok: false,
    status: 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_POLL_LIMIT',
    latest,
  });
}

async function readExactDeadLetter(runtime) {
  const rows = await runtime.query(`
    SELECT dlq_id, status, error_code, redrive_requested_at, redrive_reference, redriven_at
    FROM dead_letter_jobs
    WHERE json_extract(replay_payload_json,'$.operationId')=${sql(incident.operationId)}
      AND json_extract(replay_payload_json,'$.workKey')=${sql(incident.workKey)}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function resolveMainQueue(runtime) {
  const body = await runtime.api(`/accounts/${runtime.accountId}/queues`, { method: 'GET' });
  const queues = Array.isArray(body.result)
    ? body.result.filter((item) => item?.queue_name === incident.mainQueueName)
    : [];
  if (queues.length !== 1 || !queues[0]?.queue_id) {
    throw operatorError(
      'Exact main Queue could not be resolved',
      'FACEBOOK_COMPLETED_SOURCE_MAIN_QUEUE_AMBIGUOUS',
      { queueName: incident.mainQueueName, matches: queues.length },
    );
  }
  return queues[0];
}

async function pushRedriveCommand(runtime, queueId, dlqId) {
  return runtime.api(
    `/accounts/${runtime.accountId}/queues/${queueId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        body: {
          schemaVersion: 1,
          type: 'system.dead-letter.redrive',
          dlqId,
        },
        content_type: 'json',
      }),
    },
  );
}

function runCommand(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      `${command} ${args.join(' ')} failed`,
      'FACEBOOK_COMPLETED_SOURCE_RECOVERY_COMMAND_FAILED',
      {
        status: result.status,
        stdoutTail: tail(result.stdout),
        stderrTail: tail(result.stderr),
      },
    );
  }
  return Object.freeze({
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function readCommand(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function createEvidenceRoot() {
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  const root = resolve(
    process.env.MKT_FACEBOOK_RECOVERY_EVIDENCE_DIR
      ?? join(homedir(), 'Downloads', `facebook-completed-source-recovery-${stamp}`),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function saveEvidence(root, name, value) {
  await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function saveCommandEvidence(root, name, result) {
  await saveEvidence(root, name, {
    command: result.command,
    status: result.status,
    stdoutTail: tail(result.stdout, 80),
    stderrTail: tail(result.stderr, 80),
  });
}

function sanitizePreflight(snapshot, gate, config) {
  return {
    status: gate.status,
    ok: gate.ok,
    errors: gate.errors,
    syncGate: gate.syncGate,
    work: snapshot.work,
    source: snapshot.source,
    phases: snapshot.phases,
    observations: snapshot.observations,
    queueOperation: {
      ...snapshot.queueOperation,
      last_main_message_id: snapshot.queueOperation?.last_main_message_id ? '<retained>' : null,
    },
    deadLetters: snapshot.deadLetters.map((row) => ({
      ...row,
      message_id: row.message_id ? '<retained>' : null,
    })),
    physical: {
      scopedRows: gate.scopedRows,
      missingScopedSequences: gate.missingScopedSequences,
    },
    activeLockCount: snapshot.activeLockCount,
    sync: snapshot.sync,
    config: {
      workerName: config.workerName,
      databaseName: config.databaseName,
      mainQueueName: config.mainQueueName,
      executionFlags: config.executionFlags,
    },
  };
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tail(value, lineCount = 30) {
  return String(value ?? '').split('\n').slice(-lineCount).join('\n');
}

function fingerprint(value) {
  const text = String(value ?? '');
  if (text.length <= 8) return '<redacted>';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
