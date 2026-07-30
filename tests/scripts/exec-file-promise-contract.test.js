import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { attachExecFilePromiseContract } from '../../scripts/lib/exec-file-promise-contract.js';

test('wrapped execFile preserves stdout/stderr result and child handle through util.promisify', async () => {
  const child = { pid: 1234 };
  const wrapped = attachExecFilePromiseContract((file, args, options, callback) => {
    queueMicrotask(() => callback(null, `${file}:${args.join(',')}`, options.encoding));
    return child;
  });

  const pending = promisify(wrapped)('node', ['--version'], { encoding: 'utf8' });
  assert.equal(pending.child, child);
  assert.deepEqual(await pending, {
    stdout: 'node:--version',
    stderr: 'utf8',
  });
});

test('wrapped execFile rejection retains stdout and stderr diagnostics', async () => {
  const failure = Object.assign(new Error('failed'), { code: 1 });
  const wrapped = attachExecFilePromiseContract((file, args, options, callback) => {
    queueMicrotask(() => callback(failure, 'partial stdout', 'partial stderr'));
    return { pid: 5678 };
  });

  await assert.rejects(
    promisify(wrapped)('node', ['script.js'], {}),
    (error) => (
      error === failure
      && error.stdout === 'partial stdout'
      && error.stderr === 'partial stderr'
    ),
  );
});
