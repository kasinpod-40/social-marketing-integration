#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  applyMetaHistoryCustomerRuntimeEnvironment,
  applyMetaHistoryLarkRuntimeEnvironment,
  materializeMetaHistoryLarkRuntimeConfig,
} from './lib/meta-history-runtime-authority.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const operatorPath = process.env.MKT_META_LARK_OPERATOR_PATH
  ? resolve(process.env.MKT_META_LARK_OPERATOR_PATH)
  : join(repositoryRoot, 'scripts', 'meta-lark-parity-rollout-operator.mjs');
const shimModulePath = join(
  repositoryRoot,
  'scripts',
  'meta-d1-only-wrangler-compat-shim.mjs',
);
const generatedConfigClockPreloadPath = join(
  repositoryRoot,
  'scripts',
  'meta-d1-only-generated-config-clock-preload.mjs',
);

let tempDirectory = null;
try {
  let runtimeEnvironment = applyMetaHistoryCustomerRuntimeEnvironment(process.env);
  const realNpx = await resolveRealNpx();
  tempDirectory = await mkdtemp(join(tmpdir(), 'meta-lark-wrangler-compat-'));
  const shimExecutable = join(tempDirectory, 'npx');
  await writeFile(
    shimExecutable,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(shimModulePath).href)};\n`,
    { encoding: 'utf8', mode: 0o700 },
  );
  await chmod(shimExecutable, 0o700);

  const originalConfig = process.env.MKT_META_LARK_WRANGLER_CONFIG
    ? resolve(repositoryRoot, process.env.MKT_META_LARK_WRANGLER_CONFIG)
    : null;
  const runtimeConfig = originalConfig
    ? join(dirname(originalConfig), 'wrangler.meta-history.runtime.jsonc')
    : null;
  if (originalConfig && runtimeConfig) {
    const sourceText = await readFile(originalConfig, 'utf8');
    runtimeEnvironment = applyMetaHistoryLarkRuntimeEnvironment(
      sourceText,
      runtimeEnvironment,
    );
    await writeFile(
      runtimeConfig,
      materializeMetaHistoryLarkRuntimeConfig(sourceText, runtimeEnvironment),
      { encoding: 'utf8', mode: 0o600 },
    );
    await chmod(runtimeConfig, 0o600);
  }

  const childEnv = {
    ...runtimeEnvironment,
    PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ''}`,
    MKT_META_D1_ONLY_REAL_NPX: realNpx,
    MKT_META_D1_ONLY_COMPAT_TEMP_DIR: tempDirectory,
    ...(runtimeConfig
      ? {
          MKT_META_LARK_WRANGLER_CONFIG: runtimeConfig,
          MKT_META_D1_ONLY_COMPAT_ORIGINAL_CONFIG: runtimeConfig,
        }
      : {}),
  };

  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(generatedConfigClockPreloadPath).href,
      operatorPath,
      ...process.argv.slice(2),
    ],
    {
      cwd: repositoryRoot,
      env: childEnv,
      stdio: 'inherit',
    },
  );
  const result = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });

  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_LARK_WRANGLER_COMPAT_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

async function resolveRealNpx() {
  const explicit = process.env.MKT_META_D1_ONLY_REAL_NPX;
  if (explicit) return requireAbsolutePath(explicit, 'MKT_META_D1_ONLY_REAL_NPX');
  const result = await execFileAsync('which', ['npx'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  });
  return requireAbsolutePath(result.stdout.trim(), 'resolved npx path');
}

function requireAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'META_LARK_WRANGLER_COMPAT_LAUNCHER_INPUT_REQUIRED';
    throw error;
  }
  const absolute = resolve(value.trim());
  if (absolute !== value.trim()) {
    const error = new Error(`${fieldName} must be an absolute path`);
    error.code = 'META_LARK_WRANGLER_COMPAT_LAUNCHER_INPUT_INVALID';
    throw error;
  }
  return absolute;
}
