import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const preloadPath = resolve(
  repositoryRoot,
  'scripts',
  'meta-d1-only-generated-config-clock-preload.mjs',
);

test('Meta D1 preload makes generated config timestamps strictly unique', async () => {
  const script = `
    const values = Array.from({ length: 1000 }, () => Date.now());
    const strictlyIncreasing = values.every((value, index) => index === 0 || value > values[index - 1]);
    const names = [
      \`.meta-d1-only-\${process.pid}-\${Date.now()}-wrangler.jsonc\`,
      \`.meta-d1-only-\${process.pid}-\${Date.now()}-wrangler.jsonc\`,
    ];
    process.stdout.write(JSON.stringify({ strictlyIncreasing, namesUnique: names[0] !== names[1] }));
  `;
  const result = await execFileAsync(process.execPath, [
    '--import',
    new URL(`file://${preloadPath}`).href,
    '--input-type=module',
    '--eval',
    script,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.strictlyIncreasing, true);
  assert.equal(observed.namesUnique, true);
});

test('Meta D1 launcher loads the generated config clock before the operator', async () => {
  const launcher = await readFile(
    resolve(repositoryRoot, 'scripts', 'meta-d1-only-rollout-launcher.mjs'),
    'utf8',
  );
  assert.match(launcher, /meta-d1-only-generated-config-clock-preload\.mjs/u);
  assert.match(launcher, /'--import'/u);
  assert.match(launcher, /generatedConfigClockPreloadPath/u);
});
