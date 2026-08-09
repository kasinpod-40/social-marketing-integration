import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  LARK_TABLE_ENV,
} from '../../packages/config/src/lark-table-config.js';

const repositoryRoot = resolve(process.cwd());
const launcherPath = join(repositoryRoot, 'scripts', 'meta-lark-parity-rollout-launcher.mjs');

test('Meta Lark launcher loads required table mappings from .dev.vars before safe-config hydration', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'meta-lark-launcher-dev-vars-'));
  try {
    const mappings = Object.fromEntries(
      META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((tableKey, index) => [
        LARK_TABLE_ENV[tableKey],
        `tbl_devvars_${String(index + 1).padStart(2, '0')}`,
      ]),
    );
    const devVarsPath = join(tempDirectory, '.dev.vars');
    const configPath = join(tempDirectory, 'wrangler.sync.jsonc');
    const operatorPath = join(tempDirectory, 'fake-meta-lark-operator.mjs');
    const resultPath = join(tempDirectory, 'child-env.json');

    await writeFile(
      devVarsPath,
      `${Object.entries(mappings).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
      'utf8',
    );
    await writeFile(
      configPath,
      JSON.stringify({ name: 'social-mkt-sync-worker', vars: {} }, null, 2),
      'utf8',
    );
    await writeFile(
      operatorPath,
      `import { writeFile } from 'node:fs/promises';\nconst keys = ${JSON.stringify(Object.keys(mappings))};\nawait writeFile(process.env.TEST_META_LARK_CHILD_ENV_PATH, JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))), 'utf8');\n`,
      'utf8',
    );

    const result = await runLauncher({
      DEV_VARS_FILE: devVarsPath,
      MKT_META_LARK_OPERATOR_PATH: operatorPath,
      MKT_META_LARK_WRANGLER_CONFIG: configPath,
      TEST_META_LARK_CHILD_ENV_PATH: resultPath,
      ...Object.fromEntries(Object.keys(mappings).map((key) => [key, undefined])),
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const childEnvironment = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.deepEqual(childEnvironment, mappings);

    const generatedConfig = await readFile(
      join(tempDirectory, 'wrangler.meta-history.runtime.jsonc'),
      'utf8',
    );
    for (const [envName, tableId] of Object.entries(mappings)) {
      assert.match(
        generatedConfig,
        new RegExp(`"${envName}"\\s*:\\s*"${tableId}"`, 'u'),
      );
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

async function runLauncher(overrides) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const child = spawn(
    process.execPath,
    [launcherPath, '--phase=lark-preflight', '--execute'],
    {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolveCode, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => resolveCode(exitCode ?? 1));
  });
  return { code, stdout, stderr };
}
