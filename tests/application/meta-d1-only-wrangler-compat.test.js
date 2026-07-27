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

test('Meta D1 Wrangler compatibility rebases operator config and emits deterministic outfile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-d1-compat-test-'));
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
    const configText = JSON.stringify({
      name: 'social-mkt-sync-worker',
      main: '../../apps/sync-worker/src/index.js',
      $schema: '../../node_modules/wrangler/config-schema.json',
      d1_databases: [{ migrations_dir: '../../migrations' }],
    }, null, 2);

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
    assert.equal(prepared.args.includes('--outdir'), false);
    assert.equal(prepared.args.includes('--outfile'), true);
    assert.equal(
      prepared.args[prepared.args.indexOf('--outfile') + 1],
      join(outputDirectory, 'worker.js'),
    );
    assert.equal(
      prepared.args[prepared.args.indexOf('--config') + 1],
      prepared.normalizedConfigPath,
    );

    const normalized = JSON.parse(
      await readFile(prepared.normalizedConfigPath, 'utf8'),
    );
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

test('Meta D1 Wrangler compatibility preserves non-dry-run arguments while normalizing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-d1-compat-read-test-'));
  try {
    const repository = join(root, 'repository');
    const configPath = join(repository, 'outputs', 'safe', 'wrangler.jsonc');
    const tempDirectory = join(root, 'compat');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      name: 'social-mkt-sync-worker',
      main: '../../apps/sync-worker/src/index.js',
    }));

    const prepared = await prepareMetaD1OnlyWranglerInvocation([
      'wrangler',
      'd1',
      'migrations',
      'list',
      'MKT_STATE_DB',
      '--remote',
      '--config',
      configPath,
    ], {
      cwd: repository,
      tempDirectory,
      originalConfigPath: configPath,
    });

    assert.deepEqual(prepared.args.slice(0, 6), [
      'wrangler',
      'd1',
      'migrations',
      'list',
      'MKT_STATE_DB',
      '--remote',
    ]);
    assert.equal(prepared.dryRunOutfileNormalized, false);
    assert.equal(prepared.args.includes('--outdir'), false);
    assert.equal(prepared.args.includes('--outfile'), false);
    assert.equal(prepared.configNormalized, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Meta D1 Wrangler compatibility fails closed on unsafe output arguments and missing origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-d1-compat-invalid-test-'));
  try {
    const generatedConfig = join(root, '.meta-d1-only-generated.jsonc');
    await writeFile(generatedConfig, JSON.stringify({ main: './worker.js' }));

    await assert.rejects(
      prepareMetaD1OnlyWranglerInvocation([
        'wrangler', 'deploy', '--dry-run', '--outdir', join(root, 'out'),
        '--outfile', join(root, 'other.js'), '--config', generatedConfig,
      ], {
        cwd: root,
        tempDirectory: join(root, 'compat'),
        originalConfigPath: join(root, 'reviewed.jsonc'),
      }),
      (error) => error.code === 'META_D1_WRANGLER_COMPAT_OUTPUT_ARGUMENT_INVALID',
    );

    await assert.rejects(
      prepareMetaD1OnlyWranglerInvocation([
        'wrangler', 'deploy', '--dry-run', '--config', generatedConfig,
      ], {
        cwd: root,
        tempDirectory: join(root, 'compat-2'),
      }),
      (error) => error.code === 'META_D1_WRANGLER_COMPAT_ORIGINAL_CONFIG_REQUIRED',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
