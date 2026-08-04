import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { rebaseGeneratedWranglerConfigPaths } from './rebase-generated-wrangler-config-paths.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './woocommerce-final-one-command.js';
import { closeoutFailure, sha256, stableJson } from './report-runtime-closeout-reviewed-process.js';

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
  return Object.freeze(matches[0]);
}

export function createReviewedRemoteRuntime(input) {
  const {
    runCapture, runText, configPath, repositoryRoot, env, repositoryHead,
    target, requiredTables, config,
  } = input;

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
    const status = JSON.parse(await runText('npx', [
      'wrangler', 'deployments', 'status', '--name', 'social-mkt-sync-worker', '--config', configPath, '--json',
    ], { env }));
    const activeVersion = resolveActiveVersion(status, expectedVersionId);
    const versionView = JSON.parse(await runText('npx', [
      'wrangler', 'versions', 'view', activeVersion, '--name', 'social-mkt-sync-worker', '--config', configPath, '--json',
    ], { env }));
    const bindings = collectBindings(versionView);
    const trueFlags = bindings
      .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
      .map((binding) => [readBindingName(binding), readRemoteBoolean(binding?.text ?? binding?.value)])
      .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled)
      .map(([name]) => name)
      .sort();
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
    for (const [key, envName] of Object.entries(requiredTables)) {
      const mapping = exactlyOne(bindings, (binding) => (
        readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
      ), envName);
      if (String(mapping.text ?? mapping.value ?? '').trim() !== config.tableIds[key]) throw closeoutFailure(
        `Remote Worker Lark mapping differs for ${envName}`,
        'REPORT_RUNTIME_CLOSEOUT_REMOTE_TABLE_MAPPING_MISMATCH',
        { envName },
      );
    }
    return Object.freeze({ activeVersion, trueFlags: Object.freeze(trueFlags), mode });
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
function readBindingName(binding) { return String(binding?.name ?? binding?.binding ?? '').trim() || null; }
function normalizeBindingType(value) { return String(value ?? '').trim().toLowerCase().replaceAll('-', '_'); }
function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
