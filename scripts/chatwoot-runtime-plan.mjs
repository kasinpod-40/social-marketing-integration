import {
  CHATWOOT_RUNTIME_MODES,
  buildChatwootRuntimePlan,
} from '../packages/application/src/use-cases/chatwoot-runtime-contract.js';

try {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildChatwootRuntimePlan(args);
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    phase: 'chatwoot_runtime_plan',
    ...plan,
    safety: {
      providerRequests: 0,
      queueMessages: 0,
      remoteD1Queries: 0,
      remoteD1Mutations: 0,
      remoteLarkReads: 0,
      remoteLarkMutations: 0,
      workerDeployments: 0,
      scheduleWebhookActions: 0,
      secretReads: 0,
    },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    executed: false,
    phase: 'chatwoot_runtime_plan',
    code: error?.code ?? 'CHATWOOT_RUNTIME_PLAN_INVALID',
    error: error instanceof Error ? error.message : String(error),
    safety: {
      providerRequests: 0,
      queueMessages: 0,
      remoteD1Queries: 0,
      remoteD1Mutations: 0,
      remoteLarkReads: 0,
      remoteLarkMutations: 0,
      workerDeployments: 0,
      scheduleWebhookActions: 0,
      secretReads: 0,
    },
  }, null, 2));
  process.exitCode = 1;
}

function parseArgs(values) {
  const options = new Map();
  for (const value of values) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    if (!match) throw new TypeError(`Unsupported argument: ${value}`);
    if (options.has(match[1])) throw new TypeError(`Duplicate argument: --${match[1]}`);
    options.set(match[1], match[2]);
  }
  const modeText = options.get('mode') ?? 'initial';
  const mode = modeText === 'initial'
    ? CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT
    : modeText === 'daily'
      ? CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL
      : modeText;
  const requestedAtText = options.get('requested-at') ?? new Date().toISOString();
  const requestedAt = Date.parse(requestedAtText);
  if (!Number.isSafeInteger(requestedAt)) throw new TypeError('--requested-at must be an ISO timestamp');
  return Object.freeze({
    mode,
    requestedAt,
    conversationPages: integer(options.get('conversation-pages') ?? 0, 'conversation-pages'),
    reportingPages: integer(options.get('reporting-pages') ?? 0, 'reporting-pages'),
    conversationPagesPerInvocation: integer(
      options.get('conversation-pages-per-invocation') ?? 1,
      'conversation-pages-per-invocation',
    ),
    reportingPagesPerInvocation: integer(
      options.get('reporting-pages-per-invocation') ?? 5,
      'reporting-pages-per-invocation',
    ),
  });
}

function integer(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`--${fieldName} must be a non-negative integer`);
  }
  return number;
}
