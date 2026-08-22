import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/customer-base-view-order-audit.mjs');

function writeFixture(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

function run(source, target) {
  return spawnSync(process.execPath, [script, '--source', source, '--target', target], {
    encoding: 'utf8',
  });
}

test('passes when source and target view field order are exact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-order-pass-'));
  const source = writeFixture(dir, 'source.json', [{ tableName: 'T', viewName: 'V', fieldOrder: ['a', 'b'] }]);
  const target = writeFixture(dir, 'target.json', [{ tableName: 'T', viewName: 'V', fieldOrder: ['a', 'b'] }]);
  const result = run(source, target);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.fieldOrderMismatchCount, 0);
  assert.equal(output.widthInScope, false);
});

test('blocks when field order differs even when the same fields are present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-order-fail-'));
  const source = writeFixture(dir, 'source.json', [{ tableName: 'T', viewName: 'V', fieldOrder: ['a', 'b', 'c'] }]);
  const target = writeFixture(dir, 'target.json', [{ tableName: 'T', viewName: 'V', fieldOrder: ['a', 'c', 'b'] }]);
  const result = run(source, target);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.fieldOrderMismatchCount, 1);
  assert.deepEqual(output.mismatches[0].expected, ['a', 'b', 'c']);
  assert.deepEqual(output.mismatches[0].actual, ['a', 'c', 'b']);
});

test('excludes entries explicitly marked protected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-order-protected-'));
  const source = writeFixture(dir, 'source.json', [
    { tableName: 'Protected', viewName: 'V', fieldOrder: ['a', 'b'], protected: true },
    { tableName: 'T', viewName: 'V', fieldOrder: ['a', 'b'] },
  ]);
  const target = writeFixture(dir, 'target.json', [
    { tableName: 'T', viewName: 'V', fieldOrder: ['a', 'b'] },
  ]);
  const result = run(source, target);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sourceViewCount, 1);
  assert.equal(output.targetViewCount, 1);
});
