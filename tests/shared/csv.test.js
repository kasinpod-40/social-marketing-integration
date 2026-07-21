import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvRecords, parseCsvRows } from '../../packages/shared/src/text/csv.js';

test('parses quoted commas, escaped quotes and newlines', () => {
  const text = 'name,note\r\nalpha,"one,two"\r\nbeta,"line 1\nline 2"\r\ngamma,"say ""hi"""\r\n';
  assert.deepEqual(parseCsvRows(text), [
    ['name', 'note'], ['alpha', 'one,two'], ['beta', 'line 1\nline 2'], ['gamma', 'say "hi"'],
  ]);
  assert.deepEqual(parseCsvRecords(text), [
    { name: 'alpha', note: 'one,two' }, { name: 'beta', note: 'line 1\nline 2' }, { name: 'gamma', note: 'say "hi"' },
  ]);
});

test('rejects malformed CSV contracts', () => {
  assert.throws(() => parseCsvRows('a,"unterminated'), /unterminated/u);
  assert.throws(() => parseCsvRecords('a,a\n1,2\n'), /headers must be unique/u);
  assert.throws(() => parseCsvRecords('a\n1,2\n'), /more columns/u);
});
