#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareYouTubeDryRunConfigs,
} from './lib/youtube-dry-run-rollout-operator.js';
import {
  validateLiveRemoteYouTubeDeploymentContract,
} from './lib/youtube-live-remote-contract-parser.js';

const CONFIRMATION_ENV = 'CONFIRM_YOUTUBE_LIVE_REMOTE_CONTRACT';
const CONFIRMATION_VALUE = 'VALIDATE_YOUTUBE_LIVE_REMOTE_CONTRACT';

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      remoteActionsPerformed: false,
      command: 'npm run validate:youtube-live-remote-contract:run',
      confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      inputFileRequired: true,
      inputContract: {
        safeConfigPath: 'reviewed safe Wrangler config path',
        activeConfigPath: 'reviewed active Wrangler config path',
        channelId: 'exact reviewed YouTube channel ID',
        active: false,
        workerName: 'social-mkt-sync-worker',
        expectedDatabaseName: 'social-mkt-state-dev',
        expectedD1BindingName: 'MKT_STATE_DB',
        versionsView: 'raw sanitized Wrangler versions view JSON',
        deploymentStatus: 'raw sanitized Wrangler deployment status JSON',
        queueConsumerContexts: [
          { expectedQueueName: 'social-mkt-sync-jobs', response: 'raw Main consumer JSON' },
          { expectedQueueName: 'social-mkt-sync-dlq', response: 'raw DLQ consumer JSON' },
        ],
        scriptList: 'raw Cloudflare Worker script-list JSON',
        schedules: 'raw Cloudflare Cron JSON',
        subdomain: 'raw Cloudflare workers.dev JSON',
        expectedDeploymentMessage: 'optional exact provenance message',
      },
    }, null, 2)}\n`);
    process.exitCode = 0;
  } else {
    assertConfirmation(process.env);
    const input = JSON.parse(await readFile(resolve(options.inputPath), 'utf8'));
    const safeConfigPath = requireText(input.safeConfigPath, 'safeConfigPath');
    const activeConfigPath = requireText(input.activeConfigPath, 'activeConfigPath');
    const channelId = requireText(input.channelId, 'channelId');
    const [safeConfig, activeConfig] = await Promise.all([
      readFile(resolve(safeConfigPath), 'utf8'),
      readFile(resolve(activeConfigPath), 'utf8'),
    ]);
    const comparison = compareYouTubeDryRunConfigs(safeConfig, activeConfig, { channelId });
    const expected = input.active === true ? comparison.active : comparison.safe;
    const result = validateLiveRemoteYouTubeDeploymentContract({
      versionsView: input.versionsView,
      deploymentStatus: input.deploymentStatus,
      queueConsumerContexts: input.queueConsumerContexts,
      expectedD1BindingName: input.expectedD1BindingName ?? 'MKT_STATE_DB',
      expectedDatabaseId: expected.databaseId,
      expectedDatabaseName: input.expectedDatabaseName ?? 'social-mkt-state-dev',
      workerName: input.workerName,
      scriptList: input.scriptList,
      schedules: input.schedules,
      subdomain: input.subdomain,
      active: input.active === true,
      ...(input.expectedDeploymentMessage === undefined
        ? {}
        : { expectedDeploymentMessage: input.expectedDeploymentMessage }),
      expectedRemoteFingerprint: expected.remoteContractFingerprint,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      remoteActionsPerformed: false,
      active: input.active === true,
      versionId: result.versionId,
      traffic: result.traffic,
      remoteFingerprint: result.remoteFingerprint,
      expectedRemoteFingerprint: expected.remoteContractFingerprint,
      secretNameCount: result.secretNameCount,
      queueConsumerCount: result.queueConsumerCount,
    }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'YOUTUBE_LIVE_REMOTE_CONTRACT_VALIDATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  let execute = false;
  let inputPath = null;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg.startsWith('--input=')) {
      inputPath = arg.slice('--input='.length);
      continue;
    }
    throw cliError(
      `Unknown YouTube live Remote contract argument: ${arg}`,
      'YOUTUBE_LIVE_REMOTE_CONTRACT_ARGUMENT_INVALID',
    );
  }
  if (execute && !inputPath) {
    throw cliError(
      'Executable validation requires --input=<sanitized-live-response.json>',
      'YOUTUBE_LIVE_REMOTE_CONTRACT_INPUT_REQUIRED',
    );
  }
  return Object.freeze({ execute, inputPath });
}

function assertConfirmation(env) {
  if (env?.[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw cliError(
      `Live Remote contract validation requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'YOUTUBE_LIVE_REMOTE_CONTRACT_CONFIRMATION_REQUIRED',
    );
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw cliError(
      `Live Remote contract input requires ${fieldName}`,
      'YOUTUBE_LIVE_REMOTE_CONTRACT_INPUT_INVALID',
    );
  }
  return value.trim();
}

function cliError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
