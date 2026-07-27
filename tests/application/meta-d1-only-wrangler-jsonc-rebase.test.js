import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  prepareMetaD1OnlyWranglerInvocation,
} from '../../scripts/lib/meta-d1-only-wrangler-compat.js';

test('Meta D1 Wrangler compatibility accepts JSONC operator configs and emits strict JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-d1-jsonc-rebase-'));
  try {
    const repository = join(root, 'repository');
    const originalConfig = join(
      repository,
      'outputs',
      'meta-fasttrack-config',
      'wrangler.meta-fasttrack.safe.jsonc',
    );
    const operatorConfig = join(
      repository,
      '.meta-d1-only-123-wrangler.meta-fasttrack.safe.jsonc',
    );
    const tempDirectory = join(root, 'compat');
    const outputDirectory = join(root, 'bundle');
    const configText = `{
      // Wrangler files are JSONC and may retain comments during guarded config windows.
      "$schema": "../../node_modules/wrangler/config-schema.json",
      "name": "social-mkt-sync-worker",
      "main": "../../apps/sync-worker/src/index.js",
      "d1_databases": [
        {
          "binding": "MKT_STATE_DB",
          "migrations_dir": "../../migrations",
        },
      ],
    }`;

    await mkdir(dirname(originalConfig), { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(originalConfig, configText);
    await writeFile(operatorConfig, configText);

    const prepared = await prepareMetaD1OnlyWranglerInvocation([
      'wrangler',
      'deploy',
      '--dry-run',
      '--outdir',
      outputDirectory,
      '--config',
      operatorConfig,
    ], {
      cwd: repository,
      tempDirectory,
      originalConfigPath: originalConfig,
    });

    assert.equal(prepared.configNormalized, true);
    assert.equal(prepared.dryRunOutfileNormalized, true);
    assert.equal(prepared.dryRunOutputPath, join(outputDirectory, 'worker.js'));

    const normalizedText = await readFile(prepared.normalizedConfigPath, 'utf8');
    const normalized = JSON.parse(normalizedText);
    assert.equal(normalizedText.includes('//'), false);
    assert.equal(
      resolve(dirname(prepared.normalizedConfigPath), normalized.main),
      join(repository, 'apps', 'sync-worker', 'src', 'index.js'),
    );
    assert.equal(
      resolve(dirname(prepared.normalizedConfigPath), normalized.$schema),
      join(repository, 'node_modules', 'wrangler', 'config-schema.json'),
    );
    assert.equal(
      resolve(
        dirname(prepared.normalizedConfigPath),
        normalized.d1_databases[0].migrations_dir,
      ),
      join(repository, 'migrations'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Meta D1 Wrangler compatibility still rejects malformed JSONC', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-d1-jsonc-invalid-'));
  try {
    const configPath = join(root, 'wrangler.jsonc');
    await writeFile(configPath, '{ "main": "./worker.js", invalid }');

    await assert.rejects(
      prepareMetaD1OnlyWranglerInvocation([
        'wrangler', 'deploy', '--dry-run', '--outdir', join(root, 'out'),
        '--config', configPath,
      ], {
        cwd: root,
        tempDirectory: join(root, 'compat'),
        originalConfigPath: configPath,
      }),
      (error) => error.code === 'CHATWOOT_SAFE_CONFIG_GENERATED_JSON_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
