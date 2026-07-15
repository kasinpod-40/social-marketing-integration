import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findBlockedReleasePaths,
  findDuplicateArtifactHashes,
  findMissingRequiredReleasePaths,
  normalizeReleasePath,
  parseManifestFilePaths,
  REQUIRED_RELEASE_PATHS,
  scanReleaseTextFiles,
} from '../../scripts/lib/release-archive-policy.js';

test('release policy normalizes safe paths and blocks local or generated content', () => {
  assert.equal(normalizeReleasePath('./docs/file.md'), 'docs/file.md');
  assert.throws(() => normalizeReleasePath('../secret'), /Unsafe release path/u);
  assert.deepEqual(findBlockedReleasePaths(['tests/release/policy.test.js']), []);
  assert.deepEqual(findBlockedReleasePaths([
    'AGENTS.md',
    '.dev.vars',
    'wrangler.sync.jsonc',
    'node_modules/pkg/index.js',
    'docs/.DS_Store',
    'outputs/release.zip',
  ]), [
    '.dev.vars',
    'docs/.DS_Store',
    'node_modules/pkg/index.js',
    'outputs/release.zip',
    'wrangler.sync.jsonc',
  ]);
});

test('release policy enforces required handoff files and manifest', () => {
  assert.deepEqual(findMissingRequiredReleasePaths(REQUIRED_RELEASE_PATHS), ['RELEASE_MANIFEST.txt']);
  assert.deepEqual(findMissingRequiredReleasePaths(REQUIRED_RELEASE_PATHS, { includeManifest: false }), []);
  assert.deepEqual(parseManifestFilePaths('file\tREADME.md\nfile\tAGENTS.md\n'), [
    'AGENTS.md',
    'README.md',
  ]);
});

test('release policy finds duplicate binary artifacts by SHA-256', () => {
  const duplicateHash = 'a'.repeat(64);
  assert.deepEqual(findDuplicateArtifactHashes([
    { path: 'docs/blueprint.xlsx', sha256: duplicateHash },
    { path: 'copy/blueprint.xlsx', sha256: duplicateHash },
    { path: 'docs/readme.md', sha256: duplicateHash },
  ]), [{
    sha256: duplicateHash,
    paths: ['copy/blueprint.xlsx', 'docs/blueprint.xlsx'],
  }]);
});

test('release text scan permits placeholders but blocks credentials and DEV Table IDs', () => {
  assert.deepEqual(scanReleaseTextFiles([{
    path: '.dev.vars.example',
    content: 'LARK_APP_SECRET=replace-with-app-secret\nYOUTUBE_API_KEY=replace-with-youtube-api-key\n',
  }]), []);

  const findings = scanReleaseTextFiles([{
    path: 'docs/internal.md',
    content: 'LARK_APP_SECRET=live-secret-value\nMKT_Content=tblDcT7CVveNlNpP\n',
  }]);
  assert.deepEqual(findings.map((finding) => finding.code).sort(), [
    'CREDENTIAL_ASSIGNMENT',
    'DEV_LARK_TABLE_ID',
  ]);
});
