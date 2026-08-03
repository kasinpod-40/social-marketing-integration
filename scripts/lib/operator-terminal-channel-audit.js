import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import {
  OPERATOR_TERMINAL_ACKNOWLEDGED_DEBT,
  OPERATOR_TERMINAL_AUDIT_CONTRACT,
  OPERATOR_TERMINAL_COMPANION_CONTROLS,
  OPERATOR_TERMINAL_REQUIRED_CHANNELS,
  OPERATOR_TERMINAL_STATUSES,
  OPERATOR_TERMINAL_STRICT_PASS_PATHS,
} from './operator-terminal-channel-policy.js';

const ENTRYPOINT_NAME_PATTERN = /(?:terminal|operator|preflight|closeout|acceptance)[^/]*\.mjs$/u;
const PACKAGE_SCRIPT_PATTERN = /\bnode\s+(scripts\/[A-Za-z0-9_./-]+\.mjs)\b/gu;
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);
const TEST_PROCESS_PATTERN = /\b(?:spawnSync|spawn|execFile|execFileSync)\s*\(/u;
const TEST_ENTRYPOINT_REFERENCE_PATTERN = /(?:^|[/\\])([A-Za-z0-9_.-]+\.mjs)\b/gu;
const UNSAFE_SHELL_PATTERN = /\bshell\s*:\s*true\b/u;
const CHILD_PROCESS_IMPORT_PATTERN = /import\s*\{([\s\S]*?)\}\s*from\s*['"]node:child_process['"]/gu;

export async function auditOperatorTerminalChannels(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
  const packageEntrypoints = discoverPackageEntrypoints(packageJson);
  const topLevelScripts = await collectTopLevelEntrypoints(resolve(projectRoot, 'scripts'));
  const candidatePaths = [...new Set([...packageEntrypoints, ...topLevelScripts])].sort();
  const testIndex = await buildSpawnedTestIndex(projectRoot);
  const changedPaths = input.changedPaths ?? collectChangedPaths(projectRoot);
  const entries = [];

  for (const path of candidatePaths) {
    const absolutePath = resolve(projectRoot, path);
    const source = await readFile(absolutePath, 'utf8');
    const companion = OPERATOR_TERMINAL_COMPANION_CONTROLS[path] ?? null;
    const features = inspectOperatorTerminalSource({
      path,
      source,
      spawnedTests: testIndex.get(basename(path)) ?? [],
      companion,
      projectRoot,
    });
    const status = classifyOperatorTerminal(features);
    entries.push(Object.freeze({
      path,
      channel: classifyChannel(path),
      packageExposed: packageEntrypoints.includes(path),
      changedInBranch: changedPaths.includes(path),
      status,
      features,
    }));
  }

  const violations = validateAuditPolicy(entries, { projectRoot, changedPaths });
  const statusCounts = Object.freeze(Object.fromEntries(
    OPERATOR_TERMINAL_STATUSES.map((status) => [
      status,
      entries.filter((entry) => entry.status === status).length,
    ]),
  ));
  const channelCounts = Object.freeze(Object.fromEntries(
    [...new Set(entries.map((entry) => entry.channel))].sort().map((channel) => [
      channel,
      entries.filter((entry) => entry.channel === channel).length,
    ]),
  ));

  return Object.freeze({
    ok: violations.length === 0,
    contractVersion: OPERATOR_TERMINAL_AUDIT_CONTRACT,
    candidateCount: entries.length,
    packageEntrypointCount: packageEntrypoints.length,
    changedEntrypointCount: entries.filter((entry) => entry.changedInBranch).length,
    statusCounts,
    channelCounts,
    requiredChannels: OPERATOR_TERMINAL_REQUIRED_CHANNELS,
    entries: Object.freeze(entries),
    violations: Object.freeze(violations),
    remoteReadCount: 0,
    remoteWriteCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

export function inspectOperatorTerminalSource(input = {}) {
  const source = String(input.source ?? '');
  const path = String(input.path ?? '');
  const spawnedTests = Array.isArray(input.spawnedTests) ? input.spawnedTests : [];
  const companion = input.companion ?? null;
  const childProcessImports = readChildProcessImports(source);
  const unsafeChildProcessImports = childProcessImports.filter((name) => (
    name === 'exec' || name === 'execSync'
  ));
  const companionAllBlocker = Boolean(companion?.allBlockerPreflightPath);
  const companionSpawnedTest = Boolean(companion?.spawnedTestPath);
  const companionCompletion = companion?.completionAuthority === 'exit_code_contract';
  const companionReplay = Boolean(companion?.sameInputReplayAuthority);
  const companionSafeRestore = Boolean(companion?.safeRestoreAuthority);
  const companionPrivateEvidence = Boolean(companion?.privateEvidencePath);
  const hasReplay = companionReplay || (/\b(?:same[-_ ]?input[-_ ]?replay|replay)\b/iu.test(source)
    && /\b(?:no[_ -]?op|zero[_ -]?drift|writes?\.total|idempotent)\b/iu.test(source));
  const hasSafeRestore = companionSafeRestore || (/\bfinally\b/u.test(source)
    && /\b(?:restore|safe[-_ ]?(?:close|baseline|state)|all[-_ ]?false|previewUrlsDisabled)\b/iu.test(source));
  const hasRetainedCompletion = /\b(?:summary\.json|evidencePath|writePrivateJson|retained)\b/u.test(source)
    && /\b(?:verification|completed|complete|zero_drift|safe)\b/iu.test(source);
  const hasExitCodeContract = companionCompletion
    || /\bOPERATOR_TERMINAL_EXIT_CODES\b/u.test(source)
    || /\bexitCodeContract\b/u.test(source)
    || (/process\.exitCode\s*=\s*1\b/u.test(source)
      && /process\.exitCode\s*=\s*2\b/u.test(source));
  const hasAllBlockerPreflight = companionAllBlocker
    || (/\bblockers\b/u.test(source)
      && /\b(?:blockerCount|LOCAL_PREFLIGHT_BLOCKED|collectAcceptanceGate|allBlockersReportedInSingleRun)\b/u.test(source));
  const hasSpawnedTest = companionSpawnedTest || spawnedTests.length > 0;
  const hasExactRepositoryGate = /\b(?:origin\/main|reviewedHead|reviewed[_-]?head|exactHead|exact[_-]?head)\b/iu.test(source)
    && /\b(?:rev-parse|merge-base|branch|repository)\b/iu.test(source);
  const hasPlanOnly = /\b(?:planOnly|printPlan|executed\s*:\s*false|PLAN_ONLY)\b/u.test(source)
    && /--execute/u.test(source);
  const hasPrivateEvidence = companionPrivateEvidence || (/0o600/u.test(source)
    && /\b(?:chmod|writeFile|open|copyFile)\b/u.test(source));
  const hasLocalLock = /\b(?:lockPath|acquire[A-Za-z]*Lock|\.lock)\b/u.test(source);
  const usesShellFreeChildProcess = childProcessImports.length === 0
    || unsafeChildProcessImports.length === 0;
  const hasUnsafeShell = UNSAFE_SHELL_PATTERN.test(source)
    || unsafeChildProcessImports.length > 0;
  const likelyRemoteMutation = inferRemoteMutation(path, source);
  const completionProof = hasExitCodeContract
    || hasReplay
    || (hasRetainedCompletion && (hasSafeRestore || !likelyRemoteMutation));

  return Object.freeze({
    hasPlanOnly,
    hasSpawnedTest,
    spawnedTests: Object.freeze([...spawnedTests].sort()),
    hasAllBlockerPreflight,
    hasExactRepositoryGate,
    hasPrivateEvidence,
    hasExitCodeContract,
    hasSafeRestore,
    hasReplay,
    hasLocalLock,
    hasRetainedCompletion,
    completionProof,
    likelyRemoteMutation,
    usesShellFreeChildProcess,
    unsafeChildProcessImports: Object.freeze(unsafeChildProcessImports),
    hasUnsafeShell,
  });
}

export function classifyOperatorTerminal(features = {}) {
  if (features.hasUnsafeShell || features.usesShellFreeChildProcess === false) {
    return 'UNSAFE_SHELL_COMMAND';
  }
  if (!features.hasSpawnedTest) return 'NEEDS_SPAWNED_TEST';
  if (!features.hasAllBlockerPreflight) return 'NEEDS_ALL_BLOCKER_PREFLIGHT';
  if (!features.completionProof) return 'NEEDS_EXIT_CODE_CONTRACT';
  if (features.likelyRemoteMutation
    && !features.hasSafeRestore
    && !features.hasReplay) return 'NEEDS_SAFE_RESTORE_EVIDENCE';
  return 'PASS_EXISTING_PATTERN';
}

function discoverPackageEntrypoints(packageJson) {
  const paths = [];
  for (const command of Object.values(packageJson?.scripts ?? {})) {
    PACKAGE_SCRIPT_PATTERN.lastIndex = 0;
    for (const match of String(command).matchAll(PACKAGE_SCRIPT_PATTERN)) paths.push(match[1]);
  }
  return [...new Set(paths)].sort();
}

async function collectTopLevelEntrypoints(scriptsRoot) {
  const entries = await readdir(scriptsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && ENTRYPOINT_NAME_PATTERN.test(entry.name))
    .map((entry) => `scripts/${entry.name}`)
    .sort();
}

async function buildSpawnedTestIndex(projectRoot) {
  const testsRoot = resolve(projectRoot, 'tests');
  const files = await collectSourceFiles(testsRoot);
  const index = new Map();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!TEST_PROCESS_PATTERN.test(source)) continue;
    TEST_ENTRYPOINT_REFERENCE_PATTERN.lastIndex = 0;
    const referenced = [...source.matchAll(TEST_ENTRYPOINT_REFERENCE_PATTERN)]
      .map((match) => match[1]);
    for (const name of referenced) {
      const list = index.get(name) ?? [];
      list.push(toRepositoryPath(projectRoot, file));
      index.set(name, list);
    }
  }
  return index;
}

async function collectSourceFiles(directory) {
  const info = await safeStat(directory);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [absolute] : [];
  }));
  return nested.flat();
}

function validateAuditPolicy(entries) {
  const violations = [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  for (const [channel, path] of Object.entries(OPERATOR_TERMINAL_REQUIRED_CHANNELS)) {
    if (!byPath.has(path)) violations.push(Object.freeze({
      code: 'OPERATOR_TERMINAL_REQUIRED_CHANNEL_MISSING',
      channel,
      path,
    }));
  }

  for (const entry of entries) {
    if (entry.status === 'UNSAFE_SHELL_COMMAND') violations.push(Object.freeze({
      code: 'OPERATOR_TERMINAL_UNSAFE_SHELL_FORBIDDEN',
      path: entry.path,
      details: entry.features.unsafeChildProcessImports,
    }));
  }

  for (const path of OPERATOR_TERMINAL_STRICT_PASS_PATHS) {
    const entry = byPath.get(path);
    if (!entry || entry.status !== 'PASS_EXISTING_PATTERN') violations.push(Object.freeze({
      code: 'OPERATOR_TERMINAL_STRICT_PASS_REGRESSION',
      path,
      observedStatus: entry?.status ?? 'MISSING',
    }));
  }

  for (const entry of entries.filter((item) => item.changedInBranch)) {
    if (entry.status === 'PASS_EXISTING_PATTERN') continue;
    const debt = OPERATOR_TERMINAL_ACKNOWLEDGED_DEBT[entry.path];
    if (!debt || !debt.allowedStatuses.includes(entry.status)) violations.push(Object.freeze({
      code: 'OPERATOR_TERMINAL_CHANGED_ENTRYPOINT_NOT_ACCEPTED',
      path: entry.path,
      observedStatus: entry.status,
    }));
  }

  for (const [path, debt] of Object.entries(OPERATOR_TERMINAL_ACKNOWLEDGED_DEBT)) {
    const entry = byPath.get(path);
    if (!entry) {
      violations.push(Object.freeze({
        code: 'OPERATOR_TERMINAL_DEBT_PATH_MISSING',
        path,
      }));
    } else if (entry.status === 'PASS_EXISTING_PATTERN') {
      violations.push(Object.freeze({
        code: 'OPERATOR_TERMINAL_STALE_DEBT_ENTRY',
        path,
      }));
    } else if (!debt.allowedStatuses.includes(entry.status)) {
      violations.push(Object.freeze({
        code: 'OPERATOR_TERMINAL_DEBT_STATUS_DRIFT',
        path,
        allowedStatuses: debt.allowedStatuses,
        observedStatus: entry.status,
      }));
    }
  }

  return violations;
}

function collectChangedPaths(projectRoot) {
  const mergeBase = gitText(projectRoot, ['merge-base', 'HEAD', 'origin/main'], false);
  if (mergeBase) {
    const output = gitText(projectRoot, ['diff', '--name-only', `${mergeBase}..HEAD`], false);
    return output.split(/\r?\n/u).filter(Boolean).sort();
  }
  const shallowMerge = gitText(projectRoot, [
    'diff-tree', '--no-commit-id', '--name-only', '-r', '-m', 'HEAD',
  ], false);
  return [...new Set(shallowMerge.split(/\r?\n/u).filter(Boolean))].sort();
}

function gitText(cwd, args, required = true) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    if (!required) return '';
    const error = new Error(`Unable to inspect Git state: git ${args.join(' ')}`);
    error.code = 'OPERATOR_TERMINAL_AUDIT_GIT_FAILED';
    throw error;
  }
  return String(result.stdout ?? '').trim();
}

function readChildProcessImports(source) {
  const names = [];
  CHILD_PROCESS_IMPORT_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(CHILD_PROCESS_IMPORT_PATTERN)) {
    for (const item of match[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/u)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)].sort();
}

function inferRemoteMutation(path, source) {
  if (/(?:acceptance|read-only|readiness|preflight|validate)/iu.test(path)
    && !/\b(?:spawnSync|execFile|runText)\s*\([^)]*['"](?:wrangler|npx)['"]/iu.test(source)
    && !/\b(?:batch_create|batch_update|queue send|remote write)\b/iu.test(source)) return false;
  return /\b(?:deploy|version-upload|versions upload|batch_create|batch_update|send-one|migrate|backup)\b/iu.test(source)
    || (/\b(?:queueActionCount|remoteMutationCount|workerDeploymentCount)\b/u.test(source)
      && !/\b(?:LOCAL_ACCEPTANCE_ONLY|local acceptance only)\b/iu.test(source));
}

function classifyChannel(path) {
  const name = basename(path).toLowerCase();
  if (name.startsWith('meta-')) return 'meta';
  if (name.startsWith('woocommerce-')) return 'woocommerce';
  if (name.startsWith('chatwoot-')) return 'chatwoot';
  if (name.startsWith('tiktok-')) return 'tiktok';
  if (name.startsWith('google-ads-')) return 'google_ads';
  if (name.startsWith('youtube-')) return 'youtube';
  if (name.startsWith('lark-')) return 'lark_native_ai';
  if (name.includes('report')) return 'shared_report';
  return 'shared_or_other';
}

function toRepositoryPath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join('/');
}

async function safeStat(path) {
  try { return await stat(path); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}