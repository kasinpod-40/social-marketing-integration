import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { rebaseGeneratedWranglerConfigPaths } from './rebase-generated-wrangler-config-paths.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './woocommerce-final-one-command.js';
import {
  closeoutFailure,
  sha256,
  sleep,
  stableJson,
} from './report-runtime-closeout-reviewed-process.js';

const DEPLOYMENT_STABILITY_DELAYS_MS = Object.freeze([0, 10_000, 20_000]);
const QUEUE_ACTIVATION_STABILITY_DELAYS_MS = Object.freeze([0, 60_000, 60_000]);
const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_MAIN_QUEUE = 'social-mkt-sync-jobs';
const EXPECTED_DLQ = 'social-mkt-sync-dlq';
const EXPECTED_MAIN_CONSUMER_SETTINGS = Object.freeze({
  batchSize: 10,
  maxConcurrency: 1,
  maxRetries: 5,
  maxWaitTimeMs: 30_000,
});

export async function resolveReviewedCloudflareSession({ env, sourceText, runText }) {
  const cleanEnv = { ...env };
  for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) {
    if (!String(cleanEnv[key] ?? '').trim()) delete cleanEnv[key];
  }
  const whoami = await runText('npx', ['wrangler', 'whoami', '--json'], { env: cleanEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: cleanEnv.CLOUDFLARE_ACCOUNT_ID,
    configText: sourceText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...cleanEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  await runText('npx', ['wrangler', 'whoami', '--account', accountId, '--json'], { env: selectedEnv });
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : await runText('npx', ['wrangler', 'auth', 'token', '--json'], { env: selectedEnv });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  return Object.freeze({ accountId, token: auth.token, source: auth.source });
}

export async function resolveReviewedQueue({ accountId, token, expectedName }) {
  const matches = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues?page=${page}&per_page=100`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result)) throw closeoutFailure(
      `Cloudflare Queue inventory read failed (HTTP ${response.status})`,
      'REPORT_RUNTIME_CLOSEOUT_QUEUE_READ_FAILED',
      { status: response.status },
    );
    for (const item of body.result) {
      const name = String(item.queue_name ?? item.name ?? '').trim();
      if (name === expectedName) matches.push({
        queueId: String(item.queue_id ?? item.id ?? '').trim(),
        queueName: name,
        embeddedConsumers: Array.isArray(item.consumers)
          ? item.consumers.map((consumer) => Object.freeze({ ...consumer }))
          : [],
      });
    }
    totalPages = Number(body.result_info?.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);
  if (matches.length !== 1 || !matches[0].queueId) throw closeoutFailure(
    `Expected exactly one Cloudflare Queue named ${expectedName}`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_TARGET_INVALID',
    { matchCount: matches.length },
  );

  const selected = matches[0];
  const consumers = await readReviewedQueueConsumers({
    accountId,
    token,
    queueId: selected.queueId,
  });
  const listedConsumerId = readSingleConsumerId(consumers, 'list');
  const detail = await readReviewedQueueConsumer({
    accountId,
    token,
    queueId: selected.queueId,
    consumerId: listedConsumerId,
  });
  const consumer = assertReviewedQueueConsumer({
    consumers,
    embeddedConsumers: selected.embeddedConsumers,
    detail,
    expectedQueueName: expectedName,
  });
  return Object.freeze({
    queueId: selected.queueId,
    queueName: selected.queueName,
    consumerIdFingerprint: sha256(consumer.consumerId),
    consumerScriptName: consumer.scriptName,
    consumerScriptNameAuthority: consumer.scriptNameAuthority,
    consumerSettingsFingerprint: sha256(stableJson(consumer.settings)),
  });
}

export async function readReviewedQueueConsumers({ accountId, token, queueId }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || !Array.isArray(body.result)) throw closeoutFailure(
    `Cloudflare Queue consumer inventory read failed (HTTP ${response.status})`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_READ_FAILED',
    { status: response.status },
  );
  return Object.freeze(body.result.map((item) => Object.freeze({ ...item })));
}

export async function readReviewedQueueConsumer({ accountId, token, queueId, consumerId }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers/${encodeURIComponent(consumerId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || !body.result || typeof body.result !== 'object'
    || Array.isArray(body.result)) throw closeoutFailure(
    `Cloudflare Queue consumer detail read failed (HTTP ${response.status})`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_READ_FAILED',
    { status: response.status },
  );
  return Object.freeze({ ...body.result });
}

export function assertReviewedQueueConsumer({
  consumers,
  embeddedConsumers = [],
  detail = null,
  expectedQueueName = EXPECTED_MAIN_QUEUE,
}) {
  const listed = Array.isArray(consumers) ? consumers : [];
  if (listed.length !== 1) throw closeoutFailure(
    'Report Queue requires exactly one reviewed Worker consumer',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    { consumerCount: listed.length, reviewedMatchCount: 0 },
  );
  const consumerId = readSingleConsumerId(listed, 'list');
  const embedded = Array.isArray(embeddedConsumers) ? embeddedConsumers : [];
  if (embedded.length > 1) throw closeoutFailure(
    'Report Queue inventory contains ambiguous embedded consumers',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    { consumerCount: listed.length, embeddedConsumerCount: embedded.length },
  );

  const sources = [detail, listed[0], embedded[0]].filter((value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  ));
  const observedIds = sources.map(readConsumerId).filter(Boolean);
  if (observedIds.some((value) => value !== consumerId)) throw closeoutFailure(
    'Report Queue consumer identity changed across Cloudflare inventory reads',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    { consumerCount: listed.length, consumerIdentityMatched: false },
  );

  const explicitTypes = sources.map((item) => optionalText(item.type)).filter(Boolean);
  const explicitQueueNames = sources.map((item) => optionalText(
    item.queue_name ?? item.queueName,
  )).filter(Boolean);
  const explicitScriptNames = sources.map((item) => optionalText(
    item.script_name ?? item.scriptName,
  )).filter(Boolean);
  const typeMatched = explicitTypes.every((value) => value.toLowerCase() === 'worker');
  const queueNameMatched = explicitQueueNames.every((value) => value === expectedQueueName);
  const scriptNameMatched = explicitScriptNames.every((value) => value === EXPECTED_WORKER_NAME);
  const scriptNameAuthority = explicitScriptNames.length > 0
    ? 'cloudflare_consumer_response'
    : 'reviewed_worker_contract';
  if (!typeMatched || !queueNameMatched || !scriptNameMatched) throw closeoutFailure(
    'Report Queue requires exactly one reviewed Worker consumer',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    {
      consumerCount: listed.length,
      reviewedMatchCount: 0,
      consumerIdentityMatched: true,
      explicitTypeCount: explicitTypes.length,
      typeMatched,
      explicitQueueNameCount: explicitQueueNames.length,
      queueNameMatched,
      explicitScriptNameCount: explicitScriptNames.length,
      scriptNamePresent: explicitScriptNames.length > 0,
      scriptNameMatched,
      scriptNameAuthority,
      detailHydrated: Boolean(detail),
    },
  );

  const normalized = Object.freeze({
    batchSize: firstNumber(sources, (item) => item.settings?.batch_size ?? item.settings?.batchSize),
    maxConcurrency: firstNumber(
      sources,
      (item) => item.settings?.max_concurrency ?? item.settings?.maxConcurrency,
    ),
    maxRetries: firstNumber(sources, (item) => item.settings?.max_retries ?? item.settings?.maxRetries),
    maxWaitTimeMs: firstNumber(
      sources,
      (item) => item.settings?.max_wait_time_ms ?? item.settings?.maxWaitTimeMs,
    ),
    deadLetterQueue: firstText(sources, (item) => item.dead_letter_queue ?? item.deadLetterQueue),
  });
  if (normalized.batchSize !== EXPECTED_MAIN_CONSUMER_SETTINGS.batchSize
    || normalized.maxConcurrency !== EXPECTED_MAIN_CONSUMER_SETTINGS.maxConcurrency
    || normalized.maxRetries !== EXPECTED_MAIN_CONSUMER_SETTINGS.maxRetries
    || normalized.maxWaitTimeMs !== EXPECTED_MAIN_CONSUMER_SETTINGS.maxWaitTimeMs
    || normalized.deadLetterQueue !== EXPECTED_DLQ) throw closeoutFailure(
    'Report Queue consumer settings differ from the reviewed Worker topology',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    {
      batchSize: normalized.batchSize,
      maxConcurrency: normalized.maxConcurrency,
      maxRetries: normalized.maxRetries,
      maxWaitTimeMs: normalized.maxWaitTimeMs,
      deadLetterQueueMatched: normalized.deadLetterQueue === EXPECTED_DLQ,
      detailHydrated: Boolean(detail),
    },
  );
  return Object.freeze({
    consumerId,
    scriptName: EXPECTED_WORKER_NAME,
    scriptNameAuthority,
    settings: normalized,
  });
}

export function createReviewedRemoteRuntime(input) {
  const {
    runCapture, runText, configPath, env, repositoryHead,
    target, requiredTables, config,
  } = input;
  const fullRequiredTables = freezeTableContract(requiredTables);
  const baselineRequiredTables = isTableContract(config?.workerRequiredTables)
    ? freezeTableContract(config.workerRequiredTables)
    : fullRequiredTables;
  const bootstrapOptionalTables = Object.freeze(Object.fromEntries(
    Object.entries(fullRequiredTables)
      .filter(([key]) => !Object.hasOwn(baselineRequiredTables, key)),
  ));
  const reportExecutionWindow = Array.isArray(target?.activeTrueFlags)
    && target.activeTrueFlags.includes('MKT_REPORT_D1_READ_ENABLED');

  async function buildBundle(configText, label) {
    const outdir = await mkdtemp(join(tmpdir(), `report-closeout-${label}-`));
    try {
      const result = await withGeneratedConfig(configText, async (generatedPath) => runCapture('npx', [
        'wrangler', 'deploy', '--dry-run', '--outdir', outdir, '--config', generatedPath,
      ], { env }));
      const files = await collectFiles(outdir);
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(relative(outdir, file));
        hash.update(await readFile(file));
      }
      hash.update(result.stdout);
      return Object.freeze({ sha256: hash.digest('hex'), fileCount: files.length });
    } finally {
      await rm(outdir, { recursive: true, force: true });
    }
  }

  async function deployConfig(configText, label, contractVersion) {
    const result = await withGeneratedConfig(configText, async (generatedPath) => runCapture('npx', [
      'wrangler', 'deploy', '--config', generatedPath,
      '--message', `${contractVersion} ${label} git=${repositoryHead}`,
    ], { env }));
    return Object.freeze({ versionId: extractVersionId(result.stdout), stdoutSha256: sha256(result.stdout), label });
  }

  async function verifyDeployment(mode, expectedVersionId = null) {
    if (expectedVersionId === null) return verifyDeploymentOnce(mode, null);

    const delays = reportExecutionWindow
      ? QUEUE_ACTIVATION_STABILITY_DELAYS_MS
      : DEPLOYMENT_STABILITY_DELAYS_MS;
    const samples = [];
    for (const delayMs of delays) {
      if (delayMs > 0) await sleep(delayMs);
      samples.push(await verifyDeploymentOnce(mode, expectedVersionId));
    }
    const first = samples[0];
    const fingerprint = stableJson({
      activeVersion: first.activeVersion,
      trueFlags: first.trueFlags,
      mode: first.mode,
      bindingContract: first.bindingContract,
      requiredTableBindingCount: first.requiredTableBindingCount,
      optionalTableBindingCount: first.optionalTableBindingCount,
    });
    if (samples.some((sample) => stableJson({
      activeVersion: sample.activeVersion,
      trueFlags: sample.trueFlags,
      mode: sample.mode,
      bindingContract: sample.bindingContract,
      requiredTableBindingCount: sample.requiredTableBindingCount,
      optionalTableBindingCount: sample.optionalTableBindingCount,
    }) !== fingerprint)) throw closeoutFailure(
      'Remote Worker deployment changed during the reviewed stability barrier',
      'REPORT_RUNTIME_CLOSEOUT_DEPLOYMENT_NOT_STABLE',
      { expectedVersionId, sampleCount: samples.length },
    );
    return Object.freeze({
      ...samples.at(-1),
      stabilitySampleCount: samples.length,
      stabilityWindowMs: delays.reduce((total, value) => total + value, 0),
      queueActivationBarrier: reportExecutionWindow,
    });
  }

  async function verifyDeploymentOnce(mode, expectedVersionId) {
    const status = JSON.parse(await runText('npx', [
      'wrangler', 'deployments', 'status', '--name', EXPECTED_WORKER_NAME, '--config', configPath, '--json',
    ], { env }));
    const activeVersion = resolveActiveVersion(status, expectedVersionId);
    const versionView = JSON.parse(await runText('npx', [
      'wrangler', 'versions', 'view', activeVersion, '--name', EXPECTED_WORKER_NAME, '--config', configPath, '--json',
    ], { env }));
    const bindings = collectBindings(versionView);
    const trueFlags = extractReviewedRemoteTrueExecutionFlags(bindings);
    const expectedTrue = mode === 'active' ? [...target.activeTrueFlags].sort() : [];
    if (stableJson(trueFlags) !== stableJson(expectedTrue)) throw closeoutFailure(
      'Remote Worker execution flags differ from the reviewed Report closeout window',
      'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_MISMATCH',
      { mode, expectedTrue, observedTrue: trueFlags },
    );
    const d1 = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
    ), 'MKT_STATE_DB');
    const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
    if (databaseId !== config.databaseId) throw closeoutFailure(
      'Remote Worker D1 UUID differs from the reviewed Report closeout target',
      'REPORT_RUNTIME_CLOSEOUT_REMOTE_D1_MISMATCH',
    );
    const queueBinding = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === 'MKT_SYNC_QUEUE' && normalizeBindingType(binding?.type) === 'queue'
    ), 'MKT_SYNC_QUEUE');
    if (String(queueBinding.queue_name ?? queueBinding.queueName ?? queueBinding.queue ?? '') !== config.mainQueueName) {
      throw closeoutFailure(
        'Remote Worker Queue differs from the reviewed target',
        'REPORT_RUNTIME_CLOSEOUT_REMOTE_QUEUE_MISMATCH',
      );
    }

    const bootstrapVerification = expectedVersionId === null;
    const requiredNow = bootstrapVerification ? baselineRequiredTables : fullRequiredTables;
    const optionalNow = bootstrapVerification ? bootstrapOptionalTables : Object.freeze({});
    verifyRequiredTableBindings(bindings, requiredNow, config.tableIds);
    verifyOptionalTableBindings(bindings, optionalNow, config.tableIds);

    return Object.freeze({
      activeVersion,
      trueFlags: Object.freeze(trueFlags),
      mode,
      bindingContract: bootstrapVerification ? 'bootstrap_baseline' : 'deployed_exact',
      requiredTableBindingCount: Object.keys(requiredNow).length,
      optionalTableBindingCount: Object.keys(optionalNow).length,
    });
  }

  async function withGeneratedConfig(configText, operation) {
    const directory = await mkdtemp(join(tmpdir(), 'report-closeout-config-'));
    try {
      const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
        sourceDirectory: dirname(configPath), outputDirectory: directory,
      });
      const generatedPath = join(directory, 'wrangler.generated.json');
      await writeFile(generatedPath, rebased.text, { mode: 0o600 });
      await chmod(generatedPath, 0o600);
      return await operation(generatedPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return Object.freeze({ buildBundle, deployConfig, verifyDeployment });
}

export async function sendReviewedQueueMessage({ auth, queueId, job }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(auth.accountId)}/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw closeoutFailure(
    `Cloudflare Queue accepted no Report closeout message (HTTP ${response.status})`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_SEND_FAILED',
    { status: response.status },
  );
}

export function extractReviewedRemoteExecutionFlagMap(bindings = []) {
  if (!Array.isArray(bindings)) throw closeoutFailure(
    'Remote Worker bindings must be an array',
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_BINDINGS_INVALID',
  );
  const map = {};
  for (const binding of bindings) {
    const name = readBindingName(binding);
    if (!name || !/^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)) continue;
    const type = normalizeBindingType(binding?.type);
    let value = null;
    if (type === 'plain_text') {
      value = readRemoteBoolean(binding?.text ?? binding?.value);
      if (value === null) throw closeoutFailure(
        `Remote Worker execution flag ${name} has an invalid text Boolean value`,
        'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_VALUE_INVALID',
        { flagName: name, bindingType: type },
      );
    } else if (type === 'json') {
      const raw = binding?.json ?? binding?.value;
      if (raw !== true && raw !== false) throw closeoutFailure(
        `Remote Worker execution flag ${name} JSON binding is not Boolean`,
        'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_VALUE_INVALID',
        { flagName: name, bindingType: type, valueType: typeof raw },
      );
      value = raw;
    } else {
      throw closeoutFailure(
        `Remote Worker execution flag ${name} uses an unsupported binding type`,
        'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_BINDING_TYPE_INVALID',
        { flagName: name, bindingType: type || null },
      );
    }
    if (Object.hasOwn(map, name) && map[name] !== value) throw closeoutFailure(
      `Remote Worker execution flag ${name} is duplicated with conflicting values`,
      'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_DUPLICATE',
      { flagName: name },
    );
    map[name] = value;
  }
  return Object.freeze(Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right))));
}

export function extractReviewedRemoteTrueExecutionFlags(bindings = []) {
  const map = extractReviewedRemoteExecutionFlagMap(bindings);
  return Object.freeze(Object.keys(map).filter((name) => map[name] === true).sort());
}

function verifyRequiredTableBindings(bindings, contract, tableIds) {
  for (const [key, envName] of Object.entries(contract)) {
    const mapping = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), envName);
    assertTableMapping(mapping, envName, tableIds[key]);
  }
}

function verifyOptionalTableBindings(bindings, contract, tableIds) {
  for (const [key, envName] of Object.entries(contract)) {
    const mapping = zeroOrOne(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), envName);
    if (mapping) assertTableMapping(mapping, envName, tableIds[key]);
  }
}

function assertTableMapping(mapping, envName, expectedTableId) {
  if (String(mapping.text ?? mapping.value ?? '').trim() !== expectedTableId) throw closeoutFailure(
    `Remote Worker Lark mapping differs for ${envName}`,
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_TABLE_MAPPING_MISMATCH',
    { envName },
  );
}

function freezeTableContract(value) {
  return Object.freeze(Object.fromEntries(
    Object.entries(isTableContract(value) ? value : {})
      .map(([key, envName]) => [key, String(envName).trim()])
      .filter(([, envName]) => envName),
  ));
}

function isTableContract(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function collectFiles(root) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(root);
  return files.sort();
}

function resolveActiveVersion(value, expectedVersionId) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (expectedVersionId && !unique.includes(expectedVersionId)) throw closeoutFailure(
    'Expected Report closeout deployment is not active at 100% traffic',
    'REPORT_RUNTIME_CLOSEOUT_DEPLOYMENT_NOT_ACTIVE',
    { expectedVersionId, activeVersions: unique },
  );
  if (unique.length !== 1) throw closeoutFailure(
    'Report closeout requires exactly one Worker version at 100% traffic',
    'REPORT_RUNTIME_CLOSEOUT_TRAFFIC_INVALID',
    { activeVersions: unique },
  );
  return unique[0];
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const percentage = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (percentage === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push(versionId);
    Object.values(nested).forEach(visit);
  }
}

function collectBindings(value) {
  const arrays = [];
  visit(value);
  return arrays.find((items) => items.some((item) => readBindingName(item))) ?? [];
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) arrays.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}

function extractVersionId(stdout) {
  const labeled = String(stdout).match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1];
  if (labeled) return labeled;
  const matches = [...String(stdout).matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu)]
    .map((match) => match[0]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) throw closeoutFailure(
    'Unable to resolve the exact deployed Worker Version ID',
    'REPORT_RUNTIME_CLOSEOUT_DEPLOY_VERSION_UNRESOLVED',
    { matchCount: unique.length },
  );
  return unique[0];
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw closeoutFailure(
    `Remote Worker requires exactly one ${label} binding`,
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}

function zeroOrOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length > 1) throw closeoutFailure(
    `Remote Worker permits at most one ${label} binding before Report activation`,
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0] ?? null;
}

function readSingleConsumerId(consumers, source) {
  if (!Array.isArray(consumers) || consumers.length !== 1) throw closeoutFailure(
    'Report Queue requires exactly one reviewed Worker consumer',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    { source, consumerCount: Array.isArray(consumers) ? consumers.length : 0 },
  );
  const consumerId = readConsumerId(consumers[0]);
  if (!consumerId) throw closeoutFailure(
    'Report Queue consumer identity is missing',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
    { source, consumerCount: consumers.length },
  );
  return consumerId;
}

function readConsumerId(value) {
  return optionalText(value?.consumer_id ?? value?.consumerId);
}
function firstText(sources, select) {
  for (const source of sources) {
    const value = optionalText(select(source));
    if (value) return value;
  }
  return null;
}
function firstNumber(sources, select) {
  for (const source of sources) {
    const value = select(source);
    if (value !== undefined && value !== null && value !== '') return Number(value);
  }
  return Number.NaN;
}
function optionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}
function readBindingName(binding) { return String(binding?.name ?? binding?.binding ?? '').trim() || null; }
function normalizeBindingType(value) { return String(value ?? '').trim().toLowerCase().replaceAll('-', '_'); }
function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
