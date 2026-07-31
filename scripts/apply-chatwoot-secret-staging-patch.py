from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


launcher = Path("scripts/chatwoot-final-30d-daily-uat-launcher.mjs")
source = launcher.read_text()

source = replace_once(
    source,
    "import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';\nimport {\n",
    "import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';\n"
    "import {\n"
    "  assertChatwootFinalWorkerSecrets,\n"
    "  parseChatwootWorkerSecretNames,\n"
    "  resolveChatwootFinalSecretBootstrap,\n"
    "  serializeChatwootFinalSecretsFile,\n"
    "  summarizeChatwootFinalSecretPlan,\n"
    "} from './lib/chatwoot-final-secret-bootstrap.js';\n"
    "import {\n",
    "launcher imports",
)

source = replace_once(
    source,
    "const QUEUE_DISCOVERY_SOURCE = 'cloudflare_queue_rest';\n",
    "const QUEUE_DISCOVERY_SOURCE = 'cloudflare_queue_rest';\n"
    "const SECRET_BOOTSTRAP_MESSAGE = 'chatwoot-final-secret-bootstrap-safe';\n",
    "launcher constant",
)

source = replace_once(
    source,
    "      autoResolveChatwootLarkMappings: true,\n      remoteActionsPerformed: false,\n",
    "      autoResolveChatwootLarkMappings: true,\n"
    "      autoStageMissingChatwootSecret: true,\n"
    "      remoteActionsPerformed: false,\n",
    "plan summary",
)

source = replace_once(
    source,
    "  if (before !== 0) {\n"
    "    throw launcherError(\n"
    "      'Exact Chatwoot Shared Reliability lock scope is active before UAT',\n"
    "      'CHATWOOT_FINAL_UAT_ACTIVE_LOCK_BLOCKED',\n"
    "      { activeLockCount: before },\n"
    "    );\n"
    "  }\n\n"
    "  runCore([EXECUTE_ARGUMENT], { env, stdio: 'inherit' });\n",
    "  if (before !== 0) {\n"
    "    throw launcherError(\n"
    "      'Exact Chatwoot Shared Reliability lock scope is active before UAT',\n"
    "      'CHATWOOT_FINAL_UAT_ACTIVE_LOCK_BLOCKED',\n"
    "      { activeLockCount: before },\n"
    "    );\n"
    "  }\n\n"
    "  const secretBootstrap = await ensureChatwootWorkerSecret({\n"
    "    env,\n"
    "    sourceEnv,\n"
    "    configPath: normalizedConfigPath,\n"
    "  });\n\n"
    "  runCore([EXECUTE_ARGUMENT], { env, stdio: 'inherit' });\n",
    "launcher execution sequence",
)

source = replace_once(
    source,
    "    larkStaleMappingRepairs: larkMappings.staleMappingRepairCount,\n"
    "    activeLockCount: 0,\n",
    "    larkStaleMappingRepairs: larkMappings.staleMappingRepairCount,\n"
    "    chatwootWorkerSecretVerified: true,\n"
    "    chatwootSecretBootstrap: secretBootstrap,\n"
    "    activeLockCount: 0,\n",
    "final summary",
)

insertion = r'''
async function ensureChatwootWorkerSecret({ env, sourceEnv, configPath }) {
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  const workerName = requiredText(config.name, 'Worker name is missing from normalized config');
  const localTrueFlags = Object.entries(config.vars ?? {})
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true'))
    .map(([name]) => name)
    .sort();
  if (localTrueFlags.length) {
    throw launcherError(
      'Secret bootstrap config must keep every execution flag false',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_CONFIG_UNSAFE',
      { trueFlags: localTrueFlags },
    );
  }

  const safeVersionBefore = assertRemoteWorkerAllFlagsFalse(env, configPath, workerName);
  const remoteSecretNames = readWorkerSecretNames(env, configPath, workerName);
  const plan = resolveChatwootFinalSecretBootstrap({
    remoteSecretNames,
    readLocalAccessToken: () => sourceEnv.CHATWOOT_API_ACCESS_TOKEN,
  });
  const summary = summarizeChatwootFinalSecretPlan(plan);
  if (!plan.provision) {
    assertChatwootFinalWorkerSecrets(remoteSecretNames);
    return Object.freeze({
      ...summary,
      safeVersion: safeVersionBefore,
      remoteMutationCount: 0,
    });
  }

  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const evidenceDirectory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', head));
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const attemptPath = join(evidenceDirectory, 'secret-bootstrap.attempt.json');
  if (await isRegularFile(attemptPath)) {
    throw launcherError(
      'A prior Secret bootstrap attempt exists while the remote Secret is still absent',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_UNCERTAIN',
      { secretName: plan.secretName },
    );
  }
  await writePrivateLauncherJson(attemptPath, {
    contract: SECRET_BOOTSTRAP_MESSAGE,
    repositoryHead: head,
    secretName: plan.secretName,
    safeVersionBefore,
    attemptedAt: new Date().toISOString(),
    executionFlags: 'all_false',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  });

  const secretDirectory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', '.launcher'));
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  const secretFilePath = join(secretDirectory, `chatwoot-secrets-${Date.now()}-${process.pid}.json`);
  await writeFile(secretFilePath, serializeChatwootFinalSecretsFile(plan), { mode: 0o600 });
  await chmod(secretFilePath, 0o600);

  let deployOutput;
  try {
    deployOutput = run('npx', [
      'wrangler', 'deploy',
      '--config', configPath,
      '--secrets-file', secretFilePath,
      '--message', `${SECRET_BOOTSTRAP_MESSAGE} git=${head}`,
    ], {
      env,
      unsetEnv: ['CHATWOOT_API_ACCESS_TOKEN'],
    });
  } finally {
    await rm(secretFilePath, { force: true });
  }

  const remoteAfter = readWorkerSecretNames(env, configPath, workerName);
  assertChatwootFinalWorkerSecrets(remoteAfter);
  const safeVersion = assertRemoteWorkerAllFlagsFalse(env, configPath, workerName);
  const completed = {
    ...summary,
    safeVersion,
    remoteMutationCount: 1,
    deployOutputFingerprint: sha256(deployOutput),
  };
  await writePrivateLauncherJson(
    join(evidenceDirectory, 'secret-bootstrap.json'),
    completed,
  );
  return Object.freeze(completed);
}

function readWorkerSecretNames(env, configPath, workerName) {
  const output = run('npx', [
    'wrangler', 'secret', 'list',
    '--name', workerName,
    '--config', configPath,
    '--format', 'json',
  ], { env });
  return parseChatwootWorkerSecretNames(output);
}

function assertRemoteWorkerAllFlagsFalse(env, configPath, workerName) {
  const status = JSON.parse(run('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { env }));
  const statusItem = Array.isArray(status) ? status[0] : status;
  const active = (statusItem?.versions ?? [])
    .filter((version) => Number(version.percentage) === 100);
  if (active.length !== 1) {
    throw launcherError(
      'Secret bootstrap requires one 100% active Worker version',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_ACTIVE_VERSION_INVALID',
    );
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw launcherError(
      'Secret bootstrap active Worker version ID is invalid',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_ACTIVE_VERSION_INVALID',
    );
  }
  const view = JSON.parse(run('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { env }));
  const viewItem = Array.isArray(view) ? view[0] : view;
  const bindings = viewItem?.bindings ?? viewItem?.resources?.bindings ?? [];
  const trueFlags = bindings.filter((binding) => {
    const name = String(binding.name ?? binding.binding ?? '');
    const value = binding.text ?? binding.value;
    return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true');
  }).map((binding) => String(binding.name ?? binding.binding)).sort();
  if (trueFlags.length) {
    throw launcherError(
      'Secret bootstrap requires an all-flags-false Worker',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_REMOTE_UNSAFE',
      { trueFlags },
    );
  }
  return versionId;
}

async function writePrivateLauncherJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function requiredText(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(message, 'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_CONFIG_INVALID');
  }
  return value.trim();
}

'''
source = replace_once(
    source,
    "function runCore(args, options = {}) {\n",
    insertion + "function runCore(args, options = {}) {\n",
    "launcher helper insertion",
)

source = replace_once(
    source,
    "function run(command, args, options = {}) {\n  try {\n    return execFileSync(command, args, {\n      cwd: ROOT,\n      env: { ...process.env, ...(options.env ?? {}) },\n",
    "function run(command, args, options = {}) {\n"
    "  const commandEnv = { ...process.env, ...(options.env ?? {}) };\n"
    "  for (const name of options.unsetEnv ?? []) delete commandEnv[name];\n"
    "  try {\n"
    "    return execFileSync(command, args, {\n"
    "      cwd: ROOT,\n"
    "      env: commandEnv,\n",
    "launcher command environment",
)

launcher.write_text(source)
