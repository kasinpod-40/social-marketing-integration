import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ChatwootApiClient } from '../packages/connectors/src/chatwoot/chatwoot-api.client.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION,
  CHATWOOT_PROVIDER_PREFLIGHT_CONTRACT_VERSION,
  assertChatwootProviderPreflightConfirmation,
  buildChatwootProviderPreflightEvidence,
  classifyChatwootReportingPermissionError,
  loadChatwootProviderPreflightTarget,
  parseChatwootProviderPreflightArgs,
  summarizeChatwootProviderRequestEvents,
} from './lib/chatwoot-provider-preflight.js';

const EVIDENCE_ROOT = resolve(
  process.env.MKT_CHATWOOT_PROVIDER_PREFLIGHT_EVIDENCE_DIR
    ?? 'outputs/chatwoot-provider-preflight',
);
const EVIDENCE_FILE = resolve(EVIDENCE_ROOT, 'summary.json');

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    phase: 'chatwoot-provider-get-only-preflight',
    providerMutationCount: 0,
    d1MutationCount: 0,
    queueActionCount: 0,
    larkMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleWebhookActionCount: 0,
    error: sanitizeOperationalError(error),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseChatwootProviderPreflightArgs(process.argv.slice(2));
  if (mode.execute !== true) {
    printPlan();
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertChatwootProviderPreflightConfirmation(env);
  const target = loadChatwootProviderPreflightTarget(env);
  const requestEvents = [];
  const client = new ChatwootApiClient({
    baseUrl: target.baseUrl,
    accountId: target.accountId,
    accessToken: target.accessToken,
    timeoutMs: optionalPositiveInteger(env.CHATWOOT_API_TIMEOUT_MS, 30_000),
    maxAttempts: optionalPositiveInteger(env.CHATWOOT_API_MAX_ATTEMPTS, 5),
    maxPages: optionalPositiveInteger(env.CHATWOOT_API_MAX_PAGES, 100),
    maxRows: optionalPositiveInteger(env.CHATWOOT_API_MAX_ROWS, 5_000),
    maxResponseBytes: optionalPositiveInteger(env.CHATWOOT_API_MAX_RESPONSE_BYTES, 8_388_608),
    onRequest: (event) => requestEvents.push(event),
  });

  const profile = await client.get('api/v1/profile', {}, { operationName: 'profile' });
  const visibleAccounts = Array.isArray(profile?.accounts) ? profile.accounts : [];
  const matchingAccounts = visibleAccounts.filter((account) => Number(account?.id) === target.accountId);
  if (matchingAccounts.length !== 1) {
    throw operatorError(
      'Chatwoot profile did not expose the exact reviewed Account once',
      'CHATWOOT_PROVIDER_ACCOUNT_MISMATCH',
      {
        expectedAccountId: target.accountId,
        matchCount: matchingAccounts.length,
        visibleAccountCount: visibleAccounts.length,
      },
    );
  }
  const account = matchingAccounts[0];

  const inboxes = await client.listInboxes();
  const agents = await client.listAgents();
  const teams = await client.listTeams();
  const labels = await client.listLabels();
  const contacts = await client.listContactsPage({ page: 1 });
  const conversations = await client.listConversationsPage({ page: 1 });

  let reportingEvents = null;
  let reportingPermissionBlocker = null;
  try {
    reportingEvents = await client.listAccountReportingEventsPage({ page: 1 });
  } catch (error) {
    reportingPermissionBlocker = classifyChatwootReportingPermissionError(error);
    if (!reportingPermissionBlocker) throw error;
  }

  const endpointChecks = Object.freeze({
    profile: Object.freeze({ status: 'passed' }),
    inboxes: Object.freeze({ status: 'passed', rowsObserved: inboxes.length }),
    agents: Object.freeze({ status: 'passed', rowsObserved: agents.length }),
    teams: Object.freeze({ status: 'passed', rowsObserved: teams.length }),
    labels: Object.freeze({ status: 'passed', rowsObserved: labels.length }),
    contacts: Object.freeze({
      status: 'passed',
      pageRowsObserved: contacts.rows.length,
      declaredTotal: contacts.totalCount,
    }),
    conversations: Object.freeze({
      status: 'passed',
      pageRowsObserved: conversations.rows.length,
      declaredTotal: conversations.totalCount,
    }),
    reportingEvents: reportingEvents
      ? Object.freeze({
        status: 'passed',
        pageRowsObserved: reportingEvents.rows.length,
        declaredTotal: reportingEvents.totalCount,
        totalPages: reportingEvents.totalPages,
      })
      : Object.freeze({
        status: 'blocked',
        code: reportingPermissionBlocker.code,
        httpStatus: reportingPermissionBlocker.status,
        requiredRole: reportingPermissionBlocker.requiredRole,
      }),
  });

  const evidence = buildChatwootProviderPreflightEvidence({
    target,
    profile,
    account,
    visibleAccountCount: visibleAccounts.length,
    endpointChecks,
    requestSummary: summarizeChatwootProviderRequestEvents(requestEvents),
    reportingPermissionBlocker,
    capturedAt: new Date().toISOString(),
  });

  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await writeFile(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log(JSON.stringify({
    ok: true,
    executed: true,
    phase: evidence.phase,
    contractVersion: evidence.contractVersion,
    evidenceFile: EVIDENCE_FILE,
    status: evidence.status,
    accepted: evidence.accepted,
    decision: evidence.decision,
    identity: evidence.identity,
    endpointChecks: evidence.endpointChecks,
    requestSummary: evidence.requestSummary,
    blocker: evidence.blocker,
    nextGate: evidence.nextGate,
    boundaries: evidence.boundaries,
  }, null, 2));
}

function printPlan() {
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    phase: 'plan',
    contractVersion: CHATWOOT_PROVIDER_PREFLIGHT_CONTRACT_VERSION,
    confirmation: `CONFIRM_CHATWOOT_PROVIDER_GET_ONLY=${CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION}`,
    command: 'node scripts/chatwoot-provider-preflight.mjs --execute',
    evidenceFile: EVIDENCE_FILE,
    checks: [
      'profile',
      'exact_account',
      'inboxes',
      'agents',
      'teams',
      'labels',
      'contacts_page_1',
      'conversations_page_1',
      'reporting_events_page_1',
    ],
    safety: {
      transport: 'GET_only',
      tokenInQuery: false,
      providerMutation: false,
      d1Mutation: false,
      queueAction: false,
      larkMutation: false,
      workerDeployment: false,
      scheduleWebhookAction: false,
      productionAction: false,
    },
  }, null, 2));
}

function optionalPositiveInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw operatorError(
      'Chatwoot Provider numeric limit must be a positive integer',
      'CHATWOOT_PROVIDER_LIMIT_INVALID',
    );
  }
  return number;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootProviderPreflightError';
  error.code = code;
  error.details = details;
  return error;
}
